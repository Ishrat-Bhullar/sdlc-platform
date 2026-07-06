"""
agents/presentation_video_agent.py
====================================
Presentation & Video Generation orchestrator for the Autonomous SDLC Platform.

This module is the thin orchestrator for the redesigned, design-first
presentation pipeline. The LLM-driven stages now live in their own files:

  StorytellingAgent   (storytelling_agent.py) — narrative StorySpine
  ScenePlannerAgent    (scene_planner.py)       — was DirectorAgent; slide outline + storyboard
  SlideDesignerAgent   (slide_designer.py)      — was LogicAgent; slide copy + narration script
  ReviewAgent          (this file, unchanged)   — quality score + pptx_spec + video storyboard
  AvatarScriptAgent    (avatar_script_agent.py) — story-and-persona-aware avatar delivery script

Between Slide Designer and Review Agent, several deterministic (no-LLM)
engines run synchronously: Layout Engine, Diagram Generator, Theme Engine,
and — after Review — Animation Planner and the Persona Engine lookup that
feeds Avatar Script Agent. None of this changes the public contract: the
only two names anything outside this file imports — PresentationVideoAgent
and VideoGenerationPipeline (see presentation_routes.py) — are still defined
here, unchanged in shape.

Video output:
  Set VIDEO_MODEL=zeroscope_v2 or VIDEO_MODEL=modelscope to enable AI video.
  Without the env var the agent completes successfully with video_available=False.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .llm_service import LLMService
from .presentation_models import (
    PresentationConfig,
    PresentationSummary,
    PptxTheme,
    QualityReview,
    Slide,
    VideoFrame,
    cap,
)
from .storytelling_agent import StorytellingAgent, StorySpine
from .scene_planner import ScenePlannerAgent, ScenePlan
from .slide_designer import SlideDesignerAgent, LogicAgentOutput
from .avatar_script_agent import AvatarScriptAgent, AvatarScriptOutput
from .. import theme_engine as TE
from .. import animation_planner as AP
from ..persona_engine import get_persona, PersonaProfile

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt loader — same helper used by all other agents in the platform
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).parent


def load_prompt(file_name: str) -> str:
    prompt_path = BASE_DIR / "prompts" / file_name
    if not prompt_path.exists():
        raise FileNotFoundError(
            f"Required agent system instructions missing: {prompt_path}"
        )
    return prompt_path.read_text(encoding="utf-8")


REVIEW_SYSTEM_PROMPT = load_prompt("review_prompt.txt")

# ---------------------------------------------------------------------------
# Required artifact types — validated before the agent runs
# ---------------------------------------------------------------------------

_REQUIRED_ARTIFACT_TYPES: list[str] = [
    "requirements",
    "business_analysis",
    "architecture",
    "database",
    "ui_ux",
    "security",
    "compliance",
]


class PresentationArtifactError(ValueError):
    """Raised when required SDLC artifacts are missing from the database."""

    def __init__(self, missing: list[str]) -> None:
        self.missing = missing
        super().__init__(
            f"Cannot generate presentation: the following required artifact types are missing: "
            f"{missing}. Ensure the full pipeline including Human Review Checkpoint 2 has "
            "completed successfully before triggering presentation generation."
        )


def _required_types_from_enum(ArtifactType) -> list[str]:
    try:
        known = {m.value for m in ArtifactType}
        return [t for t in _REQUIRED_ARTIFACT_TYPES if t in known]
    except Exception:
        return list(_REQUIRED_ARTIFACT_TYPES)


def validate_artifacts(db, project_id: int, GeneratedArtifact, ArtifactType) -> list:
    """
    Verify all required artifact types exist for the project.
    Returns the full artifact list on success.
    Raises PresentationArtifactError listing which types are missing.
    """
    required = _required_types_from_enum(ArtifactType)
    artifacts = (
        db.query(GeneratedArtifact)
        .filter(GeneratedArtifact.project_id == project_id)
        .order_by(GeneratedArtifact.created_at.asc())
        .all()
    )
    present = {a.artifact_type for a in artifacts}
    missing = [t for t in required if t not in present]
    if missing:
        raise PresentationArtifactError(missing)
    return artifacts


# ---------------------------------------------------------------------------
# Review Agent output model + sub-agent (unchanged responsibility)
# ---------------------------------------------------------------------------

class ReviewAgentOutput(BaseModel):
    quality_review: QualityReview
    final_slides: list[Slide]
    final_script: str
    video_storyboard: list[VideoFrame]
    pptx_theme: PptxTheme = Field(default_factory=PptxTheme)


def _review_user_prompt(logic_output_json: str, scene_plan_json: str, *, cloud: bool = False) -> str:
    return (
        "Review and polish all slide content. Produce the final PPTX layout specification "
        "and the video storyboard. Do not invent any new facts.\n"
        "Return valid JSON only.\n\n"
        f"LOGIC OUTPUT:\n{cap(logic_output_json, 8000, cloud=cloud)}\n\n"
        f"SCENE PLAN:\n{cap(scene_plan_json, 3000, cloud=cloud)}"
    )


class ReviewAgent:
    """Quality-reviews the Slide Designer's content, polishes it for executive delivery,
    and produces the PPTX layout specification and video storyboard."""

    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None) -> None:
        self.llm = llm or LLMService(db=db, project_id=project_id, role="review", provider_lock="azure_openai")

    def run(
        self,
        logic_output: LogicAgentOutput,
        scene_plan: ScenePlan,
    ) -> ReviewAgentOutput:
        result = self.llm.generate_json(
            system=REVIEW_SYSTEM_PROMPT,
            prompt=_review_user_prompt(
                logic_output.model_dump_json(),
                scene_plan.model_dump_json(),
                cloud=self.llm.has_cloud_path(),
            ),
            schema=ReviewAgentOutput,
        )

        if not result or not result.final_slides:
            raise ValueError(
                "[ReviewAgent] AI returned no final slides. "
                "Slide Designer output may have been truncated or malformed."
            )

        logger.info(
            "[ReviewAgent] Review complete. Quality score: %s/100",
            result.quality_review.overall_score,
        )
        return result


# ---------------------------------------------------------------------------
# Video generation backends (plug-in; off by default)
# ---------------------------------------------------------------------------

def _generate_zeroscope(storyboard: list[VideoFrame], fps: int) -> str:
    from diffusers import DiffusionPipeline  # type: ignore
    import torch                              # type: ignore
    import imageio                            # type: ignore

    pipe = DiffusionPipeline.from_pretrained(
        "cerspense/zeroscope_v2_576w",
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    )
    if torch.cuda.is_available():
        pipe = pipe.to("cuda")

    prompt = storyboard[0].visual_description if storyboard else "Professional enterprise presentation"
    frames = pipe(prompt, num_frames=fps * 3, num_inference_steps=25).frames

    out_dir = Path("./storage/videos")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"presentation_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
    imageio.mimwrite(str(out_path), frames[0], fps=fps)
    return str(out_path)


def _generate_modelscope(storyboard: list[VideoFrame]) -> str:
    from modelscope.pipelines import pipeline as ms_pipeline  # type: ignore
    from modelscope.outputs import OutputKeys                  # type: ignore

    pipe = ms_pipeline("text-to-video-synthesis", "damo-vilab/text-to-video-ms-1.7b")
    prompt = storyboard[0].visual_description if storyboard else "Professional enterprise presentation"

    out_dir = Path("./storage/videos")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"presentation_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
    result = pipe({"text": prompt}, output_video=str(out_path))
    return result[OutputKeys.OUTPUT_VIDEO]


def _try_generate_video(storyboard: list[VideoFrame], fps: int = 30) -> tuple[bool, str | None]:
    model = os.getenv("VIDEO_MODEL", "").lower()
    if not model:
        logger.info("[PresentationVideoAgent] VIDEO_MODEL not set — skipping video generation")
        return False, None

    try:
        if model in ("zeroscope", "zeroscope_v2"):
            path = _generate_zeroscope(storyboard, fps)
        elif model == "modelscope":
            path = _generate_modelscope(storyboard)
        else:
            logger.warning("[PresentationVideoAgent] Unknown VIDEO_MODEL=%s — skipping", model)
            return False, None
        logger.info("[PresentationVideoAgent] Video saved: %s", path)
        return True, path
    except ImportError as exc:
        raise RuntimeError(
            f"Video generation backend '{model}' requires additional packages: {exc}. "
            "Install the required dependencies and retry."
        ) from exc
    except Exception as exc:
        raise RuntimeError(f"Video generation failed for model '{model}': {exc}") from exc


# ---------------------------------------------------------------------------
# Deterministic post-processing helpers (no LLM) run between pipeline stages
# ---------------------------------------------------------------------------

_DIAGRAM_KEYWORDS = ("architecture", "workflow", "pipeline", "component", "microservice",
                     "system design", "data flow", "sequence", "deployment")


def _attach_diagrams(slides: list[dict]) -> list[dict]:
    """Diagram Generator, auto-invoked: for any slide whose plan flagged a
    diagram (or whose layout/text strongly suggests one), render a real PNG
    with the native (always-available) diagram renderer and attach it so
    pptx_builder's existing _picture() embed path shows an actual diagram
    instead of just a text hint. Never blocks — a rendering failure just
    leaves the slide without a diagram_image, same as before this existed."""
    from ..native_diagram_renderer import spec_from_text, render as native_render
    from ..diagram_service import default_storage_base

    for slide in slides:
        text = f"{slide.get('title', '')} {slide.get('visual_suggestions', '')}".lower()
        layout = str(slide.get("layout") or slide.get("visual_suggestions") or "").lower()
        if layout not in ("architecture", "process") and not any(k in text for k in _DIAGRAM_KEYWORDS):
            continue
        try:
            dtype = ("architecture" if "architecture" in text or "deployment" in text
                     else "sequence" if "sequence" in text else "process")
            bullets = slide.get("content", {}) or {}
            bullet_text = "\n".join(bullets.get("bullets", [])) if isinstance(bullets, dict) else str(bullets)
            spec = spec_from_text(bullet_text or slide.get("title", ""), dtype)
            out_dir = default_storage_base() / "diagrams" / "presentation_auto"
            base = f"auto_{abs(hash(slide.get('title', '')))}"
            _svg_path, png_path = native_render(spec, out_dir, base)
            slide["diagram_image"] = str(png_path)
        except Exception as exc:
            logger.debug("[PresentationVideoAgent] auto-diagram skipped for slide %r: %s",
                         slide.get("title"), exc)
    return slides


def _attach_hero_images(slides: list[dict], theme_id: str, *, db=None, project_id: int | None = None) -> list[dict]:
    """Image Prompt Generator + Image Provider, wired in right after diagram
    attachment. For each image-worthy slide (per image_prompt_generator's
    explicit allow/skip lists), generates a hero illustration and attaches it
    as a NEW, separate `hero_image` field — kept distinct from `diagram_image`
    so both can coexist (pptx_builder's per-layout composition decides which,
    if any, actually renders for a given layout). Never blocks: generate_
    image_with_fallback() already returns None on any failure or when no
    image provider is configured (today's real state), so a slide simply
    keeps its existing gradient/diagram/icon look — identical to before this
    stage existed."""
    from .image_prompt_generator import build_image_prompt
    from .image_provider import generate_image_with_fallback
    from .. import layout_engine as LE
    from ..diagram_service import default_storage_base

    for slide in slides:
        content = slide.get("content") or {}
        bullets = content.get("bullets", []) if isinstance(content, dict) else []
        category_hint = slide.get("slide_type") or slide.get("visual_suggestions") or ""
        resolved_layout = LE.choose_layout(
            content_type_hint=category_hint, bullets=bullets, title=slide.get("title", ""),
            llm_hint=slide.get("visual_suggestions"),
        )
        slide_text = " ".join(bullets) + " " + str(content.get("body_text", "") if isinstance(content, dict) else "")
        prompt = build_image_prompt(
            slide.get("title", ""), category_hint, theme_id,
            slide_layout=resolved_layout, slide_text=slide_text,
        )
        if not prompt:
            continue
        out_dir = default_storage_base() / "hero_images" / "presentation_auto"
        out_path = out_dir / f"hero_{abs(hash((slide.get('title', ''), prompt)))}.png"
        result = generate_image_with_fallback(
            prompt, out_path, db=db, project_id=project_id, providers=("azure_openai_image",)
        )
        if result:
            slide["hero_image"] = str(result.image_path)
    return slides


def _apply_animation_plan(
    storyboard: list[VideoFrame], scene_plan: ScenePlan, final_slide_dicts: list[dict] | None = None,
) -> list[VideoFrame]:
    """Animation Planner: cross-check the LLM's own per-frame `animation`
    field against a deterministic transition plan derived from scene
    boundaries in the storyboard, and fill in the still-default "fade-in"
    frames with a more deliberate transition at real topic boundaries. Never
    overrides a frame where the LLM already chose something other than the
    schema default, so this only adds signal, never removes it.

    `final_slide_dicts` (optional — carries `layout`/`hero_image` per slide,
    keyed by slide_number) lets animation_planner.plan_transitions() pick
    content-aware transitions: progressive_diagram for architecture/process/
    roadmap layouts, zoom for slides with a hero_image, instead of a flat
    fade for every boundary."""
    slides_by_number = {s.get("slide_number"): s for s in (final_slide_dicts or [])}

    scenes = []
    for i, frame in enumerate(storyboard):
        slide = slides_by_number.get(frame.slide_number, {})
        scenes.append({
            "scene_number": i + 1,
            "transition_hint": "new_topic" if i == 0 else "continuation",
            "layout": slide.get("layout") or slide.get("visual_suggestions", ""),
            "hero_image": slide.get("hero_image"),
        })
    # Mark a stronger transition at each slide_type boundary in the scene plan.
    slide_types = [s.get("slide_type", "") for s in (scene_plan.slide_outline or [])]
    for i in range(1, min(len(scenes), len(slide_types))):
        if slide_types[i] != slide_types[i - 1]:
            scenes[i]["transition_hint"] = "new_topic"
    if scenes:
        scenes[-1]["transition_hint"] = "closing"

    transitions = AP.plan_transitions(scenes)
    for i, frame in enumerate(storyboard):
        if i == 0 or i - 1 >= len(transitions):
            continue
        if frame.animation == "fade-in":  # still at the schema default — safe to enrich
            frame.animation = transitions[i - 1].transition_type
    return storyboard


# ---------------------------------------------------------------------------
# Top-level output returned by PresentationVideoAgent.run()
# ---------------------------------------------------------------------------

class PresentationVideoAgentOutput(BaseModel):
    story_spine: StorySpine
    scene_plan: ScenePlan
    logic_output: LogicAgentOutput
    review_output: ReviewAgentOutput
    avatar_script: AvatarScriptOutput | None = None
    executive_summary: str
    narrative_arc: str
    slide_outline: list[dict]        # [{slide_number, title, subtitle, key_points, slide_type}]
    speaker_notes: list[dict]        # [{slide_number, title, notes}]
    storyboard: list[dict]
    presentation_script: str
    pptx_spec: dict                  # {theme, slides, total_slides} — fed to pptx_builder
    quality_score: float
    presentation_summary: PresentationSummary
    video_available: bool
    video_url: str | None
    generated_at: str
    config: PresentationConfig = Field(default_factory=PresentationConfig)


# ---------------------------------------------------------------------------
# Small helpers for tolerant avatar/scene config parsing
# ---------------------------------------------------------------------------

AvatarConfigLike = Any  # dict-like or str; kept loose so callers (routes) can pass raw JSON


def _extract_value(cfg: Any, default: str) -> str:
    if cfg is None:
        return default
    if isinstance(cfg, str):
        return cfg or default
    if isinstance(cfg, dict):
        return cfg.get("value") or default
    value = getattr(cfg, "value", None)
    return value or default


def _extract_mode(cfg: Any, default: str) -> str:
    if cfg is None or isinstance(cfg, str):
        return default
    if isinstance(cfg, dict):
        return cfg.get("mode") or default
    return getattr(cfg, "mode", None) or default


# ---------------------------------------------------------------------------
# Parent orchestrator
# ---------------------------------------------------------------------------

class PresentationVideoAgent:
    """
    Orchestrates the redesigned pipeline:

      StorytellingAgent -> ScenePlannerAgent -> SlideDesignerAgent
        -> [Diagram Generator, Theme Engine — deterministic]
        -> ReviewAgent
        -> [Animation Planner, Persona Engine lookup — deterministic]
        -> AvatarScriptAgent (only if generate_video=True)

    to produce a professional executive PPTX specification, a coherent
    avatar delivery script, and optional AI video.

    All LLM calls go through the platform's central LLMService — the same
    path used by ArchitectAgent, SecurityArchitectAgent, etc. — so BYOK /
    the deployment's default cloud provider / Ollama fallback all resolve
    identically here.
    """

    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None) -> None:
        # If a caller passes an explicit `llm`, honor it verbatim for every
        # stage. Otherwise each sub-agent builds its own role-tuned
        # LLMService (planning/narration/review) sharing the same db/
        # project_id, so BYOK resolution is identical across stages while
        # the Ollama fallback still picks a model suited to each stage.
        self._llm = llm
        self._db = db
        self._project_id = project_id
        self.storyteller = StorytellingAgent(llm, db=db, project_id=project_id)
        self.scene_planner = ScenePlannerAgent(llm, db=db, project_id=project_id)
        self.slide_designer = SlideDesignerAgent(llm, db=db, project_id=project_id)
        self.review = ReviewAgent(llm, db=db, project_id=project_id)

    def run(
        self,
        artifacts_context: str,
        presentation_tone: str = "executive",
        target_audience: str = "C-suite executives and engineering leadership",
        generate_video: bool = False,
        avatar_config: dict | AvatarConfigLike | None = None,
        scene_config: dict | AvatarConfigLike | None = None,
        language: str = "en-US",
        theme_id: str | None = None,
    ) -> PresentationVideoAgentOutput:
        """
        Full pipeline: Storytelling -> Scene Planning -> Slide Design ->
        (diagrams/theme) -> Review -> (animation/persona) -> optional Avatar
        Script -> optional video.

        `avatar_config` / `scene_config` accept either a dict with a `value`
        key (as sent by the frontend's AvatarSelector/SceneSelector — e.g.
        {"mode": "preset", "value": "Doctor"}) or a plain string. Returns
        PresentationVideoAgentOutput with all sub-agent outputs embedded so
        the caller can persist each stage as its own GeneratedArtifact row.
        """
        if not artifacts_context.strip():
            raise ValueError(
                "artifacts_context is empty. Ensure the full pipeline has completed "
                "before triggering presentation generation."
            )

        config = PresentationConfig(
            avatar_mode=_extract_mode(avatar_config, "preset"),
            avatar_value=_extract_value(avatar_config, "Professional Male"),
            scene_mode=_extract_mode(scene_config, "preset"),
            scene_value=_extract_value(scene_config, "Office"),
            language=language or "en-US",
        )
        persona: PersonaProfile = get_persona(config.avatar_value)

        logger.info(
            "[PresentationVideoAgent] Starting pipeline. tone=%s video=%s avatar=%s scene=%s lang=%s persona=%s",
            presentation_tone, generate_video, config.avatar_value, config.scene_value, config.language, persona.id,
        )

        # Stage 1: Storytelling — narrative spine, before any slide planning
        story_spine = self.storyteller.run(
            artifacts_context=artifacts_context,
            presentation_tone=presentation_tone,
            target_audience=target_audience,
        )

        # Stage 2: Scene Planning — slide outline + storyboard, story-spine-aware
        scene_plan = self.scene_planner.run(
            artifacts_context=artifacts_context,
            presentation_tone=presentation_tone,
            target_audience=target_audience,
            story_spine=story_spine,
        )

        # Stage 3: Slide Design — full slide copy + narration script
        logic_output = self.slide_designer.run(
            scene_plan=scene_plan,
            artifacts_context=artifacts_context,
            config=config,
        )

        # Stage 4: Review — quality score, final slides, pptx_theme, video storyboard
        review_output = self.review.run(
            logic_output=logic_output,
            scene_plan=scene_plan,
        )

        final_slides = review_output.final_slides
        final_slide_dicts = _attach_diagrams([s.model_dump() for s in final_slides])

        # Stage 5 (deterministic): Theme Engine — resolve the active theme,
        # defaulting by persona category when the caller didn't pick one.
        # Resolved here (rather than after images) because the Image Prompt
        # Generator needs the theme's image_palette.
        resolved_theme_id = theme_id or _theme_for_persona(persona)
        theme = TE.get_theme(resolved_theme_id)

        # Stage 5.5 (deterministic): Image Prompt Generator + Image Provider
        # — hero illustrations for image-worthy slides. No-ops cleanly when
        # no image provider is configured (today's real state).
        final_slide_dicts = _attach_hero_images(
            final_slide_dicts, resolved_theme_id, db=self._db, project_id=self._project_id
        )

        # Stage 6 (deterministic): Animation Planner — enrich storyboard
        # transitions at real topic boundaries, now content-aware (layout/
        # hero_image) via final_slide_dicts.
        video_storyboard = _apply_animation_plan(review_output.video_storyboard, scene_plan, final_slide_dicts)

        # Stage 7: Avatar Script Agent — only when video is requested, so
        # presentation-only requests incur zero extra LLM cost.
        avatar_script: AvatarScriptOutput | None = None
        video_available = False
        video_url: str | None = None
        if generate_video and video_storyboard:
            avatar_script = AvatarScriptAgent(self._llm, db=self._db, project_id=self._project_id).run(
                video_storyboard=video_storyboard,
                story_spine=story_spine,
                persona=persona,
            )
            fps = 30
            video_available, video_url = _try_generate_video(video_storyboard, fps)

        result = PresentationVideoAgentOutput(
            story_spine=story_spine,
            scene_plan=scene_plan,
            logic_output=logic_output,
            review_output=review_output,
            avatar_script=avatar_script,
            executive_summary=story_spine.hook,
            narrative_arc=scene_plan.narrative_arc,
            slide_outline=[
                {
                    "slide_number": s.slide_number,
                    "title": s.title,
                    "subtitle": s.subtitle,
                    "key_points": s.content.bullets,
                    "slide_type": s.slide_type,
                }
                for s in final_slides
            ],
            speaker_notes=[
                {
                    "slide_number": s.slide_number,
                    "title": s.title,
                    "notes": s.speaker_notes,
                }
                for s in final_slides
            ],
            storyboard=[f.model_dump() for f in video_storyboard],
            presentation_script=review_output.final_script or logic_output.full_script,
            pptx_spec={
                "theme": {**review_output.pptx_theme.model_dump(), "theme_id": resolved_theme_id, **theme},
                "slides": final_slide_dicts,
                "total_slides": len(final_slides),
            },
            quality_score=review_output.quality_review.overall_score,
            presentation_summary=logic_output.presentation_summary,
            video_available=video_available,
            video_url=video_url,
            generated_at=datetime.now(timezone.utc).isoformat(),
            config=config,
        )

        logger.info(
            "[PresentationVideoAgent] Complete. slides=%d score=%.1f video=%s persona=%s theme=%s",
            len(final_slides), result.quality_score, video_available, persona.id, resolved_theme_id,
        )
        return result


_PERSONA_CATEGORY_THEME = {
    "government": "government",
    "healthcare": "healthcare",
    "rural": "startup",  # no dedicated rural theme yet; startup's bold palette reads well on projectors
}


def _theme_for_persona(persona: PersonaProfile) -> str:
    return _PERSONA_CATEGORY_THEME.get(persona.category, TE.DEFAULT_THEME)


# ---------------------------------------------------------------------------
# Video Generation Pipeline (fully local — Coqui XTTS / Piper + LibreOffice
# + FFmpeg, no cloud APIs, no API keys, works completely offline)
# ---------------------------------------------------------------------------
# Additive extension — does NOT modify the LLM-driven stages above. It
# consumes their *output* (pptx bytes + per-slide speaker notes + the full
# narration script) to render a downloadable MP4. It is triggered separately
# from presentation_routes.py so text generation and video rendering can be
# retried independently and the existing /generate/presentation flow is
# completely unaffected.

from ..services.video_generation_service import (
    VoiceConfig,
    NarrationService,
    SlideRenderer,
    VideoComposer,
)


class VideoGenerationResult(BaseModel):
    narrated_video_path: str | None = None
    video_available: bool = False
    slide_image_count: int = 0
    duration_seconds: float | None = None


def _emit_progress(progress_cb, stage: str, percent: int, message: str = "") -> None:
    if progress_cb:
        try:
            progress_cb(stage, percent, message)
        except Exception:
            logger.debug("[VideoGenerationPipeline] progress callback raised", exc_info=True)


class VideoGenerationPipeline:
    """Renders a single narrated presentation.mp4 from an already-generated
    presentation (pptx bytes + per-slide speaker notes + the full narration
    script). 100% local: no network calls, no API keys.

    Pipeline stages (matching the WebSocket progress events emitted by the
    caller in presentation_routes.py):
        generating_script   — emitted by the caller before invoking this
                               pipeline, while the LLM presentation content
                               itself is produced (not part of this class)
        generating_voice    — per-slide local TTS narration (Coqui XTTS,
                               falling back to Piper)
        rendering_slides    — PPTX -> per-slide PNG images (LibreOffice + pdf2image)
        composing_video     — slide images + narration -> MP4 (FFmpeg)
        completed           — presentation.mp4 is ready
    """

    def __init__(self, work_dir: str | Path | None = None):
        self.work_dir = Path(work_dir or os.getenv("VIDEO_PIPELINE_WORKDIR", "./storage/video_work"))

    def run(
        self,
        *,
        pptx_bytes: bytes,
        slides: list[dict],
        full_script: str,
        voice_config: VoiceConfig,
        video_enabled: bool = True,
        progress_cb=None,
    ) -> VideoGenerationResult:
        result = VideoGenerationResult()
        if not video_enabled:
            _emit_progress(progress_cb, "completed", 100, "Video generation skipped (video_enabled=false)")
            return result

        session_dir = self.work_dir / f"session_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
        session_dir.mkdir(parents=True, exist_ok=True)

        # 1. Write PPTX to disk, render to per-slide images
        _emit_progress(progress_cb, "rendering_slides", 25, "Rendering slides to images")
        pptx_path = session_dir / "presentation.pptx"
        pptx_path.write_bytes(pptx_bytes)

        renderer = SlideRenderer()
        slide_images = renderer.render(pptx_path, session_dir / "slides")
        result.slide_image_count = len(slide_images)
        _emit_progress(progress_cb, "rendering_slides", 40, f"Rendered {len(slide_images)} slide images")

        # 2. Per-slide narration audio (speaker_notes, falling back to title)
        _emit_progress(progress_cb, "generating_voice", 50, "Synthesizing narration audio")
        narration_service = NarrationService(voice_config)
        audio_dir = session_dir / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)

        slide_audio_paths: list[Path] = []
        for idx, slide in enumerate(slides, start=1):
            text = (slide.get("speaker_notes") or slide.get("title") or "").strip() or "."
            audio_path = audio_dir / f"slide_{idx:03d}.wav"
            narration_service.synthesize(text, audio_path)
            slide_audio_paths.append(audio_path)
            _emit_progress(
                progress_cb, "generating_voice",
                50 + int(20 * idx / max(len(slides), 1)),
                f"Synthesized narration for slide {idx}/{len(slides)}",
            )

        # Defensive alignment in case slide/audio counts ever drift
        if slide_audio_paths and len(slide_audio_paths) < len(slide_images):
            last = slide_audio_paths[-1]
            slide_audio_paths.extend([last] * (len(slide_images) - len(slide_audio_paths)))
        slide_images = slide_images[: len(slide_audio_paths)] if slide_audio_paths else slide_images
        slide_audio_paths = slide_audio_paths[: len(slide_images)]

        # 3. Compose narrated slideshow video
        _emit_progress(progress_cb, "composing_video", 80, "Composing final presentation.mp4")
        composer = VideoComposer()
        narrated_path = session_dir / "presentation.mp4"
        composer.compose(slide_images, slide_audio_paths, narrated_path)
        result.narrated_video_path = str(narrated_path)
        result.video_available = True

        try:
            import subprocess
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(narrated_path)],
                capture_output=True, text=True, timeout=10,
            )
            result.duration_seconds = float(probe.stdout.strip())
        except Exception:
            logger.debug("[VideoGenerationPipeline] Could not probe video duration", exc_info=True)

        _emit_progress(progress_cb, "completed", 100, "Presentation video ready")
        return result
