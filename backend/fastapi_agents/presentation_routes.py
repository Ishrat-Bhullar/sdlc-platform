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
import os
import re
import logging
import asyncio
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile, File, Form
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse, FileResponse
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


# ---------------------------------------------------------------------------
# PDF -> Presentation understanding pipeline (used by /video/render/from-pdf)
# ---------------------------------------------------------------------------

def _extract_pdf_text(pdf_path: str) -> tuple[str, int, list[str]]:
    """Extract full document text (all pages, joined) + page count + the
    per-page text list (needed so the deck can map one slide per PDF page).
    Tries pdfplumber first, falls back to PyPDF2 — mirrors the platform's
    existing ingestion path so behaviour is consistent."""
    try:
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            pages = [(p.extract_text() or "").strip() for p in pdf.pages]
            return "\n\n".join(pages), len(pdf.pages), pages
    except ImportError:
        pass
    import PyPDF2
    reader = PyPDF2.PdfReader(pdf_path)
    pages = [(p.extract_text() or "").strip() for p in reader.pages]
    return "\n\n".join(pages), len(reader.pages), pages


_DIAGRAM_KEYWORDS = ("architecture", "workflow", "pipeline", "data flow", "process flow",
                    "sequence", "deployment", "system design", "component diagram")


def _pages_to_slides(pages: list[str], project_name: str, doc_title: str) -> list[dict]:
    """One slide per PDF page, in page order — so a 20-page PDF always
    produces exactly 20 slides, letting the user pick a precise page range
    (e.g. "just pages 2-4") in the workspace afterward. Each page's own
    heading (if any) becomes the slide title; its text becomes bullets +
    full narration."""
    slides: list[dict] = []
    for i, page_text in enumerate(pages):
        lines = [l.strip() for l in page_text.splitlines() if l.strip()]
        title = None
        for line in lines[:6]:  # a heading usually appears near the top of the page
            if _looks_like_heading(line):
                title = line.rstrip(":")
                break
        if not title:
            title = doc_title if i == 0 else f"Page {i + 1}"

        body_lines = [l for l in lines if l != title]
        bullets = _sentences_as_bullets(" ".join(body_lines))
        narration = " ".join(body_lines)[:900] or f"This page covers {title}."
        layout = "title" if i == 0 else ("closing" if i == len(pages) - 1 else "items")

        slides.append({
            "title": title[:90],
            "subtitle": f"Page {i + 1} of {len(pages)}" if i == 0 else "",
            "layout": layout,
            "content": "\n".join(f"• {b}" for b in bullets) if layout != "title" else "",
            "items": [{"icon": "check", "title": b, "body": ""} for b in bullets],
            "speaker_notes": narration,
            "duration": 28,
        })
    return slides


def _understand_document_to_slides(
    full_text: str, project_name: str, page_count: int, pages: list[str] | None = None,
    *, db=None, project_id: int | None = None,
) -> list[dict]:
    """Turn a full document into a narrated slide deck — one slide per PDF
    page (see _pages_to_slides) so the slide count always matches the
    document's page count, letting the user pick a precise page range for
    video generation afterward. Diagrams are auto-attached to any slide
    whose content describes an architecture/workflow/process, via the
    native renderer (always succeeds).
    """
    if pages:
        doc_title = project_name
        first_lines = [l.strip() for l in pages[0].splitlines() if l.strip()]
        if first_lines:
            first = first_lines[0].rstrip(":")
            if 8 < len(first) < 140 and not first.endswith("."):
                doc_title = first
        slides = _pages_to_slides(pages, project_name, doc_title)
        return [_attach_diagram_if_relevant(s) for s in slides]

    # Fallback for any caller that only has the joined full_text (no page
    # boundaries) — keeps this function usable in that older shape too.
    # The LLM path truncates its input to stay inside the ACTIVE backend's
    # context budget (see _llm_document_to_slides) — that budget is only
    # tight when Ollama ends up serving the call; a cloud GPT model's
    # context window comfortably fits much longer documents, so the
    # LLM-path length gate below is widened whenever a cloud provider is
    # configured for this project.
    from .agents.llm_service import LLMService as _LLMService
    _has_cloud = _LLMService(db=db, project_id=project_id).has_cloud_path()
    _llm_gate = 60000 if _has_cloud else 12000

    slides = None
    if len(full_text.strip()) <= _llm_gate:
        slides = _llm_document_to_slides(full_text, project_name, db=db, project_id=project_id)
    if not slides:
        logger.info(
            "[PDFPipeline] Using deterministic section builder (%s)",
            "document too large for a single LLM call" if len(full_text.strip()) > _llm_gate
            else "LLM understanding unavailable/failed",
        )
        slides = _deterministic_document_to_slides(full_text, project_name, page_count)

    return [_attach_diagram_if_relevant(s) for s in slides]


