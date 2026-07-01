"""
tech_doc_builder.py
─────────────────────────────────────────────────────────────────────────────
Deterministic, fully-local generator for COMPLETE platform-level technical
documentation, synthesized from all existing project artifacts.

Produces a structured document covering the ENTIRE platform (not a single
feature) with these sections:
  overview, module_breakdown, feature_specifications, api_documentation,
  database_schema, user_flows, security, integrations, microservices,
  error_handling, deployment_architecture, testing_strategy,
  non_functional_requirements, development_roadmap

No LLM / paid APIs. Public API:
    build_technical_documentation(artifacts, project_name, description) -> dict
"""
from __future__ import annotations

import json
from typing import Any, Dict, List


def _safe_list(obj: Any, key: str = "") -> list:
    if obj is None:
        return []
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict) and key:
        v = obj.get(key, [])
        return v if isinstance(v, list) else []
    return []


def _load_artifacts(artifacts) -> Dict[str, Any]:
    art_map: Dict[str, Any] = {}
    for a in (artifacts or []):
        art_type = getattr(a, "artifact_type", None) or (a.get("artifact_type", "") if isinstance(a, dict) else "")
        raw = getattr(a, "content", None) or (a.get("content", "") if isinstance(a, dict) else "")
        if isinstance(raw, str):
            try:
                art_map[art_type] = json.loads(raw)
            except Exception:
                art_map[art_type] = {"raw": raw}
        else:
            art_map[art_type] = raw or {}
    return art_map


# ─── Section builders ─────────────────────────────────────────────────────────

def _overview(project_name, description, arch, tech_stack, req_list) -> Dict[str, Any]:
    return {
        "title": f"{project_name} — Technical Documentation",
        "summary": arch.get("architecture_summary")
            or description
            or f"{project_name} is a full-stack platform delivering its capabilities through a modern, service-oriented architecture.",
        "architecture_pattern": arch.get("pattern", "Layered / Microservices"),
        "scope": (
            f"This document describes the complete technical design of {project_name}, "
            "covering all modules, services, data structures, APIs, security controls, "
            "integrations, deployment topology, and the development roadmap. It is intended "
            "to be sufficient for an engineering team to implement, operate, and extend the platform."
        ),
        "primary_stack": tech_stack,
        "requirement_count": len(req_list),
        "audience": ["Software Engineers", "Architects", "DevOps / SRE", "QA Engineers", "Technical Product Managers"],
    }


def _module_breakdown(components, services, req_list) -> List[Dict[str, Any]]:
    modules: List[Dict[str, Any]] = []
    # Derive modules from architecture components grouped by type
    by_type: Dict[str, List[Dict]] = {}
    for c in components:
        by_type.setdefault(c.get("type", "other"), []).append(c)

    layer_desc = {
        "frontend": "User-facing single-page application: rendering, state management, routing, and client-side validation.",
        "gateway": "Edge routing, authentication, rate-limiting, and request aggregation.",
        "api": "Public API surface exposing platform capabilities over REST/HTTP.",
        "service": "Domain microservice encapsulating a bounded context and its business logic.",
        "backend": "Application server hosting business logic and orchestration.",
        "database": "Persistent data store with transactional guarantees.",
        "cache": "In-memory cache for low-latency reads and session storage.",
        "queue": "Asynchronous message broker for event-driven workflows.",
        "external": "Third-party system integrated with the platform.",
    }
    for typ, comps in by_type.items():
        for c in comps:
            modules.append({
                "name": c.get("name"),
                "layer": typ,
                "technology": c.get("technology", ""),
                "responsibility": layer_desc.get(typ, "Platform component."),
            })
    # Add microservices explicitly
    for s in services:
        modules.append({
            "name": s.get("name"),
            "layer": "microservice",
            "technology": s.get("technology", ""),
            "responsibility": s.get("responsibility", "Owns a bounded context."),
            "port": s.get("port"),
        })
    if not modules:
        modules = [
            {"name": "Web Client", "layer": "frontend", "technology": "React", "responsibility": layer_desc["frontend"]},
            {"name": "API Server", "layer": "backend", "technology": "FastAPI", "responsibility": layer_desc["backend"]},
            {"name": "Database", "layer": "database", "technology": "PostgreSQL", "responsibility": layer_desc["database"]},
        ]
    return modules


