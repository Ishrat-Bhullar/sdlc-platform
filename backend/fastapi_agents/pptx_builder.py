"""
pptx_builder.py
================
Builds a client-ready .pptx presentation from SDLC artifacts.

Two entry points:
  build_pptx(pptx_spec, project_name)  — from AI agent pptx_spec
  build_pptx_from_deck(slides, project_name, theme_id)  — from slide_deck_builder

Design principles:
  - EY-style dark/light themes (configurable)
  - Full-bleed title slide with diagonal accent
  - Section divider slides
  - Table, bullet, two-column, stats, chart, timeline, closing layouts
  - Speaker notes on every slide
  - Proper fonts: Calibri/Helvetica hierarchy
"""
from __future__ import annotations

import io
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# ── Color palettes ────────────────────────────────────────────────────────────

THEMES = {
    "ey_dark": {
        "bg":          "1A1A2E",
        "bg2":         "16213E",
        "accent":      "FFE600",
        "accent2":     "F5C518",
        "title_text":  "FFFFFF",
        "body_text":   "C8C8D7",
        "muted":       "787890",
        "table_hdr":   "FFE600",
        "table_hdr_text": "1A1A2E",
        "table_alt":   "262640",
        "success":     "50C878",
        "warning":     "FFA500",
        "info":        "64A0FF",
    },
    "ey_light": {
        "bg":          "FFFFFF",
        "bg2":         "F4F4F8",
        "accent":      "FFD600",
        "accent2":     "1A1A2E",
        "title_text":  "1A1A2E",
        "body_text":   "373750",
        "muted":       "8888A0",
        "table_hdr":   "1A1A2E",
        "table_hdr_text": "FFFFFF",
        "table_alt":   "F0F0F8",
        "success":     "28A050",
        "warning":     "C86400",
        "info":        "1E5AC8",
    },
    "mckinsey": {
        "bg":          "FFFFFF",
        "bg2":         "F0F4F8",
        "accent":      "003865",
        "accent2":     "005B99",
        "title_text":  "003865",
        "body_text":   "222232",
        "muted":       "8C8CA0",
        "table_hdr":   "003865",
        "table_hdr_text": "FFFFFF",
        "table_alt":   "E8EFF6",
        "success":     "008050",
        "warning":     "B45000",
        "info":        "005099",
    },
}


def _rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _emu(inches: float) -> int:
    return int(inches * 914400)


# ── Main entry points ─────────────────────────────────────────────────────────

def build_pptx(pptx_spec: dict[str, Any], project_name: str = "SDLC Project") -> bytes:
    """Build PPTX from AI agent pptx_spec."""
    from fastapi_agents.slide_deck_builder import build_deck
    theme_id = pptx_spec.get("theme", {}).get("theme_id", "ey_dark") if isinstance(pptx_spec.get("theme"), dict) else "ey_dark"

    # If pptx_spec has rich slides, use them directly
    slides_data = pptx_spec.get("slides", [])

    # Build deck-style slides from spec slides
    deck_slides = []
    for s in slides_data:
        layout_cfg = s.get("pptx_layout", {})
        is_title = layout_cfg.get("layout_type") == "TITLE_SLIDE"
        content = s.get("content", {})
        bullets = content.get("bullets", []) if isinstance(content, dict) else []
        body = content.get("body_text", "") if isinstance(content, dict) else str(content)
        data_pts = content.get("data_points", []) if isinstance(content, dict) else []

        if is_title:
            deck_slides.append({
                "layout": "title",
                "title": s.get("title", project_name),
                "subtitle": s.get("subtitle", ""),
                "speaker_notes": s.get("speaker_notes", ""),
                "badge": "EXECUTIVE BRIEF",
            })
        elif data_pts:
            stats = [{"value": d.get("value", ""), "label": d.get("label", ""), "sub": d.get("context", "")} for d in data_pts[:4]]
            deck_slides.append({
                "layout": "stats_grid",
                "title": s.get("title", ""),
                "subtitle": s.get("subtitle", ""),
                "stats": stats,
                "speaker_notes": s.get("speaker_notes", ""),
            })
        elif bullets:
            deck_slides.append({
                "layout": "items",
                "title": s.get("title", ""),
                "subtitle": s.get("subtitle", ""),
                "items": [{"icon": "check", "title": b, "body": ""} for b in bullets],
                "speaker_notes": s.get("speaker_notes", ""),
            })
        elif body:
            deck_slides.append({
                "layout": "content",
                "title": s.get("title", ""),
                "subtitle": s.get("subtitle", ""),
                "content": body,
                "speaker_notes": s.get("speaker_notes", ""),
            })

    if not deck_slides:
        # Fall back to building a full deck from scratch
        deck_slides = build_deck([], project_name)

    return _build_from_slides(deck_slides, project_name, theme_id)


