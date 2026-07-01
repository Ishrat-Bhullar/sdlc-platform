"""
requirement_enricher.py
─────────────────────────────────────────────────────────────────────────────
Deterministic, fully-local enrichment of shallow requirements into
implementation-ready specifications.

Given a short requirement (id, description, category, priority) plus project
context (DB schema, architecture components), produce a rich spec with:
  business_rules, edge_cases, validations, workflow, acceptance_criteria,
  api_considerations, ui_behavior, db_impact, dependencies, constraints,
  assumptions, nfr_targets

No LLM / paid APIs — pattern-based inference. Every requirement gets a
substantive, developer-actionable expansion.

Public API:
    enrich_requirements(reqs, schema, arch) -> list[enriched dict]
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


# ─── Keyword → intent detection ───────────────────────────────────────────────

INTENT_PATTERNS = {
    "auth":         r"\b(authenticat|login|log ?in|sign ?in|password|credential|token|session|mfa|2fa|otp)\b",
    "authorize":    r"\b(authoriz|permission|role|rbac|access control|privilege)\b",
    "create":       r"\b(create|add|register|new|onboard|submit|insert)\b",
    "read":         r"\b(view|display|show|list|retrieve|fetch|read|browse)\b",
    "update":       r"\b(update|edit|modify|change|amend)\b",
    "delete":       r"\b(delete|remove|deactivate|archive|purge)\b",
    "search":       r"\b(search|filter|query|find|lookup)\b",
    "payment":      r"\b(payment|transaction|transfer|deposit|withdraw|balance|invoice|billing|refund)\b",
    "upload":       r"\b(upload|attach|import|file|document|scan)\b",
    "notify":       r"\b(notif|email|sms|alert|remind|message)\b",
    "report":       r"\b(report|export|dashboard|analytic|metric|audit)\b",
    "approve":      r"\b(approv|review|workflow|sign ?off|escalat)\b",
    "integrate":    r"\b(integrat|api|third[- ]party|external|webhook|sync)\b",
}


def _intents(text: str) -> List[str]:
    t = (text or "").lower()
    found = [name for name, pat in INTENT_PATTERNS.items() if re.search(pat, t)]
    return found or ["generic"]


def _tables(schema: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not schema:
        return []
    return schema.get("tables") or schema.get("schema") or []


def _guess_entity(text: str, schema: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Match a schema table whose name appears in the requirement text."""
    t = (text or "").lower()
    best = None
    for tbl in _tables(schema):
        name = str(tbl.get("name", "")).lower()
        singular = name[:-1] if name.endswith("s") else name
        if name and (name in t or (singular and singular in t)):
            return tbl
    return best


# ─── Section builders ─────────────────────────────────────────────────────────

def _business_rules(intents: List[str], desc: str, entity: Optional[Dict]) -> List[str]:
    rules: List[str] = []
    ename = (entity or {}).get("name", "record")
    if "auth" in intents:
        rules += [
            "Passwords must be stored using a one-way adaptive hash (bcrypt/argon2) — never in plaintext or reversible encryption.",
            "After 5 consecutive failed login attempts the account is temporarily locked for 15 minutes and a security event is logged.",
            "Sessions expire after 30 minutes of inactivity; JWT access tokens live 15 minutes with a rotating refresh token.",
        ]
    if "authorize" in intents:
        rules += [
            "Every protected endpoint must enforce role-based authorization server-side; client-side hiding is not sufficient.",
            "Privilege escalation is prevented by validating the caller's role against the resource owner on every mutation.",
        ]
    if "payment" in intents:
        rules += [
            "All monetary amounts use fixed-point decimal (NUMERIC), never floating point, to avoid rounding errors.",
            "Debits and credits are recorded in a single atomic transaction; partial writes must roll back entirely.",
            "A transaction cannot reduce an account balance below its permitted minimum (overdraft rules apply).",
            "Every financial mutation writes an immutable audit-log entry with actor, timestamp, before/after values.",
        ]
    if "create" in intents:
        rules += [f"A new {ename} is only persisted after all mandatory fields pass validation.",
                  f"Duplicate {ename} creation is prevented via a unique business key (enforced at DB and API layers)."]
    if "delete" in intents:
        rules += [f"Deletion is a soft-delete (status flag / archived_at) unless a hard purge is explicitly authorized and audited.",
                  f"A {ename} with dependent child records cannot be deleted until dependents are resolved or cascaded."]
    if "approve" in intents:
        rules += ["An item pending approval is immutable by the requester until the reviewer acts.",
                  "Approvals require a different user than the submitter (segregation of duties)."]
    if "upload" in intents:
        rules += ["Only whitelisted file types and sizes are accepted; uploads are virus-scanned before storage.",
                  "Uploaded files are stored outside the web root with randomized, non-guessable identifiers."]
    if not rules:
        rules = [
            f"The operation must complete atomically and leave {ename} data in a consistent state.",
            "All state changes are attributable to an authenticated actor and recorded for audit.",
        ]
    return rules


