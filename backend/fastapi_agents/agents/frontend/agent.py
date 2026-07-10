"""
agents/frontend/agent.py
==========================
Frontend Agent — produces a complete, implementation-ready frontend build
plan AND the actual runnable source files (components/pages/hooks/services)
for the project. Owns its own prompt (prompts.py) and schema (schemas.py);
the pipeline orchestrator only ever calls `.generate(...)`.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..llm_service import LLMService
from .prompts import FRONTEND_SYSTEM_PROMPT
from .schemas import FrontendPlanOutput

logger = logging.getLogger(__name__)


# ---------------------------------
# Demo-mode / fallback fixtures
# ---------------------------------
FRONTEND_DEMO_PLAN = {
    "framework": "React + TypeScript",
    "files": [],
    "implementation": "Typed project dashboard with authenticated API access, pipeline status, and artifact rendering.",
}


def _reuse_prior_or_demo_plan(db, project_id: int, artifact_type: str, demo_plan: dict) -> dict:
    """On a hard LLM failure (every provider in the chain exhausted — e.g. a
    Groq daily-quota outage with no local Ollama running), silently
    overwriting a project's own previously-successful generation with the
    generic empty demo plan is worse than just doing nothing: an explicit
    rerun during a provider outage would destroy real, working output. Reuse
    the last artifact that actually has files instead; only fall through to
    the generic plan when there's truly nothing to reuse (first-ever
    generation for this project also failed)."""
    from ...models import GeneratedArtifact

    try:
        # Walk back from most recent — a prior failed regeneration may itself
        # have persisted an empty fallback row, so the single latest row
        # isn't necessarily the one worth reusing.
        candidates = (
            db.query(GeneratedArtifact)
            .filter(GeneratedArtifact.project_id == project_id, GeneratedArtifact.artifact_type == artifact_type)
            .order_by(GeneratedArtifact.created_at.desc())
            .limit(20)
            .all()
        )
        for prior in candidates:
            parsed = json.loads(prior.content)
            if parsed.get("files"):
                logger.warning(
                    "[FrontendAgent] %s: all providers failed — reusing prior artifact #%s instead of an empty fallback",
                    artifact_type, prior.id,
                )
                return parsed
    except Exception:
        logger.debug("[FrontendAgent] could not inspect prior %s artifacts for reuse", artifact_type, exc_info=True)
    return demo_plan


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
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_frontend, including the DEMO_MODE fixture and the
        reuse-prior-artifact-on-total-failure fallback."""
        from ...models import DEMO_MODE, ArtifactType

        if DEMO_MODE:
            return FRONTEND_DEMO_PLAN
        try:
            llm = LLMService(db=db, project_id=project_id, role="architect", timeout=170)
            result = llm.generate_json(FRONTEND_SYSTEM_PROMPT, context, schema=FrontendPlanOutput)
            return result.model_dump()
        except Exception as exc:
            logger.warning("[FrontendAgent] generate failed: %s — falling back to static plan", exc)
            return _reuse_prior_or_demo_plan(db, project_id, ArtifactType.REACT_CODE.value, FRONTEND_DEMO_PLAN)
