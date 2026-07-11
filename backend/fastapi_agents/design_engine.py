"""
design_engine.py
=================
The local-first PRESENTATION DESIGN ENGINE — a Gamma-style planner/designer
that sits between raw content (from any source: the Director/Logic/Review
agent chain, the PDF-understanding pipeline, or slide_deck_builder) and
pptx_builder, which is purely the rendering/export layer.

    Raw slide content (title/bullets/notes)
              │
              ▼
      [ DesignEngine.design_slides() ]   <- this module (100% local, no network)
       - picks the right visual layout for the content shape
       - assigns icons per item
       - trims prose into visual-first phrases (not paragraphs)
       - fills in diagram/timing/animation metadata
              │
              ▼
        pptx_builder.build_pptx*()        <- rendering/export only

Runs entirely locally (pure Python, no external service). If a step fails
for any slide, that slide is passed through unchanged rather than raising —
callers always get back a complete, renderable deck.
"""
from __future__ import annotations

from .logging_config import get_logger
import re
from typing import Any

from . import theme_engine as TE

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Layout upgrade heuristics — turn generic "items"/"content" slides into the
# richer visual layout their content actually calls for, so decks communicate
# visually first instead of defaulting to bullet lists.
# ---------------------------------------------------------------------------

_UPGRADEABLE = {"items", "content", ""}

_KPI_NUMBER_RE = re.compile(
    r"\b\d+(\.\d+)?\s?(%|x|k|m|percent|pct|days?|hours?|weeks?|months?|years?)\b", re.I)
_STEP_WORDS = ("first", "then", "next", "finally", "step 1", "step one", "phase 1")
_COMPARISON_WORDS = (" vs ", " versus ", "before", "after", "today", "with the platform",
                    "current state", "future state", "as-is", "to-be")
_TIMELINE_WORDS = ("week ", "month ", "quarter", "q1", "q2", "q3", "q4", "phase ", "milestone")


def _bullets_of(slide: dict) -> list[str]:
    if slide.get("items"):
        return [it.get("title", "") for it in slide["items"] if it.get("title")]
    content = slide.get("content", "")
    return [l.lstrip("•-–— ").strip() for l in str(content).split("\n") if l.strip()]


def _detect_layout(slide: dict, bullets: list[str]) -> str | None:
    """Returns an upgraded layout name, or None to keep the current one."""
    text = " ".join(bullets).lower() + " " + str(slide.get("title", "")).lower()
    n = len(bullets)

    # Explicit before/after or option-A/option-B language is a stronger,
    # more intentional signal than "the text happens to contain numbers" —
    # check it before the generic KPI-number heuristic.
    if any(w in text for w in _COMPARISON_WORDS) and n >= 2:
        return "comparison"
    numeric_hits = sum(1 for b in bullets if _KPI_NUMBER_RE.search(b))
    if 2 <= numeric_hits and numeric_hits >= n - 1 and n <= 4:
        return "kpi_cards"
    if any(w in text for w in _TIMELINE_WORDS) and n >= 3:
        return "roadmap"
    if any(w in text for w in _STEP_WORDS) or (slide.get("title", "").lower().startswith(("how ", "workflow", "pipeline", "process"))):
        return "process"
    if any(k in text for k in ("architecture", "component", "layer", "microservice", "system design")):
        return "architecture"
    if n >= 6:
        return "table" if numeric_hits >= 2 else "items"
    return None


def _short_phrase(text: str, max_words: int = 9) -> str:
    """Visual-first bullets are short phrases, not sentences. Trims a long
    sentence down to its leading clause/phrase rather than mid-word."""
    t = " ".join(str(text).split())
    words = t.split(" ")
    if len(words) <= max_words:
        return t
    truncated = " ".join(words[:max_words])
    # Prefer to cut at a clause boundary if one exists nearby.
    for sep in (",", ";", " - ", " — "):
        idx = truncated.rfind(sep)
        if idx > len(truncated) * 0.5:
            return truncated[:idx].strip()
    return truncated.strip() + "…"


_ICON_HINTS = [
    (("problem", "challenge", "pain", "risk"), "warning"),
    (("solution", "propose", "approach", "idea"), "idea"),
    (("architecture", "system", "design", "component"), "layers"),
    (("workflow", "pipeline", "agent", "process", "step"), "flow"),
    (("security", "compliance", "threat", "auth"), "shield"),
    (("data", "database", "schema", "storage"), "database"),
    (("technology", "stack", "tech", "api"), "api"),
    (("benefit", "value", "roi", "return", "revenue", "cost"), "money"),
    (("growth", "scale", "increase", "faster"), "growth"),
    (("deliverable", "artifact", "output", "document"), "doc"),
    (("future", "roadmap", "next", "scope"), "rocket"),
    (("team", "user", "stakeholder", "customer", "client"), "users"),
    (("test", "quality", "coverage", "qa"), "test"),
    (("cloud", "deploy", "infrastructure", "kubernetes"), "cloud"),
    (("time", "schedule", "deadline", "duration"), "clock"),
    (("target", "goal", "kpi", "metric"), "target"),
    (("lock", "access", "permission", "rbac"), "lock"),
]