def _llm_document_to_slides(
    full_text: str, project_name: str, *, db=None, project_id: int | None = None,
) -> list[dict] | None:
    from .agents.llm_service import LLMService
    from .agents.llm_client import LLMConnectionError
    import json as _json

    system = (
        "You are a management consultant who turns source documents into client-ready "
        "presentation decks. You read the ENTIRE document, understand the business problem, "
        "solution, architecture and value, and produce a structured deck. "
        "NEVER write filler like 'this slide shows' in narration — speak like a consultant "
        "explaining ideas aloud, with smooth transitions. Ground every fact in the document; "
        "do not invent numbers.\n\n"
        "Return ONLY valid JSON: a list of 8-12 slide objects, each with:\n"
        '  "title": short slide title,\n'
        '  "layout": one of [title, items, kpi_cards, table, two_col, comparison, '
        'tech_grid, process, architecture, roadmap, timeline, quote, closing, content],\n'
        '  "bullets": array of short on-slide phrases (3-6 words each, 3-6 bullets),\n'
        '  "speaker_notes": 70-140 words of natural spoken narration explaining the idea '
        "(not reading the bullets aloud) — cover problem, solution, architecture, workflow, "
        "technology, benefits, ROI and conclusion across the deck as a whole.\n"
        "No markdown fences, no preamble — JSON array only."
    )

    llm = LLMService(db=db, project_id=project_id, role="planning")
    cloud = llm.has_cloud_path()
    llm.timeout = 170 if cloud else 55

    # Cap input so the call stays fast on the Ollama fallback's local model;
    # a cloud GPT model's context window comfortably fits the full document,
    # so this cap only applies when Ollama will actually serve the call.
    doc = full_text.strip()
    if not cloud and len(doc) > 9000:
        doc = doc[:6000] + "\n\n...[middle omitted]...\n\n" + doc[-2500:]
    user_prompt = f"Document title/context: {project_name}\n\nDOCUMENT TEXT:\n{doc}"

    try:
        raw = llm.generate_text(system, user_prompt, temperature=0.3)
        try:
            data = _json.loads(raw)
        except _json.JSONDecodeError:
            data = _repair_truncated_json_array(raw)
            if data is None:
                raise
        items = data if isinstance(data, list) else data.get("slides", [])
        slides = []
        for i, it in enumerate(items):
            if not isinstance(it, dict) or not it.get("title"):
                continue
            bullets = it.get("bullets") or []
            slides.append({
                "title": str(it["title"])[:90],
                "subtitle": "",
                "layout": str(it.get("layout") or ("title" if i == 0 else "items")).strip().lower(),
                "content": "\n".join(f"• {b}" for b in bullets) if bullets else "",
                "items": [{"icon": "check", "title": b, "body": ""} for b in bullets] if bullets else [],
                "speaker_notes": str(it.get("speaker_notes", ""))[:900],
                "duration": 30,
            })
        return slides or None
    except (LLMConnectionError, ValueError, _json.JSONDecodeError, Exception) as exc:
        logger.info("[PDFPipeline] LLM document understanding failed (%s) — falling back", exc)
        return None


def _repair_truncated_json_array(raw: str) -> list | None:
    """Small local models occasionally stop generating mid-object (hit their
    natural stopping point, or degenerate into trailing whitespace) before
    closing a JSON array. Rather than discard the whole response, salvage
    every complete top-level object that parses cleanly, so a model that got
    6 of 10 slides right before truncating still contributes 6 real, richly
    narrated slides instead of triggering the generic fallback."""
    import json as _json
    start = raw.find("[")
    if start == -1:
        return None
    depth, in_str, esc = 0, False, False
    obj_start = None
    objects: list[dict] = []
    for i, ch in enumerate(raw[start:], start=start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and obj_start is not None:
                try:
                    objects.append(_json.loads(raw[obj_start:i + 1]))
                except _json.JSONDecodeError:
                    pass
                obj_start = None
    return objects or None


_HEADING_HINTS = (
    "executive summary", "business problem", "problem statement", "challenge",
    "proposed solution", "solution overview", "why this solution", "architecture",
    "technology stack", "tech stack", "implementation", "workflow", "process",
    "deliverable", "demonstration", "benefit", "roi", "return on investment",
    "future scope", "conclusion", "next steps", "recommendation", "overview",
    "background", "objective", "scope", "approach", "methodology",
)


def _looks_like_heading(line: str) -> bool:
    """A line is treated as a section heading if it's short and either reads
    like a title (Title Case / ALL CAPS / ends with ':') or matches a common
    business-document section name — checked line-by-line across the WHOLE
    document, not just at paragraph boundaries, since many real PDFs
    (plain-text exports, Word conversions) don't preserve blank-line breaks
    between sections."""
    l = line.strip()
    if not (3 < len(l) < 70):
        return False
    # PDF page-footer/header noise ("Page | 2", "Page 12 of 20") — never a
    # real section heading, but ends up Title-Case and short like one.
    if re.match(r"^page\s*(\|\s*)?\d+(\s+of\s+\d+)?$", l, re.IGNORECASE):
        return False
    if l.rstrip(":").lower() in _HEADING_HINTS:
        return True
    words = l.split()
    if not words:
        return False
    # Title Case / ALL CAPS heading, not a full sentence (no terminal period).
    return (not l.endswith(".")) and (l.isupper() or l.istitle() or l.endswith(":"))


def _sentences_as_bullets(text: str, max_bullets: int = 5, max_len: int = 130) -> list[str]:
    """Split a section's joined text into complete sentences for on-slide
    bullets — PDF text extraction wraps mid-sentence at the page's line
    width, so using raw lines as bullets (the previous approach) produced
    broken, mid-sentence fragments. Splitting on sentence boundaries instead
    gives clean, readable phrases."""
    text = " ".join(text.split())
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z(])", text)
    bullets = []
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(s) > max_len:
            s = s[:max_len].rsplit(" ", 1)[0] + "…"
        bullets.append(s)
        if len(bullets) >= max_bullets:
            break
    return bullets or ([text[:max_len]] if text else ["See full narration below."])


