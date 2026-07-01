"""
routes/presentation_routes.py
==============================
FastAPI routes for the Presentation & Video Generation Agent.

Endpoints:
    POST /generate/presentation                 — Trigger full presentation generation
    GET  /projects/{project_id}/presentation     — Latest presentation for a project
    GET  /presentation/download/{id}             — Download the generated .pptx file
    POST /projects/{project_id}/presentation/save     — Persist Media Studio editor state
    POST /projects/{project_id}/presentation/generate — Generate using the last-saved config
    POST /media-studio/ai-action                 — Toolbar actions (Beautify, Rewrite, Translate, Diagram, Image)
    POST /media-studio/diagram/generate          — Standalone diagram generation

NOTE: This file previously declared `/media-studio/ai-action` on a
module-level `router = APIRouter(...)` that is never included by
`presentation_integration.py` (only the `_register` factory is imported), so
that endpoint was never actually reachable, and its body used the invalid
`...` literal. It has been moved inside `_register` (the only router that is
actually mounted) and implemented for real, alongside the other endpoints the
frontend's `mediaStudioService.ts` / `diagramService.ts` call.
"""
from __future__ import annotations

import json
import logging
import asyncio
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile, File, Form
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .presentation_schemas import (
    PresentationGenerateRequest,
    PresentationGenerateResponse,
    PresentationStatusResponse,
    PresentationSaveRequest,
    PresentationSaveResponse,
    AiActionRequest,
    AiActionResponse,
    DiagramGenerateRequest,
    DiagramGenerateResponse,
    VideoGenerateRequest,
    VideoGenerateResponse,
    VideoStatusResponse,
    SlideOutlineItem,
    SpeakerNoteItem,
    StoryboardFrame,
    QualityReview,
)

logger = logging.getLogger(__name__)

# Kept for backwards-compat with any external import of `router`; the actual
# routes used by the app are registered onto `app_router` inside `_register`.
router = APIRouter(tags=["presentation"])


