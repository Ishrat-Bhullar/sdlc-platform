"""
agents/requirements/agent.py
=============================
Requirements Agent — turns a raw project/requirement description into a
structured, implementation-ready requirements document (functional /
non-functional / constraints, MoSCoW priority, risk level, acceptance
criteria, traceability). Owns its own prompt (prompts.py) and schema
(schemas.py); the pipeline orchestrator only ever calls `.generate(...)`.
"""
from __future__ import annotations

from ...logging_config import get_logger
from typing import Any

from ..llm_service import LLMService
from .prompts import REQUIREMENTS_SYSTEM_PROMPT
from .schemas import RequirementAgentOutput

logger = get_logger(__name__)


# ---------------------------------
# Demo-mode fixture (returned only when the deployment-wide DEMO_MODE flag
# is on — see ai_service.py's module docstring for the contract).
# ---------------------------------
MOCK_REQUIREMENTS: dict[str, Any] = {
    "requirements": [
        {"id": "FR-001", "description": "Customers must authenticate with email and password", "category": "Functional", "priority": "critical", "risk_level": "low"},
        {"id": "FR-002", "description": "Authenticated customers see all linked account balances on a dashboard", "category": "Functional", "priority": "critical", "risk_level": "low"},
        {"id": "FR-003", "description": "Customers can view paginated transaction history filterable by date range and type", "category": "Functional", "priority": "high", "risk_level": "low"},
        {"id": "FR-004", "description": "Session must expire after 30 minutes of inactivity", "category": "Functional", "priority": "high", "risk_level": "medium"},
        {"id": "NFR-001", "description": "Page load under 3 seconds on 4G", "category": "Non-Functional", "priority": "high", "risk_level": "low"},
        {"id": "NFR-002", "description": "99.9% uptime SLA", "category": "Non-Functional", "priority": "high", "risk_level": "medium"},
        {"id": "NFR-003", "description": "All data encrypted at rest and in transit (TLS 1.3)", "category": "Non-Functional", "priority": "critical", "risk_level": "high"},
        {"id": "CON-001", "description": "Single-currency USD accounts in this iteration", "category": "Constraint", "priority": "medium", "risk_level": "low"},
    ],
    "assumptions": [
        "Single-currency (USD) accounts only for the demo",
        "No multi-factor authentication in this iteration",
        "Accounts are pre-provisioned; no in-app account creation",
    ],
    "risks": [
        "No rate-limiting on login endpoint — flagged for Security Agent",
        "Session token stored in HttpOnly cookie: CSRF token needed for non-GET mutations",
        "Password complexity not enforced on registration endpoint",
    ],
}


def build_requirement_prompt(requirement_text: str) -> str:
    return f"""
User Requirement:
{requirement_text}

Generate the structured requirement output now.
"""


class RequirementAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="requirements")

    def run(self, requirement_text: str) -> RequirementAgentOutput:
        if not requirement_text.strip():
            raise ValueError("Requirement text cannot be empty")

        result = self.llm.generate_json(
            system=REQUIREMENTS_SYSTEM_PROMPT,
            prompt=build_requirement_prompt(requirement_text),
            schema=RequirementAgentOutput,
        )

        if not result or not result.requirements:
            raise ValueError("No requirements generated")

        return result

    @classmethod
    def generate(
        cls, db, project_id: int, context: str = "", document_ids: list[int] | None = None
    ) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `RequirementAgent.generate(db, project_id, context)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_requirements."""
        from ...models import DEMO_MODE
        from ...ai_service import AIGenerationError

        if DEMO_MODE:
            return MOCK_REQUIREMENTS
        try:
            agent = cls(llm=LLMService(db=db, project_id=project_id, role="requirements", timeout=170))
            result = agent.run(context)
            data = result.model_dump() if hasattr(result, "model_dump") else result
            data.setdefault("assumptions", data.get("dependencies", []))
            return data
        except Exception as exc:
            logger.error("[RequirementAgent] generate failed: %s", exc)
            raise AIGenerationError(f"Requirements generation failed: {exc}") from exc
