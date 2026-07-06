"""\npresentation_integration.py\n============================\nStatic integration module for the Presentation & Video Generation Agent.\n\nThis module is intentionally *route-only* now. Presentation execution is wired\nper-agent inside agent_runner.py with the same lifecycle semantics as the other\nSDLC agents, including the required Human Review Checkpoint 2 approval gate.\n\nIt registers presentation API routes onto the existing FastAPI router during\nstartup via main_extension.py.\n\nHOW TO USE\n----------\nAdd these lines to the bottom of main_extension.py (after the last route):\n\n    from . import presentation_integration  # noqa: F401\n"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def integrate() -> None:

    """Perform all integration steps. Called once on module import."""

    # ── Step 2: Extend PIPELINE and _AGENT_CONFIG in agent_runner ─────────
    try:
        from . import agent_runner
        from .models import ArtifactType, AgentName

        agent_key = AgentName.PRESENTATION_VIDEO_AGENT.value
        agent_art_type = ArtifactType.PRESENTATION.value

        # Insert after REVIEW_2 in the pipeline if not already present
        if agent_key not in agent_runner.PIPELINE:
            try:
                review2_idx = agent_runner.PIPELINE.index(AgentName.REVIEW_2.value)
                agent_runner.PIPELINE.insert(review2_idx + 1, agent_key)
                logger.info("[PresentationIntegration] Inserted %s at pipeline position %d", agent_key, review2_idx + 1)
            except ValueError:
                # REVIEW_2 not found — append at end
                agent_runner.PIPELINE.append(agent_key)
                logger.info("[PresentationIntegration] REVIEW_2 not found; appended %s at end of pipeline", agent_key)

        # Register agent config
        if agent_key not in agent_runner._AGENT_CONFIG:
            agent_runner._AGENT_CONFIG[agent_key] = {
                "generate": "generate_presentation",
                "artifact_type": agent_art_type,
                "approval": False,
                "stage": "Presentation & Video Generation",
            }
            logger.info("[PresentationIntegration] Registered _AGENT_CONFIG for %s", agent_key)

    except Exception as exc:
        logger.error("[PresentationIntegration] agent_runner patching failed: %s", exc)

    # ── Step 3: Register ai_service.generate_presentation function ────────
    try:
        from . import ai_service
        from .agents.presentation_video_agent import PresentationVideoAgent

        def generate_presentation(db, project_id: int, context: str) -> dict:
            """
            ai_service wrapper for the Presentation & Video Agent.
            Called by agent_runner._execute_agent when generate='generate_presentation'.
            """
            try:
                agent = PresentationVideoAgent(db=db, project_id=project_id)

                # Build full artifact context (not just the slim context string)
                from .models import GeneratedArtifact
                artifacts = (
                    db.query(GeneratedArtifact)
                    .filter(GeneratedArtifact.project_id == project_id)
                    .order_by(GeneratedArtifact.created_at.asc())
                    .all()
                )
                ctx_parts = [f"Context: {context}\n"]
                for art in artifacts:
                    content = (art.content or "")[:2000]
                    ctx_parts.append(f"=== {art.artifact_type} ===\n{content}\n")
                full_context = "\n".join(ctx_parts)

                return agent.run(
                    artifacts_context=full_context,
                    presentation_tone="executive",
                    target_audience="C-suite executives and engineering leadership",
                    generate_video=False,
                )
            except Exception as exc:
                logger.error("[generate_presentation] Failed: %s", exc, exc_info=True)
                # Return minimal valid structure so artifact save doesn't fail
                return {
                    "executive_summary": f"Presentation generation failed: {exc}",
                    "slide_outline": [],
                    "speaker_notes": [],
                    "storyboard": [],
                    "presentation_script": "",
                    "quality_score": 0,
                    "error": str(exc),
                }

        if not hasattr(ai_service, "generate_presentation"):
            ai_service.generate_presentation = generate_presentation
            logger.info("[PresentationIntegration] Registered ai_service.generate_presentation")

    except Exception as exc:
        logger.error("[PresentationIntegration] ai_service registration failed: %s", exc)

    # ── Step 3b: Register ai_service.generate_presentation_video function ─
    # Mirrors Step 3 above exactly (same registration convention used
    # throughout this module) — adds video/avatar rendering without touching
    # ai_service.py directly, consistent with how generate_presentation itself
    # is attached.
    try:
        from . import ai_service
        from .agents.presentation_video_agent import VideoGenerationPipeline
        from .services.video_generation_service import VoiceConfig as _PipelineVoiceConfig
        from .services.video_generation_service import AvatarRenderConfig as _PipelineAvatarConfig
        from .pptx_builder import build_pptx

        def generate_presentation_video(db, project_id: int, context: str, **kwargs) -> dict:
            """
            ai_service wrapper for the Presentation Video Generation Pipeline.
            Renders a narrated MP4 (and, if avatar_enabled, a Hedra AI avatar
            MP4) from the project's latest PRESENTATION artifact. Returns a
            plain dict (not persisted here — persistence/artifact creation is
            handled by the dedicated POST /presentation/video/generate route,
            same separation already used for generate_presentation/_register).
            """
            try:
                from .models import GeneratedArtifact, ArtifactType, Project
                import json as _json

                project = db.get(Project, project_id)
                artifact = (
                    db.query(GeneratedArtifact)
                    .filter(
                        GeneratedArtifact.project_id == project_id,
                        GeneratedArtifact.artifact_type == ArtifactType.PRESENTATION.value,
                    )
                    .order_by(GeneratedArtifact.created_at.desc())
                    .first()
                )
                if not artifact:
                    raise ValueError("No PRESENTATION artifact found; run generate_presentation first.")

                data = _json.loads(artifact.content)
                pptx_spec = data.get("pptx_spec", {})
                pptx_bytes = build_pptx(pptx_spec, project_name=project.name if project else "Presentation")

                voice_cfg = _PipelineVoiceConfig(**kwargs.get("voice_config", {}))
                avatar_cfg = _PipelineAvatarConfig(**kwargs.get("avatar_config", {}))

                pipeline = VideoGenerationPipeline()
                result = pipeline.run(
                    pptx_bytes=pptx_bytes,
                    slides=pptx_spec.get("slides", []),
                    full_script=data.get("presentation_script", ""),
                    voice_config=voice_cfg,
                    avatar_config=avatar_cfg,
                    video_enabled=kwargs.get("video_enabled", True),
                )
                return result.model_dump()
            except Exception as exc:
                logger.error("[generate_presentation_video] Failed: %s", exc, exc_info=True)
                return {
                    "video_available": False,
                    "avatar_available": False,
                    "error": str(exc),
                }

        if not hasattr(ai_service, "generate_presentation_video"):
            ai_service.generate_presentation_video = generate_presentation_video
            logger.info("[PresentationIntegration] Registered ai_service.generate_presentation_video")

    except Exception as exc:
        logger.error("[PresentationIntegration] ai_service video registration failed: %s", exc)

    # ── Step 4: Register routes onto the extension router ─────────────────
    # This MUST succeed or the application should fail to start
    try:
        from .main_extension import router
        from .main import get_current_user, get_db
        from .models import (
            GeneratedArtifact, ArtifactType, AgentRun, RunStatus,
            TimelineEvent, Approval, ApprovalStatus, Project,
        )
        from .ws_manager import manager
        from .presentation_routes import _register

        # Build the models dict the route factory needs
        models_dict = {
            "GeneratedArtifact": GeneratedArtifact,
            "ArtifactType": ArtifactType,
            "AgentRun": AgentRun,
            "RunStatus": RunStatus,
            "TimelineEvent": TimelineEvent,
            "Approval": Approval,
            "ApprovalStatus": ApprovalStatus,
            "Project": Project,
        }

        # Try to add ProviderConfiguration if it exists
        try:
            from .models import ProviderConfiguration
            models_dict["ProviderConfiguration"] = ProviderConfiguration
        except ImportError:
            pass

        # Register routes - raise exception on failure to fail startup
        _register(router, get_db, get_current_user, models_dict, manager)
        logger.info("[PresentationIntegration] Routes registered successfully")
    except Exception as exc:
        logger.error("[PresentationIntegration] Route registration failed: %s", exc, exc_info=True)
        raise RuntimeError(f"Failed to register presentation routes: {exc}") from exc

    # ── Step 5: Ensure pipeline creates agent_run rows for presentation agent
    try:
        from . import agent_runner
        _original_ensure = agent_runner.ensure_agent_runs_exist

        def _patched_ensure(db, project_id):
            runs = _original_ensure(db, project_id)
            # The PIPELINE list now includes presentation_video_agent,
            # so ensure_agent_runs_exist will create the row automatically.
            return runs

        agent_runner.ensure_agent_runs_exist = _patched_ensure

    except Exception as exc:
        logger.warning("[PresentationIntegration] ensure_agent_runs_exist patch skipped: %s", exc)

    # Step 6 intentionally removed.
    # Presentation execution is handled by agent_runner.run_pipeline() directly
    # with the required Human Review Checkpoint 2 approval gate.
    # Avoid monkey-patching run_pipeline to prevent duplicate execution and
    # inconsistent lifecycle events.


    logger.info("[PresentationIntegration] All integration steps complete")


# Run integration on module import
integrate()