def _deterministic_document_to_slides(full_text: str, project_name: str, page_count: int) -> list[dict]:
    """Instant, dependency-free document -> deck builder. Scans every line
    (independent of paragraph/blank-line structure, which many real-world
    PDFs don't preserve) for section headings, so even without any LLM
    available the user gets a complete, navigable, multi-slide deck — never
    a single wall-of-text slide."""
    all_lines = [l.strip() for l in full_text.splitlines() if l.strip()]

    # PDF is the single source of truth for the title, not whatever project
    # this happens to be attached to — the document's own opening line (a
    # cover-page caption or title, e.g. "AI-Powered Knowledge Companion for
    # Panchayati Raj") is almost always more accurate than project_name.
    doc_title = project_name
    if all_lines:
        first = all_lines[0].rstrip(":")
        if 8 < len(first) < 140 and not first.endswith("."):
            doc_title = first

    sections: list[tuple[str, list[str]]] = []
    current_title, current_lines = project_name, []
    for line in all_lines:
        if _looks_like_heading(line) and current_lines:
            sections.append((current_title, current_lines))
            current_title, current_lines = line.rstrip(":"), []
        else:
            current_lines.append(line)
    if current_lines:
        sections.append((current_title, current_lines))
    # First "section" is often just the document title line repeated as both
    # the title and sole content — drop it if it duplicates the extracted title.
    if sections and sections[0][0] == project_name and len(sections) > 1:
        lead_text = " ".join(sections[0][1]).strip()
        if len(lead_text) < 20 or lead_text == doc_title:
            sections = sections[1:]
    if not sections:
        sections = [(project_name, [full_text[:800]])]

    if len(sections) > 18:
        logger.info("[PDFPipeline] Document has %d sections — keeping first 18", len(sections))
    sections = sections[:18]
    slides = [{
        "title": doc_title, "subtitle": f"{page_count}-page document — automated summary",
        "layout": "title", "content": "", "items": [],
        "speaker_notes": f"Good morning. What follows is a structured walkthrough of {doc_title}, "
                        f"covering the problem, the proposed approach, and the value it delivers.",
        "duration": 30,
    }]
    for title, lines in sections:
        bullets = _sentences_as_bullets(" ".join(lines))
        narration = " ".join(lines)[:600] or f"This section covers {title}."
        slides.append({
            "title": title[:90], "subtitle": "", "layout": "items",
            "content": "\n".join(f"• {b}" for b in bullets),
            "items": [{"icon": "check", "title": b, "body": ""} for b in bullets],
            "speaker_notes": narration, "duration": 28,
        })
    slides.append({
        "title": "Conclusion", "subtitle": "", "layout": "closing",
        "content": "", "items": [{"icon": "check", "title": "Thank you", "body": ""}],
        "speaker_notes": "That concludes this walkthrough. Happy to take any questions.",
        "duration": 20,
    })
    return slides


