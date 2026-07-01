from __future__ import annotations

import json
import os
from pydantic import BaseModel
from .llm_client import OllamaClient, call_and_validate


# ---------------------------------
# Schema Models
# ---------------------------------

class Screen(BaseModel):
    name: str
    purpose: str
    type: str  # page, modal, drawer, etc.
    components: list[str]


class UserFlow(BaseModel):
    name: str
    steps: list[str]
    screens: list[str]


class Wireframe(BaseModel):
    screen: str
    layout: str
    description: str


class ComponentRecommendation(BaseModel):
    name: str
    type: str
    library: str
    rationale: str


class UIUXDesignOutput(BaseModel):
    screens: list[Screen]
    userFlows: list[UserFlow]
    wireframes: list[Wireframe]
    componentRecommendations: list[ComponentRecommendation]
    uxRecommendations: list[str]


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


UIUX_AGENT_SYSTEM_PROMPT = load_prompt("uiux_agent_prompt.txt")


# ---------------------------------
# Prompt Builder
# ---------------------------------

def build_uiux_prompt(
    project_description: str,
    requirements: dict | None = None,
    user_stories: dict | None = None
) -> str:
    context = f"Project Description: {project_description}\n\n"
    
    if requirements:
        context += f"Requirements:\n{json.dumps(requirements, indent=2)}\n\n"
    
    if user_stories:
        context += f"User Stories:\n{json.dumps(user_stories, indent=2)}\n\n"
    
    return f"""
{context}

Design comprehensive UI/UX for this project following modern best practices.
Generate the structured UI/UX design output now.
"""


# ---------------------------------
# Main Agent Class
# ---------------------------------

class UIUXDesignAgent:
    def __init__(self, client: OllamaClient | None = None):
        self.client = client or OllamaClient()

    def run(
        self,
        project_description: str,
        requirements: dict | None = None,
        user_stories: dict | None = None
    ) -> UIUXDesignOutput:

        if not project_description:
            raise ValueError("Project description cannot be empty")

        result = call_and_validate(
            client=self.client,
            system=UIUX_AGENT_SYSTEM_PROMPT,
            prompt=build_uiux_prompt(project_description, requirements, user_stories),
            schema=UIUXDesignOutput,
        )

        if not result or not result.screens:
            raise ValueError("No UI/UX design generated")

        return result


# ---------------------------------
# Test Run Block
# ---------------------------------

if __name__ == "__main__":
    agent = UIUXDesignAgent()

    mock_description = "E-commerce platform for selling handmade crafts"
    mock_requirements = {
        "functional": [
            {"id": "REQ-001", "description": "Users must be able to browse products"},
            {"id": "REQ-002", "description": "Users must be able to add items to cart"}
        ]
    }
    mock_stories = {
        "stories": [
            {"id": "US-001", "title": "Browse products as a customer"}
        ]
    }

    print("Running UI/UX Design Agent Test...")

    try:
        output = agent.run(mock_description, mock_requirements, mock_stories)
        print("\n--- TEST SUCCESSFUL ---")
        print(output.model_dump_json(indent=2))

    except Exception as e:
        print("\n--- TEST FAILED ---")
        print(f"Error: {e}")
