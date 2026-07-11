"""
agents/uiux/agent.py
======================
UI/UX Agent — designs screens, user flows, wireframes, a full design
system (typography/spacing/palette/components/breakpoints/a11y), and the
pre-frontend style-option gallery the user picks from before any frontend
code is generated. Owns its own prompt (prompts.py) and schema
(schemas.py); the pipeline orchestrator only ever calls `.generate(...)`.
"""
from __future__ import annotations

import json
from ...logging_config import get_logger
from typing import Any

from ..llm_service import LLMService
from .prompts import UIUX_REFINEMENT_ADDENDUM, UIUX_SYSTEM_PROMPT
from .schemas import UIUXDesignOutput

logger = get_logger(__name__)


# ---------------------------------
# Demo-mode fixture (returned only when the deployment-wide DEMO_MODE flag
# is on — see ai_service.py's module docstring for the contract).
# ---------------------------------
MOCK_UIUX: dict[str, Any] = {
    "screens": ["Sign in", "Project dashboard", "Artifact workspace", "Approval center"],
    "userFlows": ["Authenticate → create project → monitor pipeline → review artifacts"],
    "wireframes": ["Responsive application shell with navigation, status cards, and artifact panels"],
    "componentRecommendations": ["Accessible forms", "Live status badges", "Error boundary", "Loading skeletons"],
    "uxRecommendations": ["Preserve selected project", "Show actionable API errors", "Support keyboard navigation"],
    "designSystem": {
        "typography": {
            "fontFamily": "Inter, system-ui, sans-serif", "headingFont": "Inter, system-ui, sans-serif",
            "scale": {"h1": "32px/40px, weight 700", "h2": "24px/32px, weight 700",
                     "h3": "20px/28px, weight 600", "body": "16px/24px, weight 400",
                     "caption": "13px/18px, weight 400", "label": "13px/16px, weight 600, uppercase"},
            "rationale": "Inter is a highly legible UI typeface at small sizes with a large weight range — suited to a data-dense operational dashboard where numbers and status text dominate.",
        },
        "spacing": {"baseUnit": "8px", "scale": ["4px", "8px", "16px", "24px", "32px", "48px", "64px"],
                   "rationale": "An 8pt grid keeps every component's padding/margin on a consistent rhythm and maps cleanly to common screen densities."},
        "colorPalette": {
            "primary": [{"name": "brand-yellow-500", "hex": "#FFE600", "usage": "primary actions, active nav state, key metrics"},
                       {"name": "brand-charcoal-900", "hex": "#2E2E38", "usage": "headers, primary text, dark surfaces"}],
            "neutral": [{"name": "gray-50", "hex": "#F6F6FA", "usage": "page background"},
                       {"name": "gray-200", "hex": "#DEDEE2", "usage": "borders, dividers"},
                       {"name": "gray-600", "hex": "#747480", "usage": "secondary/muted text"}],
            "semantic": [{"name": "success", "hex": "#2DB757", "usage": "passed checks, positive deltas"},
                        {"name": "warning", "hex": "#FF9831", "usage": "pending approvals, at-risk items"},
                        {"name": "error", "hex": "#E00000", "usage": "failed runs, validation errors"}],
            "rationale": "Charcoal + yellow anchors the brand; semantic colors are desaturated enough to stay legible next to the brand yellow without competing for attention.",
        },
        "components": [
            {"name": "Button", "states": ["default", "hover", "focus", "active", "disabled"],
             "variants": ["primary", "secondary", "ghost", "destructive"],
             "accessibility_notes": "2px focus ring offset from the button edge; minimum 44x44px touch target; disabled state communicated by both opacity and aria-disabled."},
            {"name": "StatusBadge", "states": ["default"], "variants": ["success", "warning", "error", "info", "idle"],
             "accessibility_notes": "Status is conveyed by icon + text, never color alone, for color-blind users."},
            {"name": "DataTable", "states": ["default", "loading", "empty", "error"],
             "variants": ["compact", "comfortable"],
             "accessibility_notes": "Sortable column headers are real <button> elements with aria-sort; row focus is keyboard-navigable."},
        ],
        "responsiveBreakpoints": [
            {"name": "mobile", "min_width": "0px", "layout_behavior": "Single column, nav collapses to a drawer, tables become stacked cards."},
            {"name": "tablet", "min_width": "768px", "layout_behavior": "Two-column layout for detail panels; nav remains collapsible."},
            {"name": "desktop", "min_width": "1280px", "layout_behavior": "Persistent left nav, multi-column dashboards, side-by-side detail panels."},
        ],
        "accessibility": [
            {"guideline": "WCAG 2.1 AA contrast 4.5:1 (text), 3:1 (UI components)", "applies_to": "all text and interactive elements",
             "implementation": "Charcoal-on-white and white-on-charcoal pairs are pre-validated; yellow is never used for body text, only accents/backgrounds behind dark text."},
            {"guideline": "Full keyboard operability", "applies_to": "all interactive elements",
             "implementation": "Logical tab order matches visual order; no keyboard traps in modals; Escape closes overlays."},
            {"guideline": "Screen-reader labeling", "applies_to": "icon-only buttons, status indicators, charts",
             "implementation": "aria-label on every icon-only control; charts include an sr-only text summary of the data."},
        ],
        "designPrinciples": [
            "Status at a glance — every list/table surfaces state (passed/failed/pending) visually before the user reads any text.",
            "Progressive disclosure — dense operational data is summarized first, with drill-down for detail, to avoid overwhelming the primary dashboard.",
            "Consistent iconography — one icon per concept across the whole product, never reused for a different meaning.",
            "Generous whitespace over dense layouts — this is an executive/engineering tool used for extended sessions, not a marketing page optimizing for scroll depth.",
        ],
    },
}


