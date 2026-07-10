"""
agents/business_analyst/agent.py
=================================
Business Analyst Agent — turns approved requirements into epics/user
stories, a full BRD/SRS, personas, process flows, and risk/success-metric
analysis. Owns its own prompt (prompts.py) and schema (schemas.py); the
pipeline orchestrator only ever calls `.generate(...)`.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import BaseModel

from ..llm_service import LLMService
from ..requirements.schemas import RequirementAgentOutput
from .prompts import BUSINESS_ANALYST_SYSTEM_PROMPT
from .schemas import BusinessAnalystOutput

logger = logging.getLogger(__name__)


# ---------------------------------
# Demo-mode fixture (returned only when the deployment-wide DEMO_MODE flag
# is on — see ai_service.py's module docstring for the contract).
# ---------------------------------
MOCK_USER_STORIES: dict[str, Any] = {
    "epics": [
        {
            "title": "User Authentication",
            "description": "Login, session management and logout flows",
            "stories": [
                {
                    "id": "US-001", "epic": "User Authentication",
                    "title": "Login with email and password",
                    "role": "customer", "goal": "log in with my email and password",
                    "benefit": "I can access my account securely",
                    "acceptance_criteria": [
                        {"given": "I am on the login page", "when": "I submit valid credentials", "then": "I am redirected to the dashboard"},
                        {"given": "I submit invalid credentials", "when": "the form is submitted", "then": "I see an error message and remain on the login page"},
                    ],
                    "moscow": "Must", "points": 5,
                },
                {
                    "id": "US-002", "epic": "User Authentication",
                    "title": "Session expires after inactivity",
                    "role": "customer", "goal": "have my session auto-expire",
                    "benefit": "my account is protected if I forget to log out",
                    "acceptance_criteria": [
                        {"given": "I have been inactive for 30 minutes", "when": "I try to access any protected page", "then": "I am redirected to the login page"},
                    ],
                    "moscow": "Must", "points": 3,
                },
            ],
        },
        {
            "title": "Account Management",
            "description": "Dashboard, balances and account detail",
            "stories": [
                {
                    "id": "US-003", "epic": "Account Management",
                    "title": "View all account balances on dashboard",
                    "role": "customer", "goal": "see all my accounts and balances at a glance",
                    "benefit": "I can quickly understand my financial position",
                    "acceptance_criteria": [
                        {"given": "I am logged in", "when": "I visit the dashboard", "then": "I see a card for every account with account number and balance"},
                        {"given": "I have two accounts", "when": "the dashboard loads", "then": "both accounts are shown and the total balance is summed correctly"},
                    ],
                    "moscow": "Must", "points": 5,
                },
            ],
        },
        {
            "title": "Transaction Management",
            "description": "Transaction history, filtering and export",
            "stories": [
                {
                    "id": "US-004", "epic": "Transaction Management",
                    "title": "View paginated transaction history",
                    "role": "customer", "goal": "see a list of my past transactions",
                    "benefit": "I can monitor my spending",
                    "acceptance_criteria": [
                        {"given": "I am on the transaction history page", "when": "the page loads", "then": "I see the 20 most recent transactions"},
                        {"given": "I filter by date range", "when": "I apply the filter", "then": "only transactions within that range are shown"},
                        {"given": "there are more than 20 transactions", "when": "I click Next Page", "then": "the next 20 transactions are shown"},
                    ],
                    "moscow": "Must", "points": 8,
                },
            ],
        },
    ],
}


def build_ba_prompt(approved_requirements: RequirementAgentOutput | dict | str) -> str:
    payload = (
        approved_requirements.model_dump()
        if isinstance(approved_requirements, BaseModel)
        else approved_requirements
    )

    return f"""
Approved Requirements:
{json.dumps(payload, indent=2)}

Generate the structured BA artifacts output now.
"""


class BusinessAnalystAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="ba")

    def run(
        self,
        approved_requirements: RequirementAgentOutput | dict | str
    ) -> BusinessAnalystOutput:

        if not approved_requirements:
            raise ValueError("Approved requirements cannot be empty")

        result = self.llm.generate_json(
            system=BUSINESS_ANALYST_SYSTEM_PROMPT,
            prompt=build_ba_prompt(approved_requirements),
            schema=BusinessAnalystOutput,
        )

        if not result or not result.epics:
            raise ValueError("No user stories generated")

        return result

    @classmethod
    def generate(cls, db, project_id: int, context: str) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `BusinessAnalystAgent.generate(db, project_id, context)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_user_stories."""
        from ...models import DEMO_MODE
        from ...ai_service import AIGenerationError

        if DEMO_MODE:
            return MOCK_USER_STORIES
        try:
            agent = cls(llm=LLMService(db=db, project_id=project_id, role="ba", timeout=170))
            result = agent.run(context)
            return result.model_dump() if hasattr(result, "model_dump") else result
        except Exception as exc:
            logger.error("[BusinessAnalystAgent] generate failed: %s", exc)
            raise AIGenerationError(f"User story generation failed: {exc}") from exc
