"""
agents/presentation/scene_planner.py
======================================
Scene Planner — was DirectorAgent. Analyzes SDLC artifacts (grounded in
the Storytelling Agent's StorySpine) and produces the concrete scene/slide
breakdown: section order, per-slide visual layout, diagram/chart/icon
choices, and timing. Relocated verbatim from agents/scene_planner.py as
part of the agents/<name>/ architectural refactor -- content unchanged.
"""
from __future__ import annotations

from ...logging_config import get_logger

from pydantic import BaseModel, Field

from ..llm_service import LLMService
from .prompts import SCENE_PLANNER_SYSTEM_PROMPT
from .schemas import cap
from .storytelling import StorySpine

logger = get_logger(__name__)


class ScenePlan(BaseModel):
    executive_summary: str
    narrative_arc: str
    presentation_tone: str
    target_audience: str
    slide_outline: list[dict]        # raw dicts preserved for Slide Designer's prompt
    storyboard: list[dict] = Field(default_factory=list)
    total_duration_minutes: int = 15
    recommended_sections: list[str] = Field(default_factory=list)


def _scene_planner_user_prompt(
    artifacts_context: str, tone: str, audience: str, story_spine: StorySpine | None, *, cloud: bool = False
) -> str:
    spine_context = ""
    if story_spine:
        spine_context = (
            "\n\nSTORY SPINE (the narrative this plan must follow — every slide should "
            f"serve this arc, not deviate from it):\n{story_spine.model_dump_json()}"
        )
    return (
        "Analyze the provided SDLC artifacts and create a comprehensive presentation plan.\n"
        f"Tone: {tone}. Target audience: {audience}.\n"
        "All content must be derived exclusively from the artifacts below. "
        "Return valid JSON only."
        f"{spine_context}\n\n"
        f"ARTIFACTS:\n{cap(artifacts_context, 8000, cloud=cloud)}"
    )


class ScenePlannerAgent:
    """Was DirectorAgent — same job (narrative plan + slide outline +
    storyboard), now story-spine-aware."""

    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None) -> None:
        self.llm = llm or LLMService(db=db, project_id=project_id, role="planning", provider_lock=("azure_openai", "groq"))

    def run(
        self,
        artifacts_context: str,
        presentation_tone: str,
        target_audience: str,
        story_spine: StorySpine | None = None,
    ) -> ScenePlan:
        if not artifacts_context.strip():
            raise ValueError("[ScenePlannerAgent] artifacts_context cannot be empty")

        result = self.llm.generate_json(
            system=SCENE_PLANNER_SYSTEM_PROMPT,
            prompt=_scene_planner_user_prompt(
                artifacts_context, presentation_tone, target_audience, story_spine, cloud=self.llm.has_generous_context_path()
            ),
            schema=ScenePlan,
        )

        if not result or not result.slide_outline:
            raise ValueError(
                "[ScenePlannerAgent] AI returned an empty plan. "
                "Ensure artifacts contain sufficient content and the AI provider is reachable."
            )

        logger.info("[ScenePlannerAgent] Plan created: %d slides", len(result.slide_outline))
        return result
