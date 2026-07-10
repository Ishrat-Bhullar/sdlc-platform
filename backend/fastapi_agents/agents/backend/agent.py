"""
agents/backend/agent.py
=========================
Backend Agent — produces a complete, implementation-ready backend build
plan AND the actual runnable source files (routers/services/repositories/
models/schemas) for the project, plus the standalone REST API design
capability (folded in here since it shares the same architectural
concerns and previously lived immediately alongside backend generation in
ai_service.py). Owns its own prompts (prompts.py) and schemas
(schemas.py); the pipeline orchestrator only ever calls `.generate(...)`.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..llm_service import LLMService
from .prompts import API_GENERATION_PROMPT, BACKEND_SYSTEM_PROMPT
from .schemas import ApiDesignResult, BackendPlanOutput

logger = logging.getLogger(__name__)


# ---------------------------------
# Demo-mode / fallback fixtures
# ---------------------------------
BACKEND_DEMO_PLAN = {
    "framework": "FastAPI + SQLAlchemy",
    "modules": ["Authentication", "Projects", "Agent orchestration", "Artifacts", "Approvals"],
    "implementation": "Persistent REST API with cookie sessions, validated schemas, and project-scoped agent execution.",
    "files": [],
}

MOCK_API_DESIGN: dict[str, Any] = {
    "api_style": "REST",
    "base_url": "http://localhost:8000",
    "endpoints": [
        {"method": "POST", "path": "/auth/login", "description": "Authenticate and receive HttpOnly JWT cookies", "auth_required": False,
         "request_body": '{"email": "string", "password": "string"}',
         "response": '{"id": "int", "email": "string", "full_name": "string", "role": "string"}'},
        {"method": "GET", "path": "/auth/me", "description": "Return current user from cookie", "auth_required": True,
         "request_body": None,
         "response": '{"id": "int", "email": "string", "full_name": "string"}'},
        {"method": "GET", "path": "/accounts", "description": "List all accounts for the authenticated customer", "auth_required": True,
         "request_body": None,
         "response": '{"accounts": [{"id": "int", "account_number": "string", "balance": "float"}]}'},
        {"method": "GET", "path": "/accounts/{id}", "description": "Single account detail", "auth_required": True,
         "request_body": None, "response": '{"id": "int", "account_number": "string", "balance": "float", "currency": "string"}'},
        {"method": "GET", "path": "/transactions", "description": "Paginated transaction history with filters", "auth_required": True,
         "request_body": None,
         "response": '{"transactions": [{"id": "int", "amount": "float", "transaction_type": "string", "occurred_at": "datetime"}], "total": "int", "page": "int"}'},
        {"method": "POST", "path": "/transactions", "description": "Post a new debit or credit transaction", "auth_required": True,
         "request_body": '{"account_id": "int", "transaction_type": "string", "amount": "float", "description": "string"}',
         "response": '{"id": "int", "status": "string"}'},
        {"method": "GET", "path": "/transactions/{id}", "description": "Single transaction detail", "auth_required": True,
         "request_body": None, "response": '{"id": "int", "amount": "float", "description": "string", "occurred_at": "datetime"}'},
    ],
    "openapi_yaml": """\
openapi: '3.0.3'
info:
  title: Banking Portal API
  version: '1.0.0'
paths:
  /auth/login:
    post:
      summary: Login
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                email: {type: string}
                password: {type: string}
      responses:
        '200':
          description: Authenticated — JWT cookies set
  /accounts:
    get:
      summary: List accounts
      security:
        - cookieAuth: []
      responses:
        '200':
          description: Account list
  /transactions:
    get:
      summary: List transactions
      security:
        - cookieAuth: []
      parameters:
        - name: page
          in: query
          schema: {type: integer, default: 1}
        - name: per_page
          in: query
          schema: {type: integer, default: 20}
      responses:
        '200':
          description: Paginated transaction list
""",
}


def _reuse_prior_or_demo_plan(db, project_id: int, artifact_type: str, demo_plan: dict) -> dict:
    """Mirrors FrontendAgent's reuse-on-total-failure fallback — see that
    module's docstring for the full rationale."""
    from ...models import GeneratedArtifact

    try:
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
                    "[BackendAgent] %s: all providers failed — reusing prior artifact #%s instead of an empty fallback",
                    artifact_type, prior.id,
                )
                return parsed
    except Exception:
        logger.debug("[BackendAgent] could not inspect prior %s artifacts for reuse", artifact_type, exc_info=True)
    return demo_plan


class BackendAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(self, context: str) -> BackendPlanOutput:
        if not context.strip():
            raise ValueError("Backend context cannot be empty")
        return self.llm.generate_json(BACKEND_SYSTEM_PROMPT, context, schema=BackendPlanOutput)

    def design_api(self, context: str) -> ApiDesignResult:
        if not context.strip():
            raise ValueError("API design context cannot be empty")
        return self.llm.generate_json(API_GENERATION_PROMPT, context, schema=ApiDesignResult)

    @classmethod
    def generate(cls, db, project_id: int, context: str) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `BackendAgent.generate(db, project_id, context)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_backend, including the DEMO_MODE fixture and the
        reuse-prior-artifact-on-total-failure fallback."""
        from ...models import DEMO_MODE, ArtifactType

        if DEMO_MODE:
            return BACKEND_DEMO_PLAN
        try:
            llm = LLMService(db=db, project_id=project_id, role="architect", timeout=170)
            result = llm.generate_json(BACKEND_SYSTEM_PROMPT, context, schema=BackendPlanOutput)
            return result.model_dump()
        except Exception as exc:
            logger.warning("[BackendAgent] generate failed: %s — falling back to static plan", exc)
            return _reuse_prior_or_demo_plan(db, project_id, ArtifactType.BACKEND_CODE.value, BACKEND_DEMO_PLAN)

    @classmethod
    def generate_api_design(cls, db, project_id: int, context: str) -> dict[str, Any]:
        """Orchestrator/route-facing entrypoint for the standalone API-design
        capability: `BackendAgent.generate_api_design(db, project_id, context)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_api_design."""
        from ...models import DEMO_MODE
        from ...ai_service import AIGenerationError

        if DEMO_MODE:
            return MOCK_API_DESIGN
        try:
            llm = LLMService(db=db, project_id=project_id, role="architect", timeout=170)
            result = llm.generate_json(API_GENERATION_PROMPT, context, schema=ApiDesignResult)
            if not result.endpoints:
                raise ValueError("LLM returned an API design with zero endpoints")
            return result.model_dump()
        except Exception as exc:
            logger.error("[BackendAgent] generate_api_design failed: %s", exc)
            raise AIGenerationError(f"API design generation failed: {exc}") from exc
