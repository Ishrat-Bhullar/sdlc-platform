"""
visual_asset_planner.py
========================
Public "Visual Asset Planner" seam. Deterministic icon selection is already
implemented and proven in design_engine.py (_ICON_HINTS / _icon_for) and is
used as-is here — this module adds only the optional LLM-assisted fallback
for content that matches none of the curated keyword hints, and a clean,
documented public entry point for other pipeline stages to call.
"""
from __future__ import annotations

from . import design_engine as DE
from . import theme_engine as TE


def pick_icon(text: str, *, use_llm_fallback: bool = False, llm=None) -> str:
    """Best-fit icon name (a key in theme_engine.ICONS) for the given slide
    text/topic. Deterministic keyword match first (design_engine._icon_for);
    optionally falls back to a single cheap LLM call only when nothing
    matched and a caller explicitly opts in (kept opt-in so the common path
    stays instant and free)."""
    icon_name = DE._icon_for(text)
    if icon_name != "check" or not use_llm_fallback or llm is None:
        return icon_name

    # "check" is design_engine's generic fallback — try one more LLM-assisted
    # pass only in that ambiguous case, and only if the caller supplied an
    # LLMService instance (never constructed here — no hidden network calls).
    try:
        available = ", ".join(sorted(TE.ICONS.keys()))
        prompt = (
            f"Pick exactly one icon name from this list that best represents "
            f"the following slide content. Reply with only the icon name, "
            f"nothing else.\n\nIcons: {available}\n\nContent: {text}"
        )
        reply = llm.generate_text(
            system="You select a single icon name from a fixed list. Reply with only the icon name.",
            prompt=prompt,
        )
        candidate = reply.strip().lower().split()[0].strip(".,\"'") if reply else ""
        if candidate in TE.ICONS:
            return candidate
    except Exception:
        pass
    return icon_name


def icon_glyph(name: str) -> str:
    """Convenience passthrough to theme_engine.icon() so callers of this
    planner don't need a second import for the common "resolve to glyph" step."""
    return TE.icon(name)
