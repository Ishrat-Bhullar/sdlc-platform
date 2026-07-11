"""
agents/testing/agent.py
=========================
Testing Agent — produces a complete test plan across the full test pyramid
(unit/integration/api/ui/performance/security), edge cases, and test data.
Owns its own prompt (prompts.py) and schema (schemas.py); the pipeline
orchestrator only ever calls `.generate(...)`.
"""
from __future__ import annotations

from ...logging_config import get_logger
from typing import Any

from ..llm_service import LLMService
from .prompts import TESTING_SYSTEM_PROMPT
from .schemas import TestPlanOutput

logger = get_logger(__name__)


# ---------------------------------
# Demo-mode / fallback fixture
# ---------------------------------
TESTING_DEMO_PLAN = {
    "summary": "Automated test plan generated",
    "suites": ["Authentication and session persistence", "Project CRUD", "Agent pipeline", "Artifact rendering", "Authorization and CORS"],
    "status": "passed",
    "coverage_targets": {"backend": 85, "frontend": 80},
}


class TestingAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(self, context: str) -> TestPlanOutput:
        if not context.strip():
            raise ValueError("Testing context cannot be empty")
        return self.llm.generate_json(TESTING_SYSTEM_PROMPT, context, schema=TestPlanOutput)

    @classmethod
    def generate(cls, db, project_id: int, context: str) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `TestingAgent.generate(db, project_id, context)`.
        On failure, raises AIGenerationError instead of returning a fake
        passing test plan — the caller must never mark this run Completed
        with fabricated results."""
        from ...ai_service import AIGenerationError
        from ...models import DEMO_MODE

        if DEMO_MODE:
            return TESTING_DEMO_PLAN
        try:
            llm = LLMService(db=db, project_id=project_id, role="architect", timeout=170)
            result = llm.generate_json(TESTING_SYSTEM_PROMPT, context, schema=TestPlanOutput)
            return result.model_dump()
        except Exception as exc:
            logger.error("[TestingAgent] generate failed: %s", exc)
            raise AIGenerationError(f"Testing generation failed: {exc}") from exc
