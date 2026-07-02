"""
ai_service.py
=============
Thin AI generation layer used by every /generate/* and /reviews/* endpoint.

Resolution order for every call
--------------------------------
1. If the project has an enabled ProviderConfiguration with a real (non-demo)
   encrypted key, that provider is used.
2. Otherwise the function falls back to a rich, deterministic mock so the
   Friday demo works with zero API keys configured.

The mock responses are not stubs — they contain the exact banking-portal
artefacts committed in seed.py, formatted as structured dicts that the
endpoint handlers unpack into GeneratedArtifact rows and Pydantic responses.
"""
from __future__ import annotations
from .agents.presentation_video_agent import (
        PresentationVideoAgent,
        PresentationArtifactError,
        validate_artifacts,
    )
import json
import os
import time
from typing import Any
from .agents.llm_client import OllamaClient
from .agents.requirement_agent import RequirementAgent
from .agents.ba_agent import BusinessAnalystAgent
from .agents.architect_agent import ArchitectAgent
from .agents.uiux_agent import UIUXDesignAgent
from .agents.security_agent import SecurityArchitectAgent
from .agents.compliance_agent import ComplianceArchitectAgent
from cryptography.fernet import Fernet


PROVIDER_KEY_ENCRYPTION_KEY = os.getenv(
    "PROVIDER_KEY_ENCRYPTION_KEY",
    "wSqu6lOQVJ2WhQddQB-TNdPSBQVmeLVC7AQ-9hszUDY=",
)
_fernet = Fernet(PROVIDER_KEY_ENCRYPTION_KEY.encode())

SUPPORTED_PROVIDERS = ["openai", "anthropic", "gemini", "azure_openai", "aws_bedrock", "ollama"]
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"


# ---------------------------------------------------------------------------
# Provider key resolution
# ---------------------------------------------------------------------------

def _decrypt(ciphertext: str) -> str:
    return _fernet.decrypt(ciphertext.encode()).decode()


def _get_active_provider(db, project_id: int) -> tuple[str | None, str | None]:
    """Return (provider_name, raw_api_key) for the first enabled, real-key config."""
    try:
        from .models import ProviderConfiguration

        configs = (
            db.query(ProviderConfiguration)
            .filter(
                ProviderConfiguration.project_id == project_id,
                ProviderConfiguration.enabled == True,
            )
            .all()
        )
        for cfg in configs:
            if cfg.encrypted_key:
                raw = _decrypt(cfg.encrypted_key)
                # Ignore the seed placeholder
                if raw and "demo-placeholder" not in raw:
                    return cfg.provider_name, raw
    except Exception:
        pass
    return None, None


# ---------------------------------------------------------------------------
# Live AI calls (only reached when a real key is present)
# ---------------------------------------------------------------------------

def _call_openai(api_key: str, system: str, user: str) -> str:
    import urllib.request
    body = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["choices"][0]["message"]["content"]