def _feature_specifications(req_list, epics) -> List[Dict[str, Any]]:
    features: List[Dict[str, Any]] = []
    # Prefer enriched requirements if present
    for r in req_list:
        spec = {
            "id": r.get("id"),
            "name": r.get("description", "")[:80],
            "category": r.get("category", "Functional"),
            "priority": r.get("priority", "medium"),
            "description": r.get("detail") or r.get("description", ""),
        }
        if r.get("business_rules"):
            spec["business_rules"] = r["business_rules"]
        if r.get("acceptance_criteria"):
            spec["acceptance_criteria"] = r["acceptance_criteria"]
        if r.get("workflow"):
            spec["workflow"] = r["workflow"]
        features.append(spec)
    # Augment with epics/user-stories if available
    for e in epics:
        features.append({
            "id": e.get("id", "EPIC"),
            "name": e.get("title") or e.get("name", "Epic"),
            "category": "Epic",
            "priority": e.get("priority", "medium"),
            "description": e.get("description", ""),
            "user_stories": [s.get("title") or s.get("story") or str(s) for s in _safe_list(e, "stories")][:12],
        })
    return features


def _api_documentation(req_list, services) -> Dict[str, Any]:
    endpoints: List[Dict[str, Any]] = []
    seen = set()
    for r in req_list:
        for ep in _safe_list((r.get("api_considerations") or {}), "endpoints"):
            key = (ep.get("method"), ep.get("path"))
            if key not in seen:
                seen.add(key)
                endpoints.append({
                    "method": ep.get("method"),
                    "path": ep.get("path"),
                    "description": ep.get("desc", ""),
                    "success": ep.get("success", "200 OK"),
                    "errors": ep.get("errors", "400, 401, 403"),
                    "auth": "Bearer JWT" if "/auth/login" not in (ep.get("path") or "") else "None (public)",
                })
    if not endpoints:
        # Derive a baseline CRUD surface per service
        for s in services:
            base = f"/api/{s.get('name','service').replace('-service','').replace('_','-')}"
            endpoints += [
                {"method": "GET", "path": base, "description": f"List resources in {s.get('name')}", "success": "200 OK", "errors": "401,403", "auth": "Bearer JWT"},
                {"method": "POST", "path": base, "description": f"Create a resource in {s.get('name')}", "success": "201 Created", "errors": "400,401,403,422", "auth": "Bearer JWT"},
            ]
    return {
        "conventions": [
            "RESTful resource-oriented URLs; JSON request/response bodies.",
            "Bearer JWT in the Authorization header for all non-public endpoints.",
            "Consistent error envelope: { code, message, fields }.",
            "Idempotency-Key header supported on POST/PATCH for safe retries.",
            "Cursor or offset pagination on list endpoints; standard filtering & sorting query params.",
            "Semantic versioning of the API via the /vN path prefix or Accept header.",
        ],
        "authentication": "OAuth2 password / JWT bearer tokens (HS256), 15-min access + rotating refresh tokens.",
        "endpoints": endpoints,
    }


def _database_schema(schema) -> Dict[str, Any]:
    tables = schema.get("tables") or schema.get("schema") or []
    out_tables = []
    for t in tables:
        out_tables.append({
            "name": t.get("name"),
            "columns": [
                {
                    "name": c.get("name"),
                    "type": c.get("type"),
                    "nullable": c.get("nullable", True),
                    "primary_key": c.get("primary_key", False),
                    "unique": c.get("unique", False),
                }
                for c in _safe_list(t, "columns")
            ],
        })
    return {
        "engine": "PostgreSQL 15 (ACID, row-level locking, JSONB support)",
        "tables": out_tables,
        "relationships": schema.get("relationships", []),
        "ddl": schema.get("sql_ddl", ""),
        "conventions": [
            "Surrogate primary keys (SERIAL/UUID); natural keys enforced via UNIQUE constraints.",
            "Foreign keys with explicit ON DELETE behavior; indexes on all FK columns.",
            "created_at / updated_at audit columns on mutable tables.",
            "Migrations are versioned and forward-only; no destructive changes without a backfill plan.",
        ],
    }


def _user_flows(req_list, epics) -> List[Dict[str, Any]]:
    flows = []
    for r in req_list:
        wf = r.get("workflow")
        if wf:
            flows.append({
                "name": r.get("description", "")[:70],
                "actor": "Authenticated User",
                "steps": wf,
            })
    if not flows:
        flows = [{
            "name": "Standard authenticated operation",
            "actor": "Authenticated User",
            "steps": [
                "User signs in and receives a session token.",
                "User navigates to the relevant module.",
                "User submits an action; the client validates and calls the API.",
                "The server authorizes, validates, and persists the change.",
                "The user receives confirmation and the UI updates.",
            ],
        }]
    return flows[:12]


