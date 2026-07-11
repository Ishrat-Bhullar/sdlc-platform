"""
agents/presentation/storytelling.py
=====================================
Storytelling Agent — the first stage of the presentation pipeline.
Produces a StorySpine: the deck's high-level narrative shape (hook,
problem, tension, solution, proof points, resolution, call-to-action)
BEFORE any slide-level planning happens. Every later stage (Scene Planner,
Slide Designer, Avatar Script Agent) is asked to honor this spine, so the
avatar delivers one coherent story instead of narrating slides in
isolation. Relocated verbatim from agents/storytelling_agent.py as part of
the agents/<name>/ architectural refactor -- content unchanged.
"""
from __future__ import annotations

from ...logging_config import get_logger

from pydantic import BaseModel, Field

from ..llm_service import LLMService
from .prompts import STORYTELLING_SYSTEM_PROMPT
from .schemas import cap

logger = get_logger(__name__)


class StorySpine(BaseModel):
    hook: str
    problem_statement: str
    tension: str
    solution: str
    proof_points: list[str] = Field(default_factory=list)
    resolution: str
    call_to_action: str
    tone: str = "executive"
    target_audience: str = "C-suite executives and engineering leadership"


def _storytelling_user_prompt(artifacts_context: str, tone: str, audience: str, *, cloud: bool = False) -> str:
    return (
        "Read the SDLC artifacts below and extract the single coherent STORY this "
        "presentation should tell — not a slide list, just the narrative spine.\n"
        f"Tone: {tone}. Target audience: {audience}.\n"
        "Every element must be grounded in the artifacts. Return valid JSON only.\n\n"
        f"ARTIFACTS:\n{cap(artifacts_context, 8000, cloud=cloud)}"
    )


class StorytellingAgent:
    """Produces the deck's StorySpine — run once, before Scene Planner."""

    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None) -> None:
        self.llm = llm or LLMService(db=db, project_id=project_id, role="planning", provider_lock=("azure_openai", "groq"))

    def run(self, artifacts_context: str, presentation_tone: str, target_audience: str) -> StorySpine:
        if not artifacts_context.strip():
            raise ValueError("[StorytellingAgent] artifacts_context cannot be empty")

        result = self.llm.generate_json(
            system=STORYTELLING_SYSTEM_PROMPT,
            prompt=_storytelling_user_prompt(
                artifacts_context, presentation_tone, target_audience, cloud=self.llm.has_generous_context_path()
            ),
            schema=StorySpine,
        )
        if not result or not result.hook:
            raise ValueError(
                "[StorytellingAgent] AI returned an incomplete story spine. "
                "Ensure artifacts contain sufficient content and the AI provider is reachable."
            )
        logger.info("[StorytellingAgent] Story spine created: hook=%r", result.hook[:60])
        return result
