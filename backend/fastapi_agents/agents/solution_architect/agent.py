"""
agents/solution_architect/agent.py
===================================
Solution Architect Agent — produces the enterprise implementation blueprint
(architecture summary, pattern, components, diagrams, architecture
decisions, scalability/security/performance/deployment strategy, and the
two mandatory local/cloud tech-stack recommendations). Owns its own prompt
(prompts.py) and schema (schemas.py); the pipeline orchestrator only ever
calls `.generate(...)`.
"""
from __future__ import annotations

from ...logging_config import get_logger
from typing import Any

from ..llm_service import LLMService
from .prompts import SOLUTION_ARCHITECT_SYSTEM_PROMPT
from .schemas import ArchitectAgentOutput

logger = get_logger(__name__)


# ---------------------------------
# Demo-mode fixture (returned only when the deployment-wide DEMO_MODE flag
# is on — see ai_service.py's module docstring for the contract).
# ---------------------------------
MOCK_ARCHITECTURE: dict[str, Any] = {
    "architecture_summary": (
        "Banking Portal — Monolith with modular services. Auth, Account and Transaction "
        "concerns are separated as independent modules in a single Express/FastAPI app for "
        "demo simplicity. The monolith can be extracted to true microservices post-demo "
        "without schema changes."
    ),
    "pattern": "Modular Monolith",
    "microservices": [
        {"name": "auth-service", "responsibility": "Issues and validates JWTs, owns the customers table", "technology": "FastAPI / Node.js", "port": 8001},
        {"name": "account-service", "responsibility": "Account balances and metadata", "technology": "FastAPI / Node.js", "port": 8002},
        {"name": "transaction-service", "responsibility": "Transaction history and posting", "technology": "FastAPI / Node.js", "port": 8003},
    ],
    "components": [
        {"name": "React SPA", "type": "frontend", "technology": "React 18 + Vite + TypeScript"},
        {"name": "API Gateway", "type": "gateway", "technology": "Nginx / AWS ALB"},
        {"name": "PostgreSQL", "type": "database", "technology": "PostgreSQL 15"},
        {"name": "Redis", "type": "cache", "technology": "Redis 7 — session cache"},
    ],
    "diagrams": [
        {"type": "system_context", "content": "graph TD\n  User-->|HTTPS|SPA\n  SPA-->|REST|Gateway\n  Gateway-->|route|Auth\n  Gateway-->|route|Account\n  Gateway-->|route|Transaction\n  Auth-->DB[(PostgreSQL)]\n  Account-->DB\n  Transaction-->DB"},
        {"type": "sequence_login", "content": "sequenceDiagram\n  User->>SPA: Enter credentials\n  SPA->>auth-service: POST /auth/login\n  auth-service->>DB: SELECT user WHERE email=?\n  DB-->>auth-service: user row\n  auth-service-->>SPA: Set-Cookie: access_token\n  SPA-->>User: Redirect /dashboard"},
    ],
    "tech_stack": {
        "frontend": "React 18, Vite, TypeScript, TailwindCSS",
        "backend": "FastAPI (Python 3.12) or Node.js 20 + Express",
        "database": "PostgreSQL 15",
        "auth": "JWT (HS256), bcrypt password hashing",
        "cache": "Redis 7",
        "deployment": "Docker Compose (demo), AWS ECS (production)",
    },
    "architecture_decisions": [
        {"decision": "Modular monolith over microservices for v1",
         "rationale": "Three tightly-coupled domains (auth, accounts, transactions) share a single PostgreSQL instance and low team size (2-3 engineers) — microservices would add network hops and deployment overhead without a scaling problem to justify it.",
         "alternatives_considered": "Full microservices with separate databases per service; rejected as premature given current transaction volume (<10k/day).",
         "consequences": "Simpler local dev and single deploy pipeline now; the module boundaries (auth/account/transaction) are kept clean so extraction to real services later requires no schema changes, only a network boundary."},
        {"decision": "JWT in HttpOnly cookies rather than localStorage",
         "rationale": "Eliminates XSS token theft as an attack vector; the trade-off (CSRF exposure) is mitigated with SameSite=Lax cookies and a CSRF token on state-changing requests.",
         "alternatives_considered": "Bearer tokens in Authorization header with localStorage storage; rejected due to XSS exposure.",
         "consequences": "Slightly more complex CORS configuration (credentials: 'include' required on every client request)."},
        {"decision": "PostgreSQL over a managed NoSQL store",
         "rationale": "Financial transaction data is inherently relational (customers -> accounts -> transactions) and requires ACID guarantees for balance consistency; a document store would require application-level transaction coordination.",
         "alternatives_considered": "DynamoDB for horizontal write scaling; rejected — the workload is read-heavy, not write-heavy, and ACID correctness matters more than write throughput here.",
         "consequences": "Vertical scaling ceiling exists but is far beyond current projected load; read replicas cover the read-heavy access pattern."},
    ],
    "design_principles": [
        "Stateless application tier — every service instance is interchangeable, session state lives only in the JWT and Redis, enabling horizontal autoscaling behind the load balancer.",
        "Single source of truth per entity — the customers/accounts/transactions module boundary owns its table exclusively; no other module writes to it directly.",
        "Fail closed on authorization — every route defaults to requiring authentication; public routes are explicitly allow-listed, not the reverse.",
        "Idempotent writes on financial operations — every transaction-posting request carries a client-generated idempotency key to make retries safe.",
    ],
    "scalability_strategy": "Horizontal autoscaling of stateless API containers behind the ALB, triggered on p95 latency and CPU. Redis absorbs session/read-cache load so the database isn't hit on every request. PostgreSQL scales vertically first (current load is well under a single r6g.xlarge instance's ceiling); read replicas are added when read QPS exceeds ~70% of primary capacity, routing all GET /transactions and GET /accounts traffic to replicas. Sharding is not required at current or 5-year-projected volume.",
    "security_considerations": "Defense in depth across four layers: (1) edge — WAF + rate limiting on /auth/login to blunt credential stuffing; (2) transport — TLS 1.3 everywhere, HSTS enabled; (3) application — bcrypt (cost factor 12) for password hashing, parameterized queries throughout (no raw SQL string interpolation), input validation via Pydantic schemas at every API boundary; (4) data — AES-256 encryption at rest for the RDS volume, column-level encryption for any future PII beyond what's already modeled. Secrets (DB credentials, JWT signing key) are pulled from AWS Secrets Manager at boot, never committed to source or baked into images.",
    "performance_strategy": "Redis caches the authenticated user's account summary (60s TTL) since balances are read far more often than they change. Database indexes cover every foreign key and every filter/sort column used by the transaction history endpoint (account_id, occurred_at). Transaction history pagination uses keyset pagination (WHERE occurred_at < ?) rather than OFFSET to keep query time constant regardless of page depth. Target latency budget: p95 < 200ms for read endpoints, p95 < 400ms for the transaction-posting write path (includes balance-update transaction).",
    "deployment_strategy": "Three environments (dev/staging/production) provisioned via Terraform. CI runs on every PR (lint, type-check, unit tests, container build); merges to main auto-deploy to staging. Production deploys are a manual-approval blue-green swap on ECS — the new task set is health-checked behind a separate target group before traffic is cut over, with automatic rollback if error rate exceeds 1% in the first five minutes.",
    "integration_strategy": "External integrations (KYC verification, payment rails) go through an outbound integration module that owns retry/backoff and idempotency for each partner API — application code never calls a third-party API directly. Inbound webhooks (payment confirmations) are verified by signature, deduplicated by event ID, and processed asynchronously via a queue so a slow partner never blocks the request path.",
    "communication_flow": "A transaction request enters through the ALB and is routed by path to the transaction-service module. The module first calls auth-service's shared JWT-verification middleware (in-process in the modular monolith, not a network call) to authenticate the caller, then reads the target account from account-service's module to confirm ownership and current balance, then writes the new transaction row and updated balance inside a single database transaction to guarantee consistency, and finally publishes a 'transaction.posted' event to Redis pub/sub so the account-service's cached balance and any real-time dashboard subscribers stay in sync — all without a network hop between modules today, and with the exact same call shape ready to become real service-to-service calls if the modules are later split out.",
    "module_responsibilities": [
        {"module": "auth-service", "responsibility": "Authentication, session/JWT issuance and validation, password management", "owns_data": "customers (credentials)", "communicates_with": ["account-service"]},
        {"module": "account-service", "responsibility": "Account lifecycle, balance state, ownership checks", "owns_data": "accounts", "communicates_with": ["auth-service", "transaction-service"]},
        {"module": "transaction-service", "responsibility": "Transaction posting and history, idempotency enforcement", "owns_data": "transactions", "communicates_with": ["account-service"]},
    ],
    "tech_stack_local": {
        "label": "Local / Open Source",
        "ai_layer": "Ollama running Qwen3 14B for planning tasks, DeepSeek R1 8B for anything requiring longer reasoning chains",
        "backend": "FastAPI (Python 3.12)", "frontend": "React 18 + TypeScript + Vite",
        "database": "PostgreSQL 15 (self-hosted or Docker)", "vector_store": "ChromaDB",
        "cache_queue": "Redis 7 (cache + pub/sub)", "orchestration": "LangGraph for multi-step agent flows, Temporal for durable long-running workflows",
        "deployment": "Docker Compose for single-node; Kubernetes (k3s or full k8s) once multi-node HA is needed",
        "ci_cd": "GitHub Actions self-hosted runners, or GitLab CI on-prem", "observability": "Prometheus + Grafana + Loki",
        "rationale": {
            "Ollama": "Runs entirely on-prem — no customer data ever leaves the network, zero per-token cost, works fully offline.",
            "PostgreSQL": "Free, battle-tested ACID store; no licensing cost at any scale.",
            "ChromaDB": "Embeddable, no separate service to operate for a moderate-scale vector workload.",
            "Temporal": "Durable execution survives process restarts without hand-rolled retry/state-machine code.",
        },
        "trade_offs": "Requires the team to own operations (patching, backups, scaling) that a managed cloud service would otherwise handle; local LLMs (Qwen/DeepSeek/Gemma at 8-14B) trail frontier cloud models on complex reasoning tasks.",
        "estimated_cost_profile": "Fixed infrastructure cost (compute + storage), no per-request API fees — cost is flat regardless of usage volume once hardware is provisioned.",
        "scalability_notes": "Scales with the hardware you provision; GPU capacity is the binding constraint for the AI layer, not the application tier.",
    },
    "tech_stack_cloud": {
        "label": "Cloud / Enterprise",
        "ai_layer": "Azure OpenAI (GPT-4o) for complex reasoning, AWS Bedrock (Claude) as a secondary provider for redundancy",
        "backend": "FastAPI on Azure Container Apps or AWS ECS Fargate", "frontend": "React 18, deployed via Azure Static Web Apps / AWS Amplify",
        "database": "Azure Database for PostgreSQL Flexible Server (or AWS RDS PostgreSQL)", "vector_store": "Azure AI Search or Pinecone",
        "cache_queue": "Azure Cache for Redis", "orchestration": "Azure Durable Functions or Temporal Cloud",
        "deployment": "Azure Kubernetes Service (AKS) with autoscaling node pools", "ci_cd": "Azure DevOps or GitHub Actions with cloud-hosted runners",
        "observability": "Azure Monitor / Application Insights",
        "rationale": {
            "Azure OpenAI": "Enterprise SLA, data residency guarantees, and compliance certifications (SOC2, ISO 27001) the business already needs for a financial-services workload.",
            "AKS": "Managed control plane removes the operational burden of running Kubernetes yourself.",
            "Azure Database for PostgreSQL": "Automated backups, point-in-time restore, and HA failover without building it in-house.",
        },
        "trade_offs": "Per-request/per-token costs scale with usage and can become significant at high volume; data leaves the on-prem network (mitigated by enterprise data-processing agreements); introduces vendor dependency.",
        "estimated_cost_profile": "Near-zero upfront cost, scales with usage — cheaper at low volume, more expensive than the local stack at sustained high volume.",
        "scalability_notes": "Effectively unlimited horizontal scale on demand; the constraint shifts from infrastructure capacity to budget.",
    },
}


