"""
presentation_planner.py
========================
The PRESENTATION PLANNER stage of the enterprise presentation pipeline:

    Requirements → [Presentation Planner] → Storytelling → Diagrams → Charts
                 → Theme Engine → python-pptx → Video → Voice → Final PPT + MP4

The planner produces a structured plan (plain JSON/dict) describing, per slide:
    slide order · layout · diagrams · charts · icons · narration hook ·
    transitions · animations · timing

Two modes, so the stage is always available:
  * `plan_from_artifacts(...)`  — deterministic, artifact-grounded plan built on
    top of slide_deck_builder (no LLM required; always works).
  * `enrich_with_agent(...)`     — optional: fold in a DirectorAgent (Ollama)
    plan when a local model is reachable, for a bespoke narrative.

The plan is consumed by the Storytelling Agent (narration) and by pptx_builder /
video_pipeline_local (rendering + timing), and mirrors the vocabulary in
theme_engine.NARRATIVE_ARC.
"""
from __future__ import annotations

from .logging_config import get_logger
from typing import Any

from fastapi_agents import theme_engine as TE

logger = get_logger(__name__)

# Which layouts warrant a diagram / chart / longer dwell.
_DIAGRAM_FOR = {"architecture": "architecture", "process": "workflow",
                "roadmap": "workflow", "timeline": "workflow"}
_CHART_FOR = {"chart": "bar", "kpi_cards": "kpi", "stats_grid": "kpi"}
_TIMING = {
    "title": 5, "section": 4, "agenda": 6, "items": 7, "kpi_cards": 6,
    "stats_grid": 7, "table": 10, "chart": 9, "two_col": 8, "comparison": 8,
    "tech_grid": 8, "process": 9, "architecture": 11, "roadmap": 8,
    "timeline": 8, "quote": 5, "closing": 6, "content": 6,
}
# Icon suggestions keyed by narrative section / title keywords.
_ICON_HINTS = [
    (("problem", "challenge", "pain", "risk"), ["warning", "target"]),
    (("solution", "propose", "approach"), ["idea", "rocket"]),
    (("architecture", "system", "design"), ["layers", "network"]),
    (("workflow", "pipeline", "agent", "process"), ["flow", "gear"]),
    (("security", "compliance", "threat"), ["shield", "lock"]),
    (("data", "database", "schema"), ["database", "layers"]),
    (("technology", "stack", "tech"), ["gear", "cloud"]),
    (("benefit", "value", "roi", "return"), ["growth", "money"]),
    (("deliverable", "artifact", "output"), ["doc", "check"]),
    (("future", "roadmap", "next", "scope"), ["rocket", "flag"]),
    (("team", "user", "stakeholder", "story"), ["users", "check"]),
]


def _icons_for(title: str, layout: str) -> list[str]:
    t = (title or "").lower()
    for keys, icons in _ICON_HINTS:
        if any(k in t for k in keys):
            return icons
    return {"kpi_cards": ["chart"], "architecture": ["layers"],
            "process": ["flow"], "closing": ["check"]}.get(layout, ["check"])


def plan_from_artifacts(
    slides: list[dict[str, Any]],
    project_name: str = "SDLC Project",
    presentation_tone: str = "executive",
    target_audience: str = "C-suite executives and engineering leadership",
) -> dict[str, Any]:
    """Build a structured presentation plan from already-structured deck slides
    (as produced by slide_deck_builder.build_deck). Returns a dict that is safe
    to serialise to JSON and hand to the Storytelling Agent + renderers."""
    plan_slides: list[dict[str, Any]] = []
    for i, s in enumerate(slides):
        layout = str(s.get("layout", "content"))
        title = s.get("title", "")
        n_elems = (len(s.get("items", []) or []) + len(s.get("steps", []) or [])
                   + len(s.get("layers", []) or [])
                   + len((s.get("table", {}) or {}).get("rows", []))
                   + len((s.get("chart", {}) or {}).get("data", [])))
        timing = _TIMING.get(layout, 6) + min(int(n_elems * 0.5), 4)
        transition = "zoom" if layout in ("title", "section", "closing") else "fade"
        plan_slides.append({
            "slide_number": i + 1,
            "title": title,
            "layout": layout,
            "diagram": _DIAGRAM_FOR.get(layout, "none"),
            "chart": _CHART_FOR.get(layout, "none"),
            "icons": _icons_for(title, layout),
            "transition": transition,
            "animation": _animation_for(layout),
            "timing_seconds": timing,
            "narration_hook": s.get("speaker_notes", "")[:160],
        })

    total_seconds = sum(p["timing_seconds"] for p in plan_slides)
    return {
        "project_name": project_name,
        "presentation_tone": presentation_tone,
        "target_audience": target_audience,
        "theme": TE.DEFAULT_THEME,
        "narrative_arc": TE.NARRATIVE_ARC,
        "total_slides": len(plan_slides),
        "estimated_duration_seconds": total_seconds,
        "estimated_duration": f"{round(total_seconds / 60)} min",
        "slides": plan_slides,
    }


def _animation_for(layout: str) -> str:
    return {
        "title": "fade up title, wipe accent bar",
        "section": "slide in section number",
        "kpi_cards": "count-up values, reveal cards left-to-right",
        "stats_grid": "reveal cards, count-up values",
        "process": "reveal steps left-to-right with connecting arrows",
        "architecture": "reveal layers top-to-bottom, highlight active layer",
        "comparison": "reveal both columns, then flash the vs marker",
        "chart": "grow bars from zero",
        "timeline": "draw the spine, pop nodes in sequence",
        "roadmap": "draw the spine, reveal phase cards",
        "table": "fade in header, cascade rows",
        "items": "reveal cards top-to-bottom",
    }.get(layout, "gentle fade in")


def enrich_with_agent(
    base_plan: dict[str, Any],
    artifacts_context: str,
    client=None,
) -> dict[str, Any]:
    """Optionally refine the deterministic plan using the DirectorAgent (Ollama).
    Never raises: if no local model is reachable, the base plan is returned
    unchanged so the pipeline always has a valid plan."""
    try:
        from fastapi_agents.agents.presentation_video_agent import DirectorAgent
        director = DirectorAgent(client)
        ai = director.run(
            artifacts_context=artifacts_context,
            presentation_tone=base_plan.get("presentation_tone", "executive"),
            target_audience=base_plan.get("target_audience", ""),
        )
        base_plan["executive_summary"] = ai.executive_summary
        base_plan["narrative_arc_text"] = ai.narrative_arc
        base_plan["agent_outline"] = ai.slide_outline
        base_plan["agent_storyboard"] = ai.storyboard
        logger.info("[PresentationPlanner] Enriched plan with DirectorAgent (%d outline slides)",
                    len(ai.slide_outline))
    except Exception as exc:
        logger.info("[PresentationPlanner] Agent enrichment skipped (%s) — using deterministic plan", exc)
    return base_plan
