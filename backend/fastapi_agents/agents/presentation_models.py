"""
agents/presentation_models.py
================================
Shared Pydantic models for the presentation pipeline, extracted so
storytelling_agent.py / scene_planner.py / slide_designer.py /
avatar_script_agent.py / presentation_video_agent.py can all depend on them
without any of those files needing to import each other in a cycle (each
pipeline-stage file imports only forward, from the stage before it, plus
these shared models — presentation_video_agent.py is the only file that
imports every stage, as the orchestrator).

Model shapes are unchanged from the original single-file
presentation_video_agent.py — this is a pure extraction, not a redesign of
the data itself.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class PresentationConfig(BaseModel):
    """Presenter persona, scene, and language — sourced from AvatarSelector /
    SceneSelector / StudioConfiguration on the frontend."""
    avatar_mode: str = "preset"
    avatar_value: str = "Professional Male"
    scene_mode: str = "preset"
    scene_value: str = "Office"
    language: str = "en-US"


def render_template(template: str, config: "PresentationConfig") -> str:
    """Substitute {{avatar_value}}, {{scene_value}}, {{language}} placeholders
    used in agents/prompts/logic_prompt.txt with the active config."""
    return (
        template
        .replace("{{avatar_value}}", config.avatar_value)
        .replace("{{scene_value}}", config.scene_value)
        .replace("{{language}}", config.language)
    )


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
    # Optional, LLM-authored image-generation prompt for this specific slide —
    # additive field, empty by default. When populated, the presentation
    # pipeline prefers it over the deterministic image_prompt_generator.py
    # template for that slide; when empty (the common case for models/
    # prompts that don't populate it), behavior is unchanged from before
    # this field existed.
    image_prompt: str = ""


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


def cap(text: str, limit: int, *, cloud: bool) -> str:
    """Ollama-context-window guard, shared by every pipeline stage's user-
    prompt builder. A cloud model's context window comfortably fits full
    SDLC artifact/plan/script content — only the Ollama fallback path needs
    input capped to stay inside its local model's budget."""
    return text if cloud else text[:limit]