def _security(sec, req_list) -> Dict[str, Any]:
    threats = _safe_list(sec, "threatModel")
    controls = _safe_list(sec, "controls") or _safe_list(sec, "recommendations")
    return {
        "authentication": "JWT bearer tokens; bcrypt/argon2 password hashing; optional MFA.",
        "authorization": "Role-based access control enforced server-side on every endpoint.",
        "data_protection": [
            "TLS 1.2+ for all data in transit.",
            "AES-256 encryption at rest for sensitive fields and backups.",
            "Secrets stored in a managed secrets vault, never in source or logs.",
        ],
        "application_security": [
            "OWASP Top 10 mitigations (injection, XSS, CSRF, SSRF, broken access control).",
            "Parameterized queries / ORM; output encoding; strict CORS policy.",
            "Rate limiting and account lockout to resist brute force.",
            "Security headers: HSTS, CSP, X-Content-Type-Options, X-Frame-Options.",
        ],
        "threat_model": threats,
        "controls": controls,
        "audit": "All security-relevant events are logged immutably with actor, action, and timestamp.",
    }


def _integrations(components, services) -> List[Dict[str, Any]]:
    ext = [c for c in components if c.get("type") == "external"]
    integrations = [{
        "name": c.get("name"),
        "type": "External System",
        "technology": c.get("technology", ""),
        "pattern": "REST/webhook with retry and circuit-breaker; credentials from secrets vault.",
    } for c in ext]
    integrations += [
        {"name": "Identity Provider", "type": "Auth", "technology": "OAuth2/OIDC", "pattern": "Token issuance & validation."},
        {"name": "Email/SMS Gateway", "type": "Notification", "technology": "SMTP/Provider API", "pattern": "Async via message queue."},
        {"name": "Object Storage", "type": "Storage", "technology": "S3-compatible", "pattern": "Pre-signed URLs for upload/download."},
        {"name": "Observability", "type": "Monitoring", "technology": "Prometheus/Grafana/ELK", "pattern": "Metrics, logs, traces."},
    ]
    return integrations


def _microservices(services) -> Dict[str, Any]:
    if not services:
        return {
            "applicable": False,
            "note": "The platform uses a modular monolith; bounded contexts are separated by module and can be extracted into services as scale requires.",
            "services": [],
        }
    return {
        "applicable": True,
        "communication": "Synchronous REST for queries; asynchronous events over a message bus for cross-service workflows.",
        "data_ownership": "Each service owns its schema; no shared database tables across services.",
        "resilience": "Timeouts, retries with backoff, circuit breakers, and idempotent handlers.",
        "services": [
            {
                "name": s.get("name"),
                "responsibility": s.get("responsibility", ""),
                "technology": s.get("technology", ""),
                "port": s.get("port"),
            }
            for s in services
        ],
    }


def _error_handling() -> Dict[str, Any]:
    return {
        "strategy": "Fail fast with structured, actionable errors; never leak internal details to clients.",
        "error_envelope": {"code": "MACHINE_READABLE_CODE", "message": "Human-readable summary", "fields": {"field": "reason"}},
        "http_mapping": [
            {"status": "400 Bad Request", "when": "Malformed request or invalid parameters."},
            {"status": "401 Unauthorized", "when": "Missing/invalid authentication."},
            {"status": "403 Forbidden", "when": "Authenticated but not authorized."},
            {"status": "404 Not Found", "when": "Resource does not exist or is not visible to the caller."},
            {"status": "409 Conflict", "when": "State conflict (duplicate, version mismatch)."},
            {"status": "422 Unprocessable Entity", "when": "Validation failure with field-level detail."},
            {"status": "429 Too Many Requests", "when": "Rate limit exceeded; includes Retry-After."},
            {"status": "500 Internal Server Error", "when": "Unexpected failure; correlation id returned for support."},
        ],
        "practices": [
            "Every response carries a correlation/request id for tracing.",
            "Retries are safe via idempotency keys on mutating endpoints.",
            "Transient failures use exponential backoff; permanent failures surface immediately.",
            "Unhandled exceptions are caught by a global handler that logs and returns a generic 500.",
        ],
    }


def _deployment_architecture(tech_stack) -> Dict[str, Any]:
    return {
        "topology": "Containerised services on Kubernetes behind a load balancer, across multiple availability zones.",
        "environments": ["local", "development", "staging", "production"],
        "cicd": [
            "Trunk-based development with short-lived feature branches.",
            "CI runs lint, type-check, unit + integration tests, and security scans on every PR.",
            "Immutable container images tagged by commit SHA; promoted through environments.",
            "Progressive delivery (blue/green or canary) with automated rollback on health-check failure.",
        ],
        "infrastructure": [
            "Managed PostgreSQL with automated backups and a read replica.",
            "Redis for cache/session; object storage for files.",
            "Ingress with TLS termination, WAF, and CDN at the edge.",
            "Infrastructure defined as code (Terraform); secrets from a managed vault.",
        ],
        "scaling": "Stateless services scale horizontally via HPA on CPU/latency; the database scales vertically with read replicas.",
    }