def build_pptx_from_deck(slides: list[dict], project_name: str = "SDLC Project", theme_id: str = "ey_dark") -> bytes:
    """Build PPTX directly from slide_deck_builder slides."""
    return _build_from_slides(slides, project_name, theme_id)


# ── Core builder ──────────────────────────────────────────────────────────────

def _build_from_slides(slides: list[dict], project_name: str, theme_id: str = "ey_dark") -> bytes:
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt, Emu
        from pptx.dml.color import RGBColor
        from pptx.enum.text import PP_ALIGN
        from pptx.oxml.ns import qn
        import lxml.etree as etree
    except ImportError:
        raise RuntimeError("python-pptx not installed: pip install python-pptx")

    theme = THEMES.get(theme_id, THEMES["ey_dark"])
    bg_rgb = RGBColor(*_rgb(theme["bg"]))
    bg2_rgb = RGBColor(*_rgb(theme["bg2"]))
    accent_rgb = RGBColor(*_rgb(theme["accent"]))
    accent2_rgb = RGBColor(*_rgb(theme["accent2"]))
    title_rgb = RGBColor(*_rgb(theme["title_text"]))
    body_rgb = RGBColor(*_rgb(theme["body_text"]))
    muted_rgb = RGBColor(*_rgb(theme["muted"]))

    prs = Presentation()
    prs.slide_width = Emu(_emu(13.33))
    prs.slide_height = Emu(_emu(7.5))
    blank_layout = prs.slide_layouts[6]

    def _bg(slide):
        bg = slide.background
        bg.fill.solid()
        bg.fill.fore_color.rgb = bg_rgb

    def _rect(slide, l, t, w, h, fill_rgb, line=False):
        from pptx.util import Emu
        shape = slide.shapes.add_shape(1, Emu(_emu(l)), Emu(_emu(t)), Emu(_emu(w)), Emu(_emu(h)))
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill_rgb
        if line:
            shape.line.color.rgb = fill_rgb
            shape.line.width = Emu(12700)
        else:
            shape.line.fill.background()
        return shape

    def _tb(slide, text, l, t, w, h, size=18, bold=False, color=None, italic=False,
            align=PP_ALIGN.LEFT, wrap=True, font="Calibri"):
        from pptx.util import Emu, Pt
        txb = slide.shapes.add_textbox(Emu(_emu(l)), Emu(_emu(t)), Emu(_emu(w)), Emu(_emu(h)))
        tf = txb.text_frame
        tf.word_wrap = wrap
        p = tf.paragraphs[0]
        p.alignment = align
        run = p.add_run()
        run.text = str(text)
        run.font.name = font
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.italic = italic
        run.font.color.rgb = color or body_rgb
        return txb

    def _bullets_tb(slide, items, l, t, w, h, size=15, color=None, font="Calibri", line_spacing=1.3):
        from pptx.util import Emu, Pt
        from pptx.oxml.ns import qn
        import lxml.etree as etree
        txb = slide.shapes.add_textbox(Emu(_emu(l)), Emu(_emu(t)), Emu(_emu(w)), Emu(_emu(h)))
        tf = txb.text_frame
        tf.word_wrap = True
        for i, item in enumerate(items):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.space_before = Pt(4)
            # Bullet character
            run = p.add_run()
            run.text = f"  {item}"
            run.font.name = font
            run.font.size = Pt(size)
            run.font.color.rgb = color or body_rgb
        return txb

    def _notes(slide, text):
        if text:
            slide.notes_slide.notes_text_frame.text = str(text)

    def _footer(slide, slide_num, total, title=""):
        # Footer bar
        _rect(slide, 0, 7.1, 13.33, 0.4, RGBColor(*_rgb(theme["bg2"])))
        # Accent line above footer
        _rect(slide, 0, 7.09, 13.33, 0.02, accent_rgb)
        # Brand left
        _tb(slide, "EY  ·  Autonomous SDLC Studio", 0.3, 7.14, 5, 0.32,
            size=10, color=muted_rgb, bold=False)
        # Title center
        if title:
            _tb(slide, title[:60], 4.5, 7.14, 4.5, 0.32,
                size=10, color=muted_rgb, align=PP_ALIGN.CENTER)
        # Slide number right
        _tb(slide, f"{slide_num}  /  {total}", 11.5, 7.14, 1.6, 0.32,
            size=10, color=muted_rgb, align=PP_ALIGN.RIGHT)

    # ── Build each slide ──────────────────────────────────────────────────────
    total = len(slides)
    for idx, s in enumerate(slides):
        layout = s.get("layout", "content")
        slide_num = idx + 1
        slide = prs.slides.add_slide(blank_layout)
        _bg(slide)
        title = s.get("title", "")
        subtitle = s.get("subtitle", "")
        notes_text = s.get("speaker_notes", "")

        # ── Title slide ───────────────────────────────────────────────────────
        if layout == "title" or idx == 0:
            # Full-bleed diagonal accent block (top-left triangle)
            _rect(slide, 0, 0, 13.33, 0.08, accent_rgb)
            # Large left accent bar
            _rect(slide, 0, 0.08, 0.12, 7.02, accent_rgb)
            # Bottom decorative block
            _rect(slide, 0, 6.8, 13.33, 0.3, RGBColor(*_rgb(theme["bg2"])))
            # Title
            txb = slide.shapes.add_textbox(Emu(_emu(0.4)), Emu(_emu(1.8)), Emu(_emu(9.0)), Emu(_emu(2.6)))
            tf = txb.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]
            run = p.add_run(); run.text = title
            run.font.name = "Calibri"; run.font.size = Pt(52); run.font.bold = True
            run.font.color.rgb = title_rgb
            # Accent divider
            _rect(slide, 0.4, 4.6, 5.0, 0.06, accent_rgb)
            # Subtitle
            _tb(slide, subtitle or "AI-Autonomous SDLC Platform", 0.4, 4.8, 9.0, 1.0,
                size=22, color=body_rgb)
            # Date + badge
            date_str = datetime.now().strftime("%B %Y")
            _tb(slide, f"CONFIDENTIAL  ·  {date_str}", 0.4, 6.2, 6.0, 0.5,
                size=12, color=muted_rgb, italic=True)
            badge = s.get("badge", "")
            if badge:
                _rect(slide, 10.8, 0.3, 2.2, 0.55, accent_rgb)
                _tb(slide, badge, 10.85, 0.36, 2.1, 0.42,
                    size=13, bold=True, color=RGBColor(*_rgb(theme["table_hdr_text"])))
            _notes(slide, notes_text)
            continue

        # ── Closing slide ─────────────────────────────────────────────────────
        if layout == "closing":
            _rect(slide, 0, 0, 13.33, 0.08, accent_rgb)
            _rect(slide, 0, 0.08, 0.12, 7.02, accent_rgb)
            _rect(slide, 0, 2.0, 13.33, 2.2, RGBColor(*_rgb(theme["bg2"])))
            _tb(slide, title, 0.4, 0.3, 12.5, 1.5, size=46, bold=True, color=title_rgb)
            _tb(slide, subtitle, 0.4, 1.6, 12.5, 0.5, size=18, color=muted_rgb)
            items = s.get("items", [])
            y = 2.1
            for item in items[:4]:
                _rect(slide, 0.5, y + 0.02, 0.06, 0.4, accent_rgb)
                _tb(slide, item.get("title", ""), 0.8, y, 6.0, 0.5, size=18, bold=True, color=title_rgb)
                _tb(slide, item.get("body", ""), 0.8, y + 0.44, 12.0, 0.38, size=13, color=body_rgb)
                y += 1.0
            _footer(slide, slide_num, total, title)
            _notes(slide, notes_text)
            continue

        # ── Non-title slides: standard header ─────────────────────────────────
        # Top accent bar
        _rect(slide, 0, 0, 13.33, 0.07, accent_rgb)
        # Title header band
        _rect(slide, 0, 0.07, 13.33, 1.15, RGBColor(*_rgb(theme["bg2"])))
        # Left accent bar
        _rect(slide, 0, 0.07, 0.1, 7.03, accent_rgb)
        # Title text
        _tb(slide, title, 0.25, 0.12, 11.5, 0.9, size=32, bold=True, color=title_rgb)
        # Subtitle
        _tb(slide, subtitle, 0.25, 0.9, 11.5, 0.38, size=14, color=muted_rgb)
        # Right panel background (for context callouts)
        content_y = 1.35

        # ── Stats grid ────────────────────────────────────────────────────────
        if layout == "stats_grid":
            stats = s.get("stats", [])
            cols = 2; rows_n = (len(stats) + 1) // 2
            cw = 6.3; ch = (7.1 - content_y - 0.05) / max(rows_n, 1)
            for i, stat in enumerate(stats[:4]):
                col = i % cols; row = i // cols
                cx = 0.2 + col * (cw + 0.13); cy = content_y + row * (ch + 0.08)
                # Card
                _rect(slide, cx, cy, cw, ch - 0.08, RGBColor(*_rgb(theme["bg2"])))
                # Left accent strip
                _rect(slide, cx, cy, 0.12, ch - 0.08, accent_rgb)
                # Big value
                _tb(slide, stat.get("value", ""), cx + 0.25, cy + 0.12,
                    cw - 0.4, ch * 0.55, size=60, bold=True, color=accent_rgb)
                # Label
                _tb(slide, stat.get("label", ""), cx + 0.25, cy + ch * 0.6,
                    cw - 0.4, 0.45, size=18, bold=True, color=title_rgb)
                # Sub
                _tb(slide, stat.get("sub", ""), cx + 0.25, cy + ch * 0.6 + 0.42,
                    cw - 0.4, 0.38, size=12, color=muted_rgb)
            _footer(slide, slide_num, total, title)
            _notes(slide, notes_text)
            continue

        # ── Items layout ──────────────────────────────────────────────────────
        if layout == "items":
            items = s.get("items", [])
            content = s.get("content", "")
            iw = 12.7; item_h = 0.88
            max_items = min(len(items), int((7.1 - content_y - 0.1) / item_h))
            y = content_y
            for j, item in enumerate(items[:max_items]):
                # Numbered badge
                _rect(slide, 0.25, y + 0.04, 0.46, 0.46, accent_rgb)
                badge_tc = RGBColor(*_rgb(theme["table_hdr_text"]))
                icon = "✓" if item.get("icon") == "check" else "→"
                _tb(slide, icon, 0.28, y + 0.06, 0.4, 0.38,
                    size=14, bold=True, color=badge_tc, align=PP_ALIGN.CENTER)
                # Title
                _tb(slide, item.get("title", ""), 0.84, y, iw - 0.84, 0.44,
                    size=17, bold=True, color=title_rgb)
                # Body
                body_t = item.get("body", "")
                if body_t:
                    _tb(slide, body_t, 0.84, y + 0.42, iw - 0.84, 0.38,
                        size=13, color=body_rgb)
                # Separator
                _rect(slide, 0.25, y + item_h - 0.05, iw, 0.01, RGBColor(*_rgb(theme["bg2"])))
                y += item_h
            if content:
                _tb(slide, content, 0.25, y + 0.1, 12.7, 0.6, size=13, color=muted_rgb)
            _footer(slide, slide_num, total, title)
            _notes(slide, notes_text)
            continue

        # ── Table layout ──────────────────────────────────────────────────────
        if layout == "table":
            table_data = s.get("table", {})
            headers = table_data.get("headers", [])
            data_rows = table_data.get("rows", [])
            callout = s.get("callout")

            tbl_w = 12.7 if not callout else 8.5
            col_w = tbl_w / max(len(headers), 1)

            # Header row
            hdr_y = content_y
            hdr_rgb = RGBColor(*_rgb(theme["table_hdr"]))
            hdr_tc = RGBColor(*_rgb(theme["table_hdr_text"]))
            _rect(slide, 0.25, hdr_y, tbl_w, 0.5, hdr_rgb)
            for hi, h in enumerate(headers):
                _tb(slide, h, 0.25 + hi * col_w + 0.06, hdr_y + 0.06,
                    col_w - 0.1, 0.38, size=13, bold=True, color=hdr_tc)

            # Data rows
            row_h = 0.44
            alt_rgb = RGBColor(*_rgb(theme["table_alt"]))
            for ri, row in enumerate(data_rows[:12]):
                ry = hdr_y + 0.5 + ri * row_h
                if ry + row_h > 7.1:
                    break
                if ri % 2 == 1:
                    _rect(slide, 0.25, ry, tbl_w, row_h, alt_rgb)
                for ci, cell in enumerate(row[:len(headers)]):
                    cell_color = body_rgb
                    # Highlight status-like values
                    cell_str = str(cell)
                    if cell_str.upper() in ("CRITICAL", "HIGH", "FAILED"):
                        cell_color = RGBColor(*_rgb(theme.get("warning", "FFA500")))
                    elif cell_str.upper() in ("PASSED", "COMPLIANT", "✓"):
                        cell_color = RGBColor(*_rgb(theme.get("success", "50C878")))
                    _tb(slide, cell_str[:38], 0.25 + ci * col_w + 0.06, ry + 0.05,
                        col_w - 0.1, row_h - 0.08, size=12, color=cell_color)

            # Callout box
            if callout:
                cx = tbl_w + 0.5
                ctype = callout.get("type", "info")
                ccolor_map = {"info": theme["info"], "success": theme["success"], "warning": theme["warning"]}
                ccolor = RGBColor(*_rgb(ccolor_map.get(ctype, theme["info"])))
                _rect(slide, cx, content_y, 4.3, 0.06, ccolor)
                _rect(slide, cx, content_y + 0.06, 4.3, 5.4, RGBColor(*_rgb(theme["bg2"])))
                _tb(slide, callout.get("title", ""), cx + 0.15, content_y + 0.15,
                    4.0, 0.5, size=15, bold=True, color=ccolor)
                cbody = callout.get("body", "")
                lines = cbody.split("\n")
                _bullets_tb(slide, [l.lstrip("• ").strip() for l in lines if l.strip()],
                            cx + 0.12, content_y + 0.7, 4.05, 5.0, size=12)

            _footer(slide, slide_num, total, title)
            _notes(slide, notes_text)
            continue

        # ── Chart layout ──────────────────────────────────────────────────────
        if layout == "chart":
            chart_data = s.get("chart", {})
            data_items = chart_data.get("data", [])
            callout = s.get("callout")
            chart_w = 8.2 if callout else 12.7
            bar_h_in = 0.46
            label_w_in = 3.2
            track_start = 0.25 + label_w_in + 0.1
            track_w = chart_w - label_w_in - 0.6

            y_c = content_y + 0.25
            chart_label = chart_data.get("label", "")
            if chart_label:
                _tb(slide, chart_label, 0.25, content_y, 9.0, 0.3, size=13, color=muted_rgb, italic=True)

            for di, item in enumerate(data_items[:7]):
                lbl = str(item.get("label", ""))[:36]
                val = float(item.get("value", 0))
                mx = float(item.get("max", 100))
                ratio = min(val / mx, 1.0) if mx > 0 else 0
                fill_w = max(track_w * ratio, 0.05)

                # Label
                _tb(slide, lbl, 0.25, y_c + 0.04, label_w_in, bar_h_in - 0.06, size=14, color=body_rgb)
                # Track
                _rect(slide, track_start, y_c + 0.07, track_w, bar_h_in - 0.14,
                      RGBColor(*_rgb(theme["bg2"])))
                # Fill bar
                _rect(slide, track_start, y_c + 0.07, fill_w, bar_h_in - 0.14, accent_rgb)
                # Value text
                val_str = f"{val:.0f}%" if mx == 100 else f"{val:.0f}"
                _tb(slide, val_str, track_start + fill_w + 0.1, y_c + 0.06,
                    1.0, bar_h_in, size=14, bold=True, color=accent_rgb)

                y_c += bar_h_in + 0.16
                if y_c > 7.0:
                    break

            # Callout
            if callout:
                cx = chart_w + 0.5
                ctype = callout.get("type", "info")
                ccolor_map = {"info": theme["info"], "success": theme["success"], "warning": theme["warning"]}
                ccolor = RGBColor(*_rgb(ccolor_map.get(ctype, theme["info"])))
                _rect(slide, cx, content_y, 4.5, 0.06, ccolor)
                _rect(slide, cx, content_y + 0.06, 4.5, 5.5, RGBColor(*_rgb(theme["bg2"])))
                _tb(slide, callout.get("title", ""), cx + 0.15, content_y + 0.15,
                    4.2, 0.5, size=15, bold=True, color=ccolor)
                lines = callout.get("body", "").split("\n")
                _bullets_tb(slide, [l.lstrip("• ✓").strip() for l in lines if l.strip()],
                            cx + 0.15, content_y + 0.72, 4.2, 5.0, size=12)

            _footer(slide, slide_num, total, title)
            _notes(slide, notes_text)
            continue

        # ── Two-column layout ─────────────────────────────────────────────────
        if layout in ("two_col", "two_column"):
            mid = 6.6
            lh = s.get("left_header", "")
            rh = s.get("right_header", "")
            lc = s.get("left_content", "")
            rc = s.get("right_content", "")

            # Divider
            _rect(slide, mid - 0.01, content_y, 0.02, 5.6, RGBColor(*_rgb(theme["muted"])))

            # Left column
            if lh:
                _rect(slide, 0.25, content_y, 5.5, 0.04, accent_rgb)
                _tb(slide, lh, 0.25, content_y + 0.1, 5.5, 0.5, size=16, bold=True, color=accent_rgb)
            lines_l = [l.strip() for l in lc.split("\n") if l.strip()]
            _bullets_tb(slide, lines_l, 0.25, content_y + 0.7, 6.0, 5.0, size=14)

            # Right column
            if rh:
                _rect(slide, mid + 0.15, content_y, 6.5, 0.04, accent_rgb)
                _tb(slide, rh, mid + 0.15, content_y + 0.1, 6.5, 0.5, size=16, bold=True, color=accent_rgb)
            lines_r = [l.strip() for l in rc.split("\n") if l.strip()]
            _bullets_tb(slide, lines_r, mid + 0.15, content_y + 0.7, 6.5, 5.0, size=14)

            _footer(slide, slide_num, total, title)
            _notes(slide, notes_text)
            continue

        # ── Tech grid layout ──────────────────────────────────────────────────
        if layout == "tech_grid":
            tech_items = s.get("tech_items", [])
            cols_n = 2; card_w = 6.3; card_h = 0.9; gap = 0.12
            for ti, tech in enumerate(tech_items[:8]):
                col = ti % cols_n; row = ti // cols_n
                cx = 0.2 + col * (card_w + gap)
                cy = content_y + row * (card_h + gap)
                _rect(slide, cx, cy, card_w, card_h, RGBColor(*_rgb(theme["bg2"])))
                _rect(slide, cx, cy, 0.09, card_h, accent_rgb)
                icon = str(tech.get("icon", "•"))[:2]
                layer = str(tech.get("layer", ""))
                tech_name = str(tech.get("tech", ""))
                _tb(slide, icon, cx + 0.18, cy + 0.15, 0.5, 0.5, size=22)
                _tb(slide, layer, cx + 0.78, cy + 0.08, card_w - 0.9, 0.32,
                    size=11, color=muted_rgb, italic=True)
                _tb(slide, tech_name, cx + 0.78, cy + 0.38, card_w - 0.9, 0.42,
                    size=15, bold=True, color=title_rgb)
            _footer(slide, slide_num, total, title)
            _notes(slide, notes_text)
            continue

        # ── Timeline layout ───────────────────────────────────────────────────
        if layout == "timeline":
            events = s.get("timeline", [])
            n = min(len(events), 7)
            if n == 0:
                _footer(slide, slide_num, total, title)
                _notes(slide, notes_text)
                continue

            # Horizontal line
            tl_y = 4.0
            start_x = 0.5; end_x = 12.8
            step = (end_x - start_x) / max(n - 1, 1)
            _rect(slide, start_x, tl_y - 0.01, end_x - start_x, 0.04, RGBColor(*_rgb(theme["muted"])))

            for ei, ev in enumerate(events[:n]):
                ex = start_x + ei * step
                # Node
                _rect(slide, ex - 0.15, tl_y - 0.15, 0.3, 0.3, accent_rgb)
                # Date above
                _tb(slide, str(ev.get("date", ""))[:10], ex - 0.8, tl_y - 0.75, 1.6, 0.4,
                    size=11, color=accent_rgb, bold=True, align=PP_ALIGN.CENTER)
                # Title below
                _tb(slide, str(ev.get("title", ""))[:12], ex - 0.8, tl_y + 0.2, 1.6, 0.4,
                    size=13, bold=True, color=title_rgb, align=PP_ALIGN.CENTER)
                # Desc
                _tb(slide, str(ev.get("desc", ""))[:14], ex - 0.8, tl_y + 0.62, 1.6, 0.4,
                    size=10, color=muted_rgb, align=PP_ALIGN.CENTER)

            _footer(slide, slide_num, total, title)
            _notes(slide, notes_text)
            continue

        # ── Fallback: content layout ──────────────────────────────────────────
        content_text = s.get("content", "") or subtitle
        lines = [l.strip() for l in content_text.replace("•", "\n•").split("\n") if l.strip()]
        if lines:
            _bullets_tb(slide, lines, 0.25, content_y, 12.7, 5.5, size=15)
        _footer(slide, slide_num, total, title)
        _notes(slide, notes_text)

    # Serialize
    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    logger.info("[PptxBuilder] Built %d slides (%d bytes)", total, buf.getbuffer().nbytes)
    return buf.getvalue()