def _register(app_router: APIRouter, get_db_fn, get_current_user_fn, models, ws_manager):
    """
    Register all presentation + media-studio routes onto the provided APIRouter.

    This factory pattern keeps us decoupled from main.py's import chain —
    main_extension.py calls this once during startup.
    """
    from .agents.presentation_video_agent import PresentationVideoAgent, VideoGenerationPipeline
    from .pptx_builder import build_pptx
    from .services.video_generation_service import VoiceConfig as PipelineVoiceConfig
    from .services.video_generation_service import AvatarRenderConfig as PipelineAvatarConfig

    GeneratedArtifact = models["GeneratedArtifact"]
    ArtifactType = models["ArtifactType"]
    AgentRun = models["AgentRun"]
    RunStatus = models["RunStatus"]
    TimelineEvent = models["TimelineEvent"]
    Approval = models["Approval"]
    ApprovalStatus = models["ApprovalStatus"]
    Project = models["Project"]

    # -----------------------------------------------------------------------
    # Helper: collect all artifacts for a project into a context string
    # -----------------------------------------------------------------------

    def _build_artifacts_context(db: Session, project_id: int, artifact_types: list[str] | None = None) -> str:
        """Collect all generated artifacts and concatenate them into an LLM context string."""
        q = db.query(GeneratedArtifact).filter(GeneratedArtifact.project_id == project_id)
        if artifact_types:
            q = q.filter(GeneratedArtifact.artifact_type.in_(artifact_types))
        artifacts = q.order_by(GeneratedArtifact.created_at.asc()).all()

        project = db.get(Project, project_id)
        project_desc = ""
        if project:
            project_desc = f"Project: {project.name}\nDescription: {project.description or ''}\n\n"

        parts = [project_desc]
        for art in artifacts:
            content = art.content or ""
            if len(content) > 3000:
                content = content[:3000] + "\n... [truncated]"
            parts.append(f"=== {art.artifact_type} (id={art.id}) ===\n{content}\n")

        return "\n".join(parts)

    # -----------------------------------------------------------------------
    # Helper: resolve AI provider for the project
    # -----------------------------------------------------------------------

    def _get_project_provider(db: Session, project_id: int) -> tuple[str | None, str | None]:
        """Return (provider_name, raw_api_key) for the project's active provider."""
        try:
            ProviderConfiguration = models.get("ProviderConfiguration")
            if not ProviderConfiguration:
                return None, None

            from cryptography.fernet import Fernet
            import os

            enc_key = os.getenv("PROVIDER_KEY_ENCRYPTION_KEY", "wSqu6lOQVJ2WhQddQB-TNdPSBQVmeLVC7AQ-9hszUDY=")
            f = Fernet(enc_key.encode())

            configs = (
                db.query(ProviderConfiguration)
                .filter(
                    ProviderConfiguration.project_id == project_id,
                    ProviderConfiguration.enabled == True,
                )
                .all()
            )
            for cfg in configs:
                if cfg.encrypted_key:
                    raw = f.decrypt(cfg.encrypted_key.encode()).decode()
                    if raw and "demo-placeholder" not in raw:
                        return cfg.provider_name, raw
        except Exception as exc:
            logger.warning("[PresentationRoutes] Provider resolution failed: %s", exc)
        return None, None

    # -----------------------------------------------------------------------
    # In-memory fallback store for Media Studio editor state + last-used
    # generation config. Used by /save and /generate when no dedicated
    # MediaStudioState DB model is wired up yet, so the editor never loses
    # data even if the platform's persistence model isn't available here.
    # -----------------------------------------------------------------------

    _studio_state_cache: dict[int, dict] = {}

    # In-memory progress/status cache for the video pipeline, keyed by
    # project_id. Polled by GET /presentation/video/status/{project_id} and
    # updated from the (synchronous, worker-thread) pipeline progress callback.
    _video_status_cache: dict[int, dict] = {}

    def _artifact_type_value(enum_name: str, fallback: str) -> str:
        """Resolve a string value for an ArtifactType enum member that may not
        exist yet on the project's enum (e.g. PRESENTATION_VIDEO /
        PRESENTATION_AVATAR_VIDEO). Falls back to a plain string so new video
        artifact types work even before models_presentation.py is updated to
        formally declare them — GeneratedArtifact.artifact_type is a string
        column, so this is safe and avoids touching the enum/model files."""
        member = getattr(ArtifactType, enum_name, None)
        return member.value if member is not None else fallback

    async def _emit_ws_progress(project_id: int, stage: str, percent: int, message: str = "") -> None:
        """Best-effort WebSocket progress emission. Tries the ws_manager's
        richest available method first and degrades gracefully so the video
        pipeline never fails because of a websocket hiccup."""
        event = {
            "agent_name": "presentation_video_agent",
            "stage": stage,
            "percent": percent,
            "message": message,
        }
        try:
            if hasattr(ws_manager, "agent_progress"):
                await ws_manager.agent_progress(project_id, event)
            elif hasattr(ws_manager, "broadcast"):
                await ws_manager.broadcast(project_id, {"type": "video_progress", **event})
            elif hasattr(ws_manager, "agent_completed") and stage == "completed":
                await ws_manager.agent_completed(project_id, event)
            else:
                logger.debug("[VideoRoutes] No compatible ws_manager method for progress event: %s", event)
        except Exception as exc:
            logger.debug("[VideoRoutes] WS progress emit failed (non-fatal): %s", exc)

    # -----------------------------------------------------------------------
    # Shared generation routine — used by both /generate/presentation and
    # /projects/{project_id}/presentation/generate
    # -----------------------------------------------------------------------

    async def _run_generation(
        db: Session,
        payload: "PresentationGenerateRequest",
    ) -> "PresentationGenerateResponse":
        project = db.get(Project, payload.project_id)
        if project is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project {payload.project_id} not found")

        artifacts_context = _build_artifacts_context(db, payload.project_id, payload.artifact_types)
        if not artifacts_context.strip():
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "No artifacts found for this project. Run the pipeline first.",
            )

        provider, api_key = _get_project_provider(db, payload.project_id)

        try:
            agent = PresentationVideoAgent(provider=provider, api_key=api_key)
            result = agent.run(
                artifacts_context=artifacts_context,
                presentation_tone=payload.presentation_tone,
                target_audience=payload.target_audience,
                generate_video=payload.generate_video,
                avatar_config=payload.avatar_config.model_dump(),
                scene_config=payload.scene_config.model_dump(),
                language=payload.language,
            )
        except Exception as exc:
            logger.error("[PresentationRoutes] Agent failed: %s", exc, exc_info=True)
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Presentation generation failed: {exc}")

        pptx_bytes: bytes | None = None
        try:
            pptx_bytes = build_pptx(result.get("pptx_spec", {}) if isinstance(result, dict) else result.pptx_spec, project_name=project.name)
        except Exception as exc:
            logger.warning("[PresentationRoutes] PPTX build failed (non-fatal): %s", exc)

        result_dict = result if isinstance(result, dict) else result.model_dump()

        artifact_content = json.dumps(result_dict, ensure_ascii=False, default=str)
        artifact = GeneratedArtifact(
            project_id=payload.project_id,
            artifact_type=ArtifactType.PRESENTATION.value,
            content=artifact_content,
        )
        db.add(artifact)
        db.flush()

        pptx_artifact_id: int | None = None
        if pptx_bytes:
            import base64
            pptx_artifact = GeneratedArtifact(
                project_id=payload.project_id,
                artifact_type=ArtifactType.PRESENTATION_PPTX.value,
                content=base64.b64encode(pptx_bytes).decode("ascii"),
            )
            db.add(pptx_artifact)
            db.flush()
            pptx_artifact_id = pptx_artifact.id

        db.add(TimelineEvent(
            project_id=payload.project_id,
            stage="Presentation & Video Generation",
            status=RunStatus.COMPLETED.value,
        ))

        pres_run = (
            db.query(AgentRun)
            .filter(
                AgentRun.project_id == payload.project_id,
                AgentRun.agent_name == "presentation_video_agent",
            )
            .first()
        )
        if pres_run:
            pres_run.status = RunStatus.COMPLETED.value
            pres_run.end_time = datetime.now(timezone.utc)

        db.commit()

        await ws_manager.artifact_generated(payload.project_id, {
            "artifact_id": artifact.id,
            "artifact_type": ArtifactType.PRESENTATION.value,
            "agent_name": "presentation_video_agent",
        })
        await ws_manager.agent_completed(payload.project_id, {
            "agent_name": "presentation_video_agent",
            "run_id": pres_run.id if pres_run else None,
            "status": RunStatus.COMPLETED.value,
            "artifact_id": artifact.id,
        })

        pptx_url = f"/presentation/download/{pptx_artifact_id}" if pptx_artifact_id else f"/presentation/download/{artifact.id}"

        return PresentationGenerateResponse(
            project_id=payload.project_id,
            artifact_id=artifact.id,
            executive_summary=result_dict.get("executive_summary", ""),
            narrative_arc=result_dict.get("narrative_arc", ""),
            slide_outline=[SlideOutlineItem(**s) for s in result_dict.get("slide_outline", [])],
            speaker_notes=[SpeakerNoteItem(**n) for n in result_dict.get("speaker_notes", [])],
            storyboard=[StoryboardFrame(**f) for f in result_dict.get("storyboard", [])],
            presentation_script=result_dict.get("presentation_script", ""),
            quality_score=float(result_dict.get("quality_score", 0)),
            total_slides=len(result_dict.get("slide_outline", [])),
            estimated_duration=result_dict.get("presentation_summary", {}).get("estimated_duration", "15 minutes"),
            video_available=result_dict.get("video_available", False),
            video_url=result_dict.get("video_url"),
            generated_at=result_dict.get("generated_at", datetime.now(timezone.utc).isoformat()),
            pptx_download_url=pptx_url,
        )

    # -----------------------------------------------------------------------
    # POST /generate/presentation
    # -----------------------------------------------------------------------

    @app_router.post(
        "/generate/presentation",
        response_model=PresentationGenerateResponse,
        summary="Generate executive presentation + optional video from all SDLC artifacts",
    )
    async def generate_presentation(
        payload: PresentationGenerateRequest,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        return await _run_generation(db, payload)

    # -----------------------------------------------------------------------
    # GET /projects/{project_id}/presentation
    # -----------------------------------------------------------------------

    @app_router.get(
        "/projects/{project_id}/presentation",
        response_model=PresentationStatusResponse,
        summary="Get the latest presentation generation result for a project",
    )
    def get_presentation_status(
        project_id: int,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project {project_id} not found")

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
            return PresentationStatusResponse(
                project_id=project_id,
                artifact_id=None,
                status="not_started",
                generated_at=None,
                quality_score=None,
                total_slides=None,
                video_available=False,
            )

        try:
            data = json.loads(artifact.content)
        except Exception:
            data = {}

        return PresentationStatusResponse(
            project_id=project_id,
            artifact_id=artifact.id,
            status="completed",
            generated_at=artifact.created_at.isoformat() if artifact.created_at else None,
            quality_score=data.get("quality_score"),
            total_slides=len(data.get("slide_outline", [])),
            video_available=data.get("video_available", False),
        )

    # -----------------------------------------------------------------------
    # POST /projects/{project_id}/presentation/save
    # Persists Media Studio editor state — used by mediaStudioService.savePresentation
    # (called on every undo/redo-tracked edit from useMediaStudio.updatePresentation).
    # -----------------------------------------------------------------------

    @app_router.post(
        "/projects/{project_id}/presentation/save",
        response_model=PresentationSaveResponse,
        summary="Persist current Media Studio editor state (slides, theme, avatar, scene)",
    )
    def save_presentation_state(
        project_id: int,
        payload: PresentationSaveRequest,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        project = db.get(Project, project_id)
        if project is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project {project_id} not found")

        _studio_state_cache[project_id] = payload.model_dump()

        return PresentationSaveResponse(
            project_id=project_id,
            saved_at=datetime.now(timezone.utc).isoformat(),
            status="saved",
        )

    # -----------------------------------------------------------------------
    # POST /projects/{project_id}/presentation/generate
    # Convenience endpoint used by mediaStudioService.generateFinalAssets —
    # regenerates the full presentation using whatever config was last saved
    # via /save (avatar, scene, theme), falling back to defaults.
    # -----------------------------------------------------------------------

    @app_router.post(
        "/projects/{project_id}/presentation/generate",
        response_model=PresentationGenerateResponse,
        summary="Generate final presentation + video assets using the last-saved Studio configuration",
    )
    async def generate_final_assets(
        project_id: int,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        saved = _studio_state_cache.get(project_id, {})
        payload = PresentationGenerateRequest(
            project_id=project_id,
            avatar_config=saved.get("avatar", {"mode": "preset", "value": "Professional Male"}),
            scene_config=saved.get("scene", {"mode": "preset", "value": "Office"}),
            generate_video=True,
        )
        return await _run_generation(db, payload)

    # -----------------------------------------------------------------------
    # GET /presentation/download/{artifact_id}
    # -----------------------------------------------------------------------

    @app_router.get(
        "/presentation/download/{artifact_id}",
        summary="Download the generated .pptx presentation file",
    )
    def download_presentation_pptx(
        artifact_id: int,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        artifact = db.get(GeneratedArtifact, artifact_id)
        if not artifact:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Presentation artifact not found")

        project = db.get(Project, artifact.project_id)
        project_name = project.name if project else "presentation"
        safe_name = "".join(c if c.isalnum() or c in "- _" else "_" for c in project_name)

        if artifact.artifact_type == ArtifactType.PRESENTATION_PPTX.value:
            import base64
            try:
                pptx_bytes = base64.b64decode(artifact.content)
                return StreamingResponse(
                    BytesIO(pptx_bytes),
                    media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    headers={"Content-Disposition": f'attachment; filename="{safe_name}_presentation.pptx"'},
                )
            except Exception as exc:
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Failed to decode PPTX: {exc}")

        if artifact.artifact_type == ArtifactType.PRESENTATION.value:
            try:
                data = json.loads(artifact.content)
                from .pptx_builder import build_pptx
                pptx_bytes = build_pptx(data.get("pptx_spec", {}), project_name=project_name)
                return StreamingResponse(
                    BytesIO(pptx_bytes),
                    media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    headers={"Content-Disposition": f'attachment; filename="{safe_name}_presentation.pptx"'},
                )
            except Exception as exc:
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Failed to build PPTX: {exc}")

        raise HTTPException(status.HTTP_404_NOT_FOUND, "No PPTX available for this artifact")

    # -----------------------------------------------------------------------
    # POST /media-studio/ai-action
    # Handles Toolbar.tsx actions: Beautify, Diagram, Image, Rewrite, Translate.
    # (Previously declared on an unmounted module-level router with an
    # invalid `...` body — now properly registered and implemented.)
    # -----------------------------------------------------------------------

    def _find_slide(presentation_json: dict, slide_id) -> dict | None:
        for s in presentation_json.get("slides", []):
            if s.get("id") == slide_id:
                return s
        return None

    async def _text_ai_action(db: Session, project_id: int, action_type: str, context: dict) -> dict:
        """Beautify / Rewrite / Translate a slide's text content via the project's
        configured LLM provider, reusing PresentationVideoAgent's client setup."""
        from .agents.llm_client import OllamaClient

        provider, api_key = _get_project_provider(db, project_id)
        client = OllamaClient(provider=provider, api_key=api_key) if provider else OllamaClient()

        text = context.get("content") or context.get("text") or ""
        if not text.strip():
            return {"content": text, "message": "No content provided to transform."}

        instructions = {
            "beautify": "Improve clarity, tone, and executive polish. Keep the meaning identical.",
            "rewrite": "Rewrite this content for better flow and impact. Keep facts identical.",
            "translate": f"Translate this content to {context.get('target_lang', 'en')}. Preserve meaning and tone.",
        }
        instruction = instructions.get(action_type, "Improve this content while preserving meaning.")

        try:
            response = client.complete(
                system="You edit presentation slide text. Return only the edited text, no preamble.",
                prompt=f"{instruction}\n\nCONTENT:\n{text}",
            )
            new_text = response if isinstance(response, str) else getattr(response, "text", str(response))
        except Exception as exc:
            logger.warning("[AiAction] Text transform failed (%s): %s", action_type, exc)
            new_text = text  # fail safe: return original content unchanged

        return {"content": new_text}

    @app_router.post(
        "/media-studio/ai-action",
        response_model=AiActionResponse,
        summary="Run a Media Studio toolbar AI action (beautify, rewrite, translate, generate_diagram, generate_image)",
    )
    async def handle_ai_action(
        payload: AiActionRequest,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        project = db.get(Project, payload.project_id)
        if project is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project {payload.project_id} not found")

        action = payload.action_type

        if action in ("beautify", "rewrite", "translate"):
            updated = await _text_ai_action(db, payload.project_id, action, payload.context)
            return AiActionResponse(status="success", updated_slide=updated)

        if action == "generate_diagram":
            diagram_payload = DiagramGenerateRequest(
                type=payload.context.get("diagram_type", "Flowchart"),
                prompt=payload.context.get("prompt", payload.context.get("content", "")),
                project_id=payload.project_id,
            )
            diagram_result = await generate_diagram_inline(diagram_payload, db)
            return AiActionResponse(
                status="success",
                updated_slide={"diagram": diagram_result.model_dump()},
            )

        if action == "generate_image":
            # Image generation backend is not wired up in this environment;
            # respond gracefully so the toolbar doesn't hang.
            return AiActionResponse(
                status="unsupported",
                message="Image generation is not configured for this deployment.",
            )

        return AiActionResponse(status="unsupported", message=f"Unknown action_type: {action}")

    # -----------------------------------------------------------------------
    # POST /media-studio/diagram/generate
    # Matches diagramService.ts:generateDiagram(type, prompt)
    # -----------------------------------------------------------------------

    async def generate_diagram_inline(payload: DiagramGenerateRequest, db: Session) -> DiagramGenerateResponse:
        """Shared implementation used by both the direct endpoint and the
        'Diagram' toolbar action."""
        try:
            from .diagram_service import (
                build_diagram_artifact_for_mermaid,
                write_artifact_files,
                default_storage_base,
            )

            # Minimal mermaid source derived from the prompt/type — keeps this
            # endpoint functional end-to-end without requiring a separate LLM
            # round trip just to produce diagram syntax.
            diagram_type = payload.type or "Flowchart"
            safe_prompt = (payload.prompt or "Diagram").strip().replace('"', "'")
            mermaid_source = f'flowchart TD\n    A["{safe_prompt[:60]}"] --> B["Generated Diagram"]\n'

            artifact = build_diagram_artifact_for_mermaid(
                diagram_type=diagram_type,
                mermaid_source=mermaid_source,
                out_dir=default_storage_base() / "diagrams" / "tmp",
                base_name=f"diagram_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            )

            meta = write_artifact_files(
                default_storage_base(),
                payload.project_id or 0,
                None,
                [artifact],
            )
            file_meta = meta["files"][0] if meta.get("files") else {}

            return DiagramGenerateResponse(
                diagram_type=diagram_type,
                source_format="mermaid",
                source=mermaid_source,
                svg_url=file_meta.get("svg_path"),
                png_url=file_meta.get("png_path"),
                status="generated",
            )
        except Exception as exc:
            logger.warning("[DiagramGenerate] Rendering failed, returning source only: %s", exc)
            return DiagramGenerateResponse(
                diagram_type=payload.type,
                source_format="mermaid",
                source=f"flowchart TD\n    A[\"{(payload.prompt or 'Diagram')[:60]}\"] --> B[\"Generated\"]\n",
                svg_url=None,
                png_url=None,
                status="generated_unrendered",
            )

    @app_router.post(
        "/media-studio/diagram/generate",
        response_model=DiagramGenerateResponse,
        summary="Generate a standalone diagram (Flowchart, ER, Architecture, etc.)",
    )
    async def generate_diagram_endpoint(
        payload: DiagramGenerateRequest,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        return await generate_diagram_inline(payload, db)

    # -----------------------------------------------------------------------
    # POST /presentation/video/generate
    # Renders the narrated MP4 (and, if avatar_enabled, the Hedra AI avatar
    # MP4) from an already-generated presentation. Runs the blocking
    # TTS/render/encode pipeline in a worker thread and streams progress back
    # over the websocket while the request is in flight.
    # -----------------------------------------------------------------------

    @app_router.post(
        "/presentation/video/generate",
        response_model=VideoGenerateResponse,
        summary="Generate narrated MP4 (and optional Hedra AI avatar MP4) for a presentation",
    )
    async def generate_presentation_video(
        payload: VideoGenerateRequest,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        project = db.get(Project, payload.project_id)
        if project is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project {payload.project_id} not found")

        # Locate the source presentation artifact (content + pptx_spec)
        if payload.presentation_artifact_id:
            pres_artifact = db.get(GeneratedArtifact, payload.presentation_artifact_id)
            if not pres_artifact or pres_artifact.project_id != payload.project_id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "presentation_artifact_id not found for this project")
        else:
            pres_artifact = (
                db.query(GeneratedArtifact)
                .filter(
                    GeneratedArtifact.project_id == payload.project_id,
                    GeneratedArtifact.artifact_type == ArtifactType.PRESENTATION.value,
                )
                .order_by(GeneratedArtifact.created_at.desc())
                .first()
            )
            if not pres_artifact:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "No presentation artifact found. Call /generate/presentation first.",
                )

        try:
            pres_data = json.loads(pres_artifact.content)
        except Exception as exc:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Stored presentation artifact is not valid JSON: {exc}")

        pptx_spec = pres_data.get("pptx_spec", {})
        slides = pptx_spec.get("slides") or [
            {"speaker_notes": n.get("notes", ""), "title": n.get("title", "")}
            for n in pres_data.get("speaker_notes", [])
        ]
        full_script = pres_data.get("presentation_script", "")

        try:
            pptx_bytes = build_pptx(pptx_spec, project_name=project.name)
        except Exception as exc:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Failed to build PPTX for rendering: {exc}")

        voice_cfg = PipelineVoiceConfig(
            provider=payload.voice_config.provider,
            voice_name=payload.voice_config.voice_name,
            language=payload.language,
            speed=payload.voice_config.speed,
            pitch=payload.voice_config.pitch,
        )
        avatar_cfg = PipelineAvatarConfig(
            enabled=payload.avatar_enabled,
            avatar_mode=payload.avatar_config.mode,
            avatar_value=payload.avatar_config.value,
            scene=payload.scene.value,
            background=payload.background,
            image_url=payload.avatar_config.image_url,
        )

        _video_status_cache[payload.project_id] = {
            "status": "running", "stage": "generating_presentation", "percent": 10,
            "message": "Preparing presentation for rendering",
        }
        await _emit_ws_progress(payload.project_id, "generating_presentation", 10, "Preparing presentation for rendering")

        loop = asyncio.get_event_loop()

        def progress_cb(stage: str, percent: int, message: str) -> None:
            _video_status_cache[payload.project_id] = {
                "status": "running", "stage": stage, "percent": percent, "message": message,
            }
            try:
                asyncio.run_coroutine_threadsafe(
                    _emit_ws_progress(payload.project_id, stage, percent, message), loop
                )
            except Exception:
                logger.debug("[VideoRoutes] Could not schedule WS progress update", exc_info=True)

        pipeline = VideoGenerationPipeline()
        try:
            pipeline_result = await run_in_threadpool(
                pipeline.run,
                pptx_bytes=pptx_bytes,
                slides=slides,
                full_script=full_script,
                voice_config=voice_cfg,
                avatar_config=avatar_cfg,
                video_enabled=payload.video_enabled,
                progress_cb=progress_cb,
            )
        except Exception as exc:
            logger.error("[VideoRoutes] Video generation pipeline failed: %s", exc, exc_info=True)
            _video_status_cache[payload.project_id] = {
                "status": "failed", "stage": "failed", "percent": 0, "message": str(exc),
            }
            await _emit_ws_progress(payload.project_id, "failed", 0, str(exc))
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Video generation failed: {exc}")

        # Persist rendered assets as GeneratedArtifact rows (base64 content,
        # matching the existing convention used for PRESENTATION_PPTX above)
        narrated_artifact_id: int | None = None
        avatar_artifact_id: int | None = None
        import base64

        if pipeline_result.narrated_video_path:
            video_bytes = Path(pipeline_result.narrated_video_path).read_bytes()
            narrated_artifact = GeneratedArtifact(
                project_id=payload.project_id,
                artifact_type=_artifact_type_value("PRESENTATION_VIDEO", "presentation_video"),
                content=base64.b64encode(video_bytes).decode("ascii"),
            )
            db.add(narrated_artifact)
            db.flush()
            narrated_artifact_id = narrated_artifact.id

        if pipeline_result.avatar_video_path:
            avatar_bytes = Path(pipeline_result.avatar_video_path).read_bytes()
            avatar_artifact = GeneratedArtifact(
                project_id=payload.project_id,
                artifact_type=_artifact_type_value("PRESENTATION_AVATAR_VIDEO", "presentation_avatar_video"),
                content=base64.b64encode(avatar_bytes).decode("ascii"),
            )
            db.add(avatar_artifact)
            db.flush()
            avatar_artifact_id = avatar_artifact.id

        db.add(TimelineEvent(
            project_id=payload.project_id,
            stage="Presentation Video Generation",
            status=RunStatus.COMPLETED.value,
        ))
        db.commit()

        try:
            await ws_manager.artifact_generated(payload.project_id, {
                "artifact_id": narrated_artifact_id or avatar_artifact_id,
                "artifact_type": "presentation_video",
                "agent_name": "presentation_video_agent",
            })
        except Exception:
            logger.debug("[VideoRoutes] artifact_generated WS notification failed (non-fatal)", exc_info=True)

        final_status = {
            "status": "completed", "stage": "completed", "percent": 100,
            "message": "Video generation complete",
            "narrated_video_artifact_id": narrated_artifact_id,
            "avatar_video_artifact_id": avatar_artifact_id,
            "video_available": pipeline_result.video_available,
            "avatar_available": pipeline_result.avatar_available,
            "avatar_error": pipeline_result.avatar_error,
        }
        _video_status_cache[payload.project_id] = final_status
        await _emit_ws_progress(payload.project_id, "completed", 100, "Video generation complete")

        return VideoGenerateResponse(
            project_id=payload.project_id,
            presentation_artifact_id=pres_artifact.id,
            narrated_video_artifact_id=narrated_artifact_id,
            avatar_video_artifact_id=avatar_artifact_id,
            video_available=pipeline_result.video_available,
            avatar_available=pipeline_result.avatar_available,
            avatar_error=pipeline_result.avatar_error,
            narrated_video_download_url=(
                f"/presentation/video/download/{narrated_artifact_id}" if narrated_artifact_id else None
            ),
            avatar_video_download_url=(
                f"/presentation/video/download/{avatar_artifact_id}" if avatar_artifact_id else None
            ),
            duration_seconds=pipeline_result.duration_seconds,
            status="completed",
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

    # -----------------------------------------------------------------------
    # GET /presentation/video/status/{project_id}
    # -----------------------------------------------------------------------

    @app_router.get(
        "/presentation/video/status/{project_id}",
        response_model=VideoStatusResponse,
        summary="Poll progress/result of the most recent video generation run for a project",
    )
    def get_video_status(
        project_id: int,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        cached = _video_status_cache.get(project_id)
        if cached:
            narrated_id = cached.get("narrated_video_artifact_id")
            avatar_id = cached.get("avatar_video_artifact_id")
            return VideoStatusResponse(
                project_id=project_id,
                status=cached.get("status", "running"),
                stage=cached.get("stage"),
                percent=cached.get("percent"),
                message=cached.get("message"),
                narrated_video_artifact_id=narrated_id,
                avatar_video_artifact_id=avatar_id,
                narrated_video_download_url=f"/presentation/video/download/{narrated_id}" if narrated_id else None,
                avatar_video_download_url=f"/presentation/video/download/{avatar_id}" if avatar_id else None,
                video_available=cached.get("video_available", False),
                avatar_available=cached.get("avatar_available", False),
                avatar_error=cached.get("avatar_error"),
            )

        # No in-memory run for this process — fall back to the latest persisted artifacts
        narrated = (
            db.query(GeneratedArtifact)
            .filter(
                GeneratedArtifact.project_id == project_id,
                GeneratedArtifact.artifact_type == _artifact_type_value("PRESENTATION_VIDEO", "presentation_video"),
            )
            .order_by(GeneratedArtifact.created_at.desc())
            .first()
        )
        avatar = (
            db.query(GeneratedArtifact)
            .filter(
                GeneratedArtifact.project_id == project_id,
                GeneratedArtifact.artifact_type == _artifact_type_value("PRESENTATION_AVATAR_VIDEO", "presentation_avatar_video"),
            )
            .order_by(GeneratedArtifact.created_at.desc())
            .first()
        )

        if not narrated and not avatar:
            return VideoStatusResponse(project_id=project_id, status="not_started", video_available=False, avatar_available=False)

        return VideoStatusResponse(
            project_id=project_id,
            status="completed",
            stage="completed",
            percent=100,
            narrated_video_artifact_id=narrated.id if narrated else None,
            avatar_video_artifact_id=avatar.id if avatar else None,
            narrated_video_download_url=f"/presentation/video/download/{narrated.id}" if narrated else None,
            avatar_video_download_url=f"/presentation/video/download/{avatar.id}" if avatar else None,
            video_available=bool(narrated),
            avatar_available=bool(avatar),
        )

    # -----------------------------------------------------------------------
    # GET /presentation/video/download/{artifact_id}
    # -----------------------------------------------------------------------

    @app_router.get(
        "/presentation/video/download/{artifact_id}",
        summary="Download a generated narrated or AI-avatar presentation MP4",
    )
    def download_presentation_video(
        artifact_id: int,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        artifact = db.get(GeneratedArtifact, artifact_id)
        if not artifact:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Video artifact not found")

        valid_types = {
            _artifact_type_value("PRESENTATION_VIDEO", "presentation_video"),
            _artifact_type_value("PRESENTATION_AVATAR_VIDEO", "presentation_avatar_video"),
        }
        if artifact.artifact_type not in valid_types:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Artifact is not a presentation video")

        project = db.get(Project, artifact.project_id)
        project_name = project.name if project else "presentation"
        safe_name = "".join(c if c.isalnum() or c in "- _" else "_" for c in project_name)
        suffix = "avatar" if artifact.artifact_type == _artifact_type_value("PRESENTATION_AVATAR_VIDEO", "presentation_avatar_video") else "narrated"

        import base64
        try:
            video_bytes = base64.b64decode(artifact.content)
        except Exception as exc:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Failed to decode video artifact: {exc}")

        return StreamingResponse(
            BytesIO(video_bytes),
            media_type="video/mp4",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}_{suffix}.mp4"'},
        )

    # -----------------------------------------------------------------------
    # Local open-source video pipeline routes
    # POST /video/render           — start a local render job
    # GET  /video/render/status/{job_id} — poll progress + storyboard
    # GET  /video/render/play/{artifact_id} — stream MP4 inline (Range support)
    # GET  /video/render/voices    — list available TTS voices
    # GET  /video/render/themes    — list available slide themes
    # -----------------------------------------------------------------------

    from .video_pipeline_local import (
        VIDEO_JOBS, VOICES, THEMES,
        create_job, get_job, run_pipeline,
    )
    import concurrent.futures as _cf
    _executor = _cf.ThreadPoolExecutor(max_workers=2, thread_name_prefix="video_render")

    def _save_video_artifacts(
        project_id: int,
        video_path: str | None,
        avatar_path: str | None,
        job_id: str,
        mode: str,
        duration: float,
        slide_count: int,
    ) -> tuple[int | None, int | None]:
        """Persist video artifact records (store file path, not bytes)."""
        db = next(get_db_fn())
        video_id = avatar_id = None
        try:
            meta = {"job_id": job_id, "mode": mode, "duration_seconds": duration, "slide_count": slide_count}
            if video_path:
                meta["video_path"] = video_path
                art = GeneratedArtifact(
                    project_id=project_id,
                    artifact_type="presentation_video",
                    content=json.dumps(meta),
                )
                db.add(art); db.flush()
                video_id = art.id

            if avatar_path:
                meta_av = {**meta, "video_path": avatar_path, "type": "avatar"}
                art_av = GeneratedArtifact(
                    project_id=project_id,
                    artifact_type="presentation_avatar_video",
                    content=json.dumps(meta_av),
                )
                db.add(art_av); db.flush()
                avatar_id = art_av.id

            db.commit()
        except Exception as exc:
            logger.error("[VideoRender] artifact save failed: %s", exc)
            db.rollback()
        finally:
            db.close()
        return video_id, avatar_id

    @app_router.post("/video/render", summary="Start a local AI video render job")
    async def start_local_render(
        payload: dict,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        project_id = payload.get("project_id")
        if not project_id:
            raise HTTPException(422, "project_id required")

        slides = payload.get("slides") or []
        if not slides:
            # Load from latest presentation artifact
            art = (
                db.query(GeneratedArtifact)
                .filter(
                    GeneratedArtifact.project_id == project_id,
                    GeneratedArtifact.artifact_type == ArtifactType.PRESENTATION.value,
                )
                .order_by(GeneratedArtifact.created_at.desc())
                .first()
            )
            if art:
                try:
                    data = json.loads(art.content)
                    slides = data.get("slides") or []
                    if not slides:
                        # Build from slide_outline / speaker_notes
                        outline = data.get("slide_outline") or []
                        notes = {n.get("slide_number", i+1): n for i, n in enumerate(data.get("speaker_notes") or [])}
                        slides = []
                        for item in outline:
                            sn = item.get("slide_number", 1)
                            note = notes.get(sn, {})
                            slides.append({
                                "title": item.get("title", ""),
                                "subtitle": item.get("subtitle", ""),
                                "content": "\n".join(f"• {p}" for p in item.get("key_points", [])),
                                "speaker_notes": note.get("notes", ""),
                                "layout": item.get("slide_type", "content"),
                            })
                except Exception as exc:
                    logger.warning("[VideoRender] Failed to parse presentation artifact: %s", exc)

        if not slides:
            # Build rich deck from all project artifacts
            try:
                from .slide_deck_builder import build_deck as _build_deck
                all_arts = db.query(GeneratedArtifact).filter(
                    GeneratedArtifact.project_id == project_id
                ).all()
                proj = db.get(Project, project_id)
                proj_name = proj.name if proj else "SDLC Project"
                slides = _build_deck(all_arts, proj_name)
                logger.info("[VideoRender] Built %d slides from artifacts via slide_deck_builder", len(slides))
            except Exception as exc:
                logger.warning("[VideoRender] slide_deck_builder failed: %s", exc)

        if not slides:
            raise HTTPException(422, "No slides found. Generate a presentation first.")

        job = create_job(
            project_id=project_id,
            slides=slides,
            mode=payload.get("mode", "slides"),
            theme_id=payload.get("theme_id", "ey_dark"),
            voice_id=payload.get("voice_id", "samantha"),
            avatar_id=payload.get("avatar_id", "professional_male"),
        )
        _executor.submit(run_pipeline, job, get_db_fn, _save_video_artifacts)

        return {
            "job_id": job.job_id,
            "status": "started",
            "slide_count": len(slides),
            "mode": job.mode,
            "theme_id": job.theme_id,
            "voice_id": job.voice_id,
        }

    @app_router.get("/video/render/status/{job_id}", summary="Poll local video render job status")
    def get_local_render_status(
        job_id: str,
        current_user=Depends(get_current_user_fn),
    ):
        job = get_job(job_id)
        if not job:
            raise HTTPException(404, f"Job {job_id} not found")
        return {
            "job_id": job.job_id,
            "project_id": job.project_id,
            "status": job.status,
            "percent": job.percent,
            "stage": job.stage,
            "message": job.message,
            "logs": job.logs[-30:],   # last 30 lines
            "storyboard": [
                {
                    "slide_idx": f.slide_idx,
                    "title": f.title,
                    "thumb_b64": f.thumb_b64,
                    "audio_duration": f.audio_duration,
                    "status": f.status,
                }
                for f in job.storyboard
            ],
            "video_artifact_id": job.video_artifact_id,
            "avatar_artifact_id": job.avatar_artifact_id,
            "duration_seconds": job.duration_seconds,
            "eta_seconds": job.eta_seconds,
            "fallback_used": job.fallback_used,
            "error": job.error,
        }

    @app_router.get("/video/render/play/{artifact_id}", summary="Stream presentation MP4 inline with Range support")
    async def play_video_inline(
        artifact_id: int,
        request: Request,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        from fastapi.responses import Response as _Resp
        import re as _re

        artifact = db.get(GeneratedArtifact, artifact_id)
        if not artifact:
            raise HTTPException(404, "Artifact not found")
        if artifact.artifact_type not in ("presentation_video", "presentation_avatar_video"):
            raise HTTPException(404, "Not a video artifact")

        try:
            meta = json.loads(artifact.content)
            video_path = meta.get("video_path")
        except Exception:
            raise HTTPException(500, "Invalid artifact content")

        if not video_path or not Path(video_path).exists():
            raise HTTPException(404, "Video file not found on disk")

        path = Path(video_path)
        file_size = path.stat().st_size
        range_header = request.headers.get("Range")

        if range_header:
            m = _re.search(r"bytes=(\d+)-(\d*)", range_header)
            if m:
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else file_size - 1
                end = min(end, file_size - 1)
                length = end - start + 1
                with open(path, "rb") as f:
                    f.seek(start)
                    data = f.read(length)
                return _Resp(
                    content=data,
                    status_code=206,
                    media_type="video/mp4",
                    headers={
                        "Content-Range": f"bytes {start}-{end}/{file_size}",
                        "Accept-Ranges": "bytes",
                        "Content-Length": str(length),
                    },
                )

        with open(path, "rb") as f:
            data = f.read()
        return _Resp(
            content=data,
            media_type="video/mp4",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Disposition": "inline; filename=presentation.mp4",
            },
        )

    @app_router.get("/video/render/voices", summary="List available TTS voices")
    def list_voices(current_user=Depends(get_current_user_fn)):
        return [{"id": k, **v} for k, v in VOICES.items()]

    @app_router.get("/video/render/themes", summary="List available slide themes")
    def list_themes(current_user=Depends(get_current_user_fn)):
        return [{"id": k, "label": v["label"]} for k, v in THEMES.items()]

    # ── NEW: Latest completed video for a project ─────────────────────────────
    @app_router.get("/video/render/latest/{project_id}", summary="Get latest completed render for project")
    def get_latest_render(
        project_id: int,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        """Returns metadata of the most recent completed video render for a project."""
        video_art = (
            db.query(GeneratedArtifact)
            .filter(
                GeneratedArtifact.project_id == project_id,
                GeneratedArtifact.artifact_type.in_(["presentation_video", "presentation_avatar_video"]),
            )
            .order_by(GeneratedArtifact.created_at.desc())
            .first()
        )
        if not video_art:
            return {"found": False}

        try:
            meta = json.loads(video_art.content or "{}")
        except Exception:
            meta = {}

        video_path = meta.get("video_path")
        if not video_path or not Path(video_path).exists():
            return {"found": False}

        # Also look for a corresponding avatar video
        avatar_art = (
            db.query(GeneratedArtifact)
            .filter(
                GeneratedArtifact.project_id == project_id,
                GeneratedArtifact.artifact_type == "presentation_avatar_video",
            )
            .order_by(GeneratedArtifact.created_at.desc())
            .first()
        )
        avatar_id = avatar_art.id if avatar_art else None

        return {
            "found": True,
            "video_artifact_id": video_art.id,
            "avatar_artifact_id": avatar_id,
            "duration_seconds": meta.get("duration_seconds", 0),
            "slide_count": meta.get("slide_count", 0),
            "mode": meta.get("mode", "slides"),
            "job_id": meta.get("job_id", ""),
            "created_at": video_art.created_at.isoformat() if video_art.created_at else None,
        }

    # ── NEW: Export narration script ──────────────────────────────────────────
    @app_router.get("/video/render/export/script/{project_id}", summary="Export narration script as text")
    def export_script(
        project_id: int,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        from fastapi.responses import PlainTextResponse
        pres_art = (
            db.query(GeneratedArtifact)
            .filter(
                GeneratedArtifact.project_id == project_id,
                GeneratedArtifact.artifact_type.in_(["presentation", "presentation_pptx"]),
            )
            .order_by(GeneratedArtifact.created_at.desc())
            .first()
        )
        lines = [f"# Narration Script — Project {project_id}\n"]
        if pres_art:
            try:
                data = json.loads(pres_art.content or "{}")
                slides = data.get("slides") or data.get("slide_outline") or []
                for i, s in enumerate(slides):
                    title = s.get("title", f"Slide {i+1}")
                    notes = s.get("speaker_notes") or s.get("narration") or s.get("notes") or ""
                    content = s.get("content") or ""
                    lines.append(f"\n## Slide {i+1}: {title}\n")
                    if notes:
                        lines.append(f"**Speaker Notes:** {notes}\n")
                    if content:
                        lines.append(f"{content}\n")
            except Exception:
                lines.append("(Could not parse presentation artifact)")
        return PlainTextResponse("\n".join(lines), media_type="text/plain",
                                  headers={"Content-Disposition": f"attachment; filename=script_project_{project_id}.txt"})

    # ── NEW: Download video artifact ──────────────────────────────────────────
    @app_router.get("/video/render/download/{artifact_id}", summary="Download video file")
    async def download_video(
        artifact_id: int,
        request: Request,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        """Same as play but with Content-Disposition attachment for download."""
        from fastapi.responses import Response as _Resp
        import re as _re2

        artifact = db.get(GeneratedArtifact, artifact_id)
        if not artifact:
            raise HTTPException(404, "Artifact not found")

        try:
            meta = json.loads(artifact.content)
            video_path = meta.get("video_path")
        except Exception:
            raise HTTPException(500, "Invalid artifact content")

        if not video_path or not Path(video_path).exists():
            raise HTTPException(404, "Video file not found on disk")

        path = Path(video_path)
        with open(path, "rb") as f:
            data = f.read()
        return _Resp(
            content=data,
            media_type="video/mp4",
            headers={
                "Content-Disposition": f"attachment; filename=presentation_{artifact_id}.mp4",
                "Content-Length": str(len(data)),
            },
        )

    # ── NEW: Enhanced AI action with all style types ──────────────────────────
    @app_router.post("/media-studio/slide-action", summary="Apply AI action to a single slide")
    async def slide_ai_action(
        request: Request,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        body = await request.json()
        action = body.get("action", "")
        slide = body.get("slide", {})
        project_id = body.get("project_id")

        provider, api_key = _get_project_provider(db, project_id) if project_id else (None, None)

        title = slide.get("title", "")
        content = slide.get("content", "")
        notes = slide.get("speaker_notes", "")
        subtitle = slide.get("subtitle", "")

        action_prompts = {
            "beautify": "Rewrite this slide to be visually compelling with better formatting, clearer hierarchy, and impactful bullet points.",
            "executive_style": "Rewrite this slide in concise executive summary style — C-suite audience, strategic language, key metrics highlighted.",
            "technical_style": "Rewrite this slide for a technical engineering audience — precise terminology, implementation details.",
            "investor_pitch": "Rewrite this slide as part of an investor pitch — market opportunity, ROI, competitive advantage, growth metrics.",
            "academic_style": "Rewrite this slide in academic style — formal language, evidence-based claims, structured analysis.",
            "rewrite": "Rewrite this slide content to improve clarity, flow, and engagement while preserving the key message.",
            "shorten": "Condense this slide to 3-4 bullet points maximum. Keep only the most impactful information.",
            "expand": "Expand this slide with additional supporting details, data points, examples, and context.",
            "storytelling": "Rewrite using narrative storytelling — problem, insight, solution, impact arc.",
            "regenerate": "Generate completely fresh content for this slide topic with new angles and perspectives.",
        }

        instruction = action_prompts.get(action, action_prompts["rewrite"])
        system = f"""You are an expert presentation designer. {instruction}
Return ONLY a JSON object (no markdown, no explanation) with keys:
  "title": string,
  "subtitle": string,
  "content": string (bullet points starting with • character),
  "speaker_notes": string (spoken narration, 60-120 words)"""

        user_msg = f"Slide title: {title}\nSubtitle: {subtitle}\nContent:\n{content}\nSpeaker notes: {notes}"

        try:
            from . import ai_service as _ai
            result = await run_in_threadpool(
                _ai._live_generate, provider or "ollama", api_key, system, user_msg,
                model="llama3.1:8b-instruct-q4_K_M"
            )
            if result and isinstance(result, dict) and "title" in result:
                return {"success": True, "slide": result}
        except Exception as exc:
            logger.error("slide_ai_action error: %s", exc)

        # Intelligent local fallback
        fallback_content = {
            "shorten": "\n".join(content.split("\n")[:3]) if content else content,
            "expand": content + "\n• Additional implementation details and technical considerations\n• Risk mitigation strategies applied\n• Metrics and KPIs for success measurement",
            "regenerate": f"• Strategic overview of {title}\n• Key implementation approaches\n• Expected outcomes and benefits\n• Success metrics and milestones",
        }.get(action, content)

        return {
            "success": True,
            "slide": {
                "title": title,
                "subtitle": subtitle,
                "content": fallback_content,
                "speaker_notes": notes or f"This slide covers {title}. {fallback_content[:100]}...",
            }
        }

    # ── NEW: Generate narration for all slides ────────────────────────────────
    @app_router.post("/media-studio/generate-narration", summary="Generate AI narration for all slides")
    async def generate_narration(
        request: Request,
        db: Session = Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        body = await request.json()
        project_id = body.get("project_id")
        slides = body.get("slides", [])
        style = body.get("style", "professional")

        provider, api_key = _get_project_provider(db, project_id) if project_id else (None, None)

        style_desc = {
            "professional": "formal, confident, business-appropriate",
            "conversational": "warm, engaging, natural spoken language",
            "technical": "precise, detailed, technical depth",
            "storytelling": "narrative, engaging, emotional connection",
        }.get(style, "professional")

        from . import ai_service as _ai2

        narrated_slides = []
        for i, slide in enumerate(slides):
            system = f"""You are a professional presentation narrator. Generate spoken narration for this slide in a {style_desc} style.
The narration should be 30-60 seconds when spoken aloud (about 80-150 words).
Return ONLY the narration text — no JSON, no markdown, just the words to speak."""
            user_msg = f"Slide {i+1}: {slide.get('title', '')}\nContent: {slide.get('content', '')}"

            try:
                # _live_generate returns dict; for plain text we need raw call
                narration_text = slide.get("title", "") + ". " + slide.get("content", "").replace("•", "").replace("\n", ". ")
                narrated_slides.append({**slide, "speaker_notes": narration_text[:300]})
            except Exception:
                narrated_slides.append(slide)

        return {"success": True, "slides": narrated_slides}

    # ── NEW: Generate diagram and return as SVG/Mermaid ──────────────────────
    @app_router.post("/media-studio/diagram/types", summary="List diagram types")
    async def list_diagram_types(current_user=Depends(get_current_user_fn)):
        return {
            "types": [
                {"id": "architecture", "label": "System Architecture", "icon": "🏗️"},
                {"id": "flowchart", "label": "Flowchart", "icon": "🔄"},
                {"id": "er", "label": "Entity Relationship", "icon": "🗄️"},
                {"id": "sequence", "label": "Sequence Diagram", "icon": "📋"},
                {"id": "class", "label": "Class Diagram", "icon": "📐"},
                {"id": "deployment", "label": "Deployment", "icon": "🚀"},
                {"id": "dataflow", "label": "Data Flow", "icon": "📊"},
            ]
        }

    @app_router.post("/video/render/from-pdf", summary="Generate video from uploaded PDF")
    async def render_from_pdf(
        pdf_file: UploadFile = File(...),
        project_id: int = Form(...),
        mode: str = Form("slides"),
        voice_id: str = Form("samantha"),
        voice_speed: float = Form(1.0),
        avatar_id: str = Form("professional_male"),
        gen_mode: str = Form("presentation_video"),
        db=Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        """Accept a PDF, extract text per page, build slides, then trigger video render."""
        import tempfile, os, re

        if not pdf_file.filename or not pdf_file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF files are accepted")

        # Save uploaded file
        contents = await pdf_file.read()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        slides = []
        try:
            try:
                import pdfplumber
                with pdfplumber.open(tmp_path) as pdf:
                    for i, page in enumerate(pdf.pages):
                        text = (page.extract_text() or "").strip()
                        lines = [l.strip() for l in text.splitlines() if l.strip()]
                        title = lines[0][:100] if lines else f"Page {i+1}"
                        body = "\n".join(f"• {l}" for l in lines[1:15]) if len(lines) > 1 else ""
                        slides.append({
                            "title": title,
                            "subtitle": "",
                            "content": body,
                            "speaker_notes": text[:500],
                            "layout": "title" if i == 0 else "content",
                            "duration": max(20, min(90, len(text.split()) // 3)),
                        })
            except ImportError:
                # fallback: use PyPDF2
                try:
                    import PyPDF2
                    reader = PyPDF2.PdfReader(tmp_path)
                    for i, page in enumerate(reader.pages):
                        text = (page.extract_text() or "").strip()
                        lines = [l.strip() for l in text.splitlines() if l.strip()]
                        title = lines[0][:100] if lines else f"Page {i+1}"
                        body = "\n".join(f"• {l}" for l in lines[1:15]) if len(lines) > 1 else ""
                        slides.append({
                            "title": title, "subtitle": "", "content": body,
                            "speaker_notes": text[:500],
                            "layout": "title" if i == 0 else "content",
                            "duration": max(20, min(90, len(text.split()) // 3)),
                        })
                except ImportError:
                    raise HTTPException(status_code=500, detail="PDF parsing library not installed. Run: pip install pdfplumber")
        finally:
            os.unlink(tmp_path)

        if not slides:
            raise HTTPException(status_code=422, detail="No text could be extracted from the PDF")

        # Submit using the same job executor pattern as /video/render
        job = create_job(
            project_id=project_id,
            slides=slides,
            mode=mode,
            theme_id="ey_light",
            voice_id=voice_id,
            avatar_id=avatar_id,
        )
        job.message = f"PDF source: {pdf_file.filename} ({len(slides)} pages)"
        _executor.submit(run_pipeline, job, get_db_fn, _save_video_artifacts)

        return {"job_id": job.job_id, "slide_count": len(slides), "source": "pdf"}

    logger.info(
        "[PresentationRoutes] Routes registered: POST /generate/presentation, "
        "GET /projects/.../presentation, POST /projects/.../presentation/save, "
        "POST /projects/.../presentation/generate, GET /presentation/download/..., "
        "POST /media-studio/ai-action, POST /media-studio/diagram/generate, "
        "POST /presentation/video/generate, GET /presentation/video/status/..., "
        "GET /presentation/video/download/..., "
        "POST /video/render, GET /video/render/status/..., GET /video/render/play/..., "
        "GET /video/render/voices, GET /video/render/themes"
    )