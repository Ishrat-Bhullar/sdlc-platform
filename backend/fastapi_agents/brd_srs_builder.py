"""
brd_srs_builder.py
==================
Generates rich, client-ready BRD and SRS documents from SDLC artifacts.

Both documents are returned as structured dicts that the API serialises
as JSON. The frontend DocumentationCenter renders them as formatted
markdown / structured views.
"""
from __future__ import annotations

import json
from .logging_config import get_logger
from datetime import datetime
from typing import Any, Dict, List

logger = get_logger(__name__)


def _safe_list(obj: Any, key: str = "") -> list:
    if obj is None:
        return []
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict) and key:
        return obj.get(key, [])
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


# ─────────────────────────────────────────────────────────────────────────────
# BRD Builder
# ─────────────────────────────────────────────────────────────────────────────

def build_brd(artifacts, project_name: str, project_description: str = "") -> Dict[str, Any]:
    """
    Build a Business Requirements Document from SDLC artifacts.
    Returns a structured dict with all BRD sections.
    """
    art = _load_artifacts(artifacts)
    reqs = art.get("requirements_doc", {})
    ba = art.get("user_stories", {})
    arch = art.get("architecture_diagram", {})
    sec = art.get("security_report", {})
    comp = art.get("compliance_report", {})
    test = art.get("test_report", {})

    req_list = _safe_list(reqs, "requirements")
    epics = _safe_list(ba, "epics")
    components = _safe_list(arch, "components")
    standards = _safe_list((comp.get("complianceAssessment") or {}).get("standards", []))
    threats = _safe_list(sec.get("threatModel", []))
    risks = _safe_list(reqs.get("risks", []))
    assumptions = _safe_list(reqs.get("assumptions", []))

    # Extract functional vs non-functional
    func_reqs = [r for r in req_list if isinstance(r, dict) and "non" not in r.get("category", "").lower()]
    nonfunc_reqs = [r for r in req_list if isinstance(r, dict) and "non" in r.get("category", "").lower()]
    critical_reqs = [r for r in req_list if isinstance(r, dict) and r.get("priority", "").lower() == "critical"]

    # Build user journeys from epics
    user_journeys = []
    for epic in epics[:5]:
        if isinstance(epic, dict):
            stories = _safe_list(epic, "stories")
            journey_steps = []
            for s in stories[:4]:
                if isinstance(s, dict):
                    role = s.get("role", "user")
                    goal = s.get("goal", "")
                    benefit = s.get("benefit", "")
                    if goal:
                        journey_steps.append(f"As a {role}, I want to {goal} so that {benefit}")
            user_journeys.append({
                "journey": epic.get("title", ""),
                "description": epic.get("description", ""),
                "steps": journey_steps,
            })

    date_str = datetime.now().strftime("%B %d, %Y")

    return {
        "document_type": "BRD",
        "title": f"Business Requirements Document — {project_name}",
        "version": "1.0",
        "status": "APPROVED",
        "date": date_str,
        "classification": "CONFIDENTIAL",

        "executive_summary": {
            "overview": (
                f"{project_name} is an AI-generated enterprise software solution designed to address "
                f"{project_description or 'the identified business needs'}. "
                "This Business Requirements Document defines the complete set of business, functional, "
                "and non-functional requirements that govern the delivery of the solution. "
                "It serves as the primary contractual reference between the business stakeholders and "
                "the delivery team, and must be approved by all signatories before development commences."
            ),
            "key_objectives": [
                "Automate and streamline the target business process to reduce manual effort by 60%+",
                "Provide a single source of truth for all relevant business data and decisions",
                "Enable real-time visibility into operations through dashboards and reporting",
                "Enforce governance, compliance, and audit controls across all user actions",
                "Deliver a scalable, secure platform that supports future business growth",
            ],
            "success_metrics": [
                {"metric": "Reduction in manual processing time", "target": "≥ 60%", "measurement": "Baseline vs. post-go-live comparison"},
                {"metric": "System availability (SLA)", "target": "99.9% uptime", "measurement": "Monitoring dashboards"},
                {"metric": "User adoption rate", "target": "≥ 80% within 90 days", "measurement": "Login and active session analytics"},
                {"metric": "Defect escape rate", "target": "< 2 P1/P2 per quarter", "measurement": "Production incident log"},
                {"metric": "Compliance audit pass rate", "target": "100%", "measurement": "Annual external audit"},
            ],
        },

        "scope": {
            "in_scope": [
                "Core business workflow automation and digitisation",
                "User authentication, authorisation, and session management",
                "Role-based access control (RBAC) with granular permissions",
                "Dashboard, reporting, and analytics capabilities",
                "Audit trail and compliance logging for all user actions",
                "API integration layer for third-party system connectivity",
                "Data export capabilities (CSV, PDF, JSON)",
                "Admin console for user and system management",
            ],
            "out_of_scope": [
                "Legacy system decommissioning (separate project)",
                "Data migration from existing systems (addressed in migration plan)",
                "Mobile native applications (Phase 2 deliverable)",
                "Third-party system re-architecting",
                "Hardware procurement and network infrastructure",
            ],
        },

        "stakeholders": [
            {"role": "Executive Sponsor", "responsibility": "Strategic direction and funding approval", "approval_authority": True},
            {"role": "Product Owner", "responsibility": "Requirements prioritisation and backlog management", "approval_authority": True},
            {"role": "Business Analyst", "responsibility": "Requirements elicitation, documentation, and sign-off", "approval_authority": True},
            {"role": "Solution Architect", "responsibility": "Technical design and architecture governance", "approval_authority": False},
            {"role": "Security Officer", "responsibility": "Security requirements and compliance validation", "approval_authority": True},
            {"role": "End Users", "responsibility": "UAT participation and feedback", "approval_authority": False},
            {"role": "IT Operations", "responsibility": "Infrastructure, deployment, and support", "approval_authority": False},
        ],

        "functional_requirements": [
            {
                "id": r.get("id", f"FR-{i+1:03d}"),
                "description": r.get("description", ""),
                "category": r.get("category", "Functional"),
                "priority": r.get("priority", "High"),
                "risk_level": r.get("risk_level", "Medium"),
                "rationale": f"Required to support core business workflow for {project_name}",
                "acceptance_criteria": f"Given the system is running, when a user performs the required action, then {r.get('description', 'the expected outcome')} completes successfully.",
            }
            for i, r in enumerate(func_reqs[:15])
        ] or [
            {"id": "FR-001", "description": "Users must be able to authenticate using email and password with MFA support", "category": "Functional", "priority": "Critical", "risk_level": "Low", "rationale": "Security baseline requirement", "acceptance_criteria": "Given valid credentials, when a user authenticates, then a session is created and MFA challenge is presented"},
            {"id": "FR-002", "description": "Authenticated users must see a real-time dashboard of relevant business data", "category": "Functional", "priority": "High", "risk_level": "Low", "rationale": "Core value proposition", "acceptance_criteria": "Given an authenticated session, when the dashboard loads, then all KPIs refresh within 2 seconds"},
            {"id": "FR-003", "description": "The system must maintain an immutable audit trail of all user actions", "category": "Compliance", "priority": "Critical", "risk_level": "High", "rationale": "Regulatory compliance requirement", "acceptance_criteria": "Given any user action, when the action completes, then an audit record is created with timestamp, user, action, and outcome"},
            {"id": "FR-004", "description": "Administrators must be able to manage users, roles, and permissions", "category": "Functional", "priority": "High", "risk_level": "Medium", "rationale": "Operational necessity", "acceptance_criteria": "Given admin privileges, when a user is created or modified, then changes take effect immediately"},
            {"id": "FR-005", "description": "Users must be able to export data in CSV, PDF, and JSON formats", "category": "Functional", "priority": "Medium", "risk_level": "Low", "rationale": "Business reporting requirement", "acceptance_criteria": "Given data in the system, when a user requests export, then the file downloads in the selected format within 30 seconds"},
        ],

        "non_functional_requirements": nonfunc_reqs[:10] or [
            {"id": "NFR-001", "category": "Performance", "description": "API response time must be < 200ms at p95 under normal load", "priority": "High"},
            {"id": "NFR-002", "category": "Scalability", "description": "System must support 10,000 concurrent users without degradation", "priority": "High"},
            {"id": "NFR-003", "category": "Availability", "description": "99.9% uptime SLA (< 8.7 hours downtime per year)", "priority": "Critical"},
            {"id": "NFR-004", "category": "Security", "description": "All data encrypted at rest (AES-256) and in transit (TLS 1.3)", "priority": "Critical"},
            {"id": "NFR-005", "category": "Maintainability", "description": "Code coverage minimum 80% with automated testing in CI/CD", "priority": "High"},
            {"id": "NFR-006", "category": "Usability", "description": "WCAG 2.1 AA accessibility compliance for all UI components", "priority": "High"},
            {"id": "NFR-007", "category": "Compliance", "description": f"Adherence to {', '.join(str(s) for s in standards[:3]) or 'SOC 2, ISO 27001, GDPR'}", "priority": "Critical"},
        ],

        "business_rules": [
            {"id": "BR-001", "rule": "A user may not have more than one active session simultaneously (single-session policy)"},
            {"id": "BR-002", "rule": "All approvals must be recorded with approver identity, timestamp, and rationale"},
            {"id": "BR-003", "rule": "Data must be retained for a minimum of 7 years per regulatory requirements"},
            {"id": "BR-004", "rule": "Password must be at least 12 characters and changed every 90 days"},
            {"id": "BR-005", "rule": "Access to sensitive data requires approval from a supervisor-level role"},
            {"id": "BR-006", "rule": "System-generated reports must carry a digital watermark and generation timestamp"},
            {"id": "BR-007", "rule": "API rate limits must be enforced: 1000 requests/minute per authenticated client"},
        ],

        "user_journeys": user_journeys or [
            {
                "journey": "User Onboarding",
                "description": "New user registers and completes initial system setup",
                "steps": [
                    "Admin creates user account with assigned role",
                    "User receives invitation email with secure setup link",
                    "User sets password and configures MFA",
                    "User completes profile and preference setup",
                    "User is redirected to personalised dashboard",
                ],
            },
            {
                "journey": "Core Workflow Execution",
                "description": "User performs the primary business process end-to-end",
                "steps": [
                    "User logs in and navigates to the relevant workspace",
                    "User initiates the primary business action",
                    "System validates inputs and applies business rules",
                    "Workflow progresses through required approval stages",
                    "System records outcome in audit trail and notifies stakeholders",
                ],
            },
        ],

        "risks": risks or [
            {"id": "RISK-001", "description": "Scope creep expanding v1 beyond agreed boundaries", "likelihood": "Medium", "impact": "High", "mitigation": "Strict change control process with steering committee approval required"},
            {"id": "RISK-002", "description": "Integration complexity with legacy systems", "likelihood": "Low", "impact": "High", "mitigation": "Dedicated integration spike in first sprint, fallback to file-based exchange"},
            {"id": "RISK-003", "description": "Regulatory requirements changing during delivery", "likelihood": "Low", "impact": "Critical", "mitigation": "Monthly compliance review with legal and compliance team"},
            {"id": "RISK-004", "description": "Key stakeholder availability for UAT", "likelihood": "Medium", "impact": "Medium", "mitigation": "Schedule UAT dates in project kickoff, identify backup approvers"},
        ],

        "assumptions": assumptions or [
            "Business stakeholders will be available for weekly reviews and sign-offs throughout the project",
            "Existing infrastructure (servers, network, databases) meets the minimum specifications defined in the architecture",
            "Third-party APIs required for integration will be available in a non-production environment by week 3",
            "The data migration approach and any required data cleansing will be agreed within the first two weeks",
            "User acceptance testing resources (business SMEs) will be available for a minimum of 2 weeks",
            "Security scanning tools (SAST/DAST) will be procured and configured by the development team",
        ],

        "dependencies": [
            {"dependency": "Identity Provider (IdP) / SSO platform", "owner": "IT Security", "required_by": "Week 3"},
            {"dependency": "Cloud infrastructure provisioned", "owner": "IT Operations", "required_by": "Week 2"},
            {"dependency": "Third-party API credentials and documentation", "owner": "Vendor", "required_by": "Week 3"},
            {"dependency": "Test data set approved by Data Governance", "owner": "Data Team", "required_by": "Week 4"},
            {"dependency": "UAT environment configured and accessible", "owner": "IT Operations", "required_by": "Week 8"},
        ],

        "approval_matrix": [
            {"section": "Executive Summary & Scope", "approver": "Executive Sponsor", "status": "APPROVED"},
            {"section": "Functional Requirements", "approver": "Product Owner", "status": "APPROVED"},
            {"section": "Non-Functional Requirements", "approver": "Solution Architect", "status": "APPROVED"},
            {"section": "Security Requirements", "approver": "Security Officer", "status": "APPROVED"},
            {"section": "Full Document", "approver": "All Stakeholders", "status": "APPROVED"},
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# SRS Builder
# ─────────────────────────────────────────────────────────────────────────────

def build_srs(artifacts, project_name: str, project_description: str = "") -> Dict[str, Any]:
    """
    Build a System Requirements Specification from SDLC artifacts.
    Returns a structured dict with all SRS sections.
    """
    art = _load_artifacts(artifacts)
    reqs = art.get("requirements_doc", {})
    arch = art.get("architecture_diagram", {})
    schema = art.get("sql_schema", {})
    api_d = art.get("api_design", {})
    sec = art.get("security_report", {})
    comp = art.get("compliance_report", {})
    test = art.get("test_report", {})
    backend = art.get("backend_code", {})
    react = art.get("react_code", {})

    req_list = _safe_list(reqs, "requirements")
    components = _safe_list(arch, "components")
    tables = _safe_list(schema, "tables")
    endpoints = _safe_list(api_d, "endpoints")
    threats = _safe_list(sec.get("threatModel", []))
    standards = _safe_list((comp.get("complianceAssessment") or {}).get("standards", []))
    suites = _safe_list(test, "suites")
    coverage = test.get("coverage_targets", {}) or {}

    date_str = datetime.now().strftime("%B %d, %Y")
    fe_fw = react.get("framework", "React 18 + TypeScript")
    be_fw = backend.get("framework", "FastAPI + SQLAlchemy")

    return {
        "document_type": "SRS",
        "title": f"System Requirements Specification — {project_name}",
        "version": "1.0",
        "status": "APPROVED",
        "date": date_str,
        "classification": "CONFIDENTIAL",

        "system_overview": {
            "description": (
                f"{project_name} is a cloud-native, AI-generated enterprise platform. "
                f"{project_description or 'The system automates and digitises the core business workflow '}"
                "through a secure, scalable multi-tier architecture comprising a React SPA frontend, "
                f"a {be_fw} REST API backend, PostgreSQL database, and Redis cache layer. "
                "All components are containerised and deployed on Kubernetes."
            ),
            "architecture_pattern": arch.get("pattern", "Layered / Modular Monolith"),
            "technology_stack": {
                "frontend": fe_fw,
                "backend": be_fw,
                "database": "PostgreSQL 15",
                "cache": "Redis 7",
                "infrastructure": "Docker + Kubernetes (AWS EKS)",
                "ci_cd": "GitHub Actions + ArgoCD",
                "monitoring": "Prometheus + Grafana + OpenTelemetry",
            },
            "system_boundaries": [
                "Web browser clients (Chrome, Firefox, Safari, Edge — latest 2 versions)",
                "REST API over HTTPS — consumed by frontend and third-party integrators",
                "PostgreSQL database — primary persistence layer (managed AWS RDS)",
                "Redis — session store, cache, and async job queue",
                "External identity provider (SAML/OIDC) — optional SSO integration",
                "Email / notification service — SendGrid or AWS SES",
                "Cloud storage — AWS S3 for document and file storage",
            ],
        },

        "functional_requirements": [
            {
                "id": r.get("id", f"SFR-{i+1:03d}"),
                "description": r.get("description", ""),
                "category": r.get("category", "Functional"),
                "priority": r.get("priority", "High"),
                "system_response": f"The system SHALL {r.get('description', '').lower().rstrip('.')} and return a 200 OK response with the operation result.",
                "input": "Valid authenticated HTTP request with required parameters",
                "output": "JSON response with result data and HTTP status code",
                "error_handling": "Return appropriate 4xx/5xx with structured error envelope",
            }
            for i, r in enumerate(req_list[:12])
        ] or [
            {"id": "SFR-001", "description": "User authentication", "category": "Security", "priority": "Critical", "system_response": "System SHALL authenticate users via email/password with bcrypt hashing and issue an HttpOnly session cookie", "input": "POST /auth/login {email, password}", "output": "200 OK {user_id, role, session_id}", "error_handling": "401 Unauthorized with lockout after 5 failed attempts"},
            {"id": "SFR-002", "description": "RBAC enforcement", "category": "Security", "priority": "Critical", "system_response": "System SHALL validate user role against required permission on every protected endpoint", "input": "Any authenticated request", "output": "Resource response or 403 Forbidden", "error_handling": "403 Forbidden with reason code"},
            {"id": "SFR-003", "description": "Audit logging", "category": "Compliance", "priority": "Critical", "system_response": "System SHALL record every state-changing operation with actor, timestamp, action, and outcome", "input": "Any write operation", "output": "Audit event persisted to immutable log", "error_handling": "If audit write fails, operation is rolled back"},
        ],

        "non_functional_requirements": {
            "performance": {
                "api_response_time": "< 200ms p95 under normal load (< 1000 concurrent users)",
                "api_response_time_peak": "< 500ms p99 under peak load (10,000 concurrent users)",
                "page_load_time": "< 2 seconds Time-to-Interactive (TI) on broadband",
                "database_query_time": "< 50ms for indexed queries, < 500ms for aggregations",
                "file_export": "< 30 seconds for exports of up to 100,000 records",
                "batch_processing": "Background jobs must complete within 5 minutes for standard workloads",
            },
            "scalability": {
                "concurrent_users": "10,000 authenticated concurrent users",
                "data_volume": "Up to 50 million records per tenant without performance degradation",
                "horizontal_scaling": "Stateless API pods scalable via Kubernetes HPA",
                "storage": "Unlimited S3 object storage with lifecycle management",
            },
            "availability": {
                "sla": "99.9% uptime (< 8.76 hours downtime/year)",
                "rto": "Recovery Time Objective: < 30 minutes",
                "rpo": "Recovery Point Objective: < 1 hour (hourly database snapshots)",
                "maintenance_windows": "Rolling deployments — zero planned downtime",
                "geo_redundancy": "Multi-AZ deployment (primary) + cross-region backup",
            },
            "security": {
                "authentication": "OAuth 2.0 / OIDC + MFA (TOTP/SMS)",
                "authorisation": "RBAC with attribute-based access control (ABAC) extension",
                "encryption_transit": "TLS 1.3 minimum; TLS 1.0/1.1 disabled",
                "encryption_rest": "AES-256 for all PII and sensitive data",
                "secrets_management": "AWS Secrets Manager with automatic rotation",
                "vulnerability_scanning": "SAST (Semgrep/Bandit) + DAST (OWASP ZAP) in CI/CD",
                "pen_testing": "Annual external penetration test",
                "session_management": "HttpOnly, Secure, SameSite=Strict cookies; 30-min idle timeout",
            },
            "compliance": {
                "standards": standards or ["SOC 2 Type II", "ISO 27001", "GDPR", "OWASP ASVS L2"],
                "data_residency": "Data stored within specified geographic region (configurable)",
                "data_retention": "7-year retention for audit records; configurable for business data",
                "right_to_erasure": "GDPR Article 17 — user data deletion within 30 days of request",
                "audit_trail": "Immutable, tamper-evident audit log for all state changes",
            },
            "maintainability": {
                "code_coverage": f"Backend: {coverage.get('backend', 85)}%, Frontend: {coverage.get('frontend', 80)}%",
                "documentation": "OpenAPI 3.0 spec auto-generated; ADRs for all architecture decisions",
                "dependency_management": "Automated Dependabot PRs for security patches",
                "tech_debt": "Tech debt reviewed in every quarterly architecture review",
            },
        },

        "api_specification": {
            "base_url": "https://api.{domain}/v1",
            "authentication": "Cookie-based session (HttpOnly) + CSRF token",
            "content_type": "application/json",
            "rate_limiting": "1000 requests/minute per authenticated user; 100/minute unauthenticated",
            "versioning": "URI versioning (/v1/...); breaking changes require new major version",
            "error_format": {
                "schema": {"detail": "string", "code": "string", "request_id": "uuid"},
                "example": {"detail": "Resource not found", "code": "RESOURCE_NOT_FOUND", "request_id": "abc-123"},
            },
            "endpoints": [
                {
                    "method": ep.get("method", "GET").upper(),
                    "path": ep.get("path", "/api/v1/resource"),
                    "description": ep.get("description", ep.get("purpose", "")),
                    "auth_required": True,
                    "rate_limit": "1000/min",
                    "response_codes": ["200", "400", "401", "403", "404", "500"],
                }
                for ep in endpoints[:10]
            ] or [
                {"method": "POST", "path": "/auth/login", "description": "Authenticate user", "auth_required": False, "rate_limit": "10/min", "response_codes": ["200", "401", "429"]},
                {"method": "GET", "path": "/projects", "description": "List all projects", "auth_required": True, "rate_limit": "1000/min", "response_codes": ["200", "401"]},
                {"method": "POST", "path": "/projects", "description": "Create project", "auth_required": True, "rate_limit": "100/min", "response_codes": ["201", "400", "401"]},
                {"method": "GET", "path": "/projects/{id}/artifacts", "description": "List artifacts", "auth_required": True, "rate_limit": "1000/min", "response_codes": ["200", "401", "404"]},
            ],
        },

        "database_specification": {
            "dbms": "PostgreSQL 15",
            "schema_version": "1.0.0",
            "normalisation": "Third Normal Form (3NF)",
            "row_level_security": True,
            "indexing_strategy": "B-tree indexes on all foreign keys and high-cardinality filter columns",
            "backup_strategy": "Automated daily snapshots + point-in-time recovery (PITR) for 35 days",
            "tables": [
                {
                    "name": t.get("name", ""),
                    "columns": len(_safe_list(t, "columns")),
                    "primary_key": next((c.get("name") for c in _safe_list(t, "columns") if isinstance(c, dict) and c.get("primary_key")), "id"),
                    "foreign_keys": len([c for c in _safe_list(t, "columns") if isinstance(c, dict) and c.get("foreign_key")]),
                    "purpose": f"Stores {t.get('name', 'entity').replace('_', ' ')} records",
                }
                for t in tables[:10]
            ] or [
                {"name": "users", "columns": 12, "primary_key": "id", "foreign_keys": 0, "purpose": "Stores user identity and profile data"},
                {"name": "sessions", "columns": 6, "primary_key": "id", "foreign_keys": 1, "purpose": "Tracks authenticated sessions"},
                {"name": "projects", "columns": 9, "primary_key": "id", "foreign_keys": 1, "purpose": "Stores project metadata"},
                {"name": "artifacts", "columns": 8, "primary_key": "id", "foreign_keys": 2, "purpose": "Stores generated SDLC artifacts"},
                {"name": "audit_events", "columns": 10, "primary_key": "id", "foreign_keys": 2, "purpose": "Immutable audit trail"},
            ],
        },

        "security_requirements": {
            "threat_model": threats or [
                "Credential stuffing / brute force attacks",
                "SQL injection via unparameterised queries",
                "XSS / CSRF in web interface",
                "Broken access control (IDOR)",
                "Sensitive data exposure in logs or error messages",
                "Dependency chain compromise (supply chain attack)",
                "Session hijacking via cookie theft",
                "Insecure direct object references",
            ],
            "security_controls": [
                {"control": "Input validation", "implementation": "Pydantic schemas on all API inputs; parameterised queries (SQLAlchemy ORM)"},
                {"control": "Output encoding", "implementation": "React JSX auto-escaping; CSP header enforced"},
                {"control": "Authentication", "implementation": "bcrypt password hashing (cost factor 12); TOTP/SMS MFA"},
                {"control": "Authorisation", "implementation": "RBAC middleware on every protected route; permission checked server-side"},
                {"control": "Session security", "implementation": "HttpOnly Secure SameSite=Strict cookies; 30-min idle timeout; single active session"},
                {"control": "HTTPS enforcement", "implementation": "TLS 1.3; HSTS header with 1-year max-age; redirect HTTP → HTTPS"},
                {"control": "Rate limiting", "implementation": "Per-endpoint limits in API gateway; IP-based and user-based counters in Redis"},
                {"control": "Dependency scanning", "implementation": "Dependabot + Trivy in CI; critical vulnerabilities block merge"},
                {"control": "Secret management", "implementation": "No secrets in code; AWS Secrets Manager with IAM roles; automatic rotation"},
                {"control": "Logging & monitoring", "implementation": "Structured JSON logs; SIEM integration; anomaly alerting within 5 minutes"},
            ],
        },

        "error_handling": {
            "error_format": {"detail": "Human-readable message", "code": "Machine-readable error code", "request_id": "UUID for correlation"},
            "http_status_codes": {
                "200": "Success — response body contains result",
                "201": "Resource created — Location header set",
                "400": "Validation error — invalid request body or parameters",
                "401": "Unauthenticated — session missing or expired",
                "403": "Unauthorised — insufficient permissions",
                "404": "Not found — resource does not exist",
                "409": "Conflict — duplicate resource or state violation",
                "422": "Unprocessable entity — semantic validation failed",
                "429": "Rate limit exceeded — retry after N seconds",
                "500": "Internal server error — logged and alerted",
                "503": "Service unavailable — maintenance or overload",
            },
            "retry_strategy": "Exponential backoff with jitter for 429 and 503 responses; max 3 retries",
            "circuit_breaker": "Open circuit after 5 consecutive failures; half-open after 30 seconds",
        },

        "testing_requirements": {
            "test_suites": suites or [
                "Unit Tests — business logic and utility functions",
                "Integration Tests — API endpoints with real database",
                "E2E Tests — critical user journeys with Playwright",
                "Security Tests — OWASP ZAP DAST scan",
                "Performance Tests — k6 load test at 10x expected load",
                "Accessibility Tests — axe-core on all UI screens",
            ],
            "coverage_targets": {
                "backend": coverage.get("backend", 85),
                "frontend": coverage.get("frontend", 80),
                "integration": 70,
                "e2e_critical_paths": 100,
            },
            "quality_gates": [
                "No P0/P1 security vulnerabilities in production",
                "All unit and integration tests passing before merge",
                "Code coverage must not decrease below target on any PR",
                "Performance tests must pass at 2x expected concurrent load",
                "Accessibility audit score ≥ 95 on all UI screens",
            ],
        },

        "acceptance_criteria": [
            {"id": "AC-001", "requirement": "Authentication", "criteria": "User can log in with valid credentials and is redirected to dashboard within 2 seconds; invalid credentials show error without revealing which field is wrong"},
            {"id": "AC-002", "requirement": "Authorisation", "criteria": "A user without required permissions receives 403; no data leaks in error response"},
            {"id": "AC-003", "requirement": "Audit trail", "criteria": "Every write operation creates an audit record visible to admins; records cannot be deleted or modified"},
            {"id": "AC-004", "requirement": "Performance", "criteria": "95th percentile API response time < 200ms under load test with 1,000 concurrent users"},
            {"id": "AC-005", "requirement": "Data export", "criteria": "Export of 10,000 records completes in < 30 seconds and produces a valid file in the requested format"},
            {"id": "AC-006", "requirement": "Accessibility", "criteria": "All screens pass WCAG 2.1 AA criteria as validated by axe-core automated scan"},
            {"id": "AC-007", "requirement": "Security scan", "criteria": "SAST and DAST scans produce zero critical or high vulnerabilities"},
            {"id": "AC-008", "requirement": "Availability", "criteria": "System achieves 99.9% uptime over 30-day monitoring period in staging environment"},
        ],

        "traceability_matrix": [
            {"brd_req": r.get("id", f"FR-{i+1:03d}"), "srs_req": f"SFR-{i+1:03d}", "test_case": f"TC-{i+1:03d}", "status": "Covered"}
            for i, r in enumerate(req_list[:10])
        ] or [
            {"brd_req": "FR-001", "srs_req": "SFR-001", "test_case": "TC-001", "status": "Covered"},
            {"brd_req": "FR-002", "srs_req": "SFR-002", "test_case": "TC-002", "status": "Covered"},
            {"brd_req": "FR-003", "srs_req": "SFR-003", "test_case": "TC-003", "status": "Covered"},
        ],
    }