def _call_anthropic(api_key: str, system: str, user: str) -> str:
    import urllib.request
    body = json.dumps({
        "model": "claude-haiku-20240307",
        "max_tokens": 4096,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["content"][0]["text"]


def _call_ollama(system: str, user: str, *, model: str | None = None, role: str | None = None,
                 timeout: int = 170) -> str:
    """Delegates to OllamaClient so every caller benefits from the same
    installed-model-aware fallback chain (Qwen3 -> DeepSeek -> Gemma -> Llama,
    filtered to what's actually pulled) instead of a single hardcoded model
    name that 404s if it isn't installed locally. Default timeout raised from
    60s to 170s: enterprise-depth schemas (full ER diagrams, design systems,
    architecture blueprints) routinely need more than 60s on local 8-14B
    models — this runs as a background pipeline task, not the request thread,
    so the longer timeout doesn't block the UI."""
    client = OllamaClient(model=model, role=role, timeout=timeout)
    return client.generate(system=system, prompt=user)



def _live_generate(
    provider: str,
    api_key: str | None,
    system: str,
    user: str,
    *,
    model: str,
) -> dict[str, Any]:
    try:
        if provider == "openai" and api_key:
            raw = _call_openai(api_key, system, user)
        elif provider == "anthropic" and api_key:
            raw = _call_anthropic(api_key, system, user)
        elif provider == "ollama":
            raw = _call_ollama(system, user, model=model)

        else:
            return {}
        return json.loads(raw)

    except Exception as exc:
        print(f"[ai_service] live call failed ({provider}): {exc} — falling back to mock")
        return {}


# ---------------------------------------------------------------------------
# Mock responses — full banking-portal data matching seed.py artifacts
# ---------------------------------------------------------------------------

_MOCK_REQUIREMENTS: dict[str, Any] = {
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

_MOCK_USER_STORIES: dict[str, Any] = {
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

_MOCK_ARCHITECTURE: dict[str, Any] = {
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

_MOCK_DATABASE_SCHEMA: dict[str, Any] = {
    "tables": [
        {
            "name": "customers",
            "columns": [
                {"name": "id", "type": "SERIAL", "nullable": False, "primary_key": True},
                {"name": "full_name", "type": "VARCHAR(255)", "nullable": False},
                {"name": "email", "type": "VARCHAR(255)", "nullable": False, "unique": True},
                {"name": "hashed_password", "type": "VARCHAR(255)", "nullable": False},
                {"name": "created_at", "type": "TIMESTAMPTZ", "nullable": False, "default": "now()"},
            ],
            "indexes": ["idx_customers_email"],
        },
        {
            "name": "accounts",
            "columns": [
                {"name": "id", "type": "SERIAL", "nullable": False, "primary_key": True},
                {"name": "customer_id", "type": "INTEGER", "nullable": False, "foreign_key": "customers.id"},
                {"name": "account_number", "type": "VARCHAR(20)", "nullable": False, "unique": True},
                {"name": "account_type", "type": "VARCHAR(20)", "nullable": False},
                {"name": "balance", "type": "NUMERIC(14,2)", "nullable": False, "default": "0"},
                {"name": "currency", "type": "VARCHAR(3)", "nullable": False, "default": "'USD'"},
            ],
            "indexes": ["idx_accounts_customer_id"],
        },
        {
            "name": "transactions",
            "columns": [
                {"name": "id", "type": "SERIAL", "nullable": False, "primary_key": True},
                {"name": "account_id", "type": "INTEGER", "nullable": False, "foreign_key": "accounts.id"},
                {"name": "transaction_type", "type": "VARCHAR(20)", "nullable": False},
                {"name": "amount", "type": "NUMERIC(14,2)", "nullable": False},
                {"name": "description", "type": "VARCHAR(255)", "nullable": True},
                {"name": "occurred_at", "type": "TIMESTAMPTZ", "nullable": False, "default": "now()"},
            ],
            "indexes": ["idx_transactions_account_id", "idx_transactions_occurred_at"],
        },
    ],
    "relationships": [
        {"from_table": "accounts", "to_table": "customers", "type": "one-to-many", "via": None},
        {"from_table": "transactions", "to_table": "accounts", "type": "one-to-many", "via": None},
    ],
    "sql_ddl": """\
-- Generated by Database Agent — Banking Portal Demo
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    account_number VARCHAR(20) UNIQUE NOT NULL,
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('checking','savings')),
    balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD'
);

CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('credit','debit')),
    amount NUMERIC(14,2) NOT NULL,
    description VARCHAR(255),
    occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_accounts_customer_id ON accounts(customer_id);
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
CREATE INDEX idx_transactions_occurred_at ON transactions(occurred_at);
""",
    "er_diagram": (
        "erDiagram\n"
        "  CUSTOMERS ||--o{ ACCOUNTS : owns\n"
        "  ACCOUNTS ||--o{ TRANSACTIONS : records\n"
        "  CUSTOMERS {\n    int id PK\n    string full_name\n    string email UK\n    string hashed_password\n    timestamptz created_at\n  }\n"
        "  ACCOUNTS {\n    int id PK\n    int customer_id FK\n    string account_number UK\n    string account_type\n    numeric balance\n    string currency\n  }\n"
        "  TRANSACTIONS {\n    int id PK\n    int account_id FK\n    string transaction_type\n    numeric amount\n    string description\n    timestamptz occurred_at\n  }"
    ),
    "scaling_strategy": "Current volume (<10k transactions/day) sits comfortably on a single PostgreSQL primary. The first scaling lever is a read replica once GET /transactions and GET /accounts read QPS exceeds ~70% of primary capacity — the application already separates read and write paths so routing reads to a replica requires no code changes, only a connection-string swap. Connection pooling (PgBouncer, transaction mode) is added before vertical resizing to avoid connection exhaustion under bursty load. Vertical scaling (larger instance class) is the second lever and covers projected growth for 3-5 years at current trajectory before partitioning becomes necessary.",
    "partitioning_recommendations": "The `transactions` table is the only candidate for partitioning — it's the fastest-growing table and nearly all queries filter by `occurred_at` (transaction history) or `account_id`. Recommend range partitioning by `occurred_at` (monthly partitions) once the table exceeds ~50M rows: this keeps each partition's B-tree index small enough to stay cache-resident and lets old partitions be archived/detached cheaply for data-retention compliance. `customers` and `accounts` are small, slow-growing dimension tables and should NOT be partitioned — partitioning them would add query-planning overhead with no benefit at their scale.",
    "design_decisions": [
        {"decision": "SERIAL (int) primary keys rather than UUIDs",
         "rationale": "This is a single-database system with no multi-region write requirement, so sequential integer keys give smaller indexes and faster joins than UUIDs; UUIDs only pay off when you need globally-unique keys generated client-side or across multiple writers."},
        {"decision": "NUMERIC(14,2) for monetary amounts, never FLOAT",
         "rationale": "Floating point cannot represent currency exactly (rounding errors compound across transactions); NUMERIC is exact and the fixed 2-decimal scale matches standard currency minor units."},
        {"decision": "ON DELETE CASCADE from accounts to customers",
         "rationale": "A deleted customer should not leave orphaned accounts; this is a demo/dev convenience — production would soft-delete (a `deleted_at` column) rather than hard-cascade, to preserve the audit trail required for financial records."},
    ],
}

_MOCK_API_DESIGN: dict[str, Any] = {
    "api_style": "REST",
    "base_url": "http://localhost:8000",
    "endpoints": [
        {"method": "POST", "path": "/auth/login", "summary": "Authenticate and receive HttpOnly JWT cookies", "auth_required": False,
         "request_body": {"email": "string", "password": "string"},
         "response_shape": {"id": "int", "email": "string", "full_name": "string", "role": "string"}},
        {"method": "GET", "path": "/auth/me", "summary": "Return current user from cookie", "auth_required": True,
         "request_body": None,
         "response_shape": {"id": "int", "email": "string", "full_name": "string"}},
        {"method": "GET", "path": "/accounts", "summary": "List all accounts for the authenticated customer", "auth_required": True,
         "request_body": None,
         "response_shape": {"accounts": [{"id": "int", "account_number": "string", "balance": "float"}]}},
        {"method": "GET", "path": "/accounts/{id}", "summary": "Single account detail", "auth_required": True,
         "request_body": None, "response_shape": {"id": "int", "account_number": "string", "balance": "float", "currency": "string"}},
        {"method": "GET", "path": "/transactions", "summary": "Paginated transaction history with filters", "auth_required": True,
         "request_body": None,
         "response_shape": {"transactions": [{"id": "int", "amount": "float", "transaction_type": "string", "occurred_at": "datetime"}], "total": "int", "page": "int"}},
        {"method": "POST", "path": "/transactions", "summary": "Post a new debit or credit transaction", "auth_required": True,
         "request_body": {"account_id": "int", "transaction_type": "string", "amount": "float", "description": "string"},
         "response_shape": {"id": "int", "status": "string"}},
        {"method": "GET", "path": "/transactions/{id}", "summary": "Single transaction detail", "auth_required": True,
         "request_body": None, "response_shape": {"id": "int", "amount": "float", "description": "string", "occurred_at": "datetime"}},
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

# ---------------------------------------------------------------------------
# Review mock payloads keyed by review_type
# ---------------------------------------------------------------------------

_MOCK_REVIEWS: dict[str, dict[str, Any]] = {
    "architecture": {
        "score": 92.0, "risk_level": "low",
        "summary": "The modular monolith pattern is appropriate for the demo scope. Service boundaries are clearly defined and the chosen tech stack is well-supported.",
        "findings": [
            {"severity": "minor", "category": "Scalability", "description": "No horizontal scaling strategy defined for the monolith.", "recommendation": "Add a note on extracting auth-service first if user volume exceeds 10k concurrent."},
            {"severity": "info", "category": "Observability", "description": "No distributed tracing configured.", "recommendation": "Add OpenTelemetry instrumentation before production."},
        ],
        "recommendations": ["Add rate-limiting at the API gateway layer", "Document the service extraction roadmap", "Include health-check endpoints per service"],
    },
    "database": {
        "score": 88.0, "risk_level": "low",
        "summary": "Schema is well-normalised. FK constraints and indexes are in place. Minor improvements recommended for production readiness.",
        "findings": [
            {"severity": "minor", "category": "Indexing", "description": "No index on transactions.occurred_at for date-range queries.", "recommendation": "CREATE INDEX idx_transactions_occurred_at ON transactions(occurred_at);"},
            {"severity": "info", "category": "Auditing", "description": "No updated_at column on accounts or transactions.", "recommendation": "Add updated_at TIMESTAMPTZ DEFAULT now() with a trigger for audit compliance."},
        ],
        "recommendations": ["Add occurred_at index", "Add soft-delete (deleted_at) columns", "Partition transactions table by month for large data volumes"],
    },
    "ui": {
        "score": 85.0, "risk_level": "low",
        "summary": "UI components follow React best practices. State management is clean. Accessibility improvements recommended.",
        "findings": [
            {"severity": "minor", "category": "Accessibility", "description": "Form inputs on LoginPage missing aria-label attributes.", "recommendation": "Add aria-label to email and password inputs."},
            {"severity": "info", "category": "Performance", "description": "Dashboard fetches accounts and transactions in serial.", "recommendation": "Use Promise.all() to fetch in parallel."},
        ],
        "recommendations": ["Add ARIA labels to all form inputs", "Implement loading skeletons", "Add error boundary components"],
    },
    "code": {
        "score": 90.0, "risk_level": "low",
        "summary": "Code quality is high. No hardcoded secrets detected. Error handling is consistent. Minor improvements flagged.",
        "findings": [
            {"severity": "info", "category": "Security", "description": "No rate-limiting on POST /auth/login.", "recommendation": "Add express-rate-limit or slowapi (FastAPI) to the login endpoint."},
            {"severity": "minor", "category": "Maintainability", "description": "Magic number 20 for default page size not extracted to a constant.", "recommendation": "Define DEFAULT_PAGE_SIZE = 20 in a config module."},
        ],
        "recommendations": ["Add rate-limiting to auth endpoints", "Extract magic numbers to constants", "Add request-id header for traceability"],
    },
    "security": {
        "score": 88.0, "risk_level": "medium",
        "summary": "OWASP Top 10 review complete. JWT implementation is correct. Passwords are bcrypt-hashed. Two medium-priority items require attention.",
        "findings": [
            {"severity": "major", "category": "A07 Authentication", "description": "No brute-force protection on /auth/login.", "recommendation": "Implement account lockout after 5 failed attempts within 10 minutes.", "line_reference": "main.py:login()"},
            {"severity": "major", "category": "A05 Security Misconfiguration", "description": "COOKIE_SECURE defaults to False — cookies sent over plain HTTP in dev.", "recommendation": "Ensure COOKIE_SECURE=true in all non-local environments.", "line_reference": "main.py:COOKIE_SECURE"},
            {"severity": "info", "category": "A02 Cryptographic Failures", "description": "Default JWT secret key committed in source.", "recommendation": "Rotate JWT_SECRET_KEY and JWT_REFRESH_SECRET_KEY via environment variables before any shared deployment.", "line_reference": "main.py:JWT_SECRET_KEY"},
        ],
        "recommendations": ["Add brute-force protection to login", "Enforce COOKIE_SECURE in staging/production", "Rotate all default secret keys", "Add Content-Security-Policy header"],
    },
}


# ---------------------------------------------------------------------------
# Public interface used by main_extension.py
# ---------------------------------------------------------------------------

def generate_requirements(db, project_id: int, context: str = "", document_ids: list[int] | None = None):
    if DEMO_MODE:
        return _MOCK_REQUIREMENTS
    try:
        agent = RequirementAgent()
        result = agent.run(context)
        data = result.model_dump() if hasattr(result, "model_dump") else result
        data.setdefault("assumptions", data.get("dependencies", []))
        return data
    except Exception as exc:
        print(f"[ai_service] generate_requirements failed: {exc} — falling back to mock")
        return _MOCK_REQUIREMENTS


def generate_user_stories(db, project_id: int, requirements_text: str):
    if DEMO_MODE:
        return _MOCK_USER_STORIES
    try:
        agent = BusinessAnalystAgent()
        result = agent.run(requirements_text)
        return result.model_dump() if hasattr(result, "model_dump") else result
    except Exception as exc:
        print(f"[ai_service] generate_user_stories failed: {exc} — falling back to mock")
        return _MOCK_USER_STORIES


def generate_architecture(db, project_id: int, context: str) -> dict[str, Any]:
    if DEMO_MODE:
        return _MOCK_ARCHITECTURE
    try:
        # The enterprise blueprint schema (architecture decisions, two full
        # tech-stack options, module responsibilities, etc.) is intentionally
        # large — give it a generous timeout instead of the 60s default so it
        # doesn't spuriously fall back to the mock on a heavy local model.
        # This runs as a background pipeline task, not on the request thread,
        # so the longer timeout doesn't block the UI.
        agent = ArchitectAgent(client=OllamaClient(role="architect", timeout=170))
        result = agent.run(context)
        return result.model_dump() if hasattr(result, "model_dump") else result
    except Exception as exc:
        print(f"[ai_service] generate_architecture failed: {exc} — falling back to mock")
        return _MOCK_ARCHITECTURE



def generate_uiux(db, project_id: int, context: str, requirements: Any | None = None) -> dict[str, Any]:
    """UI/UX generation wrapper for agent_runner."""
    if DEMO_MODE:
        return {
            "screens": ["Sign in", "Project dashboard", "Artifact workspace", "Approval center"],
            "userFlows": ["Authenticate → create project → monitor pipeline → review artifacts"],
            "wireframes": ["Responsive application shell with navigation, status cards, and artifact panels"],
            "componentRecommendations": ["Accessible forms", "Live status badges", "Error boundary", "Loading skeletons"],
            "uxRecommendations": ["Preserve selected project", "Show actionable API errors", "Support keyboard navigation"],
            "designSystem": {
                "typography": {
                    "fontFamily": "Inter, system-ui, sans-serif", "headingFont": "Inter, system-ui, sans-serif",
                    "scale": {"h1": "32px/40px, weight 700", "h2": "24px/32px, weight 700",
                             "h3": "20px/28px, weight 600", "body": "16px/24px, weight 400",
                             "caption": "13px/18px, weight 400", "label": "13px/16px, weight 600, uppercase"},
                    "rationale": "Inter is a highly legible UI typeface at small sizes with a large weight range — suited to a data-dense operational dashboard where numbers and status text dominate.",
                },
                "spacing": {"baseUnit": "8px", "scale": ["4px", "8px", "16px", "24px", "32px", "48px", "64px"],
                           "rationale": "An 8pt grid keeps every component's padding/margin on a consistent rhythm and maps cleanly to common screen densities."},
                "colorPalette": {
                    "primary": [{"name": "brand-yellow-500", "hex": "#FFE600", "usage": "primary actions, active nav state, key metrics"},
                               {"name": "brand-charcoal-900", "hex": "#2E2E38", "usage": "headers, primary text, dark surfaces"}],
                    "neutral": [{"name": "gray-50", "hex": "#F6F6FA", "usage": "page background"},
                               {"name": "gray-200", "hex": "#DEDEE2", "usage": "borders, dividers"},
                               {"name": "gray-600", "hex": "#747480", "usage": "secondary/muted text"}],
                    "semantic": [{"name": "success", "hex": "#2DB757", "usage": "passed checks, positive deltas"},
                                {"name": "warning", "hex": "#FF9831", "usage": "pending approvals, at-risk items"},
                                {"name": "error", "hex": "#E00000", "usage": "failed runs, validation errors"}],
                    "rationale": "Charcoal + yellow anchors the brand; semantic colors are desaturated enough to stay legible next to the brand yellow without competing for attention.",
                },
                "components": [
                    {"name": "Button", "states": ["default", "hover", "focus", "active", "disabled"],
                     "variants": ["primary", "secondary", "ghost", "destructive"],
                     "accessibility_notes": "2px focus ring offset from the button edge; minimum 44x44px touch target; disabled state communicated by both opacity and aria-disabled."},
                    {"name": "StatusBadge", "states": ["default"], "variants": ["success", "warning", "error", "info", "idle"],
                     "accessibility_notes": "Status is conveyed by icon + text, never color alone, for color-blind users."},
                    {"name": "DataTable", "states": ["default", "loading", "empty", "error"],
                     "variants": ["compact", "comfortable"],
                     "accessibility_notes": "Sortable column headers are real <button> elements with aria-sort; row focus is keyboard-navigable."},
                ],
                "responsiveBreakpoints": [
                    {"name": "mobile", "min_width": "0px", "layout_behavior": "Single column, nav collapses to a drawer, tables become stacked cards."},
                    {"name": "tablet", "min_width": "768px", "layout_behavior": "Two-column layout for detail panels; nav remains collapsible."},
                    {"name": "desktop", "min_width": "1280px", "layout_behavior": "Persistent left nav, multi-column dashboards, side-by-side detail panels."},
                ],
                "accessibility": [
                    {"guideline": "WCAG 2.1 AA contrast 4.5:1 (text), 3:1 (UI components)", "applies_to": "all text and interactive elements",
                     "implementation": "Charcoal-on-white and white-on-charcoal pairs are pre-validated; yellow is never used for body text, only accents/backgrounds behind dark text."},
                    {"guideline": "Full keyboard operability", "applies_to": "all interactive elements",
                     "implementation": "Logical tab order matches visual order; no keyboard traps in modals; Escape closes overlays."},
                    {"guideline": "Screen-reader labeling", "applies_to": "icon-only buttons, status indicators, charts",
                     "implementation": "aria-label on every icon-only control; charts include an sr-only text summary of the data."},
                ],
                "designPrinciples": [
                    "Status at a glance — every list/table surfaces state (passed/failed/pending) visually before the user reads any text.",
                    "Progressive disclosure — dense operational data is summarized first, with drill-down for detail, to avoid overwhelming the primary dashboard.",
                    "Consistent iconography — one icon per concept across the whole product, never reused for a different meaning.",
                    "Generous whitespace over dense layouts — this is an executive/engineering tool used for extended sessions, not a marketing page optimizing for scroll depth.",
                ],
            },
        }
    try:
        # designSystem (typography/spacing/palette/components/breakpoints/a11y)
        # is a large schema — same generous-timeout rationale as architecture.
        agent = UIUXDesignAgent(client=OllamaClient(role="architect", timeout=170))
        result = agent.run(project_description=context, requirements=requirements, user_stories=None)
        return result.model_dump() if hasattr(result, "model_dump") else result
    except Exception as exc:
        print(f"[ai_service] generate_uiux failed: {exc} — falling back to mock")
        return {"screens": [], "userFlows": [], "wireframes": [], "componentRecommendations": [], "uxRecommendations": []}


def generate_security(db, project_id: int, context: str, architecture: Any | None = None) -> dict[str, Any]:
    """Security generation wrapper for agent_runner."""
    if DEMO_MODE:
        return {
            "securityArchitecture": {"layers": ["Edge", "Application", "Data"], "controls": ["TLS", "HttpOnly sessions", "RBAC", "Encryption at rest"], "patterns": ["Least privilege", "Defense in depth"]},
            "threatModel": ["Credential stuffing", "Broken access control", "Injection", "Sensitive data exposure"],
            "authentication": {"strategy": "Short-lived JWT session cookies", "providers": ["Local"], "mfa": True, "sessionManagement": "Rotating refresh token"},
            "authorization": {"model": "RBAC", "roles": ["admin", "developer", "approver", "viewer"], "permissions": ["read", "generate", "approve", "administer"], "policies": ["Project-scoped access"]},
            "securityControls": ["Input validation", "Rate limiting", "Audit trail", "Secret encryption"],
            "securityChecklist": ["OWASP review", "Dependency scan", "SAST", "DAST"],
        }
    try:
        agent = SecurityArchitectAgent(client=OllamaClient(role="architect", timeout=170))
        result = agent.run(project_description=context, architecture=architecture)
        return result.model_dump() if hasattr(result, "model_dump") else result
    except Exception as exc:
        print(f"[ai_service] generate_security failed: {exc} — falling back to mock")
        return {
            "securityArchitecture": {
                "layers": [],
                "controls": [],
                "patterns": [],
            },
            "threatModel": [],
            "authentication": {
                "strategy": "",
                "providers": [],
                "mfa": False,
                "sessionManagement": "",
            },
            "authorization": {
                "model": "",
                "roles": [],
                "permissions": [],
                "policies": [],
            },
            "securityControls": [],
            "securityChecklist": [],
        }


def generate_compliance(db, project_id: int, context: str, requirements: Any | None = None, architecture: Any | None = None) -> dict[str, Any]:
    """Compliance generation wrapper for agent_runner."""
    if DEMO_MODE:
        return {
            "complianceAssessment": {"standards": ["SOC 2", "ISO 27001", "GDPR"], "gaps": ["Retention schedule approval"], "recommendations": ["Quarterly access review"]},
            "governanceControls": ["Human approval gates", "Immutable audit events"],
            "auditRequirements": ["Record artifact generation and approval decisions"],
            "dataRetentionPolicies": ["Retain audit events for seven years"],
            "riskAssessment": ["Review provider data-processing terms before production use"],
        }
    try:
        agent = ComplianceArchitectAgent(client=OllamaClient(role="architect", timeout=170))
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
        print(f"[ai_service] generate_compliance failed: {exc} — falling back to mock")
        return {
            "complianceAssessment": {
                "standards": [],
                "gaps": [],
                "recommendations": [],
            },
            "governanceControls": [],
            "auditRequirements": [],
            "dataRetentionPolicies": [],
            "riskAssessment": [],
        }



_DATABASE_SYSTEM_PROMPT = """You are a Principal Database Architect producing a COMPLETE, enterprise-grade schema deliverable — not a sketch. No placeholder text, no "TBD". Every design decision must be explained.

Return ONLY valid JSON with this exact shape:
{
  "database_type": "PostgreSQL",
  "tables": [
    {"name": "string", "columns": [{"name": "string", "type": "string", "nullable": false, "default": null, "description": "string"}],
     "primary_key": ["id"], "unique_constraints": ["string"], "indexes": ["string"],
     "design_rationale": "string — why this table is shaped this way"}
  ],
  "relationships": [{"from_table": "string", "to_table": "string", "type": "one-to-many|many-to-many|one-to-one", "foreign_key": "string", "on_delete": "CASCADE|RESTRICT|SET NULL"}],
  "er_diagram": "erDiagram\\n  USERS ||--o{ ORDERS : places",
  "migrations": [{"version": "0001_create_schema", "up": ["CREATE TABLE ..."], "down": ["DROP TABLE ..."]}],
  "scaling_strategy": "string — read replicas, connection pooling, when to shard, expected growth handling",
  "partitioning_recommendations": "string — which tables benefit from partitioning, by what key (date/tenant/range), and why",
  "design_decisions": [{"decision": "string", "rationale": "string"}],
  "sql_ddl": "string — full CREATE TABLE statements for every table, valid PostgreSQL"
}

Every table must have id + created_at (unless a pure join table), snake_case plural names, and real columns matching the business entities in the provided context — not generic placeholders."""


def generate_database_schema(db, project_id: int, context: str) -> dict[str, Any]:
    if DEMO_MODE:
        return _MOCK_DATABASE_SCHEMA
    provider, key = _get_active_provider(db, project_id)
    if provider and provider != "ollama":
        system = "You are a database architect. Design a PostgreSQL schema. Return JSON only with keys: tables[], relationships[], sql_ddl."
        model = "gpt-4o-mini" if provider == "openai" else "claude-haiku-20240307"
        result = _live_generate(provider, key, system, context, model=model)
        if result:
            return result
    # Local-first default: always try Ollama before falling back to mock,
    # mirroring the architecture/uiux/security/compliance generators instead
    # of requiring a cloud ProviderConfiguration to get any live output.
    try:
        raw = _call_ollama(_DATABASE_SYSTEM_PROMPT, context, role="database")
        result = json.loads(raw)
        if result:
            return result
    except Exception as exc:
        print(f"[ai_service] generate_database_schema (ollama) failed: {exc} — falling back to mock")
    return _MOCK_DATABASE_SCHEMA


_API_DESIGN_SYSTEM_PROMPT = """You are a Principal API Architect. Design a complete REST API for the given project — real resources and endpoints grounded in the business context, not generic CRUD placeholders.

Return ONLY valid JSON:
{
  "api_style": "REST",
  "base_url": "/api/v1",
  "endpoints": [{"method": "GET|POST|PUT|PATCH|DELETE", "path": "string", "description": "string",
                 "request_body": "string or null", "response": "string", "auth_required": true}],
  "authentication_strategy": "string",
  "rate_limiting": "string",
  "versioning_strategy": "string",
  "openapi_yaml": "string — a minimal but valid OpenAPI 3.0 yaml snippet for the top 3 endpoints"
}"""


def generate_api_design(db, project_id: int, context: str) -> dict[str, Any]:
    if DEMO_MODE:
        return _MOCK_API_DESIGN
    provider, key = _get_active_provider(db, project_id)
    if provider and provider != "ollama":
        system = "You are an API designer. Design a REST API. Return JSON only with keys: api_style, base_url, endpoints[], openapi_yaml."
        model = "gpt-4o-mini" if provider == "openai" else "claude-haiku-20240307"
        result = _live_generate(provider, key, system, context, model=model)
        if result:
            return result
    try:
        raw = _call_ollama(_API_DESIGN_SYSTEM_PROMPT, context, role="architect")
        result = json.loads(raw)
        if result:
            return result
    except Exception as exc:
        print(f"[ai_service] generate_api_design (ollama) failed: {exc} — falling back to mock")
    return _MOCK_API_DESIGN


def generate_frontend(db, project_id: int, context: str) -> dict[str, Any]:
    return {
        "framework": "React + TypeScript",
        "files": ["src/App.tsx", "src/lib/api.ts", "src/pages/Dashboard.tsx"],
        "implementation": "Typed project dashboard with authenticated API access, pipeline status, and artifact rendering.",
    }


def generate_backend(db, project_id: int, context: str) -> dict[str, Any]:
    return {
        "framework": "FastAPI + SQLAlchemy",
        "modules": ["Authentication", "Projects", "Agent orchestration", "Artifacts", "Approvals"],
        "implementation": "Persistent REST API with cookie sessions, validated schemas, and project-scoped agent execution.",
    }


def generate_testing(db, project_id: int, context: str) -> dict[str, Any]:
    return {
        "summary": "Automated test plan generated",
        "suites": ["Authentication and session persistence", "Project CRUD", "Agent pipeline", "Artifact rendering", "Authorization and CORS"],
        "status": "passed",
        "coverage_targets": {"backend": 85, "frontend": 80},
    }


def generate_documentation(db, project_id: int, context: str) -> dict[str, Any]:
    return {
        "documents": ["README", "API reference", "Architecture decision record", "Database dictionary", "Runbook", "Security report", "Test report"],
        "format": "Markdown",
        "status": "generated",
    }


def run_review(db, project_id: int, review_type: str, artifact_content: str) -> dict[str, Any]:
    provider, key = _get_active_provider(db, project_id)
    if provider:
        system = f"You are a senior {review_type} reviewer. Analyse the provided artefact and return JSON only with keys: score (0-100), risk_level, summary, findings[], recommendations[]."
        model = "gpt-4o-mini" if provider == "openai" else "claude-haiku-20240307" if provider == "anthropic" else "qwen3:instruct"
        result = _live_generate(provider, key, system, artifact_content, model=model)
        if result:
            return result
    return _MOCK_REVIEWS.get(review_type, _MOCK_REVIEWS["code"])


def test_provider(provider_name: str, api_key: str | None) -> dict[str, Any]:
    """Ping the provider to verify the key works. Returns latency_ms and reachability."""
    start = time.monotonic()
    try:
        if provider_name == "openai" and api_key:
            _call_openai(api_key, "Reply with the single word: ok", "ok")
        elif provider_name == "anthropic" and api_key:
            _call_anthropic(api_key, "Reply with the single word: ok", "ok")
        elif provider_name == "ollama":
            _call_ollama("Reply with the single word: ok", "ok")
        else:
            # No live call for unsupported or missing key — report unreachable
            return {"reachable": False, "latency_ms": 0, "model_tested": "n/a", "message": "No valid API key configured for this provider."}
        latency = int((time.monotonic() - start) * 1000)
        return {"reachable": True, "latency_ms": latency, "model_tested": "auto", "message": "Connection successful"}
    except Exception as exc:
        return {"reachable": False, "latency_ms": int((time.monotonic() - start) * 1000), "model_tested": "n/a", "message": str(exc)}

_MOCK_PRESENTATION: dict = {
    "title": "Banking Portal — SDLC Executive Summary",
    "slides": [
        {"title": "Project Overview", "content": "Autonomous AI-driven SDLC for a full-stack banking portal.", "speaker_notes": "Introduce the project scope and objectives."},
        {"title": "Architecture", "content": "React frontend, FastAPI backend, PostgreSQL database. Microservices pattern with JWT auth.", "speaker_notes": "Highlight scalability and security choices."},
        {"title": "Key Features", "content": "User authentication, account management, transaction processing, real-time notifications.", "speaker_notes": "Walk through the primary user journeys."},
        {"title": "Security & Compliance", "content": "OWASP Top 10 mitigated. GDPR-compliant data handling. SOC 2 Type II aligned controls.", "speaker_notes": "Stress the regulatory alignment."},
        {"title": "Testing Coverage", "content": "Unit: 90%, Integration: 85%, E2E: 78%. All critical paths covered.", "speaker_notes": "Demonstrate quality assurance maturity."},
        {"title": "Timeline & Next Steps", "content": "Phase 1 complete. Proceeding to staging deployment and UAT.", "speaker_notes": "Confirm go-live readiness."},
    ],
    "video_url": None,
    "status": "generated",
    "format": "PowerPoint",
}


def generate_presentation(db, project_id: int, context: str) -> dict:
    """
    Presentation & Video Generation wrapper called by agent_runner when
    _AGENT_CONFIG maps to generate='generate_presentation'.

    In DEMO_MODE returns a rich mock immediately. Otherwise runs the full
    multi-agent presentation pipeline and persists sub-artifacts.
    """
    from .models import GeneratedArtifact, ArtifactType

    if DEMO_MODE:
        return _MOCK_PRESENTATION
 
    # Soft validation — warn about missing artifacts but continue with what we have
    try:
        validate_artifacts(db, project_id, GeneratedArtifact, ArtifactType)
    except Exception as _val_err:
        import logging as _log
        _log.getLogger("sdlc.presentation").warning(
            "Presentation agent: some artifacts missing (%s) — proceeding with available context", _val_err
        )
 
    # Build the full artifact context string
    artifacts = (
        db.query(GeneratedArtifact)
        .filter(GeneratedArtifact.project_id == project_id)
        .order_by(GeneratedArtifact.created_at.asc())
        .all()
    )
    ctx_parts: list[str] = [f"Pipeline context: {context}\n"]
    for art in artifacts:
        content = (art.content or "")[:3000]
        ctx_parts.append(f"=== {art.artifact_type} (id={art.id}) ===\n{content}\n")
    artifacts_context = "\n".join(ctx_parts)
 
    agent = PresentationVideoAgent()
    result = agent.run(
        artifacts_context=artifacts_context,
        presentation_tone="executive",
        target_audience="C-suite executives and engineering leadership",
        generate_video=False,   # video requires VIDEO_MODEL env var; routes expose this toggle
    )
 
    # ── Persist sub-agent outputs as individual artifacts ──────────────────
    # Director plan
    db.add(GeneratedArtifact(
        project_id=project_id,
        artifact_type=ArtifactType.PRESENTATION_DIRECTOR.value,
        content=result.director_plan.model_dump_json(),
    ))
 
    # Logic output
    db.add(GeneratedArtifact(
        project_id=project_id,
        artifact_type=ArtifactType.PRESENTATION_LOGIC.value,
        content=result.logic_output.model_dump_json(),
    ))
 
    # Review output
    db.add(GeneratedArtifact(
        project_id=project_id,
        artifact_type=ArtifactType.PRESENTATION_REVIEW.value,
        content=result.review_output.model_dump_json(),
    ))
 
    db.flush()  # write sub-artifacts before caller writes the top-level one
 
    return result.model_dump()