"""
diagram_generator.py
─────────────────────────────────────────────────────────────────────────────
Deterministic, fully-local generator for a COMPLETE set of architecture
diagrams (Mermaid syntax) derived from real project artifacts.

No LLM, no paid APIs — pure Python. Produces every supported diagram type:
  high_level, component, sequence, class, er, deployment, dataflow,
  infrastructure, network

Each generator degrades gracefully when a given artifact is missing, using
sensible defaults inferred from whatever data is available.

Public API:
    build_all_diagrams(arch, schema, project_name) -> list[{type, title, content, category}]
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _san(name: str) -> str:
    """Sanitize a label into a Mermaid-safe node id."""
    nid = re.sub(r"[^A-Za-z0-9]", "_", str(name or "node")).strip("_")
    if not nid:
        nid = "n"
    if nid[0].isdigit():
        nid = "n_" + nid
    return nid


def _q(label: str) -> str:
    """Quote a label for safe Mermaid rendering."""
    return str(label or "").replace('"', "'").replace("\n", " ")


def _components(arch: Dict[str, Any]) -> List[Dict[str, Any]]:
    return arch.get("components") or []


def _services(arch: Dict[str, Any]) -> List[Dict[str, Any]]:
    return arch.get("microservices") or []


def _tech(arch: Dict[str, Any]) -> Dict[str, str]:
    return arch.get("tech_stack") or {}


def _tables(schema: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not schema:
        return []
    return schema.get("tables") or schema.get("schema") or []


# ─── 1. High-level architecture ───────────────────────────────────────────────

def gen_high_level(arch: Dict[str, Any], project_name: str) -> str:
    comps = _components(arch)
    services = _services(arch)
    tech = _tech(arch)

    lines = ["graph TD"]
    lines.append('  User(["👤 End User"])')
    lines.append('  User -->|HTTPS| CDN["🌐 CDN / WAF"]')

    frontend = next((c for c in comps if c.get("type") == "frontend"), None)
    fe_label = frontend["name"] if frontend else "Web SPA"
    lines.append(f'  CDN --> FE["🖥️ {_q(fe_label)}"]')
    lines.append('  FE -->|REST / WS| GW["🚪 API Gateway"]')

    if services:
        for svc in services[:8]:
            sid = _san(svc.get("name"))
            lines.append(f'  GW --> {sid}["⚙️ {_q(svc.get("name"))}"]')
        # services to data stores
        db = next((c for c in comps if c.get("type") == "database"), None)
        db_label = db["name"] if db else tech.get("database", "PostgreSQL")
        lines.append(f'  DB[("🗄️ {_q(db_label)}")]')
        for svc in services[:8]:
            lines.append(f'  {_san(svc.get("name"))} --> DB')
        if tech.get("cache"):
            lines.append(f'  CACHE[("⚡ {_q(tech.get("cache"))}")]')
            lines.append(f'  {_san(services[0].get("name"))} --> CACHE')
    else:
        # Fall back to component-driven flow
        backend = next((c for c in comps if c.get("type") in ("backend", "service", "gateway")), None)
        be_label = backend["name"] if backend else "Application Server"
        lines.append(f'  GW --> BE["⚙️ {_q(be_label)}"]')
        db = next((c for c in comps if c.get("type") == "database"), None)
        db_label = db["name"] if db else tech.get("database", "Database")
        lines.append(f'  BE --> DB[("🗄️ {_q(db_label)}")]')

    lines.append("  classDef edge fill:#2E2E38,stroke:#FFE600,color:#fff;")
    return "\n".join(lines)


# ─── 2. Component diagram ──────────────────────────────────────────────────────

def gen_component(arch: Dict[str, Any]) -> str:
    comps = _components(arch)
    services = _services(arch)
    lines = ["flowchart LR"]

    # Group components by layer
    lines.append('  subgraph Client["Presentation Layer"]')
    fes = [c for c in comps if c.get("type") in ("frontend", "ui", "client")]
    if not fes:
        fes = [{"name": "Web SPA", "technology": "React"}]
    for c in fes:
        lines.append(f'    {_san(c["name"])}["{_q(c["name"])}<br/><small>{_q(c.get("technology",""))}</small>"]')
    lines.append("  end")

    lines.append('  subgraph App["Application Layer"]')
    gws = [c for c in comps if c.get("type") in ("gateway", "backend", "service", "api")]
    for c in gws:
        lines.append(f'    {_san(c["name"])}["{_q(c["name"])}<br/><small>{_q(c.get("technology",""))}</small>"]')
    for s in services[:8]:
        lines.append(f'    {_san(s["name"])}(["{_q(s["name"])}<br/><small>:{s.get("port","")}</small>"])')
    if not gws and not services:
        lines.append('    APP["Application Server"]')
    lines.append("  end")

    lines.append('  subgraph Data["Data Layer"]')
    dbs = [c for c in comps if c.get("type") in ("database", "cache", "storage", "queue")]
    if not dbs:
        dbs = [{"name": "PostgreSQL", "technology": "RDBMS"}]
    for c in dbs:
        lines.append(f'    {_san(c["name"])}[("{_q(c["name"])}")]')
    lines.append("  end")

    # Wire layers
    first_fe = _san(fes[0]["name"])
    if services:
        for s in services[:8]:
            lines.append(f'  {first_fe} --> {_san(s["name"])}')
            for c in dbs:
                lines.append(f'  {_san(s["name"])} --> {_san(c["name"])}')
    elif gws:
        lines.append(f'  {first_fe} --> {_san(gws[0]["name"])}')
        for c in dbs:
            lines.append(f'  {_san(gws[0]["name"])} --> {_san(c["name"])}')
    return "\n".join(lines)


# ─── 3. Sequence diagram ──────────────────────────────────────────────────────

def gen_sequence(arch: Dict[str, Any]) -> str:
    services = _services(arch)
    svc_name = services[0]["name"] if services else "API Service"
    second = services[1]["name"] if len(services) > 1 else "Core Service"
    lines = [
        "sequenceDiagram",
        "  autonumber",
        "  actor User",
        "  participant SPA as Web SPA",
        "  participant GW as API Gateway",
        f"  participant SVC as {_q(svc_name)}",
        f"  participant SVC2 as {_q(second)}",
        "  participant DB as Database",
        "",
        "  User->>SPA: Interact (submit action)",
        "  SPA->>GW: HTTPS request + JWT",
        "  GW->>GW: Validate token & rate-limit",
        "  GW->>SVC: Route request",
        "  SVC->>DB: Query / persist",
        "  DB-->>SVC: Result set",
        "  SVC->>SVC2: Async event (message bus)",
        "  SVC-->>GW: 200 OK + payload",
        "  GW-->>SPA: JSON response",
        "  SPA-->>User: Render updated UI",
    ]
    return "\n".join(lines)


# ─── 4. Class diagram ─────────────────────────────────────────────────────────

def gen_class(arch: Dict[str, Any], schema: Dict[str, Any]) -> str:
    tables = _tables(schema)
    services = _services(arch)
    lines = ["classDiagram"]

    if tables:
        for t in tables[:10]:
            cname = _san(t.get("name", "Entity")).title().replace("_", "")
            lines.append(f"  class {cname} {{")
            for col in (t.get("columns") or [])[:12]:
                ctype = str(col.get("type", "")).split("(")[0].lower()
                marker = "+" if col.get("primary_key") else "-"
                lines.append(f"    {marker}{ctype} {col.get('name','field')}")
            # Add a couple of methods inferred from services
            lines.append(f"    +save() {cname}")
            lines.append(f"    +findById(id) {cname}")
            lines.append("  }")
        # Relationships
        for rel in (schema.get("relationships") or [])[:12]:
            a = _san(str(rel.get("from_table", rel.get("from", rel.get("source", ""))))).title().replace("_", "")
            b = _san(str(rel.get("to_table", rel.get("to", rel.get("target", ""))))).title().replace("_", "")
            if a and b and a.lower() != "node" and b.lower() != "node":
                lines.append(f"  {b} --> {a}")
    else:
        # Derive from services
        for s in (services or [{"name": "Service"}])[:6]:
            cname = _san(s.get("name")).title().replace("_", "")
            lines.append(f"  class {cname} {{")
            lines.append(f"    +String name")
            lines.append(f"    +handle(request) Response")
            lines.append("  }")
    return "\n".join(lines)


# ─── 5. ER diagram ────────────────────────────────────────────────────────────

def gen_er(schema: Dict[str, Any]) -> str:
    tables = _tables(schema)
    lines = ["erDiagram"]
    if not tables:
        lines += [
            "  USERS {",
            "    int id PK",
            "    string email",
            "  }",
            "  SESSIONS {",
            "    int id PK",
            "    int user_id FK",
            "  }",
            "  USERS ||--o{ SESSIONS : has",
        ]
        return "\n".join(lines)

    for t in tables[:12]:
        tname = _san(t.get("name", "table")).upper()
        lines.append(f"  {tname} {{")
        for col in (t.get("columns") or [])[:14]:
            ctype = re.sub(r"[^A-Za-z0-9]", "", str(col.get("type", "string")).split("(")[0]) or "string"
            key = "PK" if col.get("primary_key") else ("FK" if col.get("name", "").endswith("_id") else "")
            lines.append(f"    {ctype.lower()} {col.get('name','field')} {key}".rstrip())
        lines.append("  }")

    rels = schema.get("relationships") or []
    if rels:
        for rel in rels[:16]:
            a = _san(str(rel.get("from_table", rel.get("from", rel.get("source", ""))))).upper()
            b = _san(str(rel.get("to_table", rel.get("to", rel.get("target", ""))))).upper()
            verb = _q(rel.get("type", "relates"))
            if a and b and a != "NODE" and b != "NODE":
                # one-to-many: parent (to_table) ||--o{ child (from_table)
                lines.append(f'  {b} ||--o{{ {a} : "{verb}"')
    else:
        # infer FK relationships from *_id columns
        names = {_san(t.get("name", "")).upper(): t for t in tables}
        for t in tables[:12]:
            tname = _san(t.get("name", "")).upper()
            for col in (t.get("columns") or []):
                cn = col.get("name", "")
                if cn.endswith("_id"):
                    ref = _san(cn[:-3]).upper()
                    ref_plural = ref + "S"
                    target = ref if ref in names else (ref_plural if ref_plural in names else None)
                    if target and target != tname:
                        lines.append(f"  {target} ||--o{{ {tname} : has")
    return "\n".join(lines)


# ─── 6. Deployment diagram ────────────────────────────────────────────────────

def gen_deployment(arch: Dict[str, Any]) -> str:
    services = _services(arch)
    tech = _tech(arch)
    lines = ["flowchart TB"]
    lines.append('  subgraph Cloud["☁️ Cloud Provider (AWS / GCP)"]')
    lines.append('    subgraph LB["Load Balancer / Ingress"]')
    lines.append('      ALB["Application Load Balancer"]')
    lines.append("    end")
    lines.append('    subgraph K8S["Kubernetes Cluster"]')
    if services:
        for s in services[:8]:
            sid = _san(s["name"])
            lines.append(f'      {sid}_pod["Pod: {_q(s["name"])}<br/><small>replicas: 3</small>"]')
    else:
        lines.append('      app_pod["Pod: Application<br/><small>replicas: 3</small>"]')
    lines.append("    end")
    lines.append('    subgraph Managed["Managed Data Services"]')
    lines.append(f'      RDS[("{_q(tech.get("database","PostgreSQL"))}<br/>Primary + Replica")]')
    if tech.get("cache"):
        lines.append(f'      REDIS[("{_q(tech.get("cache"))}")]')
    lines.append('      S3["Object Storage (S3)"]')
    lines.append("    end")
    lines.append("  end")
    lines.append('  Internet(["Internet"]) --> ALB')
    lines.append("  ALB --> K8S")
    if services:
        for s in services[:8]:
            lines.append(f'  {_san(s["name"])}_pod --> RDS')
    else:
        lines.append("  app_pod --> RDS")
    return "\n".join(lines)


# ─── 7. Data flow diagram ─────────────────────────────────────────────────────

def gen_dataflow(arch: Dict[str, Any]) -> str:
    services = _services(arch)
    lines = ["flowchart LR"]
    lines.append('  ext1[/"External User"/]')
    lines.append('  p1(("1.0<br/>Authenticate"))')
    lines.append('  p2(("2.0<br/>Process Request"))')
    lines.append('  p3(("3.0<br/>Persist & Notify"))')
    lines.append('  ds1[("D1: User Store")]')
    lines.append('  ds2[("D2: Domain Store")]')
    lines.append('  ds3[("D3: Audit Log")]')
    lines.append("  ext1 -->|credentials| p1")
    lines.append("  p1 -->|verify| ds1")
    lines.append("  p1 -->|session token| p2")
    lines.append("  p2 -->|read/write| ds2")
    lines.append("  p2 --> p3")
    lines.append("  p3 -->|append| ds3")
    lines.append("  p3 -->|response| ext1")
    if services:
        note = ", ".join(s.get("name", "") for s in services[:4])
        lines.append(f'  p2 -.->|handled by| svc["{_q(note)}"]')
    return "\n".join(lines)


# ─── 8. Infrastructure diagram ────────────────────────────────────────────────

def gen_infrastructure(arch: Dict[str, Any]) -> str:
    tech = _tech(arch)
    lines = ["flowchart TB"]
    lines.append('  subgraph edge["Edge"]')
    lines.append('    DNS["Route53 DNS"]')
    lines.append('    WAF["WAF + Shield"]')
    lines.append('    CDN["CloudFront CDN"]')
    lines.append("  end")
    lines.append('  subgraph vpc["VPC 10.0.0.0/16"]')
    lines.append('    subgraph pub["Public Subnet"]')
    lines.append("      NAT[NAT Gateway]")
    lines.append("      ALB[App Load Balancer]")
    lines.append("    end")
    lines.append('    subgraph priv["Private Subnet — Compute"]')
    lines.append("      EKS[EKS / Container Cluster]")
    lines.append("    end")
    lines.append('    subgraph data["Private Subnet — Data"]')
    lines.append(f'      RDS[("{_q(tech.get("database","PostgreSQL"))}")]')
    if tech.get("cache"):
        lines.append(f'      CACHE[("{_q(tech.get("cache"))}")]')
    lines.append("    end")
    lines.append("  end")
    lines.append('  subgraph obs["Observability"]')
    lines.append("    LOG[CloudWatch / ELK]")
    lines.append("    MON[Prometheus + Grafana]")
    lines.append("  end")
    lines.append("  DNS --> WAF --> CDN --> ALB --> EKS")
    lines.append("  EKS --> RDS")
    lines.append("  EKS -.-> MON")
    lines.append("  EKS -.-> LOG")
    return "\n".join(lines)


# ─── 9. Network diagram ───────────────────────────────────────────────────────

def gen_network(arch: Dict[str, Any]) -> str:
    lines = ["flowchart TB"]
    lines.append('  Internet(["Internet"])')
    lines.append('  IGW["Internet Gateway"]')
    lines.append('  Internet --> IGW')
    lines.append('  subgraph AZ_A["Availability Zone A"]')
    lines.append('    subgraph pubA["Public 10.0.1.0/24"]')
    lines.append("      albA[ALB Node]")
    lines.append("    end")
    lines.append('    subgraph privA["Private 10.0.11.0/24"]')
    lines.append("      appA[App Nodes]")
    lines.append("    end")
    lines.append('    subgraph dataA["Data 10.0.21.0/24"]')
    lines.append("      dbA[(DB Primary)]")
    lines.append("    end")
    lines.append("  end")
    lines.append('  subgraph AZ_B["Availability Zone B"]')
    lines.append('    subgraph pubB["Public 10.0.2.0/24"]')
    lines.append("      albB[ALB Node]")
    lines.append("    end")
    lines.append('    subgraph privB["Private 10.0.12.0/24"]')
    lines.append("      appB[App Nodes]")
    lines.append("    end")
    lines.append('    subgraph dataB["Data 10.0.22.0/24"]')
    lines.append("      dbB[(DB Standby)]")
    lines.append("    end")
    lines.append("  end")
    lines.append("  IGW --> albA & albB")
    lines.append("  albA --> appA --> dbA")
    lines.append("  albB --> appB --> dbB")
    lines.append("  dbA -.replication.-> dbB")
    return "\n".join(lines)


# ─── Orchestrator ─────────────────────────────────────────────────────────────

DIAGRAM_SPECS = [
    ("high_level",    "High-Level Architecture", "architecture"),
    ("component",     "Component Diagram",       "structure"),
    ("sequence",      "Sequence Diagram",        "behavior"),
    ("class",         "Class Diagram",           "structure"),
    ("er",            "Entity Relationship",     "data"),
    ("deployment",    "Deployment Diagram",      "infra"),
    ("dataflow",      "Data Flow Diagram",       "behavior"),
    ("infrastructure","Infrastructure Diagram",  "infra"),
    ("network",       "Network Diagram",         "infra"),
]


def build_all_diagrams(
    arch: Optional[Dict[str, Any]],
    schema: Optional[Dict[str, Any]],
    project_name: str = "Platform",
) -> List[Dict[str, str]]:
    """Generate the full set of Mermaid diagrams from project artifacts."""
    arch = arch or {}
    schema = schema or {}

    generators = {
        "high_level": lambda: gen_high_level(arch, project_name),
        "component": lambda: gen_component(arch),
        "sequence": lambda: gen_sequence(arch),
        "class": lambda: gen_class(arch, schema),
        "er": lambda: gen_er(schema),
        "deployment": lambda: gen_deployment(arch),
        "dataflow": lambda: gen_dataflow(arch),
        "infrastructure": lambda: gen_infrastructure(arch),
        "network": lambda: gen_network(arch),
    }

    out: List[Dict[str, str]] = []
    for dtype, title, category in DIAGRAM_SPECS:
        try:
            content = generators[dtype]()
        except Exception as exc:  # never fail the whole set
            content = f"graph TD\n  err[\"{title} generation error: {str(exc)[:60]}\"]"
        out.append({"type": dtype, "title": title, "content": content, "category": category})
    return out
