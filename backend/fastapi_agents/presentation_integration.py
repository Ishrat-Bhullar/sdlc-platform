"""\npresentation_integration.py\n============================\nStatic integration module for the Presentation & Video Generation Agent.\n\nThis module is intentionally *route-only* now. Presentation execution is wired\nper-agent inside agent_runner.py with the same lifecycle semantics as the other\nSDLC agents, including the required Human Review Checkpoint 2 approval gate.\n\nIt registers presentation API routes onto the existing FastAPI router during\nstartup via main_extension.py.\n\nHOW TO USE\n----------\nAdd these lines to the bottom of main_extension.py (after the last route):\n\n    from . import presentation_integration  # noqa: F401\n"""
from __future__ import annotations

from .logging_config import get_logger

logger = get_logger(__name__)


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

    # Step 3 / Step 3b removed: these used to monkey-patch
    # ai_service.generate_presentation / generate_presentation_video onto the
    # ai_service module at startup. As of the agents/<name>/ architectural
    # refactor, nothing reads those attributes anymore — agent_runner.py
    # dispatches to PresentationVideoAgent.generate(...) directly via
    # AgentFactory (agents/registry.py), and presentation_routes.py already
    # imports PresentationVideoAgent / VideoGenerationPipeline directly from
    # agents/presentation/ rather than going through ai_service. Verified via
    # a full-codebase search: no caller ever read
    # ai_service.generate_presentation or ai_service.generate_presentation_video.

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