def _testing_strategy(req_list) -> Dict[str, Any]:
    return {
        "pyramid": [
            {"level": "Unit", "coverage_target": "80%+", "scope": "Pure functions, domain logic, validators."},
            {"level": "Integration", "coverage_target": "Key paths", "scope": "Service ↔ database, service ↔ service, API contracts."},
            {"level": "End-to-End", "coverage_target": "Critical journeys", "scope": "User-facing flows through the real UI/API."},
        ],
        "additional": [
            "Contract tests for external integrations.",
            "Load/performance tests validating NFR latency & throughput targets.",
            "Security testing: SAST, dependency scanning, and periodic DAST/pen-tests.",
            "Accessibility testing to WCAG 2.1 AA.",
        ],
        "acceptance_source": f"Acceptance criteria are derived from the {len(req_list)} documented requirements and their Given/When/Then specs.",
        "gates": "A change may not merge unless all tests pass and coverage thresholds are met.",
    }


def _nfr(arch, req_list) -> List[Dict[str, str]]:
    return [
        {"attribute": "Performance", "target": "p95 API latency < 300ms; p99 < 1s under expected load."},
        {"attribute": "Availability", "target": "99.9% monthly uptime; graceful degradation on dependency failure."},
        {"attribute": "Scalability", "target": "Horizontally scalable stateless services; supports 10x traffic growth."},
        {"attribute": "Security", "target": "OWASP ASVS L2; encrypted in transit and at rest; least-privilege access."},
        {"attribute": "Maintainability", "target": "Modular codebase, 80%+ test coverage, documented APIs."},
        {"attribute": "Observability", "target": "Structured logs, RED/USE metrics, distributed tracing, alerting on SLOs."},
        {"attribute": "Compliance", "target": "Auditable trails; data retention & privacy per applicable regulations."},
        {"attribute": "Accessibility", "target": "WCAG 2.1 AA across all user-facing surfaces."},
    ]


def _roadmap() -> List[Dict[str, Any]]:
    return [
        {"phase": "Phase 1 — Foundation", "duration": "Weeks 1-4", "items": [
            "Project scaffolding, CI/CD pipeline, environments.",
            "Authentication & authorization, core data model, base API.",
        ]},
        {"phase": "Phase 2 — Core Features", "duration": "Weeks 5-10", "items": [
            "Implement primary domain modules and their APIs/UIs.",
            "Integration tests, initial performance baselines.",
        ]},
        {"phase": "Phase 3 — Hardening", "duration": "Weeks 11-14", "items": [
            "Security review & pen-test remediation.",
            "Load testing, observability, and SLO alerting.",
        ]},
        {"phase": "Phase 4 — Launch", "duration": "Weeks 15-16", "items": [
            "UAT, documentation finalization, staging sign-off.",
            "Production rollout with progressive delivery and rollback plan.",
        ]},
        {"phase": "Phase 5 — Evolve", "duration": "Ongoing", "items": [
            "Feature iteration from user feedback and analytics.",
            "Scale services, optimize cost, extend integrations.",
        ]},
    ]


# ─── Orchestrator ─────────────────────────────────────────────────────────────

def build_technical_documentation(artifacts, project_name: str, description: str = "") -> Dict[str, Any]:
    art = _load_artifacts(artifacts)
    reqs = art.get("requirements_doc", {})
    ba = art.get("user_stories", {})
    arch = art.get("architecture_diagram", {})
    schema = art.get("sql_schema", {})
    sec = art.get("security_report", {})

    req_list = _safe_list(reqs, "requirements")
    epics = _safe_list(ba, "epics")
    components = _safe_list(arch, "components")
    services = _safe_list(arch, "microservices")
    tech_stack = arch.get("tech_stack", {}) if isinstance(arch, dict) else {}

    return {
        "generated_for": project_name,
        "overview": _overview(project_name, description, arch, tech_stack, req_list),
        "module_breakdown": _module_breakdown(components, services, req_list),
        "feature_specifications": _feature_specifications(req_list, epics),
        "api_documentation": _api_documentation(req_list, services),
        "database_schema": _database_schema(schema),
        "user_flows": _user_flows(req_list, epics),
        "security": _security(sec, req_list),
        "integrations": _integrations(components, services),
        "microservices": _microservices(services),
        "error_handling": _error_handling(),
        "deployment_architecture": _deployment_architecture(tech_stack),
        "testing_strategy": _testing_strategy(req_list),
        "non_functional_requirements": _nfr(arch, req_list),
        "development_roadmap": _roadmap(),
    }
