"""
agents/presentation/slide_designer.py
=======================================
Slide Designer — was LogicAgent. Takes the Scene Planner's plan and writes
complete slide content, speaker notes, and the full narration script,
grounded in real SDLC artifacts and the active avatar/scene/language
configuration. Relocated verbatim from agents/slide_designer.py as part of
the agents/<name>/ architectural refactor -- content unchanged.
"""
from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from ..llm_service import LLMService
from .prompts import SLIDE_DESIGNER_SYSTEM_PROMPT
from .schemas import PresentationConfig, PresentationSummary, Slide, cap, render_template
from .scene_planner import ScenePlan

logger = logging.getLogger(__name__)


class LogicAgentOutput(BaseModel):
    slides: list[Slide]
    full_script: str
    presentation_summary: PresentationSummary
    artifacts_used: list[str] = Field(default_factory=list)


def _slide_designer_user_prompt(
    scene_plan_json: str, artifacts_context: str, config: PresentationConfig, *, cloud: bool = False
) -> str:
    return (
        "Generate complete slide content, speaker notes, and the full narration script.\n"
        f"The presentation will be delivered by a {config.avatar_value} in a {config.scene_value} setting, "
        f"in {config.language}.\n"
        "Every fact must come from the SDLC artifacts. "
        "Write [Data not available] if a planned slide cannot be backed by artifact data.\n"
        "Return valid JSON only.\n\n"
        f"SCENE PLAN:\n{cap(scene_plan_json, 8000, cloud=cloud)}\n\n"
        f"ARTIFACTS:\n{cap(artifacts_context, 8000, cloud=cloud)}"
    )


class SlideDesignerAgent:
    """Was LogicAgent — same job (slide copy, speaker notes, narration
    script), now consuming a ScenePlan instead of the old DirectorAgentOutput."""

    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None) -> None:
        self.llm = llm or LLMService(db=db, project_id=project_id, role="narration", provider_lock=("azure_openai", "groq"))

    def run(
        self,
        scene_plan: ScenePlan,
        artifacts_context: str,
        config: PresentationConfig | None = None,
    ) -> LogicAgentOutput:
        config = config or PresentationConfig()
        system_prompt = render_template(SLIDE_DESIGNER_SYSTEM_PROMPT, config)

        result = self.llm.generate_json(
            system=system_prompt,
            prompt=_slide_designer_user_prompt(
                scene_plan.model_dump_json(),
                artifacts_context,
                config,
                cloud=self.llm.has_generous_context_path(),
            ),
            schema=LogicAgentOutput,
        )

        if not result or not result.slides:
            raise ValueError(
                "[SlideDesignerAgent] AI returned no slides. "
                "Check that the scene plan and artifact context are non-empty."
            )

        logger.info(
            "[SlideDesignerAgent] Content generated: %d slides, script_length=%d chars",
            len(result.slides), len(result.full_script),
        )
        return result
