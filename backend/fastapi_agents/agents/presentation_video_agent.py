"""
agents/presentation_video_agent.py
====================================
Presentation & Video Generation Agent for the Autonomous SDLC Platform.

Mirrors the architecture of architect_agent.py exactly:
  - Loads system prompts from agents/prompts/ at module import time
  - Uses the platform's OllamaClient / call_and_validate for every LLM call
  - Returns typed Pydantic models
  - Raises ValueError for missing input or empty AI output

Three sub-agents, each responsible for one stage of the pipeline:
  DirectorAgent   — reads real SDLC artifacts, plans the narrative & slide outline
  LogicAgent      — writes all slide content, speaker notes, and the narration script
  ReviewAgent     — polishes content, scores quality, produces the PPTX layout spec
                    and video storyboard

The parent PresentationVideoAgent orchestrates all three and is the only
class called from ai_service.generate_presentation() / presentation_routes.py.

Avatar / Scene / Language support:
  Logic_prompt.txt uses `{{avatar_value}}`, `{{scene_value}}`, `{{language}}`
  placeholders. PresentationVideoAgent.run() now accepts an optional
  `avatar_config`, `scene_config`, and `language` and substitutes them into
  the LogicAgent's system prompt before each call, so generated narration is
  grounded in the presenter persona / scene / language picked in the frontend
  (AvatarSelector / SceneSelector / StudioConfiguration).

  NOTE: a previous revision of this file accidentally defined a *second*,
  incomplete `PresentationVideoAgent` class further down in the module. Since
  Python resolves duplicate top-level definitions by "last one wins", that
  broken stub (referencing the undefined `PresentationResult` type and a
  `self.director_agent` typo) silently replaced the entire working
  implementation below at import time. That duplicate has been removed and
  its intent (config-aware generation) merged into the real class instead.

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

from .llm_client import OllamaClient, call_and_validate

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


# Loaded once at import time, same as ARCHITECT_AGENT_SYSTEM_PROMPT
DIRECTOR_SYSTEM_PROMPT = load_prompt("director_prompt.txt")
LOGIC_SYSTEM_PROMPT    = load_prompt("logic_prompt.txt")
REVIEW_SYSTEM_PROMPT   = load_prompt("review_prompt.txt")

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
# Avatar / Scene / Language configuration
# ---------------------------------------------------------------------------

class PresentationConfig(BaseModel):
    """Presenter persona, scene, and language — sourced from AvatarSelector /
    SceneSelector / StudioConfiguration on the frontend."""
    avatar_mode: str = "preset"
    avatar_value: str = "Professional Male"
    scene_mode: str = "preset"
    scene_value: str = "Office"
    language: str = "en-US"


def _render_template(template: str, config: "PresentationConfig") -> str:
    """Substitute {{avatar_value}}, {{scene_value}}, {{language}} placeholders
    used in agents/prompts/logic_prompt.txt with the active config."""
    return (
        template
        .replace("{{avatar_value}}", config.avatar_value)
        .replace("{{scene_value}}", config.scene_value)
        .replace("{{language}}", config.language)
    )


# ---------------------------------------------------------------------------
# Pydantic output models (mirrors ArchitectAgentOutput pattern)
# ---------------------------------------------------------------------------

class SlideLayout(BaseModel):
    layout_type: str = "TITLE_CONTENT"
    background_color: str = "1a1a2e"
    title_font_size: int = 28
    content_font_size: int = 16
    accent_color: str = "4FC3F7"
    include_slide_number: bool = True


class DataPoint(BaseModel):
    label: str
    value: str
    context: str = ""


class SlideContent(BaseModel):
    bullets: list[str] = Field(default_factory=list)
    body_text: str = ""
    data_points: list[DataPoint] = Field(default_factory=list)


class Slide(BaseModel):
    slide_number: int
    title: str
    subtitle: str = ""
    slide_type: str = "content"
    content: SlideContent = Field(default_factory=SlideContent)
    speaker_notes: str = ""
    visual_suggestions: str = ""
    pptx_layout: SlideLayout = Field(default_factory=SlideLayout)


class PresentationSummary(BaseModel):
    total_slides: int
    estimated_duration: str = "15 minutes"
    key_messages: list[str] = Field(default_factory=list)
    call_to_action: str = ""


class PptxTheme(BaseModel):
    primary_color: str = "1a1a2e"
    secondary_color: str = "16213e"
    accent_color: str = "4FC3F7"
    text_color: str = "FFFFFF"
    font_family: str = "Calibri"


class VideoFrame(BaseModel):
    frame_number: int
    timestamp_seconds: int
    slide_number: int
    narration: str
    visual_description: str
    animation: str = "fade-in"
    duration_seconds: int = 90


class QualityReview(BaseModel):
    overall_score: float
    narrative_consistency: float = 0.0
    content_completeness: float = 0.0
    visual_clarity: float = 0.0
    executive_impact: float = 0.0
    issues_found: list[str] = Field(default_factory=list)
    improvements_made: list[str] = Field(default_factory=list)


# Sub-agent output models used for structured persistence

class DirectorAgentOutput(BaseModel):
    executive_summary: str
    narrative_arc: str
    presentation_tone: str
    target_audience: str
    slide_outline: list[dict]        # raw dicts preserved for LogicAgent prompt
    storyboard: list[dict]
    total_duration_minutes: int = 15
    recommended_sections: list[str] = Field(default_factory=list)


class LogicAgentOutput(BaseModel):
    slides: list[Slide]
    full_script: str
    presentation_summary: PresentationSummary
    artifacts_used: list[str] = Field(default_factory=list)


class ReviewAgentOutput(BaseModel):
    quality_review: QualityReview
    final_slides: list[Slide]
    final_script: str
    video_storyboard: list[VideoFrame]
    pptx_theme: PptxTheme = Field(default_factory=PptxTheme)


# Top-level output returned by PresentationVideoAgent.run()
class PresentationVideoAgentOutput(BaseModel):
    director_plan: DirectorAgentOutput
    logic_output: LogicAgentOutput
    review_output: ReviewAgentOutput
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
# User-prompt builders (system prompts come from prompt files)
# ---------------------------------------------------------------------------

def _director_user_prompt(artifacts_context: str, tone: str, audience: str) -> str:
    return (
        f"Analyze the provided SDLC artifacts and create a comprehensive presentation plan.\n"
        f"Tone: {tone}. Target audience: {audience}.\n"
        f"All content must be derived exclusively from the artifacts below. "
        "Return valid JSON only.\n\n"
        f"ARTIFACTS:\n{artifacts_context[:8000]}"
    )


def _logic_user_prompt(director_plan_json: str, artifacts_context: str, config: PresentationConfig) -> str:
    return (
        "Generate complete slide content, speaker notes, and the full narration script.\n"
        f"The presentation will be delivered by a {config.avatar_value} in a {config.scene_value} setting, "
        f"in {config.language}.\n"
        "Every fact must come from the SDLC artifacts. "
        "Write [Data not available] if a planned slide cannot be backed by artifact data.\n"
        "Return valid JSON only.\n\n"
        f"DIRECTOR PLAN:\n{director_plan_json[:8000]}\n\n"
        f"ARTIFACTS:\n{artifacts_context[:8000]}"
    )


def _review_user_prompt(logic_output_json: str, director_plan_json: str) -> str:
    return (
        "Review and polish all slide content. Produce the final PPTX layout specification "
        "and the video storyboard. Do not invent any new facts.\n"
        "Return valid JSON only.\n\n"
        f"LOGIC OUTPUT:\n{logic_output_json[:8000]}\n\n"
        f"DIRECTOR PLAN:\n{director_plan_json[:3000]}"
    )


# ---------------------------------------------------------------------------
# Sub-agents — each mirrors the ArchitectAgent pattern
# ---------------------------------------------------------------------------

class DirectorAgent:
    """Analyzes project SDLC artifacts and creates the narrative plan, slide outline,
    and storyboard. Uses the platform's OllamaClient / call_and_validate."""

    def __init__(self, client: OllamaClient | None = None) -> None:
        self.client = client or OllamaClient()

    def run(
        self,
        artifacts_context: str,
        presentation_tone: str,
        target_audience: str,
    ) -> DirectorAgentOutput:
        if not artifacts_context.strip():
            raise ValueError("[DirectorAgent] artifacts_context cannot be empty")

        result = call_and_validate(
            client=self.client,
            system=DIRECTOR_SYSTEM_PROMPT,
            prompt=_director_user_prompt(artifacts_context, presentation_tone, target_audience),
            schema=DirectorAgentOutput,
        )

        if not result or not result.slide_outline:
            raise ValueError(
                "[DirectorAgent] AI returned an empty plan. "
                "Ensure artifacts contain sufficient content and the AI provider is reachable."
            )

        logger.info("[DirectorAgent] Plan created: %d slides", len(result.slide_outline))
        return result


