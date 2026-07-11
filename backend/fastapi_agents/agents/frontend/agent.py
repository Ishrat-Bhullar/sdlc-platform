"""
agents/frontend/agent.py
==========================
Frontend Agent — produces a complete, implementation-ready frontend build
plan AND the actual runnable source files (components/pages/hooks/services)
for the project. Owns its own prompt (prompts.py) and schema (schemas.py);
the pipeline orchestrator only ever calls `.generate(...)`.
"""
from __future__ import annotations

from ...logging_config import get_logger
from typing import Any

from ..llm_service import LLMService
from .prompts import FRONTEND_SYSTEM_PROMPT
from .schemas import FrontendPlanOutput

logger = get_logger(__name__)


# ---------------------------------
# Demo-mode fixture — only used when DEMO_MODE is explicitly enabled, never
# as a failure fallback (see generate() below).
# ---------------------------------
FRONTEND_DEMO_PLAN = {
    "framework": "React + TypeScript",
    "files": [],
    "implementation": "Typed project dashboard with authenticated API access, pipeline status, and artifact rendering.",
}


class FrontendAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(self, context: str) -> FrontendPlanOutput:
        if not context.strip():
            raise ValueError("Frontend context cannot be empty")
        return self.llm.generate_json(FRONTEND_SYSTEM_PROMPT, context, schema=FrontendPlanOutput)

    @classmethod
    def generate(cls, db, project_id: int, context: str) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `FrontendAgent.generate(db, project_id, context)`.
        On any failure (every provider exhausted, or the LLM response fails
        schema validation), raises AIGenerationError instead of returning a
        placeholder — a stage that didn't produce real files must be recorded
        as Failed, never as Completed with empty output."""
        from ...models import DEMO_MODE
        from ...ai_service import AIGenerationError

        if DEMO_MODE:
            return FRONTEND_DEMO_PLAN
        try:
            llm = LLMService(db=db, project_id=project_id, role="architect", timeout=170)
            result = llm.generate_json(FRONTEND_SYSTEM_PROMPT, context, schema=FrontendPlanOutput)
            return result.model_dump()
        except Exception as exc:
            logger.error("[FrontendAgent] generate failed: %s", exc)
            raise AIGenerationError(f"Frontend generation failed: {exc}") from exc
