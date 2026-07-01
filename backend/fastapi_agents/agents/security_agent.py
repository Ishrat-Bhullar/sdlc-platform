from __future__ import annotations

import json
import os
from pydantic import BaseModel
from .llm_client import OllamaClient, call_and_validate


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
    def __init__(self, client: OllamaClient | None = None):
        self.client = client or OllamaClient()

    def run(
        self,
        project_description: str,
        architecture: dict | None = None
    ) -> SecurityArchitectureOutput:

        if not project_description:
            raise ValueError("Project description cannot be empty")

        result = call_and_validate(
            client=self.client,
            system=SECURITY_AGENT_SYSTEM_PROMPT,
            prompt=build_security_prompt(project_description, architecture),
            schema=SecurityArchitectureOutput,
        )

        if not result or not result.securityArchitecture:
            raise ValueError("No security architecture generated")

        return result


# ---------------------------------
# Test Run Block
# ---------------------------------

if __name__ == "__main__":
    agent = SecurityArchitectAgent()

    mock_description = "E-commerce platform for selling handmade crafts"
    mock_architecture = {
        "pattern": "Microservices",
        "apiStyle": "REST",
        "services": ["User Service", "Product Service", "Payment Service"]
    }

    print("Running Security Architect Agent Test...")

    try:
        output = agent.run(mock_description, mock_architecture)
        print("\n--- TEST SUCCESSFUL ---")
        print(output.model_dump_json(indent=2))

    except Exception as e:
        print("\n--- TEST FAILED ---")
        print(f"Error: {e}")
