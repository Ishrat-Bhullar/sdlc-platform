"""
agents/review/agent.py
========================
Review Agent — a new standalone capability (previously a bare function,
ai_service.run_review) that scores an artefact (architecture/database/ui/
code/security) and returns findings + recommendations. This is distinct
from the presentation pipeline's internal quality-review stage (see
agents/presentation/ — that ReviewAgent class stays presentation-specific
and is not renamed, to avoid confusing the two). Owns its own prompt
(prompts.py) and schema (schemas.py); its one real operation is
`.review(...)`, not `.generate(...)` — there is no content to generate,
only an existing artefact to assess.
"""
from __future__ import annotations

import logging
from typing import Any

from ..llm_service import LLMService
from .prompts import build_review_system_prompt
from .schemas import ReviewOutcome

logger = logging.getLogger(__name__)


class ReviewAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="review")

    def run(self, review_type: str, artifact_content: str) -> ReviewOutcome:
        if not artifact_content:
            raise ValueError("Artifact content cannot be empty")
        system = build_review_system_prompt(review_type)
        return self.llm.generate_json(system, artifact_content, schema=ReviewOutcome)

    @classmethod
    def review(cls, db, project_id: int, review_type: str, artifact_content: str) -> dict[str, Any]:
        """Orchestrator/route-facing entrypoint: `ReviewAgent.review(db, project_id, review_type, artifact_content)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.run_review."""
        from ...ai_service import AIGenerationError

        try:
            agent = cls(llm=LLMService(db=db, project_id=project_id, role="review", timeout=170))
            result = agent.run(review_type, artifact_content)
            return result.model_dump()
        except Exception as exc:
            logger.error("[ReviewAgent] review (%s) failed: %s", review_type, exc)
            raise AIGenerationError(f"{review_type.title()} review failed: {exc}") from exc
