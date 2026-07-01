from __future__ import annotations

import json
from pydantic import BaseModel
from .llm_client import OllamaClient, call_and_validate
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


class BusinessAnalystOutput(BaseModel):
    epics: list[EpicOut]


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
    def __init__(self, client: OllamaClient | None = None):
        self.client = client or OllamaClient()

    def run(
        self,
        approved_requirements: RequirementAgentOutput | dict
    ) -> BusinessAnalystOutput:

        if not approved_requirements:
            raise ValueError("Approved requirements cannot be empty")

        result = call_and_validate(
            client=self.client,
            system=BA_AGENT_SYSTEM_PROMPT,
            prompt=build_ba_prompt(approved_requirements),
            schema=BusinessAnalystOutput,
        )

        if not result or not result.epics:
            raise ValueError("No user stories generated")

        return result


# ---------------------------------
# Test Run Block
# ---------------------------------

if __name__ == "__main__":
    agent = BusinessAnalystAgent()

    mock_requirements = {
        "requirements": [
            {
                "id": "REQ-001",
                "description": "User must be able to securely login via username and password.",
                "category": "Functional",
                "priority": "Must",
                "risk_level": "Low"
            }
        ],
        "risks": ["Brute force login attempts"],
        "dependencies": ["Authentication Database Server"]
    }

    print("Running Business Analyst Agent Test...")

    try:
        output = agent.run(mock_requirements)
        print("\n--- TEST SUCCESSFUL ---")
        print(output.model_dump_json(indent=2))

    except Exception as e:
        print("\n--- TEST FAILED ---")
        print(f"Error: {e}")