def build_architecture_prompt(context: str) -> str:
    return f"""
Project Context:
{context}

Generate the architecture output now.
"""


class ArchitectAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(self, context: str) -> ArchitectAgentOutput:
        if not context.strip():
            raise ValueError("Architecture context cannot be empty")

        result = self.llm.generate_json(
            system=SOLUTION_ARCHITECT_SYSTEM_PROMPT,
            prompt=build_architecture_prompt(context),
            schema=ArchitectAgentOutput,
        )

        if not result or not result.architecture_summary:
            raise ValueError("No architecture generated")

        return result

    @classmethod
    def generate(cls, db, project_id: int, context: str) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `ArchitectAgent.generate(db, project_id, context)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_architecture."""
        from ...models import DEMO_MODE
        from ...ai_service import AIGenerationError

        if DEMO_MODE:
            return MOCK_ARCHITECTURE
        try:
            # The enterprise blueprint schema (architecture decisions, two full
            # tech-stack options, module responsibilities, etc.) is intentionally
            # large — give it a generous timeout instead of the 60s default so it
            # doesn't spuriously fall back to the mock on a heavy local model.
            # This runs as a background pipeline task, not on the request thread,
            # so the longer timeout doesn't block the UI.
            agent = cls(llm=LLMService(db=db, project_id=project_id, role="architect", timeout=170))
            result = agent.run(context)
            return result.model_dump() if hasattr(result, "model_dump") else result
        except Exception as exc:
            logger.error("[ArchitectAgent] generate failed: %s", exc)
            raise AIGenerationError(f"Architecture generation failed: {exc}") from exc
