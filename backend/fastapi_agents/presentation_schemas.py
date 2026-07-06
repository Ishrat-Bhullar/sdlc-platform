"""
schemas/presentation_schemas.py
=================================
Pydantic request/response schemas for the Presentation & Video Generation agent endpoints.

NOTE: This file previously contained two conflicting definitions of
`PresentationGenerateRequest` (the second silently overwrote the first at
import time, dropping fields like `target_audience` / `artifact_types` that
presentation_routes.py depends on), and was missing schemas for the
save / AI-toolbar / diagram endpoints needed by the frontend. Everything has
been merged into one consistent set of models below — no functionality was
removed, only de-duplicated and extended.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared sub-configs (avatar / scene / voice)
# ---------------------------------------------------------------------------

class AvatarConfig(BaseModel):
    mode: str = "preset"  # "preset" | "custom"
    value: str = "Professional Male"


class SceneConfig(BaseModel):
    mode: str = "preset"  # "preset" | "custom"
    value: str = "Office"


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class PresentationGenerateRequest(BaseModel):
    project_id: int
    presentation_tone: str = Field(
        default="executive",
        description="Tone of the presentation: executive, technical, or stakeholder"
    )
    target_audience: str = Field(
        default="C-suite executives and engineering leadership",
        description="Description of the target audience"
    )
    generate_video: bool = Field(
        default=False,
        description="Attempt video generation if a local video model is available"
    )
    artifact_types: list[str] | None = Field(
        default=None,
        description="Optional subset of artifact types to include. If None, all are used."
    )
    avatar_config: AvatarConfig = Field(default_factory=AvatarConfig)
    scene_config: SceneConfig = Field(default_factory=SceneConfig)
    language: str = Field(default="en-US")
    theme_id: str | None = Field(
        default=None,
        description="Theme preset id (ey, ey_dark, mckinsey, minimal, government, startup, healthcare). "
                    "Defaults by persona category when not set."
    )


class PresentationDownloadRequest(BaseModel):
    artifact_id: int


class PresentationSaveRequest(BaseModel):
    """Body for POST /projects/{project_id}/presentation/save — persists editor state."""
    slides: list[dict[str, Any]] = Field(default_factory=list)
    theme: str = "EY Theme"
    mode: str = "Presentation + Video"
    avatar: AvatarConfig = Field(default_factory=AvatarConfig)
    scene: SceneConfig = Field(default_factory=SceneConfig)


class AiActionRequest(BaseModel):
    """Body for POST /media-studio/ai-action — toolbar actions (Beautify, Diagram, etc.)."""
    project_id: int
    slide_id: int | None = None
    action_type: str
    context: dict[str, Any] = Field(default_factory=dict)


class DiagramGenerateRequest(BaseModel):
    """Body for POST /media-studio/diagram/generate."""
    type: str
    prompt: str
    project_id: int | None = None


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class SlideOutlineItem(BaseModel):
    slide_number: int
    title: str
    subtitle: str = ""
    key_points: list[str] = []
    slide_type: str = "content"


class SpeakerNoteItem(BaseModel):
    slide_number: int
    title: str
    notes: str


class StoryboardFrame(BaseModel):
    frame_number: int
    timestamp_seconds: int
    slide_number: int
    narration: str
    visual_description: str
    animation: str
    duration_seconds: int


class QualityReview(BaseModel):
    overall_score: float
    narrative_consistency: float
    content_completeness: float
    visual_clarity: float
    executive_impact: float
    issues_found: list[str]
    improvements_made: list[str]


class PresentationGenerateResponse(BaseModel):
    project_id: int
    artifact_id: int
    executive_summary: str
    narrative_arc: str
    slide_outline: list[SlideOutlineItem]
    speaker_notes: list[SpeakerNoteItem]
    storyboard: list[StoryboardFrame]
    presentation_script: str
    quality_score: float
    total_slides: int
    estimated_duration: str
    video_available: bool
    video_url: str | None
    generated_at: str
    pptx_download_url: str


class PresentationStatusResponse(BaseModel):
    project_id: int
    artifact_id: int | None
    status: str  # not_started | completed | failed
    generated_at: str | None
    quality_score: float | None
    total_slides: int | None
    video_available: bool


class PresentationSaveResponse(BaseModel):
    project_id: int
    saved_at: str
    status: str = "saved"


class AiActionResponse(BaseModel):
    status: str
    updated_slide: dict[str, Any] | None = None
    message: str | None = None


class DiagramGenerateResponse(BaseModel):
    diagram_type: str
    source_format: str = "mermaid"
    source: str | None = None
    svg_url: str | None = None
    png_url: str | None = None
    status: str = "generated"


# ---------------------------------------------------------------------------
# Video Generation Pipeline schemas (narrated MP4 + optional Hedra AI avatar)
# ---------------------------------------------------------------------------

class VoiceConfigSchema(BaseModel):
    """TTS configuration. provider='azure' uses Azure Speech (primary);
    provider='coqui' forces local Coqui XTTS. Azure is always attempted
    first regardless of provider unless explicitly set to 'coqui', and
    automatically falls back to Coqui on failure either way."""
    provider: str = "azure"               # "azure" | "coqui"
    voice_name: str = "en-US-AriaNeural"
    speed: float = 1.0
    pitch: float = 0.0


class AvatarRenderConfigSchema(BaseModel):
    """AI avatar options selected via AvatarSelector.tsx. `mode`/`value`
    mirror the existing AvatarConfig shape already used by
    StudioConfiguration / PresentationGenerateRequest.avatar_config."""
    mode: str = "preset"                  # "preset" | "custom"
    value: str = "Professional Male"
    image_url: str | None = None          # optional reference portrait for Hedra


class VideoGenerateRequest(BaseModel):
    project_id: int
    # Reuse an existing PRESENTATION artifact's content instead of
    # regenerating slide text; if omitted, the latest one for the project is used.
    presentation_artifact_id: int | None = None

    video_enabled: bool = True
    avatar_enabled: bool = False
    avatar_config: AvatarRenderConfigSchema = Field(default_factory=AvatarRenderConfigSchema)
    voice_config: VoiceConfigSchema = Field(default_factory=VoiceConfigSchema)
    language: str = "en-US"
    scene: SceneConfig = Field(default_factory=SceneConfig)
    background: str = ""


class VideoGenerateResponse(BaseModel):
    project_id: int
    presentation_artifact_id: int
    narrated_video_artifact_id: int | None = None
    avatar_video_artifact_id: int | None = None
    video_available: bool
    avatar_available: bool
    avatar_error: str | None = None
    narrated_video_download_url: str | None = None
    avatar_video_download_url: str | None = None
    duration_seconds: float | None = None
    status: str = "completed"
    generated_at: str


class VideoStatusResponse(BaseModel):
    project_id: int
    status: str  # not_started | running | completed | failed
    stage: str | None = None
    percent: int | None = None
    message: str | None = None
    narrated_video_artifact_id: int | None = None
    avatar_video_artifact_id: int | None = None
    narrated_video_download_url: str | None = None
    avatar_video_download_url: str | None = None
    video_available: bool = False
    avatar_available: bool = False
    avatar_error: str | None = None