def _attach_diagram_if_relevant(slide: dict) -> dict:
    """If a slide's title/content strongly suggests a diagram would clarify
    it, render one with the native (always-available) renderer and attach
    its path — never blocks, never fails the slide if rendering errors."""
    text = f"{slide.get('title','')} {slide.get('content','')}".lower()
    if slide.get("layout") in ("architecture", "process") or any(k in text for k in _DIAGRAM_KEYWORDS):
        try:
            from .native_diagram_renderer import spec_from_text, render as native_render
            from .diagram_service import default_storage_base
            dtype = "architecture" if "architecture" in text or "deployment" in text else (
                "sequence" if "sequence" in text else "process")
            bullets_text = slide.get("content", "").replace("• ", "\n").strip() or slide.get("title", "")
            spec = spec_from_text(bullets_text, dtype)
            out_dir = default_storage_base() / "diagrams" / "pdf_auto"
            base = f"auto_{abs(hash(slide.get('title','')))}"
            svg_path, png_path = native_render(spec, out_dir, base)
            slide["diagram_image"] = str(png_path)
        except Exception as exc:
            logger.debug("[PDFPipeline] auto-diagram skipped for slide %r: %s", slide.get("title"), exc)
    return slide


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

    # Provider resolution (BYOK -> deployment default -> Ollama) now lives
    # entirely in LLMService — construct one with db/project_id wherever an
    # LLM call is needed instead of resolving provider/api_key by hand here.

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

        try:
            agent = PresentationVideoAgent(db=db, project_id=payload.project_id)
            result = agent.run(
                artifacts_context=artifacts_context,
                presentation_tone=payload.presentation_tone,
                target_audience=payload.target_audience,
                generate_video=payload.generate_video,
                avatar_config=payload.avatar_config.model_dump(),
                scene_config=payload.scene_config.model_dump(),
                language=payload.language,
                theme_id=payload.theme_id,
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
        """Beautify / Rewrite / Translate a slide's text content via the
        platform's central LLMService (BYOK -> deployment default -> Ollama)."""
        from .agents.llm_service import LLMService

        llm = LLMService(db=db, project_id=project_id, role="review", timeout=60)

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
            new_text = llm.generate_text(
                system="You edit presentation slide text. Return only the edited text, no preamble.",
                prompt=f"{instruction}\n\nCONTENT:\n{text}",
            )
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
        'Diagram' toolbar action.

        Render fallback chain (never leaves the user with a failed diagram):
          1. mermaid-cli (mmdc)   — if installed, prettiest mermaid rendering
          2. Native renderer      — pure Python + Pillow, zero external
                                     binaries, always succeeds. This is the
                                     guaranteed path on machines without
                                     mmdc/PlantUML/graphviz installed.
        Retries once on transient failure before falling back.
        """
        from .diagram_service import default_storage_base, write_artifact_files, DiagramArtifact
        from .native_diagram_renderer import spec_from_text, render as native_render

        diagram_type = (payload.type or "Flowchart").strip()
        dtype_key = diagram_type.lower().replace(" ", "_").replace("diagram", "").strip("_") or "workflow"
        safe_prompt = (payload.prompt or "Diagram").strip()
        base_name = f"diagram_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        out_dir = default_storage_base() / "diagrams" / "tmp"

        spec = spec_from_text(safe_prompt, dtype_key)
        mermaid_source = _spec_to_mermaid(spec)

        svg_path = png_path = None
        source_format = "mermaid"
        status = "generated"

        # 1) Try mermaid-cli, with one retry, if it's actually installed.
        import shutil as _shutil
        if _shutil.which("mmdc") or __import__("os").getenv("MERMAID_CLI"):
            from .diagram_service import build_diagram_artifact_for_mermaid
            for attempt in range(2):
                try:
                    artifact = build_diagram_artifact_for_mermaid(
                        diagram_type=diagram_type, mermaid_source=mermaid_source,
                        out_dir=out_dir, base_name=base_name,
                    )
                    meta = write_artifact_files(default_storage_base(), payload.project_id or 0, None, [artifact])
                    fm = meta["files"][0] if meta.get("files") else {}
                    svg_path, png_path = fm.get("svg_path"), fm.get("png_path")
                    break
                except Exception as exc:
                    logger.warning("[DiagramGenerate] mmdc attempt %d failed: %s", attempt + 1, exc)

        # 2) Guaranteed fallback: native renderer (no external deps, never fails).
        if not svg_path or not png_path:
            try:
                native_svg, native_png = native_render(spec, out_dir, base_name)
                source_format = "native-svg"
                artifact = DiagramArtifact(
                    diagram_type=diagram_type, source_format=source_format,
                    source=mermaid_source,
                    svg_bytes=native_svg.read_bytes(), png_bytes=native_png.read_bytes(),
                    source_filename=f"{base_name}.mmd", svg_filename=native_svg.name,
                    png_filename=native_png.name,
                )
                meta = write_artifact_files(default_storage_base(), payload.project_id or 0, None, [artifact])
                fm = meta["files"][0] if meta.get("files") else {}
                svg_path, png_path = fm.get("svg_path"), fm.get("png_path")
            except Exception as exc:
                # This should be unreachable (native renderer has no external
                # deps) but guard anyway so the endpoint never 500s.
                logger.error("[DiagramGenerate] Native renderer failed unexpectedly: %s", exc, exc_info=True)
                status = "generation_failed"

        return DiagramGenerateResponse(
            diagram_type=diagram_type,
            source_format=source_format,
            source=mermaid_source,
            svg_url=svg_path,
            png_url=png_path,
            status=status,
        )

    def _spec_to_mermaid(spec) -> str:
        """Best-effort mermaid representation of a DiagramSpec, kept as the
        editable/portable `source` field even when rendering falls back to
        the native renderer."""
        if spec.diagram_type == "sequence" and spec.actors:
            lines = ["sequenceDiagram"]
            for a in spec.actors:
                lines.append(f'    participant {re.sub(r"[^A-Za-z0-9_]", "", a) or "A"} as {a}')
            for i in range(len(spec.actors) - 1):
                a1 = re.sub(r"[^A-Za-z0-9_]", "", spec.actors[i]) or "A"
                a2 = re.sub(r"[^A-Za-z0-9_]", "", spec.actors[i + 1]) or "B"
                lines.append(f"    {a1}->>{a2}: step {i + 1}")
            return "\n".join(lines)
        if spec.layers:
            lines = ["flowchart TD"]
            prev = None
            for i, layer in enumerate(spec.layers):
                label = ", ".join(layer) if layer else f"Layer {i+1}"
                node_id = f"L{i}"
                lines.append(f'    {node_id}["{label}"]')
                if prev:
                    lines.append(f"    {prev} --> {node_id}")
                prev = node_id
            return "\n".join(lines)
        nodes = spec.nodes or ["Start", "End"]
        lines = ["flowchart LR"]
        for i, n in enumerate(nodes):
            lines.append(f'    N{i}["{n}"]')
        for a, b in (spec.edges or [(i, i + 1) for i in range(len(nodes) - 1)]):
            lines.append(f"    N{a} --> N{b}")
        return "\n".join(lines)

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

        # Two producers write this same artifact_type with different content
        # shapes: the older VideoGenerationPipeline path (POST
        # /presentation/video/generate) stores the full video as base64 text;
        # the local job-based pipeline (POST /video/render, video_pipeline_
        # local.py's _save_video_artifacts) stores a small JSON blob pointing
        # at the real file on disk (video_path) instead. Detect which one
        # this is rather than assuming — feeding the JSON blob to
        # base64.b64decode() doesn't raise (base64 decoding is lenient), it
        # silently returns a handful of garbage bytes.
        try:
            meta = json.loads(artifact.content)
            video_path = meta.get("video_path")
        except (json.JSONDecodeError, TypeError):
            video_path = None

        if video_path:
            path = Path(video_path)
            if not path.exists():
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Video file not found on disk")
            video_bytes = path.read_bytes()
        else:
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

        # Presenter type maps to the render mode: "human" → SadTalker lip-sync,
        # everything else → narrated slideshow (optionally cartoon-overlaid).
        presenter_type = payload.get("presenter_type") or (
            "human" if payload.get("mode") == "avatar" else "cartoon"
        )
        voice = payload.get("voice") or {}
        job = create_job(
            project_id=project_id,
            slides=slides,
            mode=payload.get("mode", "slides"),
            theme_id=payload.get("theme_id", "ey"),
            voice_id=payload.get("voice_id", "samantha"),
            avatar_id=payload.get("avatar_id", "professional_male"),
            presenter_type=presenter_type,
            presenter_position=str(payload.get("presenter_position", "right")),
            voice_speed=float(voice.get("speed", payload.get("voice_speed", 1.0))),
            voice_pitch=float(voice.get("pitch", payload.get("voice_pitch", 1.0))),
            voice_volume=float(voice.get("volume", payload.get("voice_volume", 1.0))),
            voice_emotion=str(voice.get("emotion", payload.get("voice_emotion", "confident"))),
            narration_style=str(voice.get("style", payload.get("narration_style", "consultant"))),
            pause_scale=float(voice.get("pause", payload.get("pause_scale", 1.0))),
            emphasis=float(voice.get("emphasis", payload.get("emphasis", 1.0))),
            resolution=str(payload.get("resolution", "1080p")),
            fps=int(payload.get("fps", 30)),
            captions=bool(payload.get("captions", False)),
            motion=bool(payload.get("motion", payload.get("camera_motion", True))),
            generate_subtitle_files=bool(payload.get("generate_subtitle_files", False)),
        )
        _executor.submit(run_pipeline, job, get_db_fn, _save_video_artifacts)

        return {
            "job_id": job.job_id,
            "status": "started",
            "slide_count": len(slides),
            "mode": job.mode,
            "presenter_type": job.presenter_type,
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
            "avatar_error": job.avatar_error,
            "avatar_provider_used": job.avatar_provider_used,
            "subtitles_available": bool(job.srt_path and job.vtt_path),
            "error": job.error,
        }

    @app_router.get("/video/render/subtitles/{job_id}.{ext}", summary="Download generated subtitle file (srt or vtt)")
    def download_render_subtitles(
        job_id: str,
        ext: str,
        current_user=Depends(get_current_user_fn),
    ):
        job = get_job(job_id)
        if not job:
            raise HTTPException(404, f"Job {job_id} not found")
        path_str = job.srt_path if ext == "srt" else job.vtt_path if ext == "vtt" else None
        if not path_str:
            raise HTTPException(404, f"No .{ext} subtitle file available for this job")
        path = Path(path_str)
        if not path.exists():
            raise HTTPException(404, "Subtitle file no longer exists")
        media_type = "application/x-subrip" if ext == "srt" else "text/vtt"
        return FileResponse(path, media_type=media_type, filename=path.name)

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

    @app_router.post("/video/render/voice-preview", summary="Synthesize a short narration sample")
    async def voice_preview(payload: dict, current_user=Depends(get_current_user_fn)):
        """Render a short WAV sample with the requested voice + delivery controls
        so users can hear the narration before committing to a full render."""
        from .video_pipeline_local import LocalTTSService, VoiceControls, VIDEO_OUTPUT_DIR
        import uuid as _uuid
        voice = payload.get("voice", {}) if isinstance(payload.get("voice"), dict) else {}
        sample = (payload.get("text") or
                  "Good morning. Let me walk you through how this solution delivers "
                  "real business value, from the problem statement through to the return on investment.")
        controls = VoiceControls(
            voice_id=payload.get("voice_id", voice.get("voice_id", "samantha")),
            speed=float(voice.get("speed", payload.get("voice_speed", 1.0))),
            pitch=float(voice.get("pitch", payload.get("voice_pitch", 1.0))),
            volume=float(voice.get("volume", payload.get("voice_volume", 1.0))),
            emotion=str(voice.get("emotion", payload.get("voice_emotion", "confident"))),
            narration_style=str(voice.get("style", payload.get("narration_style", "consultant"))),
            pause_scale=float(voice.get("pause", payload.get("pause_scale", 1.0))),
        )
        out = VIDEO_OUTPUT_DIR / f"preview_{_uuid.uuid4().hex[:8]}.wav"
        try:
            await run_in_threadpool(LocalTTSService().synthesize, sample, out, controls=controls)
        except Exception as exc:
            raise HTTPException(500, f"Voice preview failed: {exc}")
        return FileResponse(str(out), media_type="audio/wav", filename="voice_preview.wav")

    @app_router.get("/video/render/themes", summary="List available slide themes")
    def list_themes(current_user=Depends(get_current_user_fn)):
        return [{"id": k, "label": v["label"]} for k, v in THEMES.items()]

    @app_router.get("/video/render/presenters", summary="Presenter type availability + persona list")
    def list_presenters(current_user=Depends(get_current_user_fn)):
        """Real, proactive availability check for each presenter type so the UI
        never has to discover 'Human Avatar' is broken after a failed render.
        Cartoon / Voice Only / No Presenter never depend on SadTalker and are
        always available."""
        from .video_pipeline_local import sadtalker_status, AVATAR_SOURCE_MAP
        status = sadtalker_status()
        return {
            "presenter_types": [
                {"id": "cartoon", "label": "Cartoon Presenter", "available": True,
                 "message": "Professional animated presenter — always available."},
                {"id": "human", "label": "Human Avatar", "available": status["available"],
                 "message": status["message"]},
                {"id": "voice_only", "label": "Voice Only", "available": True,
                 "message": "Narrated slides — always available."},
                {"id": "none", "label": "No Presenter", "available": True,
                 "message": "Slides with captions — always available."},
            ],
            "sadtalker": status,
            "personas": list(AVATAR_SOURCE_MAP.keys()),
        }

    @app_router.post("/video/render/presenters/recheck", summary="Force re-probe SadTalker availability")
    def recheck_presenters(current_user=Depends(get_current_user_fn)):
        from .video_pipeline_local import sadtalker_status
        return sadtalker_status(force=True)

    # ── Local AI model selection (Settings → active model + fallback chain) ────
    @app_router.get("/settings/ai-model", summary="List local models + active selection")
    def get_ai_model(current_user=Depends(get_current_user_fn)):
        """Returns the preferred model chain, the currently pinned primary
        model, and which models are actually installed in Ollama."""
        from .agents.llm_client import DEFAULT_MODEL_CHAIN, OllamaClient
        installed: list[str] = []
        try:
            installed = OllamaClient()._list_installed()
        except Exception:
            installed = []
        # Curated, user-facing preference order (Qwen3 32B → 14B → DeepSeek R1 → Gemma)
        preferred = [
            {"id": "qwen3:32b", "label": "Qwen3 32B (best quality)"},
            {"id": "qwen3:14b", "label": "Qwen3 14B (balanced)"},
            {"id": "deepseek-r1:14b", "label": "DeepSeek R1 14B (reasoning)"},
            {"id": "deepseek-r1:8b", "label": "DeepSeek R1 8B"},
            {"id": "gemma2:9b", "label": "Gemma 2 9B (fast, local)"},
            {"id": "gemma2:latest", "label": "Gemma 2 (latest)"},
            {"id": "llama3.1:8b", "label": "Llama 3.1 8B"},
        ]
        return {
            "provider": os.getenv("LLM_PROVIDER", "ollama"),
            "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            "active_model": os.getenv("OLLAMA_MODEL") or DEFAULT_MODEL_CHAIN[0],
            "fallback_chain": (os.getenv("OLLAMA_MODEL_FALLBACKS") or ",".join(DEFAULT_MODEL_CHAIN)).split(","),
            "auto_fallback": os.getenv("OLLAMA_AUTO_FALLBACK", "true").lower() != "false",
            "preferred": preferred,
            "installed": installed,
        }

    @app_router.post("/settings/ai-model/test", summary="Test connection to the local model endpoint")
    def test_ai_model(payload: dict | None = None, current_user=Depends(get_current_user_fn)):
        """Ping Ollama and confirm the requested model is available — powers the
        'Test Connection' button in the Video Studio model configuration."""
        import time as _t
        import requests as _rq
        payload = payload or {}
        base = (payload.get("base_url") or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")
        model = payload.get("model") or os.getenv("OLLAMA_MODEL")
        t0 = _t.time()
        try:
            resp = _rq.get(f"{base}/api/tags", timeout=8)
            resp.raise_for_status()
            installed = [m.get("name", "") for m in resp.json().get("models", [])]
            latency_ms = int((_t.time() - t0) * 1000)
            model_ok = (not model) or any(
                n == model or n.split(":")[0] == str(model).split(":")[0] for n in installed
            )
            return {
                "ok": True,
                "reachable": True,
                "latency_ms": latency_ms,
                "installed_count": len(installed),
                "model": model,
                "model_available": model_ok,
                "message": f"Connected to Ollama at {base} · {len(installed)} models · {latency_ms}ms"
                           + ("" if model_ok else f" · '{model}' not pulled (will use fallback)"),
            }
        except Exception as exc:
            return {
                "ok": False,
                "reachable": False,
                "message": f"Could not reach Ollama at {base}: {exc}",
            }

    @app_router.post("/settings/ai-model", summary="Set active local model + fallback chain")
    def set_ai_model(payload: dict, current_user=Depends(get_current_user_fn)):
        """Persist the active model / fallback chain into the process env so the
        OllamaClient picks it up on the next generation. `model` pins the primary;
        `fallback_chain` (optional list) overrides the whole ordered chain."""
        model = payload.get("model")
        chain = payload.get("fallback_chain")
        if model:
            os.environ["OLLAMA_MODEL"] = str(model)
        if isinstance(chain, list) and chain:
            os.environ["OLLAMA_MODEL_FALLBACKS"] = ",".join(str(m) for m in chain)
        return {
            "status": "saved",
            "active_model": os.getenv("OLLAMA_MODEL"),
            "fallback_chain": (os.getenv("OLLAMA_MODEL_FALLBACKS") or "").split(",") if os.getenv("OLLAMA_MODEL_FALLBACKS") else [],
        }

    # ── Platform-default cloud LLM status (Settings → AI Provider) ────────────
    # Read-only, deployment-wide, no secrets: shows whether the
    # DEFAULT_AZURE_OPENAI_* / DEFAULT_OPENAI_* env vars are configured,
    # without ever exposing the key itself. These are the "two places" the
    # senior engineer configures — Azure is tried first, GPT (OpenAI) second,
    # Ollama only if neither is set. The frontend just displays what's active.
    @app_router.get("/settings/ai-config", summary="Deployment-wide default LLM status (no secrets)")
    def get_ai_config(current_user=Depends(get_current_user_fn)):
        from .agents.llm_service import default_azure_config_from_env, default_openai_config_from_env
        from .agents.llm_client import OllamaClient

        azure_cfg = default_azure_config_from_env()
        openai_cfg = default_openai_config_from_env()
        ollama_reachable = False
        try:
            ollama_reachable = bool(OllamaClient()._list_installed())
        except Exception:
            ollama_reachable = False

        return {
            "azure_configured": azure_cfg is not None,
            "azure_model": azure_cfg.model if azure_cfg else None,
            "azure_endpoint": azure_cfg.base_url if azure_cfg else None,
            "openai_configured": openai_cfg is not None,
            "openai_model": openai_cfg.model if openai_cfg else None,
            # Back-compat fields for any older caller: reflects whichever
            # default would actually win right now (Azure first, then GPT).
            "default_configured": azure_cfg is not None or openai_cfg is not None,
            "default_provider": (azure_cfg or openai_cfg).provider if (azure_cfg or openai_cfg) else None,
            "default_model": (azure_cfg or openai_cfg).model if (azure_cfg or openai_cfg) else None,
            "default_base_url": (azure_cfg or openai_cfg).base_url if (azure_cfg or openai_cfg) else None,
            # api_key deliberately never returned
            "ollama_reachable": ollama_reachable,
        }

    @app_router.post("/settings/ai-config/test", summary="Test the deployment-wide default LLM connection")
    def test_ai_config(current_user=Depends(get_current_user_fn)):
        from .agents.llm_service import default_azure_config_from_env, default_openai_config_from_env

        cfg = default_azure_config_from_env() or default_openai_config_from_env()
        if cfg is None:
            return {
                "reachable": False, "latency_ms": 0, "model_tested": "n/a",
                "message": "No platform default configured — set DEFAULT_AZURE_OPENAI_* or DEFAULT_OPENAI_* in the backend .env",
            }
        from . import ai_service
        return ai_service.test_provider(
            cfg.provider, cfg.api_key, base_url=cfg.base_url, model=cfg.model, api_version=cfg.api_version,
        )

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
        slides: list = []
        if pres_art:
            try:
                data = json.loads(pres_art.content or "{}")
                slides = data.get("slides") or data.get("slide_outline") or []
            except Exception:
                slides = []
        if not slides:
            # The "quick" video-editor flow (build slides in the workspace,
            # hit Generate Video) never persists a `presentation` artifact —
            # only the rendered video's metadata (job_id, duration, path).
            # Fall back to the in-memory render job for that video, keyed by
            # the job_id recorded on the presentation_video artifact, so the
            # script export works for that flow too, not only decks produced
            # via /generate/presentation.
            try:
                from .video_pipeline_local import VIDEO_JOBS
                video_art = (
                    db.query(GeneratedArtifact)
                    .filter(
                        GeneratedArtifact.project_id == project_id,
                        GeneratedArtifact.artifact_type == "presentation_video",
                    )
                    .order_by(GeneratedArtifact.created_at.desc())
                    .first()
                )
                if video_art:
                    meta = json.loads(video_art.content or "{}")
                    job = VIDEO_JOBS.get(meta.get("job_id", ""))
                    if job:
                        slides = job.slides
            except Exception:
                slides = []
        if slides:
            for i, s in enumerate(slides):
                title = s.get("title", f"Slide {i+1}")
                notes = s.get("speaker_notes") or s.get("narration") or s.get("notes") or ""
                content = s.get("content") or ""
                lines.append(f"\n## Slide {i+1}: {title}\n")
                if notes:
                    lines.append(f"**Speaker Notes:** {notes}\n")
                if content:
                    lines.append(f"{content}\n")
        else:
            lines.append("(No presentation or rendered video found for this project.)")
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
            from .agents.llm_service import LLMService
            from pydantic import BaseModel as _BaseModel

            class _SlideActionOut(_BaseModel):
                title: str = ""
                subtitle: str = ""
                content: str = ""
                speaker_notes: str = ""

            llm = LLMService(db=db, project_id=project_id, role="review", timeout=60)
            result = await run_in_threadpool(
                lambda: llm.generate_json(system, user_msg, schema=_SlideActionOut).model_dump()
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

        # Consultant-style fallback narration — never "this slide shows/covers".
        first_point = ""
        for line in str(fallback_content).split("\n"):
            cleaned = line.lstrip("•-–— ").strip()
            if cleaned:
                first_point = cleaned
                break
        fallback_notes = notes or (
            f"Let's talk about {title.lower()}. {first_point}. "
            f"What matters here is how this moves the engagement forward and the value it unlocks for the business."
        )
        return {
            "success": True,
            "slide": {
                "title": title,
                "subtitle": subtitle,
                "content": fallback_content,
                "speaker_notes": fallback_notes,
            }
        }

    # ── NEW: Regenerate just one slide's diagram (no full-deck rebuild) ───────
    @app_router.post("/media-studio/slide-diagram", summary="Regenerate the diagram for a single slide")
    async def slide_diagram_action(
        request: Request,
        current_user=Depends(get_current_user_fn),
    ):
        """Renders a fresh architecture/workflow diagram for one slide's
        current title/content via the local, always-available diagram
        renderer (same one used for PDF auto-diagrams) and returns just the
        updated diagram_image path — the rest of the slide is untouched, and
        no other slide in the deck is regenerated."""
        body = await request.json()
        slide = body.get("slide", {})
        diagram_type = body.get("diagram_type") or (
            "architecture" if "architecture" in str(slide.get("title", "")).lower() else "workflow"
        )

        try:
            import uuid as _uuid
            from .native_diagram_renderer import spec_from_text, render as native_render
            from .diagram_service import default_storage_base

            bullets_text = str(slide.get("content", "")).replace("• ", "\n").strip() or slide.get("title", "")
            spec = spec_from_text(bullets_text, diagram_type)
            out_dir = default_storage_base() / "diagrams" / "slide_action"
            base = f"slide_{_uuid.uuid4().hex[:10]}"
            _svg_path, png_path = native_render(spec, out_dir, base)
            return {"success": True, "diagram_image": str(png_path)}
        except Exception as exc:
            logger.error("[MediaStudio] slide_diagram_action failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail=f"Diagram generation failed: {exc}")

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

        style_desc = {
            "professional": "formal, confident, business-appropriate",
            "conversational": "warm, engaging, natural spoken language",
            "technical": "precise, detailed, technical depth",
            "storytelling": "narrative, engaging, emotional connection",
        }.get(style, "professional")

        from .agents.llm_service import LLMService

        llm = LLMService(db=db, project_id=project_id, role="narration", timeout=60)
        narrated_slides = []
        for i, slide in enumerate(slides):
            system = f"""You are a professional presentation narrator. Generate spoken narration for this slide in a {style_desc} style.
The narration should be 30-60 seconds when spoken aloud (about 80-150 words).
Return ONLY the narration text — no JSON, no markdown, just the words to speak."""
            user_msg = f"Slide {i+1}: {slide.get('title', '')}\nContent: {slide.get('content', '')}"

            try:
                narration_text = llm.generate_text(system, user_msg, temperature=0.4)
                narrated_slides.append({**slide, "speaker_notes": narration_text.strip()[:900]})
            except Exception as exc:
                logger.warning("[MediaStudio] generate_narration LLM call failed for slide %d (%s) — deterministic fallback", i + 1, exc)
                narration_text = slide.get("title", "") + ". " + slide.get("content", "").replace("•", "").replace("\n", ". ")
                narrated_slides.append({**slide, "speaker_notes": narration_text[:300]})

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

    @app_router.post("/video/render/from-pdf", summary="Understand a PDF and generate an editable presentation (optionally start rendering immediately)")
    async def render_from_pdf(
        pdf_file: UploadFile = File(...),
        project_id: int = Form(...),
        mode: str = Form("slides"),
        theme_id: str = Form("ey"),
        voice_id: str = Form("samantha"),
        voice_speed: float = Form(1.0),
        avatar_id: str = Form("professional_male"),
        presenter_type: str = Form("cartoon"),
        gen_mode: str = Form("presentation_video"),
        start_render: bool = Form(False),
        db=Depends(get_db_fn),
        current_user=Depends(get_current_user_fn),
    ):
        """PDF -> understand the document -> one slide per PDF page, editable
        in the workspace.

        By default this ONLY produces the editable slide deck — it does NOT
        start a video render. That lets the user pick a page range (or edit
        content) in the workspace first, then explicitly render via
        /video/render with just the slides they selected. Pass
        start_render=true to preserve the old one-shot "understand + render
        everything immediately" behavior for callers that want it.

        A single bounded LLM call (<=55s, small/fast planning model) turns
        the document into a structured, narrated slide deck; if the model is
        unavailable or times out, a deterministic section-based builder
        produces an equally complete (if less bespoke) deck instantly, so
        this endpoint never hangs and never fails outright."""
        import tempfile, os as _os

        if not pdf_file.filename or not pdf_file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF files are accepted")

        contents = await pdf_file.read()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        try:
            full_text, page_count, pdf_pages = _extract_pdf_text(tmp_path)
        finally:
            _os.unlink(tmp_path)

        if not full_text.strip():
            raise HTTPException(status_code=422, detail="No text could be extracted from the PDF")

        project = db.get(Project, project_id)
        project_name = project.name if project else (pdf_file.filename or "Document").rsplit(".", 1)[0]

        slides = await run_in_threadpool(
            _understand_document_to_slides, full_text, project_name, page_count, pdf_pages,
            db=db, project_id=project_id,
        )

        job_id = None
        if start_render:
            job = create_job(
                project_id=project_id,
                slides=slides,
                mode=mode,
                theme_id=theme_id,
                voice_id=voice_id,
                avatar_id=avatar_id,
                presenter_type=presenter_type,
                voice_speed=voice_speed,
            )
            job.message = f"PDF source: {pdf_file.filename} ({page_count} pages -> {len(slides)} slides)"
            _executor.submit(run_pipeline, job, get_db_fn, _save_video_artifacts)
            job_id = job.job_id

        return {
            "job_id": job_id, "slide_count": len(slides), "source": "pdf",
            "slides": slides,  # returned so the UI can open the editable deck immediately
        }

    @app_router.post("/video/import-pptx", summary="Import an existing .pptx as editable slides")
    async def import_pptx(
        pptx_file: UploadFile = File(...),
        current_user=Depends(get_current_user_fn),
    ):
        """Parse an uploaded .pptx back into the same editable slide-dict shape
        used everywhere else in the workspace (title/subtitle/content/
        speaker_notes/layout), so a deck the user already has can be dropped
        in and continued here rather than starting from scratch. Unlike
        /video/render/from-pdf this does not start a render job — the user
        edits first, then renders explicitly."""
        from .pptx_importer import parse_pptx_to_slides

        if not pptx_file.filename or not pptx_file.filename.lower().endswith(".pptx"):
            raise HTTPException(status_code=400, detail="Only .pptx files are accepted")

        contents = await pptx_file.read()
        try:
            slides = await run_in_threadpool(parse_pptx_to_slides, contents)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except Exception as exc:
            logger.error("[PptxImport] Failed to parse %s: %s", pptx_file.filename, exc, exc_info=True)
            raise HTTPException(status_code=422, detail=f"Could not read this .pptx file: {exc}")

        return {"slide_count": len(slides), "source": "pptx", "slides": slides}

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