from __future__ import annotations

import json
import os
from pydantic import BaseModel
from .llm_service import LLMService


# ---------------------------------
# Schema Models
# ---------------------------------

class Screen(BaseModel):
    name: str = ""
    purpose: str = ""
    type: str = "page"  # page, modal, drawer, etc.
    components: list[str] = []


class UserFlow(BaseModel):
    name: str = ""
    steps: list[str] = []
    screens: list[str] = []


class Wireframe(BaseModel):
    screen: str = ""
    layout: str = ""
    description: str = ""


class ComponentRecommendation(BaseModel):
    # All fields default to "" rather than being required: a local 8-14B
    # model under load will sometimes omit or rename one field in an
    # otherwise good response, and a single miss shouldn't discard the
    # whole (correct, on-topic) document in favour of the generic mock.
    name: str = ""
    type: str = ""
    library: str = ""
    rationale: str = ""


class TypographyScale(BaseModel):
    fontFamily: str = "Inter, system-ui, sans-serif"
    headingFont: str = "Inter, system-ui, sans-serif"
    scale: dict[str, str] = {}          # e.g. {"h1": "32px/40px, 700", "body": "16px/24px, 400"}
    rationale: str = ""


class SpacingSystem(BaseModel):
    baseUnit: str = "8px"
    scale: list[str] = []                # e.g. ["4px","8px","16px","24px","32px","48px","64px"]
    rationale: str = ""


class ColorToken(BaseModel):
    name: str = ""
    hex: str = ""
    usage: str = ""


class ColorPalette(BaseModel):
    primary: list[ColorToken] = []
    neutral: list[ColorToken] = []
    semantic: list[ColorToken] = []      # success / warning / error / info
    rationale: str = ""


class DesignSystemComponent(BaseModel):
    name: str = ""
    states: list[str] = []               # default, hover, focus, disabled, error
    variants: list[str] = []
    accessibility_notes: str = ""


class ResponsiveBreakpoint(BaseModel):
    name: str = ""                       # mobile / tablet / desktop / wide
    min_width: str = ""
    layout_behavior: str = ""


class AccessibilityRequirement(BaseModel):
    guideline: str = ""                  # e.g. "WCAG 2.1 AA - 4.5:1 contrast"
    applies_to: str = ""
    implementation: str = ""


class DesignSystem(BaseModel):
    """The complete design system — not just a wireframe list. This is what
    lets a developer implement pixel-accurate, on-brand UI without guessing."""
    typography: TypographyScale = TypographyScale()
    spacing: SpacingSystem = SpacingSystem()
    colorPalette: ColorPalette = ColorPalette()
    components: list[DesignSystemComponent] = []
    responsiveBreakpoints: list[ResponsiveBreakpoint] = []
    accessibility: list[AccessibilityRequirement] = []
    designPrinciples: list[str] = []


class UIUXDesignOutput(BaseModel):
    screens: list[Screen] = []
    userFlows: list[UserFlow] = []
    wireframes: list[Wireframe] = []
    componentRecommendations: list[ComponentRecommendation] = []
    uxRecommendations: list[str] = []
    designSystem: DesignSystem = DesignSystem()


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
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(
        self,
        project_description: str,
        requirements: dict | None = None,
        user_stories: dict | None = None
    ) -> UIUXDesignOutput:

        if not project_description:
            raise ValueError("Project description cannot be empty")

        result = self.llm.generate_json(
            system=UIUX_AGENT_SYSTEM_PROMPT,
            prompt=build_uiux_prompt(project_description, requirements, user_stories),
            schema=UIUXDesignOutput,
        )

        # Accept the result if EITHER the screen inventory or the design
        # system has real content — a local model under load will sometimes
        # produce a rich designSystem but skimp on screens (or vice versa);
        # discarding a genuinely useful partial response for the generic
        # empty fallback is worse than delivering what it did produce.
        has_content = result and (
            result.screens or result.designSystem.colorPalette.primary
            or result.designSystem.typography.scale or result.componentRecommendations
        )
        if not has_content:
            raise ValueError("No UI/UX design generated")

        return result
