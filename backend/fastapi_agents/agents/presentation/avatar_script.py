"""
agents/presentation/avatar_script.py
======================================
Avatar Script Agent — a 4th LLM stage, run only when video generation is
requested (generate_video=True). Consumes the Review Agent's
video_storyboard plus the Storytelling Agent's StorySpine and the selected
PersonaProfile to produce a coherent, persona-consistent delivery script:
per-scene subtitle text, speaking-duration estimate, pause, emotion, and
emphasis markers. Relocated verbatim from agents/avatar_script_agent.py as
part of the agents/<name>/ architectural refactor -- content unchanged.
"""
from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from ..llm_service import LLMService
from ...persona_engine import PersonaProfile
from .prompts import AVATAR_SCRIPT_SYSTEM_PROMPT
from .schemas import VideoFrame, cap
from .storytelling import StorySpine

logger = logging.getLogger(__name__)


class AvatarSceneScript(BaseModel):
    scene_number: int
    slide_number: int
    narration_text: str
    subtitle_text: str
    estimated_duration_seconds: float
    pause_after_seconds: float = 0.5
    emotion: str = "confident"  # must match video_pipeline_local.EMOTION_PRESETS keys
    emphasis_phrases: list[str] = Field(default_factory=list)


class AvatarScriptOutput(BaseModel):
    scenes: list[AvatarSceneScript]


def _avatar_script_user_prompt(
    storyboard: list[VideoFrame], story_spine: StorySpine, persona: PersonaProfile, *, cloud: bool = False
) -> str:
    storyboard_json = "[" + ",".join(f.model_dump_json() for f in storyboard) + "]"
    return (
        f"The presenter is a {persona.display_name} ({persona.category}), default tone "
        f"'{persona.tone}', default emotion '{persona.default_emotion}'. Keep this identity "
        "consistent across every scene.\n\n"
        f"STORY SPINE:\n{story_spine.model_dump_json()}\n\n"
        f"VIDEO STORYBOARD (per-slide narration already written — turn this into scene "
        f"delivery direction, do not invent new facts):\n{cap(storyboard_json, 8000, cloud=cloud)}"
    )


class AvatarScriptAgent:
    """Only invoked when generate_video=True. Produces the scene-by-scene
    delivery script consumed by subtitle_generator.py and the avatar
    rendering step (via avatar_provider.py)."""

    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None) -> None:
        self.llm = llm or LLMService(db=db, project_id=project_id, role="narration", provider_lock=("azure_openai", "groq"))

    def run(
        self,
        video_storyboard: list[VideoFrame],
        story_spine: StorySpine,
        persona: PersonaProfile,
    ) -> AvatarScriptOutput:
        if not video_storyboard:
            raise ValueError("[AvatarScriptAgent] video_storyboard cannot be empty")

        result = self.llm.generate_json(
            system=AVATAR_SCRIPT_SYSTEM_PROMPT,
            prompt=_avatar_script_user_prompt(
                video_storyboard, story_spine, persona, cloud=self.llm.has_generous_context_path()
            ),
            schema=AvatarScriptOutput,
        )

        if not result or not result.scenes:
            raise ValueError(
                "[AvatarScriptAgent] AI returned no scenes. "
                "Check that the video storyboard is non-empty."
            )

        logger.info("[AvatarScriptAgent] Delivery script created: %d scenes", len(result.scenes))
        return result
