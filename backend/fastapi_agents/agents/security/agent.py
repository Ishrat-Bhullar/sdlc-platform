"""
agents/security/agent.py
=========================
Security Agent — designs the security architecture (layers/controls,
threat model, authentication, authorization, security controls, and a
review checklist) for a project. Owns its own prompt (prompts.py) and
schema (schemas.py); the pipeline orchestrator only ever calls
`.generate(...)`.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..llm_service import LLMService
from .prompts import SECURITY_SYSTEM_PROMPT
from .schemas import SecurityArchitectureOutput

logger = logging.getLogger(__name__)


# ---------------------------------
# Demo-mode fixture (returned only when the deployment-wide DEMO_MODE flag
# is on — see ai_service.py's module docstring for the contract).
# ---------------------------------
MOCK_SECURITY: dict[str, Any] = {
    "securityArchitecture": {"layers": ["Edge", "Application", "Data"], "controls": ["TLS", "HttpOnly sessions", "RBAC", "Encryption at rest"], "patterns": ["Least privilege", "Defense in depth"]},
    "threatModel": ["Credential stuffing", "Broken access control", "Injection", "Sensitive data exposure"],
    "authentication": {"strategy": "Short-lived JWT session cookies", "providers": ["Local"], "mfa": True, "sessionManagement": "Rotating refresh token"},
    "authorization": {"model": "RBAC", "roles": ["admin", "developer", "approver", "viewer"], "permissions": ["read", "generate", "approve", "administer"], "policies": ["Project-scoped access"]},
    "securityControls": ["Input validation", "Rate limiting", "Audit trail", "Secret encryption"],
    "securityChecklist": ["OWASP review", "Dependency scan", "SAST", "DAST"],
}


def build_security_prompt(
    project_description: str,
    architecture: dict | None = None
) -> str:
    context = f"Project Description: {project_description}\n\n"

    if architecture:
        context += f"Architecture Context:\n{json.dumps(architecture, indent=2)}\n\n"

    return f"""
{context}

Design comprehensive security architecture for this project following industry best practices.
Generate the structured security architecture output now.
"""


class SecurityArchitectAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(
        self,
        project_description: str,
        architecture: dict | None = None
    ) -> SecurityArchitectureOutput:

        if not project_description:
            raise ValueError("Project description cannot be empty")

        result = self.llm.generate_json(
            system=SECURITY_SYSTEM_PROMPT,
            prompt=build_security_prompt(project_description, architecture),
            schema=SecurityArchitectureOutput,
        )

        if not result or not result.securityArchitecture:
            raise ValueError("No security architecture generated")

        return result

    @classmethod
    def generate(cls, db, project_id: int, context: str, architecture: Any | None = None) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `SecurityArchitectAgent.generate(db, project_id, context)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_security."""
        from ...models import DEMO_MODE
        from ...ai_service import AIGenerationError

        if DEMO_MODE:
            return MOCK_SECURITY
        try:
            agent = cls(llm=LLMService(db=db, project_id=project_id, role="architect", timeout=170))
            result = agent.run(project_description=context, architecture=architecture)
            return result.model_dump() if hasattr(result, "model_dump") else result
        except Exception as exc:
            logger.error("[SecurityArchitectAgent] generate failed: %s", exc)
            raise AIGenerationError(f"Security architecture generation failed: {exc}") from exc
