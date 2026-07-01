from __future__ import annotations

import os
from pydantic import BaseModel
from .llm_client import OllamaClient, call_and_validate


class Microservice(BaseModel):
    name: str
    responsibility: str
    technology: str
    port: int | None = None


class Component(BaseModel):
    name: str
    type: str
    technology: str


class Diagram(BaseModel):
    type: str
    content: str


class ArchitectAgentOutput(BaseModel):
    architecture_summary: str
    pattern: str
    microservices: list[Microservice]
    components: list[Component]
    diagrams: list[Diagram]
    tech_stack: dict[str, str]


BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_prompt(file_name: str) -> str:
    prompt_path = os.path.join(BASE_DIR, "prompts", file_name)
    if not os.path.exists(prompt_path):
        raise FileNotFoundError(
            f"Required agent system instructions missing: {prompt_path}"
        )
    with open(prompt_path, "r", encoding="utf-8") as file:
        return file.read()


ARCHITECT_AGENT_SYSTEM_PROMPT = load_prompt("architect_agent_system_prompt.txt")


def build_architecture_prompt(context: str) -> str:
    return f"""
Project Context:
{context}

Generate the architecture output now.
"""


class ArchitectAgent:
    def __init__(self, client: OllamaClient | None = None):
        self.client = client or OllamaClient()

    def run(self, context: str) -> ArchitectAgentOutput:
        if not context.strip():
            raise ValueError("Architecture context cannot be empty")

        result = call_and_validate(
            client=self.client,
            system=ARCHITECT_AGENT_SYSTEM_PROMPT,
            prompt=build_architecture_prompt(context),
            schema=ArchitectAgentOutput,
        )

        if not result or not result.architecture_summary:
            raise ValueError("No architecture generated")

        return result