def _icon_for(text: str) -> str:
    t = text.lower()
    for keys, icon in _ICON_HINTS:
        if any(k in t for k in keys):
            return icon
    return "check"


def _compact_kpi_value(raw: str) -> str:
    """KPI cards render the value at very large type — keep it to a compact
    numeral+unit token (e.g. "40 percent" -> "40%") so it never overflows
    the card and collides with the label underneath."""
    v = raw.strip()
    v = re.sub(r"\bpercent\b", "%", v, flags=re.I)
    v = re.sub(r"\bpct\b", "%", v, flags=re.I)
    v = re.sub(r"\s+%", "%", v)
    v = re.sub(r"\bdays?\b", "d", v, flags=re.I)
    v = re.sub(r"\bhours?\b", "h", v, flags=re.I)
    v = re.sub(r"\bweeks?\b", "w", v, flags=re.I)
    v = re.sub(r"\bmonths?\b", "mo", v, flags=re.I)
    v = re.sub(r"\byears?\b", "yr", v, flags=re.I)
    return v[:10]


def _to_kpi_cards(slide: dict, bullets: list[str]) -> dict:
    stats = []
    for b in bullets[:4]:
        m = _KPI_NUMBER_RE.search(b)
        value = _compact_kpi_value(m.group(0)) if m else "•"
        label = b[:m.start()].strip(" -:—") if m else b
        label = _short_phrase(label, 5) or b[:24]
        stats.append({"value": value, "label": label or "Metric", "sub": ""})
    out = dict(slide)
    out["layout"] = "kpi_cards"
    out["stats"] = stats
    return out


def _to_process(slide: dict, bullets: list[str]) -> dict:
    steps = [{"title": _short_phrase(b, 4), "body": _short_phrase(b, 10) if len(b.split()) > 4 else ""}
             for b in bullets[:5]]
    out = dict(slide)
    out["layout"] = "process"
    out["steps"] = steps
    return out


def _to_comparison(slide: dict, bullets: list[str]) -> dict:
    half = max(1, (len(bullets) + 1) // 2)
    out = dict(slide)
    out["layout"] = "comparison"
    out["left"] = {"header": "Today", "points": [_short_phrase(b) for b in bullets[:half]]}
    out["right"] = {"header": "With the Platform", "points": [_short_phrase(b) for b in bullets[half:]]}
    return out


def _to_roadmap(slide: dict, bullets: list[str]) -> dict:
    evs = [{"title": _short_phrase(b, 5), "desc": "", "date": f"Phase {i+1}"} for i, b in enumerate(bullets[:5])]
    out = dict(slide)
    out["layout"] = "roadmap"
    out["timeline"] = evs
    return out


def _to_architecture(slide: dict, bullets: list[str]) -> dict:
    layers = [{"name": _short_phrase(b, 4), "desc": "", "icon": _icon_for(b)} for b in bullets[:5]]
    out = dict(slide)
    out["layout"] = "architecture"
    out["layers"] = layers
    return out


def _to_items(slide: dict, bullets: list[str]) -> dict:
    items = [{"icon": _icon_for(b), "title": _short_phrase(b), "body": ""} for b in bullets[:6]]
    out = dict(slide)
    out["layout"] = "items"
    out["items"] = items
    return out


_UPGRADERS = {
    "kpi_cards": _to_kpi_cards, "process": _to_process, "comparison": _to_comparison,
    "roadmap": _to_roadmap, "architecture": _to_architecture, "items": _to_items,
}


def design_slide(slide: dict) -> dict:
    """Apply visual-design decisions to a single slide dict. Never raises —
    on any error the original slide is returned unchanged."""
    try:
        layout = str(slide.get("layout", "") or "").lower()
        if layout not in _UPGRADEABLE:
            # Already a rich, deliberately-chosen layout (table/chart/kpi_cards/
            # two_col/tech_grid/timeline/quote/title/section/closing/etc.) —
            # leave the designer's/agent's choice alone.
            return slide
        bullets = _bullets_of(slide)
        if not bullets:
            return slide
        upgraded = _detect_layout(slide, bullets) or "items"
        fn = _UPGRADERS.get(upgraded, _to_items)
        return fn(slide, bullets)
    except Exception as exc:
        logger.debug("[DesignEngine] slide design skipped (%s): %s", slide.get("title"), exc)
        return slide


def design_slides(slides: list[dict]) -> list[dict]:
    """Design-enrich a full deck. 100% local, always returns a complete deck
    (falls back to the original slide list on total failure)."""
    if not slides:
        return slides
    try:
        return [design_slide(s) for s in slides]
    except Exception as exc:
        logger.warning("[DesignEngine] Falling back to un-designed slides: %s", exc)
        return slides


def engine_status() -> dict[str, Any]:
    """Reported to the UI / logs so it's clear this is the active local
    design engine (no external service, always available)."""
    return {
        "engine": "local-design-engine",
        "available": True,
        "mode": "local",
        "description": "Local-first layout/icon/visual-hierarchy planner — "
                       "no network dependency, always available.",
    }
