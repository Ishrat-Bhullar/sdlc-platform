"""
Schemas for the Solution Architect Agent. Relocated verbatim from
agents/architect_agent.py as part of the agents/<name>/ architectural
refactor -- content unchanged.
"""
from __future__ import annotations

from pydantic import BaseModel, model_validator


def _first_present(d: dict, *keys: str, default=""):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return default


class Microservice(BaseModel):
    name: str
    responsibility: str
    technology: str
    port: int | None = None


class Component(BaseModel):
    name: str = ""
    type: str = "backend"
    technology: str = ""

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, v):
        if not isinstance(v, dict):
            return v
        v = dict(v)
        v.setdefault("name", _first_present(v, "name", "component", "service"))
        v.setdefault("technology", _first_present(v, "technology", "tech", "stack"))
        return v


class Diagram(BaseModel):
    type: str = "system_context"
    content: str = ""

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, v):
        if not isinstance(v, dict):
            return v
        v = dict(v)
        # Small local models sometimes send a prose "description" instead of
        # (or alongside) actual Mermaid "content" — accept either so a naming
        # mismatch alone never forces a fallback to the mock deck.
        v.setdefault("content", _first_present(v, "content", "description", "mermaid", "source"))
        return v


class ArchitectureDecision(BaseModel):
    """An ADR-style record — the decision, why, and what was ruled out."""
    decision: str = ""
    rationale: str = ""
    alternatives_considered: str = ""
    consequences: str = ""

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, v):
        if not isinstance(v, dict):
            return v
        v = dict(v)
        v.setdefault("decision", _first_present(v, "decision", "title", "description"))
        v.setdefault("rationale", _first_present(v, "rationale", "reason", "why", "justification"))
        return v


class ModuleResponsibility(BaseModel):
    module: str
    responsibility: str
    owns_data: str = ""
    communicates_with: list[str] = []


class TechStackOption(BaseModel):
    """One of the two mandatory stack recommendations (local/open-source or
    cloud/enterprise) — every technology choice must be justified, not just
    listed, and trade-offs must be explicit."""
    label: str                          # "Local / Open Source" | "Cloud / Enterprise"
    ai_layer: str = ""
    backend: str = ""
    frontend: str = ""
    database: str = ""
    vector_store: str = ""
    cache_queue: str = ""
    orchestration: str = ""
    deployment: str = ""
    ci_cd: str = ""
    observability: str = ""
    rationale: dict[str, str] = {}      # technology -> why it was chosen
    trade_offs: str = ""
    estimated_cost_profile: str = ""
    scalability_notes: str = ""


class ArchitectAgentOutput(BaseModel):
    architecture_summary: str
    pattern: str = "Modular Monolith"
    microservices: list[Microservice] = []
    # These three, plus every nested field above, now have defaults and
    # lenient before-validators: a local 8-14B model asked for a large
    # schema will sometimes omit or rename a field under load, and a single
    # missing field should degrade that one section gracefully rather than
    # discard an otherwise good, on-topic response and fall back to canned
    # demo content.
    components: list[Component] = []
    diagrams: list[Diagram] = []
    tech_stack: dict[str, str] = {}          # kept for backward compatibility
    # --- Enterprise implementation blueprint -------------------------------
    architecture_decisions: list[ArchitectureDecision] = []
    design_principles: list[str] = []
    scalability_strategy: str = ""
    security_considerations: str = ""
    performance_strategy: str = ""
    deployment_strategy: str = ""
    integration_strategy: str = ""
    communication_flow: str = ""
    module_responsibilities: list[ModuleResponsibility] = []
    # --- Two mandatory stack recommendations --------------------------------
    tech_stack_local: TechStackOption = TechStackOption(label="Local / Open Source")
    tech_stack_cloud: TechStackOption = TechStackOption(label="Cloud / Enterprise")
