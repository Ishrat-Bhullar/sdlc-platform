"""
agents/storytelling_agent.py
==============================
Storytelling Agent — the first stage of the redesigned presentation
pipeline. Produces a StorySpine: the deck's high-level narrative shape
(hook, problem, tension, solution, proof points, resolution, call-to-action)
BEFORE any slide-level planning happens. Every later stage (Scene Planner,
Slide Designer, Avatar Script Agent) is asked to honor this spine, so the
avatar delivers one coherent story instead of narrating slides in isolation.

Genuinely new (no prior version existed in this codebase) — kept
deliberately small and fast: one focused LLM call with a short, cheap-to-
validate output schema, run once per presentation regardless of slide count.
"""
from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel, Field

from .llm_service import LLMService
from .presentation_models import cap

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent


def _load_prompt(file_name: str) -> str:
    prompt_path = BASE_DIR / "prompts" / file_name
    if not prompt_path.exists():
        raise FileNotFoundError(f"Required agent system instructions missing: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


STORYTELLING_SYSTEM_PROMPT = _load_prompt("storytelling_prompt.txt")


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
        self.llm = llm or LLMService(db=db, project_id=project_id, role="planning", provider_lock="azure_openai")

    def run(self, artifacts_context: str, presentation_tone: str, target_audience: str) -> StorySpine:
        if not artifacts_context.strip():
            raise ValueError("[StorytellingAgent] artifacts_context cannot be empty")

        result = self.llm.generate_json(
            system=STORYTELLING_SYSTEM_PROMPT,
            prompt=_storytelling_user_prompt(
                artifacts_context, presentation_tone, target_audience, cloud=self.llm.has_cloud_path()
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
