"""
agents/documentation/agent.py
===============================
Documentation Agent — produces a complete set of engineering documentation
(developer/deployment/installation/api/operations/maintenance guides,
troubleshooting, and FAQs), each a full markdown document. Owns its own
prompt (prompts.py) and schema (schemas.py); the pipeline orchestrator
only ever calls `.generate(...)`.
"""
from __future__ import annotations

import logging
from typing import Any

from ..llm_service import LLMService
from .prompts import DOCUMENTATION_SYSTEM_PROMPT
from .schemas import DocumentationPlanOutput

logger = logging.getLogger(__name__)


# ---------------------------------
# Demo-mode fixture
# ---------------------------------
DOCUMENTATION_DEMO_PLAN = {
    "documents": ["README", "API reference", "Architecture decision record", "Database dictionary", "Runbook", "Security report", "Test report"],
    "format": "Markdown",
    "status": "generated",
}


class DocumentationAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(self, context: str) -> DocumentationPlanOutput:
        if not context.strip():
            raise ValueError("Documentation context cannot be empty")
        return self.llm.generate_json(DOCUMENTATION_SYSTEM_PROMPT, context, schema=DocumentationPlanOutput)

    @classmethod
    def generate(cls, db, project_id: int, context: str) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `DocumentationAgent.generate(db, project_id, context)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_documentation."""
        from ...models import DEMO_MODE
        from ...ai_service import AIGenerationError

        if DEMO_MODE:
            return DOCUMENTATION_DEMO_PLAN
        try:
            llm = LLMService(db=db, project_id=project_id, role="architect", timeout=170)
            result = llm.generate_json(DOCUMENTATION_SYSTEM_PROMPT, context, schema=DocumentationPlanOutput)
            return result.model_dump()
        except Exception as exc:
            logger.error("[DocumentationAgent] generate failed: %s", exc)
            raise AIGenerationError(f"Documentation generation failed: {exc}") from exc
