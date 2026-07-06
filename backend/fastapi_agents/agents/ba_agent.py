from __future__ import annotations

import json
from pydantic import BaseModel
from .llm_service import LLMService
from .requirement_agent import MoscowPriority, RequirementAgentOutput


# ---------------------------------
# Schema Models
# ---------------------------------

class Epic(BaseModel):
    id: str
    name: str
    description: str


class AcceptanceCriterion(BaseModel):
    given: str
    when: str
    then: str


class UserStory(BaseModel):
    id: str
    epic: str
    title: str
    role: str
    goal: str
    benefit: str
    acceptance_criteria: list[AcceptanceCriterion]
    moscow: str
    points: int


class EpicOut(BaseModel):
    title: str
    description: str
    stories: list[UserStory]


class Persona(BaseModel):
    name: str
    role: str = ""
    goals: list[str] = []
    pain_points: list[str] = []
    demographics: str = ""


class ProcessFlow(BaseModel):
    name: str
    steps: list[str] = []
    diagram: str = ""  # Mermaid flowchart/sequence source


class RiskItem(BaseModel):
    risk: str
    likelihood: str = "medium"  # low, medium, high
    impact: str = "medium"      # low, medium, high, critical
    mitigation: str = ""


class SuccessMetric(BaseModel):
    metric: str
    target: str = ""
    measurement_method: str = ""


class BusinessAnalystOutput(BaseModel):
    epics: list[EpicOut]
    detailed_brd: str = ""
    srs: str = ""
    personas: list[Persona] = []
    process_flows: list[ProcessFlow] = []
    business_workflows: list[str] = []
    validation_rules: list[str] = []
    exception_handling: list[str] = []
    risk_analysis: list[RiskItem] = []
    success_metrics: list[SuccessMetric] = []


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


BA_AGENT_SYSTEM_PROMPT = load_prompt("ba_agent_system_prompt.txt")



# ---------------------------------
# Prompt Builder
# ---------------------------------

def build_ba_prompt(approved_requirements: RequirementAgentOutput | dict) -> str:
    payload = (
        approved_requirements.model_dump()
        if isinstance(approved_requirements, BaseModel)
        else approved_requirements
    )

    return f"""
Approved Requirements:
{json.dumps(payload, indent=2)}

Generate the structured BA artifacts output now.
"""


# ---------------------------------
# Main Agent Class
# ---------------------------------

class BusinessAnalystAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="ba")

    def run(
        self,
        approved_requirements: RequirementAgentOutput | dict
    ) -> BusinessAnalystOutput:

        if not approved_requirements:
            raise ValueError("Approved requirements cannot be empty")

        result = self.llm.generate_json(
            system=BA_AGENT_SYSTEM_PROMPT,
            prompt=build_ba_prompt(approved_requirements),
            schema=BusinessAnalystOutput,
        )

        if not result or not result.epics:
            raise ValueError("No user stories generated")

        return result
