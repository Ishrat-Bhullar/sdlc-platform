"""
agents/compliance/agent.py
============================
Compliance Agent — assesses compliance/governance/audit/risk requirements
(GDPR/HIPAA/SOC2/ISO 27001/etc.) for a project. Owns its own prompt
(prompts.py) and schema (schemas.py); the pipeline orchestrator only ever
calls `.generate(...)`.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..llm_service import LLMService
from .prompts import COMPLIANCE_SYSTEM_PROMPT
from .schemas import ComplianceArchitectureOutput

logger = logging.getLogger(__name__)


# ---------------------------------
# Demo-mode fixture (returned only when the deployment-wide DEMO_MODE flag
# is on — see ai_service.py's module docstring for the contract).
# ---------------------------------
MOCK_COMPLIANCE: dict[str, Any] = {
    "complianceAssessment": {"standards": ["SOC 2", "ISO 27001", "GDPR"], "gaps": ["Retention schedule approval"], "recommendations": ["Quarterly access review"]},
    "governanceControls": ["Human approval gates", "Immutable audit events"],
    "auditRequirements": ["Record artifact generation and approval decisions"],
    "dataRetentionPolicies": ["Retain audit events for seven years"],
    "riskAssessment": ["Review provider data-processing terms before production use"],
}


def build_compliance_prompt(
    project_description: str,
    requirements: dict | None = None,
    architecture: dict | None = None,
    database: dict | None = None,
    uiux: dict | None = None,
    security: dict | None = None
) -> str:
    context = f"Project Description: {project_description}\n\n"

    if requirements:
        context += f"Requirements:\n{json.dumps(requirements, indent=2)}\n\n"

    if architecture:
        context += f"Architecture:\n{json.dumps(architecture, indent=2)}\n\n"

    if database:
        context += f"Database Design:\n{json.dumps(database, indent=2)}\n\n"

    if uiux:
        context += f"UI/UX Design:\n{json.dumps(uiux, indent=2)}\n\n"

    if security:
        context += f"Security Architecture:\n{json.dumps(security, indent=2)}\n\n"

    return f"""
{context}

Assess compliance, governance, audit, and risk requirements for this project.
Generate the structured compliance architecture output now.
"""


class ComplianceArchitectAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(
        self,
        project_description: str,
        requirements: dict | None = None,
        architecture: dict | None = None,
        database: dict | None = None,
        uiux: dict | None = None,
        security: dict | None = None
    ) -> ComplianceArchitectureOutput:

        if not project_description:
            raise ValueError("Project description cannot be empty")

        result = self.llm.generate_json(
            system=COMPLIANCE_SYSTEM_PROMPT,
            prompt=build_compliance_prompt(
                project_description, requirements, architecture, database, uiux, security
            ),
            schema=ComplianceArchitectureOutput,
        )

        if not result or not result.complianceAssessment:
            raise ValueError("No compliance assessment generated")

        return result

    @classmethod
    def generate(
        cls, db, project_id: int, context: str,
        requirements: Any | None = None, architecture: Any | None = None,
    ) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `ComplianceArchitectAgent.generate(db, project_id, context)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_compliance."""
        from ...models import DEMO_MODE
        from ...ai_service import AIGenerationError

        if DEMO_MODE:
            return MOCK_COMPLIANCE
        try:
            agent = cls(llm=LLMService(db=db, project_id=project_id, role="architect", timeout=170))
            result = agent.run(
                project_description=context,
                requirements=requirements,
                architecture=architecture,
                database=None,
                uiux=None,
                security=None,
            )
            return result.model_dump() if hasattr(result, "model_dump") else result
        except Exception as exc:
            logger.error("[ComplianceArchitectAgent] generate failed: %s", exc)
            raise AIGenerationError(f"Compliance generation failed: {exc}") from exc
