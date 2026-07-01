from __future__ import annotations

import json
import os
from pydantic import BaseModel
from .llm_client import OllamaClient, call_and_validate


# ---------------------------------
# Schema Models
# ---------------------------------

class ComplianceAssessment(BaseModel):
    standards: list[str]  # GDPR, HIPAA, SOC2, etc.
    gaps: list[str]
    recommendations: list[str]


class GovernanceControl(BaseModel):
    control: str
    framework: str  # ISO 27001, NIST, CIS, etc.
    requirement: str
    implementation: str


class AuditRequirement(BaseModel):
    requirement: str
    frequency: str  # daily, weekly, monthly, quarterly, annually
    evidence: str
    responsible: str


class DataRetentionPolicy(BaseModel):
    dataType: str
    retentionPeriod: str
    deletionMethod: str
    justification: str


class RiskAssessment(BaseModel):
    risk: str
    likelihood: str  # low, medium, high
    impact: str  # low, medium, high, critical
    mitigation: str
    owner: str


class ComplianceArchitectureOutput(BaseModel):
    complianceAssessment: ComplianceAssessment
    governanceControls: list[GovernanceControl]
    auditRequirements: list[AuditRequirement]
    dataRetentionPolicies: list[DataRetentionPolicy]
    riskAssessment: list[RiskAssessment]


# ---------------------------------
# System Prompt (loaded from prompts folder)
# ---------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_prompt(file_name: str) -> str:
    prompt_path = os.path.join(BASE_DIR, "prompts", file_name)
    if not os.path.exists(prompt_path):
        raise FileNotFoundError(f"Required agent system instructions missing: {prompt_path}")
    with open(prompt_path, "r", encoding="utf-8") as file:
        return file.read()


COMPLIANCE_AGENT_SYSTEM_PROMPT = load_prompt("compliance_agent_prompt.txt")


# ---------------------------------
# Prompt Builder
# ---------------------------------

def build_compliance_prompt(
    project_description: str,
    requirements: dict | None = None,
    architecture: dict | None = None,
    database: dict | None = None,
    uiux: dict | None = None,
    security: dict | None = None
) -> str:
    context = f"Project Description: {project_description}\n\n"
    
    if requirements:
        context += f"Requirements:\n{json.dumps(requirements, indent=2)}\n\n"
    
    if architecture:
        context += f"Architecture:\n{json.dumps(architecture, indent=2)}\n\n"
    
    if database:
        context += f"Database Design:\n{json.dumps(database, indent=2)}\n\n"
    
    if uiux:
        context += f"UI/UX Design:\n{json.dumps(uiux, indent=2)}\n\n"
    
    if security:
        context += f"Security Architecture:\n{json.dumps(security, indent=2)}\n\n"
    
    return f"""
{context}

Assess compliance, governance, audit, and risk requirements for this project.
Generate the structured compliance architecture output now.
"""


# ---------------------------------
# Main Agent Class
# ---------------------------------

class ComplianceArchitectAgent:
    def __init__(self, client: OllamaClient | None = None):
        self.client = client or OllamaClient()

    def run(
        self,
        project_description: str,
        requirements: dict | None = None,
        architecture: dict | None = None,
        database: dict | None = None,
        uiux: dict | None = None,
        security: dict | None = None
    ) -> ComplianceArchitectureOutput:

        if not project_description:
            raise ValueError("Project description cannot be empty")

        result = call_and_validate(
            client=self.client,
            system=COMPLIANCE_AGENT_SYSTEM_PROMPT,
            prompt=build_compliance_prompt(
                project_description, requirements, architecture, database, uiux, security
            ),
            schema=ComplianceArchitectureOutput,
        )

        if not result or not result.complianceAssessment:
            raise ValueError("No compliance assessment generated")

        return result


# ---------------------------------
# Test Run Block
# ---------------------------------

if __name__ == "__main__":
    agent = ComplianceArchitectAgent()

    mock_description = "Healthcare patient management system"
    mock_requirements = {
        "functional": [
            {"id": "REQ-001", "description": "Store patient medical records"}
        ]
    }
    mock_security = {
        "authentication": {"strategy": "OAuth2", "mfa": True}
    }

    print("Running Compliance Architect Agent Test...")

    try:
        output = agent.run(mock_description, mock_requirements, security=mock_security)
        print("\n--- TEST SUCCESSFUL ---")
        print(output.model_dump_json(indent=2))

    except Exception as e:
        print("\n--- TEST FAILED ---")
        print(f"Error: {e}")
