from __future__ import annotations

import json
import os
from pydantic import BaseModel
from .llm_service import LLMService


# ---------------------------------
# Schema Models
# ---------------------------------

class SecurityArchitecture(BaseModel):
    layers: list[str]
    controls: list[str]
    patterns: list[str]


class Threat(BaseModel):
    threat: str
    impact: str  # low, medium, high, critical
    likelihood: str  # low, medium, high
    mitigation: str


class Authentication(BaseModel):
    strategy: str
    providers: list[str]
    mfa: bool
    sessionManagement: str


class Authorization(BaseModel):
    model: str  # RBAC, ABAC, etc.
    roles: list[str]
    permissions: list[str]
    policies: list[str]


class SecurityControl(BaseModel):
    control: str
    category: str  # authentication, encryption, monitoring, etc.
    implementation: str


class SecurityArchitectureOutput(BaseModel):
    securityArchitecture: SecurityArchitecture
    threatModel: list[Threat]
    authentication: Authentication
    authorization: Authorization
    securityControls: list[SecurityControl]
    securityChecklist: list[str]


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


SECURITY_AGENT_SYSTEM_PROMPT = load_prompt("security_agent_prompt.txt")


# ---------------------------------
# Prompt Builder
# ---------------------------------

def build_security_prompt(
    project_description: str,
    architecture: dict | None = None
) -> str:
    context = f"Project Description: {project_description}\n\n"
    
    if architecture:
        context += f"Architecture Context:\n{json.dumps(architecture, indent=2)}\n\n"
    
    return f"""
{context}

Design comprehensive security architecture for this project following industry best practices.
Generate the structured security architecture output now.
"""


# ---------------------------------
# Main Agent Class
# ---------------------------------

class SecurityArchitectAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(
        self,
        project_description: str,
        architecture: dict | None = None
    ) -> SecurityArchitectureOutput:

        if not project_description:
            raise ValueError("Project description cannot be empty")

        result = self.llm.generate_json(
            system=SECURITY_AGENT_SYSTEM_PROMPT,
            prompt=build_security_prompt(project_description, architecture),
            schema=SecurityArchitectureOutput,
        )

        if not result or not result.securityArchitecture:
            raise ValueError("No security architecture generated")

        return result
