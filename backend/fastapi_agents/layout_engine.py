"""
layout_engine.py
=================
Public "Layout Engine" seam for the presentation pipeline. This module does
NOT duplicate layout-selection heuristics — those already exist, proven and
wired into rendering, in design_engine.py (_detect_layout) and pptx_builder.py
(_LAYOUT_ALIASES / _hint_to_layout). This file gives the Scene Planner /
Slide Designer stages a single, named, importable function to call *before*
full slide content exists (Scene Planner only has a coarse content-type hint,
not finished bullets yet), while final, content-aware layout selection still
happens once at render time via design_engine.design_slides() — so there is
exactly one source of truth for "what does this content actually look like,"
never two heuristics that can drift apart.
"""
from __future__ import annotations

from . import design_engine as DE

# Coarse hints a Scene Planner can produce before slide copy is written.
# Maps directly onto pptx_builder's RENDERERS dispatch keys.
_CONTENT_TYPE_TO_LAYOUT = {
    "process": "process", "workflow": "process", "steps": "process",
    "comparison": "comparison", "before_after": "comparison",
    "timeline": "roadmap", "roadmap": "roadmap", "milestones": "roadmap",
    "architecture": "architecture", "system_design": "architecture",
    "stats": "kpi_cards", "metrics": "kpi_cards", "kpi": "kpi_cards",
    "table": "table", "chart": "chart", "quote": "quote",
    "tech_stack": "tech_grid", "agenda": "agenda",
    "title": "title", "section": "section", "closing": "closing",
    # Additions: each maps onto an existing, already-working layout rather
    # than a new dedicated renderer — "ER diagram"/"cloud architecture"/
    # "dashboard"/"infographic"/"flowchart" all achieve their intended look
    # via a layout that already renders that shape of content well.
    "database": "table", "db_schema": "table",           # paired with a real ER-style diagram via _attach_diagrams
    "deployment": "architecture", "cloud_architecture": "architecture",
    "requirements": "items", "infographic": "items",      # icon-chip + short-phrase cards already read as an infographic
    "dashboard": "kpi_cards",                              # a dashboard IS a KPI-card grid in this system
    "flowchart": "process",
    # Full-bleed, image-led "hero moment" layout — a single powerful
    # statement/vision beat, not routine content (e.g. "why this solution",
    # future-scope, a big claim), distinct from the title/section/quote/
    # closing layouts that only ever show a hero image as a side accent.
    "hero": "hero", "vision": "hero", "statement": "hero",
}

_VALID_LAYOUTS = frozenset(
    {"title", "section", "agenda", "items", "stats_grid", "kpi_cards", "table",
     "chart", "two_col", "two_column", "comparison", "tech_grid", "process",
     "architecture", "roadmap", "timeline", "quote", "closing", "content", "hero"}
)


def choose_layout(
    content_type_hint: str | None = None,
    bullets: list[str] | None = None,
    title: str = "",
    llm_hint: str | None = None,
) -> str:
    """Best-fit pptx_builder layout key for a scene/slide.

    Resolution order (first match wins):
      1. content_type_hint, if it maps to a known layout — cheapest, used by
         Scene Planner before slide copy exists.
      2. bullets, if provided — delegates to design_engine's proven content-
         shape detector (numeric/KPI density, comparison language, timeline
         words, process words, architecture keywords).
      3. llm_hint, if it's a recognized layout key — respects the LLM's own
         suggestion when neither of the above fired.
      4. "content" — the same safe fallback pptx_builder.RENDERERS itself uses.
    """
    if content_type_hint:
        mapped = _CONTENT_TYPE_TO_LAYOUT.get(str(content_type_hint).strip().lower())
        if mapped:
            return mapped

    if bullets:
        detected = DE._detect_layout({"title": title}, bullets)
        if detected:
            return detected

    if llm_hint:
        hinted = str(llm_hint).strip().lower().replace(" ", "_")
        if hinted in _VALID_LAYOUTS:
            return hinted

    return "content"
