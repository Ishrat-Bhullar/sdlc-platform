"""
agents/testing/agent.py
=========================
Testing Agent — produces a complete test plan across the full test pyramid
(unit/integration/api/ui/performance/security), edge cases, and test data.
Owns its own prompt (prompts.py) and schema (schemas.py); the pipeline
orchestrator only ever calls `.generate(...)`.
"""
from __future__ import annotations

import logging
from typing import Any

from ..llm_service import LLMService
from .prompts import TESTING_SYSTEM_PROMPT
from .schemas import TestPlanOutput

logger = logging.getLogger(__name__)


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
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_testing (including that a failure falls back to
        the static demo plan rather than raising, unlike most other agents)."""
        from ...models import DEMO_MODE

        if DEMO_MODE:
            return TESTING_DEMO_PLAN
        try:
            llm = LLMService(db=db, project_id=project_id, role="architect", timeout=170)
            result = llm.generate_json(TESTING_SYSTEM_PROMPT, context, schema=TestPlanOutput)
            return result.model_dump()
        except Exception as exc:
            logger.warning("[TestingAgent] generate failed: %s — falling back to static plan", exc)
            return TESTING_DEMO_PLAN