def _edge_cases(intents: List[str], entity: Optional[Dict]) -> List[str]:
    ename = (entity or {}).get("name", "record")
    cases = [
        "Empty, null, or whitespace-only input in mandatory fields.",
        "Excessively long input exceeding column limits (boundary + 1).",
        "Concurrent requests modifying the same record (optimistic-lock / race condition).",
        "Network interruption mid-operation — client retries must be idempotent.",
    ]
    if "auth" in intents:
        cases += ["Login with correct email but wrong password.", "Expired or tampered JWT presented.",
                  "Password reset token reused or expired."]
    if "payment" in intents:
        cases += ["Insufficient balance for the requested debit.", "Duplicate submission of the same transaction (idempotency key).",
                  "Currency mismatch between source and destination accounts."]
    if "search" in intents:
        cases += ["Query with special characters / SQL-injection payloads.", "Zero results and very large result sets (pagination)."]
    if "upload" in intents:
        cases += ["Zero-byte file, corrupted file, or mismatched extension vs. MIME type.", "Upload exceeding max size limit."]
    if "delete" in intents:
        cases += [f"Deleting a {ename} that is referenced by other active records.", "Double-delete of an already-removed record."]
    return cases


def _validations(intents: List[str], entity: Optional[Dict]) -> List[str]:
    v: List[str] = []
    if entity:
        for col in (entity.get("columns") or [])[:10]:
            cname = col.get("name", "")
            ctype = str(col.get("type", "")).lower()
            if cname in ("id",) or col.get("primary_key"):
                continue
            if "email" in cname:
                v.append(f"`{cname}` must match RFC-5322 email format and be unique.")
            elif "password" in cname:
                v.append(f"`{cname}` min 8 chars incl. upper, lower, digit, symbol; checked against breached-password list.")
            elif "amount" in cname or "balance" in cname or "numeric" in ctype:
                v.append(f"`{cname}` must be a non-negative decimal with max 2 fractional digits.")
            elif "date" in ctype or "time" in ctype or cname.endswith("_at"):
                v.append(f"`{cname}` must be a valid ISO-8601 timestamp, not in the future where inapplicable.")
            elif not col.get("nullable", True):
                v.append(f"`{cname}` is required and must be non-empty.")
            elif "varchar" in ctype:
                m = re.search(r"varchar\((\d+)\)", ctype)
                lim = m.group(1) if m else "the column"
                v.append(f"`{cname}` length must not exceed {lim} characters; trim leading/trailing whitespace.")
    if not v:
        v = [
            "All mandatory fields present and non-empty.",
            "String lengths within column limits; numeric ranges enforced.",
            "Input sanitized against injection (parameterized queries, output encoding).",
        ]
    return v


def _workflow(intents: List[str], desc: str, entity: Optional[Dict]) -> List[str]:
    ename = (entity or {}).get("name", "resource")
    if "auth" in intents:
        return [
            "User submits credentials over HTTPS.",
            "Server rate-limits and looks up the account by email.",
            "Password hash is verified using constant-time comparison.",
            "On success, issue signed JWT access + refresh tokens; record login event.",
            "On failure, increment failed-attempt counter and return a generic error.",
        ]
    if "payment" in intents:
        return [
            "Validate request payload and idempotency key.",
            "Begin DB transaction; lock source and destination rows.",
            "Check business rules (balance, limits, currency).",
            "Apply debit and credit; write audit-log entry.",
            "Commit transaction; emit domain event for notifications.",
            "Return confirmation with transaction reference.",
        ]
    if "approve" in intents:
        return [
            "Requester submits item; status set to PENDING_APPROVAL.",
            "System notifies the assigned reviewer(s).",
            "Reviewer inspects and approves or rejects with a reason.",
            "Status transitions; requester and stakeholders are notified.",
            "Audit trail records actor, decision, and timestamp.",
        ]
    verb = "create" if "create" in intents else "update" if "update" in intents else "process"
    return [
        f"Authenticated user initiates the request to {verb} a {ename}.",
        "Server authorizes the action against the user's role.",
        "Input is validated; on failure a 4xx with field errors is returned.",
        f"The {ename} is persisted within a transaction.",
        "A success response is returned and relevant events/notifications fire.",
    ]


