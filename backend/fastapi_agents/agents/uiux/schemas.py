"""
Schemas for the UI/UX Agent. Relocated verbatim from agents/uiux_agent.py
as part of the agents/<name>/ architectural refactor -- content unchanged
(including the StyleOption model added for the pre-frontend style-selection
gate).
"""
from __future__ import annotations

from pydantic import BaseModel


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


class StyleOption(BaseModel):
    """One named visual-style direction presented to the user before any
    frontend code is generated (e.g. "Modern SaaS", "Minimal",
    "Glassmorphism"). Reuses the same palette/typography/spacing shapes as
    DesignSystem so a picked style maps directly onto generation guidance
    fed to the Frontend Agent."""
    name: str = ""
    description: str = ""
    colorPalette: ColorPalette = ColorPalette()
    typography: TypographyScale = TypographyScale()
    spacing: SpacingSystem = SpacingSystem()
    buttonStyle: str = ""
    layoutDescription: str = ""


class UIUXDesignOutput(BaseModel):
    screens: list[Screen] = []
    userFlows: list[UserFlow] = []
    wireframes: list[Wireframe] = []
    componentRecommendations: list[ComponentRecommendation] = []
    uxRecommendations: list[str] = []
    designSystem: DesignSystem = DesignSystem()
    styleOptions: list[StyleOption] = []