def build_uiux_prompt(
    project_description: str,
    requirements: dict | None = None,
    user_stories: dict | None = None,
    refinement_instruction: str | None = None,
    existing_design: dict | None = None,
) -> str:
    context = f"Project Description: {project_description}\n\n"

    if requirements:
        context += f"Requirements:\n{json.dumps(requirements, indent=2)}\n\n"

    if user_stories:
        context += f"User Stories:\n{json.dumps(user_stories, indent=2)}\n\n"

    if refinement_instruction and existing_design:
        context += f"Existing Design (revise this):\n{json.dumps(existing_design, indent=2)}\n\n"
        context += f"Refinement Instruction:\n{refinement_instruction}\n\n"
        return f"""
{context}

Revise the existing design per the refinement instruction and return the full updated design output now.
"""

    return f"""
{context}

Design comprehensive UI/UX for this project following modern best practices.
Generate the structured UI/UX design output now.
"""


class UIUXDesignAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(
        self,
        project_description: str,
        requirements: dict | None = None,
        user_stories: dict | None = None,
        refinement_instruction: str | None = None,
        existing_design: dict | None = None,
    ) -> UIUXDesignOutput:

        if not project_description:
            raise ValueError("Project description cannot be empty")

        is_refinement = bool(refinement_instruction and existing_design)
        system_prompt = UIUX_SYSTEM_PROMPT + UIUX_REFINEMENT_ADDENDUM if is_refinement else UIUX_SYSTEM_PROMPT

        result = self.llm.generate_json(
            system=system_prompt,
            prompt=build_uiux_prompt(
                project_description, requirements, user_stories,
                refinement_instruction=refinement_instruction,
                existing_design=existing_design,
            ),
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
            or result.styleOptions
        )
        if not has_content:
            raise ValueError("No UI/UX design generated")

        return result

    @classmethod
    def generate(cls, db, project_id: int, context: str, requirements: Any | None = None) -> dict[str, Any]:
        """Orchestrator-facing entrypoint: `UIUXDesignAgent.generate(db, project_id, context)`.
        Preserves the exact contract/behavior previously implemented inline in
        ai_service.generate_uiux."""
        from ...models import DEMO_MODE
        from ...ai_service import AIGenerationError

        if DEMO_MODE:
            return MOCK_UIUX
        try:
            # designSystem (typography/spacing/palette/components/breakpoints/a11y)
            # is a large schema — same generous-timeout rationale as architecture.
            agent = cls(llm=LLMService(db=db, project_id=project_id, role="architect", timeout=170))
            result = agent.run(project_description=context, requirements=requirements, user_stories=None)
            return result.model_dump() if hasattr(result, "model_dump") else result
        except Exception as exc:
            logger.error("[UIUXDesignAgent] generate failed: %s", exc)
            raise AIGenerationError(f"UI/UX generation failed: {exc}") from exc
