"""
theme_engine.py
================
Single source of truth for the consulting-grade visual design system used by
BOTH slide-rendering paths:

  * pptx_builder.py            → editable .pptx (python-pptx)
  * video_pipeline_local.py    → 1920×1080 slide PNGs (Pillow) for the video

Keeping the palette, typography, spacing scale and iconography in one module
means the downloadable PowerPoint and the rendered video are pixel-consistent
and always look like they came out of the same consulting studio.

Design DNA is benchmarked against the attached EY corporate template:
  * Font family : EYInterstate (Light for body, Regular/Bold for headings)
                  → falls back gracefully to Arial / Helvetica Neue / Avenir
  * Yellow      : FFE600  (EY signature accent)
  * Charcoal    : 2E2E38  (EY primary dark — NOT navy)
  * Off-white   : FFFFFF / F6F6FA
  * Muted grey  : DEDEE2 / 747480

The module is deliberately framework-free (no pptx / PIL imports) so it can be
consumed by either renderer without pulling heavy dependencies.
"""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Typography — primary is the real EY corporate face; the fallbacks are the
# closest metrically-compatible system faces so local rendering (which usually
# lacks the licensed EY font) still looks professional.
# ---------------------------------------------------------------------------

FONT_STACK = {
    # For python-pptx we set a single family string; PowerPoint on a machine
    # with the EY fonts installed will pick EYInterstate, everyone else Arial.
    "pptx_heading": "EYInterstate",
    "pptx_body": "EYInterstate Light",
    "pptx_fallback": "Arial",
    # For Pillow we need real font *files* — these ship on macOS and are the
    # closest humanist-geometric match to EYInterstate.
    "pillow_candidates_regular": [
        ("/System/Library/Fonts/Avenir Next.ttc", 0),
        ("/System/Library/Fonts/HelveticaNeue.ttc", 0),
        ("/System/Library/Fonts/Helvetica.ttc", 0),
        ("/Library/Fonts/Arial.ttf", None),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", None),
    ],
    "pillow_candidates_bold": [
        ("/System/Library/Fonts/Avenir Next.ttc", 3),
        ("/System/Library/Fonts/HelveticaNeue.ttc", 1),
        ("/System/Library/Fonts/Helvetica.ttc", 1),
        ("/Library/Fonts/Arial Bold.ttf", None),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", None),
    ],
    "pillow_candidates_light": [
        ("/System/Library/Fonts/Avenir Next.ttc", 1),
        ("/System/Library/Fonts/HelveticaNeue.ttc", 2),
        ("/System/Library/Fonts/Helvetica.ttc", 0),
        ("/Library/Fonts/Arial.ttf", None),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", None),
    ],
}


# ---------------------------------------------------------------------------
# Themes — each palette is a flat dict of hex strings (no leading '#').
# `ey` is the new authentic EY palette and is now the default everywhere.
# The previous ids (ey_dark / ey_light / mckinsey) are preserved so nothing
# that referenced them breaks; ey_dark is re-tuned to the real charcoal.
# ---------------------------------------------------------------------------

THEMES: dict[str, dict[str, Any]] = {
    # ── Authentic EY (light canvas, charcoal + yellow) — flagship ──────────
    "ey": {
        "label": "EY Consulting",
        "mode": "light",
        "bg": "FFFFFF",
        "bg2": "F6F6FA",          # panel / card fill
        "bg3": "2E2E38",          # charcoal band (headers, dividers)
        "accent": "FFE600",       # EY yellow
        "accent2": "2E2E38",      # charcoal
        "accent3": "747480",      # steel grey
        "title_text": "2E2E38",
        "body_text": "3A3A45",
        "muted": "747480",
        "hairline": "DEDEE2",
        "on_dark": "FFFFFF",      # text on charcoal
        "on_accent": "2E2E38",    # text on yellow
        "table_hdr": "2E2E38",
        "table_hdr_text": "FFFFFF",
        "table_alt": "F2F2F6",
        "success": "2DB757",      # EY-consistent green
        "warning": "FF9831",
        "danger": "E00000",
        "info": "188CE5",         # EY blue
        "chart_series": ["FFE600", "2E2E38", "188CE5", "2DB757", "FF9831", "747480"],
    },
    # ── EY dark (charcoal canvas) — for on-screen / video hero decks ───────
    "ey_dark": {
        "label": "EY Dark",
        "mode": "dark",
        "bg": "2E2E38",
        "bg2": "3A3A45",
        "bg3": "23232B",
        "accent": "FFE600",
        "accent2": "F5C518",
        "accent3": "747480",
        "title_text": "FFFFFF",
        "body_text": "DEDEE2",
        "muted": "9B9BA8",
        "hairline": "4A4A55",
        "on_dark": "FFFFFF",
        "on_accent": "2E2E38",
        "table_hdr": "FFE600",
        "table_hdr_text": "2E2E38",
        "table_alt": "3A3A45",
        "success": "2DB757",
        "warning": "FF9831",
        "danger": "FF5B5B",
        "info": "4FC3F7",
        "chart_series": ["FFE600", "4FC3F7", "2DB757", "FF9831", "DEDEE2", "747480"],
    },
    # ── EY light (kept for back-compat; now points at authentic palette) ───
    "ey_light": {
        "label": "EY Light",
        "mode": "light",
        "bg": "FFFFFF",
        "bg2": "F6F6FA",
        "bg3": "2E2E38",
        "accent": "FFE600",
        "accent2": "2E2E38",
        "accent3": "747480",
        "title_text": "2E2E38",
        "body_text": "3A3A45",
        "muted": "747480",
        "hairline": "DEDEE2",
        "on_dark": "FFFFFF",
        "on_accent": "2E2E38",
        "table_hdr": "2E2E38",
        "table_hdr_text": "FFFFFF",
        "table_alt": "F2F2F6",
        "success": "2DB757",
        "warning": "FF9831",
        "danger": "E00000",
        "info": "188CE5",
        "chart_series": ["FFE600", "2E2E38", "188CE5", "2DB757", "FF9831", "747480"],
    },
    # ── McKinsey deep blue ─────────────────────────────────────────────────
    "mckinsey": {
        "label": "Deep Blue",
        "mode": "light",
        "bg": "FFFFFF",
        "bg2": "EEF3F8",
        "bg3": "051C2C",
        "accent": "051C2C",
        "accent2": "2251FF",
        "accent3": "6A7580",
        "title_text": "051C2C",
        "body_text": "23303B",
        "muted": "6A7580",
        "hairline": "D5DEE7",
        "on_dark": "FFFFFF",
        "on_accent": "FFFFFF",
        "table_hdr": "051C2C",
        "table_hdr_text": "FFFFFF",
        "table_alt": "EEF3F8",
        "success": "1F9D55",
        "warning": "C77700",
        "danger": "C0392B",
        "info": "2251FF",
        "chart_series": ["2251FF", "051C2C", "00A9F4", "1F9D55", "C77700", "6A7580"],
    },
}

