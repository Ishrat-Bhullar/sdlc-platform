"""
Schemas for the Business Analyst Agent. Relocated verbatim from
agents/ba_agent.py as part of the agents/<name>/ architectural refactor --
content unchanged.
"""
from __future__ import annotations

from pydantic import BaseModel


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
