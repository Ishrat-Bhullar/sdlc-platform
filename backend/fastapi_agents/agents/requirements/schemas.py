"""
Schemas for the Requirements Agent. Relocated verbatim from
agents/requirement_agent.py as part of the agents/<name>/ architectural
refactor -- content unchanged.
"""
from __future__ import annotations

from enum import Enum
from pydantic import BaseModel


# ---------------------------------
# Enums
# ---------------------------------

class RequirementCategory(str, Enum):
    FUNCTIONAL = "Functional"
    NON_FUNCTIONAL = "Non-Functional"
    CONSTRAINT = "Constraint"
    ASSUMPTION = "Assumption"


class MoscowPriority(str, Enum):
    MUST = "Must"
    SHOULD = "Should"
    COULD = "Could"
    WONT = "Won't"


class RiskLevel(str, Enum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"


# ---------------------------------
# Schema Models
# ---------------------------------

class GivenWhenThen(BaseModel):
    given: str
    when: str
    then: str


class ApiConsiderationEndpoint(BaseModel):
    method: str
    path: str
    desc: str = ""
    success: str = ""
    errors: str = ""


class ApiConsiderations(BaseModel):
    endpoints: list[ApiConsiderationEndpoint] = []
    notes: list[str] = []


class DbImpact(BaseModel):
    primary_table: str = ""
    columns_touched: list[str] = []
    notes: list[str] = []


class RequirementItem(BaseModel):
    id: str
    description: str
    category: RequirementCategory
    priority: MoscowPriority
    risk_level: RiskLevel
    # --- Implementation-ready detail rendered by RequirementCard's
    # per-requirement accordion (frontend/src/pages/RequirementsWorkspace.tsx) ---
    business_rules: list[str] = []
    edge_cases: list[str] = []
    validations: list[str] = []
    workflow: list[str] = []
    acceptance_criteria: list[GivenWhenThen] = []
    api_considerations: ApiConsiderations = ApiConsiderations()
    ui_behavior: list[str] = []
    db_impact: DbImpact = DbImpact()
    dependencies: list[str] = []
    constraints: list[str] = []
    nfr_targets: dict[str, str] = {}
    assumptions: list[str] = []


class UserRole(BaseModel):
    name: str
    description: str = ""
    permissions: list[str] = []


class TraceabilityEntry(BaseModel):
    requirement_id: str
    business_goal: str = ""
    source: str = ""
    related_requirements: list[str] = []


class ErrorScenario(BaseModel):
    requirement_id: str
    scenario: str
    expected_behavior: str = ""


class RequirementAgentOutput(BaseModel):
    requirements: list[RequirementItem]
    risks: list[str]
    dependencies: list[str]
    user_roles: list[UserRole] = []
    traceability: list[TraceabilityEntry] = []
    error_scenarios: list[ErrorScenario] = []
