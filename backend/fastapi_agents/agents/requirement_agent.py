from __future__ import annotations

from enum import Enum
from pydantic import BaseModel
from .llm_client import OllamaClient, call_and_validate


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

class RequirementItem(BaseModel):
    id: str
    description: str
    category: RequirementCategory
    priority: MoscowPriority
    risk_level: RiskLevel


class RequirementAgentOutput(BaseModel):
    requirements: list[RequirementItem]
    risks: list[str]
    dependencies: list[str]


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
    def __init__(self, client: OllamaClient | None = None):
        self.client = client or OllamaClient()

    def run(self, requirement_text: str) -> RequirementAgentOutput:
        if not requirement_text.strip():
            raise ValueError("Requirement text cannot be empty")

        result = call_and_validate(
            client=self.client,
            system=REQUIREMENT_AGENT_SYSTEM_PROMPT,
            prompt=build_requirement_prompt(requirement_text),
            schema=RequirementAgentOutput,
        )

        if not result or not result.requirements:
            raise ValueError("No requirements generated")

        return result


# ---------------------------------
# Test Run Block
# ---------------------------------

if __name__ == "__main__":
    agent = RequirementAgent()

    test_prompt = (
        "Build a banking portal with login, account dashboard "
        "and transaction history"
    )

    print("Running Requirement Agent Test...")

    try:
        output = agent.run(test_prompt)
        print("\n--- TEST SUCCESSFUL ---")
        print(output.model_dump_json(indent=2))

    except Exception as e:
        print("\n--- TEST FAILED ---")
        print(f"Error: {e}")