def _acceptance_criteria(intents: List[str], desc: str, entity: Optional[Dict]) -> List[Dict[str, str]]:
    ename = (entity or {}).get("name", "record")
    ac: List[Dict[str, str]] = []
    ac.append({
        "given": "an authenticated, authorized user with valid input",
        "when": f"they perform the '{desc[:60]}' action",
        "then": "the system completes it successfully and returns a 2xx response with the expected payload",
    })
    ac.append({
        "given": "input that violates a validation rule",
        "when": "the request is submitted",
        "then": "the system rejects it with a 422 and a clear, field-level error message, persisting nothing",
    })
    ac.append({
        "given": "an unauthenticated or unauthorized caller",
        "when": "the endpoint is invoked",
        "then": "the system returns 401/403 and logs the attempt",
    })
    if "payment" in intents:
        ac.append({
            "given": "a debit that would overdraw the account",
            "when": "the transaction is attempted",
            "then": "it is rejected atomically, the balance is unchanged, and the reason is recorded",
        })
    if "auth" in intents:
        ac.append({
            "given": "5 consecutive failed login attempts",
            "when": "a 6th attempt is made",
            "then": "the account is locked for 15 minutes and the user is informed without leaking which factor failed",
        })
    return ac


def _api_considerations(intents: List[str], entity: Optional[Dict]) -> Dict[str, Any]:
    ename = (entity or {}).get("name", "resource")
    base = f"/api/{ename.lower()}s" if ename != "resource" else "/api/resource"
    endpoints = []
    if "create" in intents or "generic" in intents:
        endpoints.append({"method": "POST", "path": base, "desc": f"Create a {ename}", "success": "201 Created", "errors": "400, 401, 403, 409, 422"})
    if "read" in intents:
        endpoints.append({"method": "GET", "path": base, "desc": f"List {ename}s (paginated, filterable)", "success": "200 OK", "errors": "401, 403"})
        endpoints.append({"method": "GET", "path": f"{base}/{{id}}", "desc": f"Get a {ename} by id", "success": "200 OK", "errors": "401, 403, 404"})
    if "update" in intents:
        endpoints.append({"method": "PATCH", "path": f"{base}/{{id}}", "desc": f"Update a {ename}", "success": "200 OK", "errors": "400, 401, 403, 404, 409, 422"})
    if "delete" in intents:
        endpoints.append({"method": "DELETE", "path": f"{base}/{{id}}", "desc": f"Delete/deactivate a {ename}", "success": "204 No Content", "errors": "401, 403, 404, 409"})
    if "auth" in intents:
        endpoints = [
            {"method": "POST", "path": "/api/auth/login", "desc": "Authenticate and issue tokens", "success": "200 OK", "errors": "400, 401, 429"},
            {"method": "POST", "path": "/api/auth/refresh", "desc": "Rotate refresh token", "success": "200 OK", "errors": "401"},
            {"method": "POST", "path": "/api/auth/logout", "desc": "Invalidate session", "success": "204 No Content", "errors": "401"},
        ]
    if not endpoints:
        endpoints.append({"method": "POST", "path": base, "desc": f"Perform the operation", "success": "200 OK", "errors": "400, 401, 403, 422"})
    return {
        "endpoints": endpoints,
        "notes": [
            "All endpoints require a valid Bearer JWT except public auth routes.",
            "Requests/responses are JSON; use consistent error envelope { code, message, fields }.",
            "Mutations accept an Idempotency-Key header to make retries safe.",
            "Rate-limit per user/IP; return 429 with Retry-After when exceeded.",
        ],
    }


def _ui_behavior(intents: List[str], entity: Optional[Dict]) -> List[str]:
    ui = [
        "Primary action button is disabled until the form is valid; shows an inline spinner while the request is in flight.",
        "Field-level validation errors appear beneath each field on blur and on submit.",
        "Success shows a non-blocking toast; failures show an actionable error message with a retry option.",
        "All interactive elements are keyboard-accessible and screen-reader labelled (WCAG 2.1 AA).",
    ]
    if "read" in intents or "search" in intents:
        ui += ["List views support pagination, column sorting, and debounced search.",
               "Empty, loading, and error states are explicitly designed (no blank screens)."]
    if "payment" in intents:
        ui += ["Amounts are formatted with locale-aware currency; a confirmation step precedes irreversible transfers."]
    if "delete" in intents:
        ui += ["Destructive actions require an explicit confirmation dialog naming the record."]
    return ui