class LogicAgent:
    """Takes the Director's plan and writes complete slide content, speaker notes,
    and the full narration script, grounded in real SDLC artifacts and the active
    avatar/scene/language configuration."""

    def __init__(self, client: OllamaClient | None = None) -> None:
        self.client = client or OllamaClient()

    def run(
        self,
        director_plan: DirectorAgentOutput,
        artifacts_context: str,
        config: PresentationConfig | None = None,
    ) -> LogicAgentOutput:
        config = config or PresentationConfig()
        system_prompt = _render_template(LOGIC_SYSTEM_PROMPT, config)

        result = call_and_validate(
            client=self.client,
            system=system_prompt,
            prompt=_logic_user_prompt(
                director_plan.model_dump_json(),
                artifacts_context,
                config,
            ),
            schema=LogicAgentOutput,
        )

        if not result or not result.slides:
            raise ValueError(
                "[LogicAgent] AI returned no slides. "
                "Check that the director plan and artifact context are non-empty."
            )

        logger.info(
            "[LogicAgent] Content generated: %d slides, script_length=%d chars",
            len(result.slides),
            len(result.full_script),
        )
        return result


class ReviewAgent:
    """Quality-reviews the Logic Agent's content, polishes it for executive delivery,
    and produces the PPTX layout specification and video storyboard."""

    def __init__(self, client: OllamaClient | None = None) -> None:
        self.client = client or OllamaClient()

    def run(
        self,
        logic_output: LogicAgentOutput,
        director_plan: DirectorAgentOutput,
    ) -> ReviewAgentOutput:
        result = call_and_validate(
            client=self.client,
            system=REVIEW_SYSTEM_PROMPT,
            prompt=_review_user_prompt(
                logic_output.model_dump_json(),
                director_plan.model_dump_json(),
            ),
            schema=ReviewAgentOutput,
        )

        if not result or not result.final_slides:
            raise ValueError(
                "[ReviewAgent] AI returned no final slides. "
                "Logic agent output may have been truncated or malformed."
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
# Parent orchestrator
# ---------------------------------------------------------------------------

class PresentationVideoAgent:
    """
    Orchestrates DirectorAgent → LogicAgent → ReviewAgent to produce a
    professional executive PPTX specification and optional AI video.

    All LLM calls go through the platform's OllamaClient / call_and_validate —
    the same path used by ArchitectAgent, SecurityArchitectAgent, etc.

    A shared OllamaClient instance is passed down to all three sub-agents so
    connection setup happens once.
    """

    def __init__(self, provider: str | None = None, api_key: str | None = None, client: OllamaClient | None = None) -> None:
        # `provider` / `api_key` kept for backwards compatibility with callers
        # (e.g. presentation_routes.py / presentation_integration.py) that
        # construct OllamaClient themselves via these kwargs.
        if client is None:
            try:
                client = OllamaClient(provider=provider, api_key=api_key)  # type: ignore[call-arg]
            except TypeError:
                client = OllamaClient()
        self._client = client
        self.director = DirectorAgent(self._client)
        self.logic    = LogicAgent(self._client)
        self.review   = ReviewAgent(self._client)

    def run(
        self,
        artifacts_context: str,
        presentation_tone: str = "executive",
        target_audience: str = "C-suite executives and engineering leadership",
        generate_video: bool = False,
        avatar_config: dict | AvatarConfigLike | None = None,
        scene_config: dict | AvatarConfigLike | None = None,
        language: str = "en-US",
    ) -> PresentationVideoAgentOutput:
        """
        Full pipeline: Director → Logic → Review → optional video.

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

        logger.info(
            "[PresentationVideoAgent] Starting pipeline. tone=%s video=%s avatar=%s scene=%s lang=%s",
            presentation_tone, generate_video, config.avatar_value, config.scene_value, config.language,
        )

        # Step 1: Director
        director_plan = self.director.run(
            artifacts_context=artifacts_context,
            presentation_tone=presentation_tone,
            target_audience=target_audience,
        )

        # Step 2: Logic (avatar/scene/language-aware)
        logic_output = self.logic.run(
            director_plan=director_plan,
            artifacts_context=artifacts_context,
            config=config,
        )

        # Step 3: Review
        review_output = self.review.run(
            logic_output=logic_output,
            director_plan=director_plan,
        )

        final_slides = review_output.final_slides

        # Step 4: Optional video
        video_available = False
        video_url: str | None = None
        if generate_video:
            fps = 30
            video_available, video_url = _try_generate_video(
                review_output.video_storyboard, fps
            )

        result = PresentationVideoAgentOutput(
            director_plan=director_plan,
            logic_output=logic_output,
            review_output=review_output,
            executive_summary=director_plan.executive_summary,
            narrative_arc=director_plan.narrative_arc,
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
            storyboard=[f.model_dump() for f in review_output.video_storyboard],
            presentation_script=review_output.final_script or logic_output.full_script,
            pptx_spec={
                "theme": review_output.pptx_theme.model_dump(),
                "slides": [s.model_dump() for s in final_slides],
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
            "[PresentationVideoAgent] Complete. slides=%d score=%.1f video=%s",
            len(final_slides), result.quality_score, video_available,
        )
        return result


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
# Video Generation Pipeline (fully local — Coqui XTTS / Piper + LibreOffice
# + MoviePy/FFmpeg, no cloud APIs, no API keys, works completely offline)
# ---------------------------------------------------------------------------
# Additive extension — does NOT modify DirectorAgent / LogicAgent / ReviewAgent
# / PresentationVideoAgent above. It consumes their *output* (pptx bytes +
# per-slide speaker notes + the full narration script) to render a downloadable
# MP4. It is triggered separately from presentation_routes.py so text
# generation and video rendering can be retried independently and the
# existing /generate/presentation flow is completely unaffected.
#
# NOTE: an earlier revision of this pipeline integrated the Hedra API for an
# optional AI talking-avatar render. That entire code path (AvatarRenderConfig,
# AvatarVideoService, HedraAvatarError, and the avatar branch below) has been
# removed per updated requirements — the pipeline must have zero external API
# dependencies and run fully offline. What remains is exactly the local chain:
# LLM content (already produced) -> PPTX -> slide images -> local TTS
# narration -> MoviePy/FFmpeg composition -> presentation.mp4.

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
        composing_video     — slide images + narration -> MP4 (MoviePy/FFmpeg)
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
            from moviepy.editor import VideoFileClip  # type: ignore
            with VideoFileClip(str(narrated_path)) as vc:
                result.duration_seconds = vc.duration
        except Exception:
            logger.debug("[VideoGenerationPipeline] Could not probe video duration", exc_info=True)

        _emit_progress(progress_cb, "completed", 100, "Video generation complete")
        return result