DEFAULT_THEME = "ey"


def get_theme(theme_id: str | None) -> dict[str, Any]:
    """Return a theme dict, tolerant of unknown / None ids and legacy hex ids."""
    if not theme_id:
        return THEMES[DEFAULT_THEME]
    tid = str(theme_id).strip().lower().replace(" ", "_")
    # Friendly aliases coming from the frontend theme picker
    alias = {
        "ey_theme": "ey", "ey_consulting": "ey", "consulting": "ey",
        "dark": "ey_dark", "light": "ey", "deep_blue": "mckinsey",
        "mckinsey_blue": "mckinsey",
    }
    tid = alias.get(tid, tid)
    return THEMES.get(tid, THEMES[DEFAULT_THEME])


# ---------------------------------------------------------------------------
# Spacing / layout scale (in inches for a 13.33 × 7.5 widescreen canvas).
# A shared scale keeps margins, gutters and header heights identical between
# the .pptx and the video frames.
# ---------------------------------------------------------------------------

CANVAS = {"w": 13.333, "h": 7.5}
LAYOUT = {
    "margin_x": 0.55,          # generous side whitespace (consulting standard)
    "margin_top": 0.5,
    "header_h": 1.15,          # title band height
    "content_top": 1.75,       # first content baseline below header
    "content_bottom": 6.95,    # above footer
    "footer_y": 7.05,
    "gutter": 0.28,            # gap between cards/columns
    "card_radius": 0.08,
    "accent_bar_w": 0.09,      # left/kicker accent bar thickness
}


# ---------------------------------------------------------------------------
# Iconography — professional glyphs (rendered as vector text). Kept as a
# mapping so both renderers speak the same icon language and slide specs can
# reference icons by semantic name instead of hardcoding emoji.
# ---------------------------------------------------------------------------

ICONS = {
    "check": "✓", "arrow": "→", "bullet": "▪", "star": "★",
    "shield": "⛊", "lock": "🔒", "gear": "⚙", "cloud": "☁",
    "database": "🗄", "chart": "📊", "rocket": "🚀", "flag": "⚑",
    "users": "👥", "code": "</>", "api": "⇄", "test": "✔",
    "layers": "▤", "flow": "⤳", "money": "$", "growth": "↗",
    "target": "◎", "clock": "⏱", "warning": "⚠", "idea": "💡",
    "doc": "▤", "network": "⧉", "brain": "◈", "eye": "◉",
}


def icon(name: str, default: str = "▪") -> str:
    return ICONS.get(str(name).lower().strip(), default)


# ---------------------------------------------------------------------------
# Canonical consulting deck section arc — used by the planner / storytelling
# agent so every generated deck follows the same executive narrative flow.
# ---------------------------------------------------------------------------

NARRATIVE_ARC = [
    "title",
    "agenda",
    "business_use_case",
    "problem_statement",
    "existing_challenges",
    "proposed_solution",
    "why_this_solution",
    "architecture",
    "agent_workflow",
    "technology_stack",
    "implementation_approach",
    "deliverables",
    "demonstration",
    "business_benefits",
    "roi",
    "future_scope",
    "conclusion",
]