def _db_impact(intents: List[str], entity: Optional[Dict]) -> Dict[str, Any]:
    if entity:
        cols = [c.get("name") for c in (entity.get("columns") or [])][:12]
        return {
            "primary_table": entity.get("name"),
            "columns_touched": cols,
            "notes": [
                f"Reads/writes target the `{entity.get('name')}` table.",
                "Add appropriate indexes on filter/foreign-key columns for query performance.",
                "Wrap multi-row changes in a transaction; use row-level locking to avoid races.",
                "Consider an audit/history table for change tracking where compliance requires it.",
            ],
        }
    return {
        "primary_table": "(derive from data model)",
        "columns_touched": [],
        "notes": ["Identify the owning table, enforce constraints at the DB level, and index query paths."],
    }


def _dependencies(intents: List[str]) -> List[str]:
    deps = []
    if "auth" in intents:
        deps += ["Identity/JWT library", "Password-hashing library (bcrypt/argon2)", "Rate-limiter / cache (Redis)"]
    if "payment" in intents:
        deps += ["Transactional datastore with row locking", "Audit-log service", "Message bus for async notifications"]
    if "notify" in intents:
        deps += ["Email/SMS provider or local queue", "Template rendering service"]
    if "upload" in intents:
        deps += ["Object storage (S3-compatible)", "Virus-scanning service"]
    if "integrate" in intents:
        deps += ["External API client with retry/circuit-breaker", "Secrets manager for credentials"]
    if not deps:
        deps = ["Application datastore", "Authentication/authorization middleware"]
    # de-dup preserving order
    seen, out = set(), []
    for d in deps:
        if d not in seen:
            seen.add(d); out.append(d)
    return out


def _constraints(intents: List[str], priority: str) -> List[str]:
    c = [
        "Must comply with the project's security baseline (OWASP ASVS) and data-protection policy.",
        "All I/O over TLS 1.2+; secrets never logged or exposed to the client.",
    ]
    if "payment" in intents:
        c.append("Financial operations must be auditable and reconcilable (regulatory constraint).")
    if priority in ("critical", "high"):
        c.append("Requires automated test coverage (unit + integration) before release.")
    return c


def _nfr_targets(intents: List[str], priority: str) -> Dict[str, str]:
    p95 = "200ms" if "read" in intents else "500ms"
    return {
        "performance": f"p95 latency < {p95} under expected load; p99 < 1s.",
        "availability": "99.9% monthly uptime for this capability.",
        "scalability": "Horizontally scalable; stateless request handling.",
        "security": "AuthN + AuthZ enforced; input validated; audit-logged.",
        "observability": "Structured logs, metrics, and traces emitted for each request.",
    }


# ─── Orchestrator ─────────────────────────────────────────────────────────────

def enrich_requirement(
    req: Dict[str, Any],
    schema: Dict[str, Any],
    arch: Dict[str, Any],
) -> Dict[str, Any]:
    desc = req.get("description", "")
    intents = _intents(desc)
    entity = _guess_entity(desc, schema)
    priority = str(req.get("priority", "medium")).lower()

    enriched = dict(req)  # preserve original fields
    enriched.update({
        "intents": intents,
        "detail": desc,
        "business_rules": _business_rules(intents, desc, entity),
        "edge_cases": _edge_cases(intents, entity),
        "validations": _validations(intents, entity),
        "workflow": _workflow(intents, desc, entity),
        "acceptance_criteria": _acceptance_criteria(intents, desc, entity),
        "api_considerations": _api_considerations(intents, entity),
        "ui_behavior": _ui_behavior(intents, entity),
        "db_impact": _db_impact(intents, entity),
        "dependencies": _dependencies(intents),
        "constraints": _constraints(intents, priority),
        "nfr_targets": _nfr_targets(intents, priority),
        "assumptions": [
            "The authenticated user context is available to the handler.",
            "Reference/master data required by this feature already exists.",
            "Infrastructure (datastore, cache, queue) is provisioned and reachable.",
        ],
    })
    return enriched


def enrich_requirements(
    reqs: List[Dict[str, Any]],
    schema: Optional[Dict[str, Any]] = None,
    arch: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    schema = schema or {}
    arch = arch or {}
    return [enrich_requirement(r, schema, arch) for r in (reqs or [])]
