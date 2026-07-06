from __future__ import annotations

from enum import Enum
from pydantic import BaseModel
from .llm_service import LLMService


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


# ---------------------------------
# System Prompt (loaded from prompts folder)
# ---------------------------------

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def load_prompt(file_name: str) -> str:
    prompt_path = os.path.join(BASE_DIR, "prompts", file_name)
    if not os.path.exists(prompt_path):
        raise FileNotFoundError(f"Required agent system instructions missing: {prompt_path}")
    with open(prompt_path, "r", encoding="utf-8") as file:
        return file.read()


REQUIREMENT_AGENT_SYSTEM_PROMPT = load_prompt("requirement_agent_system_prompt.txt")



# ---------------------------------
# Prompt Builder
# ---------------------------------

def build_requirement_prompt(requirement_text: str) -> str:
    return f"""
User Requirement:
{requirement_text}

Generate the structured requirement output now.
"""


# ---------------------------------
# Main Agent Class
# ---------------------------------

class RequirementAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="requirements")

    def run(self, requirement_text: str) -> RequirementAgentOutput:
        if not requirement_text.strip():
            raise ValueError("Requirement text cannot be empty")

        result = self.llm.generate_json(
            system=REQUIREMENT_AGENT_SYSTEM_PROMPT,
            prompt=build_requirement_prompt(requirement_text),
            schema=RequirementAgentOutput,
        )

        if not result or not result.requirements:
            raise ValueError("No requirements generated")

        return result
