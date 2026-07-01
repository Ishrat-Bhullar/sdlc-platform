"""
video_pipeline_local.py
========================
Fully local, open-source AI Presentation video generation pipeline.

TTS chain:     macOS `say` → espeak-ng → ffmpeg silence (never fails)
Slide render:  Pillow 1920×1080 PNG with EY/McKinsey/Minimal/Clean themes
               Layouts: title, content, two_col, table, chart, stats_grid,
                        items, tech_grid, timeline, closing, quote, metric
Video compose: pure FFmpeg subprocess — no MoviePy dependency
Avatar:        SadTalker — real AI lip-sync talking head (local, open-source)
               Face photo + audio → animated talking face MP4 via 3DMM + neural renderer

Progress is tracked in a module-level VIDEO_JOBS registry that routes poll.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import shutil
import subprocess
import textwrap
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

SLIDE_W, SLIDE_H = 1920, 1080
THUMB_W, THUMB_H = 320, 180

VIDEO_OUTPUT_DIR = Path(os.path.expanduser("~/.sdlc_studio/videos"))
VIDEO_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# macOS built-in voices (always available, no install needed)
VOICES: Dict[str, Dict[str, str]] = {
    "samantha":  {"name": "Samantha",  "lang": "en-US", "label": "Samantha — Female, American"},
    "alex":      {"name": "Alex",      "lang": "en-US", "label": "Alex — Male, American"},
    "victoria":  {"name": "Victoria",  "lang": "en-US", "label": "Victoria — Female, American (warm)"},
    "daniel":    {"name": "Daniel",    "lang": "en-GB", "label": "Daniel — Male, British"},
    "karen":     {"name": "Karen",     "lang": "en-AU", "label": "Karen — Female, Australian"},
    "moira":     {"name": "Moira",     "lang": "en-IE", "label": "Moira — Female, Irish"},
    "tom":       {"name": "Tom",       "lang": "en-US", "label": "Tom — Male, American (deep)"},
}

THEMES: Dict[str, Dict[str, Any]] = {
    "ey_dark": {
        "label": "EY Dark",
        "bg":            (26,  26,  46),
        "accent":        (255, 230,  0),
        "title_color":   (255, 255, 255),
        "body_color":    (200, 200, 215),
        "muted_color":   (120, 120, 145),
        "bar_color":     (255, 230,  0),
        "footer_color":  (46,  46,  80),
        "stripe_color":  (38,  38,  62),
        "table_header":  (255, 230,  0),
        "table_alt":     (38,  38,  65),
        "success_color": (80, 200, 120),
        "warning_color": (255, 165,  0),
        "info_color":    (100, 160, 255),
    },
    "ey_light": {
        "label": "EY Light",
        "bg":            (252, 252, 255),
        "accent":        (255, 214,  0),
        "title_color":   (26,  26,  46),
        "body_color":    (55,  55,  75),
        "muted_color":   (150, 150, 170),
        "bar_color":     (26,  26,  46),
        "footer_color":  (220, 220, 235),
        "stripe_color":  (242, 242, 250),
        "table_header":  (26,  26,  46),
        "table_alt":     (240, 240, 248),
        "success_color": (40, 160,  80),
        "warning_color": (200, 100,   0),
        "info_color":    (30,  90, 200),
    },
    "mckinsey": {
        "label": "McKinsey Blue",
        "bg":            (255, 255, 255),
        "accent":        (0,   56, 101),
        "title_color":   (0,   56, 101),
        "body_color":    (35,  35,  50),
        "muted_color":   (140, 140, 155),
        "bar_color":     (0,   56, 101),
        "footer_color":  (228, 234, 240),
        "stripe_color":  (244, 247, 250),
        "table_header":  (0,   56, 101),
        "table_alt":     (240, 245, 250),
        "success_color": (0,  128,  80),
        "warning_color": (180,  80,   0),
        "info_color":    (0,   80, 160),
    },
    "minimal": {
        "label": "Minimal Dark",
        "bg":            (12,  12,  20),
        "accent":        (99, 102, 241),
        "title_color":   (255, 255, 255),
        "body_color":    (175, 175, 200),
        "muted_color":   (80,  80, 105),
        "bar_color":     (99, 102, 241),
        "footer_color":  (28,  28,  45),
        "stripe_color":  (22,  22,  35),
        "table_header":  (99, 102, 241),
        "table_alt":     (22,  22,  38),
        "success_color": (80, 200, 120),
        "warning_color": (255, 165,  0),
        "info_color":    (100, 160, 255),
    },
}

# ── Font loading ─────────────────────────────────────────────────────────────

def _load_font(size: int, bold: bool = False):
    from PIL import ImageFont
    candidates = [
        ("/System/Library/Fonts/HelveticaNeue.ttc", 1 if bold else 0),
        ("/System/Library/Fonts/Helvetica.ttc",     0),
        ("/System/Library/Fonts/Avenir Next.ttc",   3 if bold else 0),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", None),
    ]
    for path, idx in candidates:
        if Path(path).exists():
            try:
                if idx is not None:
                    return ImageFont.truetype(path, size, index=idx)
                else:
                    return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


# ── Pillow slide renderer ─────────────────────────────────────────────────────

class PillowSlideRenderer:
    """Renders presentation slides as 1920×1080 PNG images using Pillow."""

    def render(
        self,
        slide: Dict[str, Any],
        theme_id: str,
        slide_num: int,
        total_slides: int,
    ) -> Any:
        from PIL import Image, ImageDraw, ImageFilter
        theme = THEMES.get(theme_id, THEMES["ey_dark"])
        layout = str(slide.get("layout", "content"))
        img = Image.new("RGB", (SLIDE_W, SLIDE_H), theme["bg"])
        draw = ImageDraw.Draw(img)

        # ── Premium background treatment ──────────────────────────────────────
        if layout in ("title", "closing"):
            # Rich diagonal gradient overlay for title/closing slides
            self._draw_gradient_bg(img, draw, theme, layout)
        elif layout not in ("stats_grid", "timeline"):
            # Right-panel accent block with decorative top triangle
            panel_x = SLIDE_W * 2 // 3
            draw.rectangle([(panel_x, 0), (SLIDE_W, SLIDE_H - 60)], fill=theme["stripe_color"])
            # Decorative accent corner triangle top-right
            draw.polygon([(panel_x, 0), (SLIDE_W, 0), (SLIDE_W, 120)], fill=theme["bar_color"])

        # ── Top accent bar (4px thick, full width) ────────────────────────────
        draw.rectangle([(0, 0), (SLIDE_W, 6)], fill=theme["accent"])

        # ── Left accent strip (vertical sidebar, content slides only) ─────────
        if layout not in ("title", "closing", "stats_grid"):
            draw.rectangle([(0, 6), (6, SLIDE_H - 60)], fill=theme["accent"])

        # ── Footer ────────────────────────────────────────────────────────────
        draw.rectangle([(0, SLIDE_H - 60), (SLIDE_W, SLIDE_H)], fill=theme["footer_color"])
        # Footer divider line
        draw.rectangle([(0, SLIDE_H - 60), (SLIDE_W, SLIDE_H - 58)], fill=theme["accent"])

        fn_font = _load_font(26)
        brand_font = _load_font(26, bold=True)
        slide_label = f"  {slide_num}  /  {total_slides}  "
        draw.text((SLIDE_W - 160, SLIDE_H - 42), slide_label, font=fn_font, fill=theme["muted_color"])
        draw.text((30, SLIDE_H - 42), "EY  ·  Autonomous SDLC Studio", font=brand_font, fill=theme["muted_color"])
        # Center footer: slide title abbreviated
        center_label = str(slide.get("title", ""))[:50]
        center_font = _load_font(22)
        try:
            cw = center_font.getlength(center_label)
        except Exception:
            cw = len(center_label) * 11
        draw.text(((SLIDE_W - cw) // 2, SLIDE_H - 42), center_label, font=center_font, fill=theme["muted_color"])

        # ── Dispatch to layout renderer ───────────────────────────────────────
        dispatch = {
            "title":        self._render_title_layout,
            "metric":       self._render_metric_layout,
            "quote":        self._render_quote_layout,
            "two_column":   self._render_two_col_layout,
            "two_col":      self._render_two_col_layout,
            "table":        self._render_table_layout,
            "chart":        self._render_chart_layout,
            "stats_grid":   self._render_stats_grid_layout,
            "items":        self._render_items_layout,
            "tech_grid":    self._render_tech_grid_layout,
            "timeline":     self._render_timeline_layout,
            "closing":      self._render_closing_layout,
        }
        renderer = dispatch.get(layout, self._render_content_layout)
        if layout == "title" or slide_num == 1:
            renderer = self._render_title_layout
        renderer(draw, slide, theme)

        return img

    def _draw_gradient_bg(self, img, draw, theme, layout: str) -> None:
        """Draw a subtle diagonal gradient for title/closing slides."""
        bg = theme["bg"]
        accent = theme["accent"]
        h = SLIDE_H
        w = SLIDE_W
        # Horizontal gradient bands — dark top to slightly lighter bottom
        for y in range(0, h, 4):
            ratio = y / h
            r = int(bg[0] + (min(bg[0] + 20, 255) - bg[0]) * ratio)
            g = int(bg[1] + (min(bg[1] + 15, 255) - bg[1]) * ratio)
            b = int(bg[2] + (min(bg[2] + 30, 255) - bg[2]) * ratio)
            draw.rectangle([(0, y), (w, y + 4)], fill=(r, g, b))
        # Large decorative circle (bottom right)
        cx, cy, r = w - 180, h - 200, 280
        for ring in range(3):
            offset = ring * 18
            color = tuple(min(c + 8, 255) for c in bg)
            draw.ellipse([(cx - r + offset, cy - r + offset), (cx + r - offset, cy + r - offset)], outline=color, width=2)
        # Accent geometric shape top-left
        draw.polygon([(0, 0), (420, 0), (0, 280)], fill=tuple(min(c + 10, 255) for c in bg))

    # ── Title layout ──────────────────────────────────────────────────────────

    def _render_title_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        subtitle = slide.get("subtitle") or slide.get("content", "")
        badge = slide.get("badge", "")

        title_font = _load_font(92, bold=True)
        sub_font = _load_font(46)
        badge_font = _load_font(26, bold=True)
        label_font = _load_font(28)

        # Left accent column
        draw.rectangle([(60, 180), (72, 880)], fill=theme["accent"])

        # Title
        self._draw_wrapped_text(draw, title, title_font, theme["title_color"],
                                x=120, y=230, max_width=SLIDE_W * 2 // 3 - 80, line_height=110)

        # Divider with accent dot
        draw.rectangle([(120, 560), (640, 568)], fill=theme["accent"])
        draw.ellipse([(634, 553), (654, 573)], fill=theme["accent"])

        # Subtitle
        if subtitle:
            self._draw_wrapped_text(draw, subtitle, sub_font, theme["body_color"],
                                    x=120, y=596, max_width=SLIDE_W * 2 // 3 - 80, line_height=64)

        # Bottom label — meta info
        meta = slide.get("meta", "EY Autonomous SDLC Studio  ·  Confidential")
        draw.text((120, SLIDE_H - 120), meta, font=label_font, fill=theme["muted_color"])

        # Badge pill (top-right area)
        if badge:
            bw = len(badge) * 14 + 40
            bx = SLIDE_W - bw - 60
            by = 40
            draw.rectangle([(bx, by), (bx + bw, by + 46)], fill=theme["accent"])
            bar = theme["accent"]
            bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
            badge_txt_color = (26, 26, 46) if bri > 128 else (255, 255, 255)
            draw.text((bx + 20, by + 10), badge, font=badge_font, fill=badge_txt_color)

    # ── Content layout ────────────────────────────────────────────────────────

    def _render_content_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        content = slide.get("content") or slide.get("body", "")
        subtitle = slide.get("subtitle", "")

        title_font = _load_font(68, bold=True)
        sub_font = _load_font(36)
        bullet_font = _load_font(36)

        # Title band
        draw.rectangle([(0, 60), (SLIDE_W * 2 // 3, 185)], fill=theme["bar_color"])
        bar = theme["bar_color"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        draw.text((80, 88), title[:68], font=title_font, fill=tc)

        y = 215
        if subtitle:
            draw.text((80, y), subtitle[:100], font=sub_font, fill=theme["muted_color"])
            y += 56

        if content:
            lines = [l.strip() for l in content.replace("•", "\n•").split("\n") if l.strip()]
            for line in lines[:12]:
                is_bullet = line.startswith(("•", "-", "*", "→"))
                if is_bullet:
                    clean = line.lstrip("•-*→ ").strip()
                    draw.ellipse([(82, y + 13), (98, y + 29)], fill=theme["accent"])
                    self._draw_wrapped_text(draw, clean, bullet_font, theme["body_color"],
                                            x=115, y=y, max_width=SLIDE_W * 2 // 3 - 160, line_height=50)
                    y += 66
                else:
                    self._draw_wrapped_text(draw, line, bullet_font, theme["body_color"],
                                            x=80, y=y, max_width=SLIDE_W * 2 // 3 - 120, line_height=50)
                    y += 64
                if y > SLIDE_H - 120:
                    break

    # ── Two-column layout ─────────────────────────────────────────────────────

    def _render_two_col_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        subtitle = slide.get("subtitle", "")
        left_header = slide.get("left_header", "")
        left_content = slide.get("left_content") or slide.get("content", "")
        right_header = slide.get("right_header", "")
        right_content = slide.get("right_content") or slide.get("subtitle", "")

        title_font = _load_font(68, bold=True)
        hdr_font = _load_font(38, bold=True)
        body_font = _load_font(34)

        draw.rectangle([(0, 60), (SLIDE_W, 175)], fill=theme["bar_color"])
        bar = theme["bar_color"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        draw.text((80, 82), title[:72], font=title_font, fill=tc)

        # Vertical divider
        mid = SLIDE_W // 2
        draw.rectangle([(mid - 2, 195), (mid + 2, SLIDE_H - 80)], fill=theme["muted_color"])

        # Left column header
        y_l = 210
        if left_header:
            draw.text((80, y_l), left_header, font=hdr_font, fill=theme["accent"])
            draw.rectangle([(80, y_l + 48), (mid - 80, y_l + 52)], fill=theme["accent"])
            y_l += 70

        if left_content:
            lines = [l.strip() for l in left_content.split("\n") if l.strip()]
            for line in lines[:14]:
                self._draw_wrapped_text(draw, line, body_font, theme["body_color"],
                                        x=80, y=y_l, max_width=mid - 160, line_height=50)
                y_l += 60
                if y_l > SLIDE_H - 100:
                    break

        # Right column header
        y_r = 210
        if right_header:
            draw.text((mid + 60, y_r), right_header, font=hdr_font, fill=theme["accent"])
            draw.rectangle([(mid + 60, y_r + 48), (SLIDE_W - 80, y_r + 52)], fill=theme["accent"])
            y_r += 70

        if right_content:
            lines = [l.strip() for l in right_content.split("\n") if l.strip()]
            for line in lines[:14]:
                self._draw_wrapped_text(draw, line, body_font, theme["body_color"],
                                        x=mid + 60, y=y_r, max_width=mid - 160, line_height=50)
                y_r += 60
                if y_r > SLIDE_H - 100:
                    break

    # ── Table layout ──────────────────────────────────────────────────────────

    def _render_table_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        subtitle = slide.get("subtitle", "")
        table = slide.get("table", {})
        callout = slide.get("callout")

        title_font = _load_font(64, bold=True)
        sub_font = _load_font(32)
        hdr_font = _load_font(32, bold=True)
        cell_font = _load_font(28)
        callout_font = _load_font(28)

        # Title bar
        draw.rectangle([(0, 60), (SLIDE_W, 160)], fill=theme["bar_color"])
        bar = theme["bar_color"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        draw.text((80, 78), title[:72], font=title_font, fill=tc)

        y = 175
        if subtitle:
            draw.text((80, y), subtitle[:120], font=sub_font, fill=theme["muted_color"])
            y += 46

        headers = table.get("headers", [])
        rows = table.get("rows", [])

        if not headers:
            return

        # Calculate column widths
        table_w = SLIDE_W - 160 if not callout else SLIDE_W * 2 // 3 - 100
        col_w = table_w // len(headers) if headers else 200
        col_widths = []
        # First col wider
        if len(headers) > 1:
            col_widths = [int(col_w * 1.3)] + [int((table_w - col_w * 1.3) / (len(headers) - 1))] * (len(headers) - 1)
        else:
            col_widths = [table_w]

        # Header row
        hdr_h = 52
        draw.rectangle([(80, y), (80 + table_w, y + hdr_h)], fill=theme["table_header"])
        bar = theme["table_header"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        hdr_tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        x = 80
        for i, hdr in enumerate(headers):
            draw.text((x + 10, y + 12), str(hdr)[:22], font=hdr_font, fill=hdr_tc)
            x += col_widths[i] if i < len(col_widths) else col_w
        y += hdr_h

        # Data rows
        row_h = 46
        for ri, row in enumerate(rows[:12]):
            bg = theme["table_alt"] if ri % 2 else theme["bg"]
            draw.rectangle([(80, y), (80 + table_w, y + row_h)], fill=bg)
            x = 80
            for ci, cell in enumerate(row[:len(headers)]):
                draw.text((x + 10, y + 10), str(cell)[:30], font=cell_font, fill=theme["body_color"])
                x += col_widths[ci] if ci < len(col_widths) else col_w
            # Row border
            draw.line([(80, y + row_h), (80 + table_w, y + row_h)], fill=theme["muted_color"], width=1)
            y += row_h
            if y > SLIDE_H - 200:
                break

        # Callout box (right side)
        if callout:
            cx = SLIDE_W * 2 // 3 + 20
            cy = 230
            cw = SLIDE_W - cx - 40
            ctype = callout.get("type", "info")
            color_map = {
                "info": theme["info_color"],
                "warning": theme["warning_color"],
                "success": theme["success_color"],
            }
            callout_color = color_map.get(ctype, theme["info_color"])
            draw.rectangle([(cx, cy), (cx + cw, cy + 4)], fill=callout_color)
            draw.rectangle([(cx, cy + 4), (cx + cw, SLIDE_H - 100)], fill=theme["stripe_color"])
            ctitle_font = _load_font(32, bold=True)
            cbody_font = _load_font(28)
            draw.text((cx + 20, cy + 20), callout.get("title", "")[:30], font=ctitle_font, fill=callout_color)
            body_text = callout.get("body", "")
            # Replace · with newline for readability
            body_lines = body_text.replace(" · ", "\n").split("\n")
            ty = cy + 70
            for bl in body_lines[:10]:
                self._draw_wrapped_text(draw, bl.strip(), cbody_font, theme["body_color"],
                                        x=cx + 20, y=ty, max_width=cw - 40, line_height=44)
                ty += 50
                if ty > SLIDE_H - 130:
                    break

    # ── Chart layout (horizontal bar chart) ───────────────────────────────────

    def _render_chart_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        subtitle = slide.get("subtitle", "")
        chart = slide.get("chart", {})
        callout = slide.get("callout")

        title_font = _load_font(64, bold=True)
        sub_font = _load_font(32)
        label_font = _load_font(32)
        val_font = _load_font(30, bold=True)
        chart_title_font = _load_font(34, bold=True)

        # Title bar
        draw.rectangle([(0, 60), (SLIDE_W, 160)], fill=theme["bar_color"])
        bar = theme["bar_color"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        draw.text((80, 78), title[:72], font=title_font, fill=tc)

        y = 175
        if subtitle:
            draw.text((80, y), subtitle[:120], font=sub_font, fill=theme["muted_color"])
            y += 46

        chart_label = chart.get("label", "")
        if chart_label:
            draw.text((80, y), chart_label, font=chart_title_font, fill=theme["muted_color"])
            y += 50

        data = chart.get("data", [])
        if not data:
            return

        chart_area_w = (SLIDE_W * 2 // 3 - 120) if callout else (SLIDE_W - 200)
        bar_h = 44
        gap = 18
        label_w = 360
        bar_start = 80 + label_w + 20

        for idx, item in enumerate(data[:8]):
            label = str(item.get("label", ""))[:40]
            value = float(item.get("value", 0))
            max_val = float(item.get("max", 100))
            ratio = min(value / max_val, 1.0) if max_val > 0 else 0

            track_w = chart_area_w - label_w - 120
            bar_fill_w = int(ratio * track_w)

            # Label
            draw.text((80, y + 10), label, font=label_font, fill=theme["body_color"])

            # Background track (rounded ends approximated)
            draw.rectangle([(bar_start, y + 8), (bar_start + track_w, y + bar_h - 8)],
                            fill=theme["stripe_color"])

            # Fill bar with slight brightness gradient (lighter left portion)
            if bar_fill_w > 0:
                bar_col = theme["bar_color"]
                bright_col = tuple(min(c + 30, 255) for c in bar_col)
                # Left 40% brighter
                bright_w = int(bar_fill_w * 0.4)
                if bright_w > 0:
                    draw.rectangle([(bar_start, y + 8), (bar_start + bright_w, y + bar_h - 8)],
                                    fill=bright_col)
                draw.rectangle([(bar_start + bright_w, y + 8), (bar_start + bar_fill_w, y + bar_h - 8)],
                                fill=bar_col)
                # End cap accent dot
                cap_x = bar_start + bar_fill_w
                draw.ellipse([(cap_x - 6, y + bar_h // 2 - 6), (cap_x + 6, y + bar_h // 2 + 6)],
                              fill=theme["accent"])

            # Percentage label
            pct_str = f"{value:.0f}%" if max_val == 100 else f"{value:.0f}"
            draw.text((bar_start + bar_fill_w + 16, y + 9), pct_str, font=val_font, fill=theme["accent"])

            y += bar_h + gap
            if y > SLIDE_H - 180:
                break

        # Callout box
        if callout:
            cx = SLIDE_W * 2 // 3 + 20
            cy = 220
            cw = SLIDE_W - cx - 40
            ctype = callout.get("type", "info")
            color_map = {"info": theme["info_color"], "warning": theme["warning_color"], "success": theme["success_color"]}
            callout_color = color_map.get(ctype, theme["info_color"])
            draw.rectangle([(cx, cy), (cx + cw, cy + 4)], fill=callout_color)
            draw.rectangle([(cx, cy + 4), (cx + cw, SLIDE_H - 100)], fill=theme["stripe_color"])
            ctitle_font = _load_font(32, bold=True)
            cbody_font = _load_font(27)
            draw.text((cx + 20, cy + 20), callout.get("title", "")[:30], font=ctitle_font, fill=callout_color)
            body_text = callout.get("body", "")
            body_lines = body_text.split("\n")
            ty = cy + 70
            for bl in body_lines[:12]:
                if bl.strip():
                    self._draw_wrapped_text(draw, bl.strip(), cbody_font, theme["body_color"],
                                            x=cx + 20, y=ty, max_width=cw - 40, line_height=42)
                    ty += 46
                    if ty > SLIDE_H - 130:
                        break

    # ── Stats grid layout (2×2 big numbers) ──────────────────────────────────

    def _render_stats_grid_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        subtitle = slide.get("subtitle", "")
        stats = slide.get("stats", [])

        title_font = _load_font(72, bold=True)
        sub_font = _load_font(36)

        # Title bar
        draw.rectangle([(0, 60), (SLIDE_W, 175)], fill=theme["bar_color"])
        bar = theme["bar_color"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        draw.text((80, 82), title[:72], font=title_font, fill=tc)

        if subtitle:
            draw.text((80, 182), subtitle[:100], font=sub_font, fill=theme["muted_color"])

        if not stats:
            return

        # 2×2 grid
        cols = 2 if len(stats) > 2 else len(stats)
        rows = (len(stats) + cols - 1) // cols
        cell_w = (SLIDE_W - 160) // cols
        cell_h = (SLIDE_H - 340) // max(rows, 1)

        val_font = _load_font(120, bold=True)
        label_font = _load_font(40, bold=True)
        sub2_font = _load_font(30)

        for i, stat in enumerate(stats[:4]):
            col = i % cols
            row = i // cols
            cx = 80 + col * cell_w
            cy = 240 + row * cell_h

            # Card shadow (offset dark rect)
            shadow_offset = 6
            draw.rectangle([(cx + 20 + shadow_offset, cy + 10 + shadow_offset),
                             (cx + cell_w - 20 + shadow_offset, cy + cell_h - 20 + shadow_offset)],
                            fill=tuple(max(c - 12, 0) for c in theme["bg"]))
            # Card background
            draw.rectangle([(cx + 20, cy + 10), (cx + cell_w - 20, cy + cell_h - 20)],
                            fill=theme["stripe_color"])
            # Left accent strip (thicker = 8px)
            draw.rectangle([(cx + 20, cy + 10), (cx + 28, cy + cell_h - 20)], fill=theme["accent"])
            # Top accent bar inside card
            draw.rectangle([(cx + 28, cy + 10), (cx + cell_w - 20, cy + 16)],
                            fill=tuple(min(c + 15, 255) for c in theme["stripe_color"]))

            # Value (big number)
            val_str = str(stat.get("value", "—"))[:10]
            draw.text((cx + 60, cy + 22), val_str, font=val_font, fill=theme["accent"])

            # Separator line
            draw.rectangle([(cx + 60, cy + cell_h - 128), (cx + cell_w - 40, cy + cell_h - 124)],
                            fill=theme["muted_color"])

            # Label
            label = str(stat.get("label", ""))[:30]
            draw.text((cx + 60, cy + cell_h - 118), label, font=label_font, fill=theme["title_color"])

            # Sub-label
            sub_label = str(stat.get("sub", ""))[:50]
            draw.text((cx + 60, cy + cell_h - 72), sub_label, font=sub2_font, fill=theme["muted_color"])

    # ── Items layout (icon + title + body list) ───────────────────────────────

    def _render_items_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        subtitle = slide.get("subtitle", "")
        items = slide.get("items", [])
        content = slide.get("content", "")

        title_font = _load_font(68, bold=True)
        sub_font = _load_font(32)
        item_title_font = _load_font(38, bold=True)
        item_body_font = _load_font(30)

        # Title bar
        draw.rectangle([(0, 60), (SLIDE_W * 2 // 3, 165)], fill=theme["bar_color"])
        bar = theme["bar_color"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        draw.text((80, 80), title[:68], font=title_font, fill=tc)

        y = 178
        if subtitle:
            draw.text((80, y), subtitle[:100], font=sub_font, fill=theme["muted_color"])
            y += 46

        if not items:
            # Fall through to content display
            self._draw_wrapped_text(draw, content, item_body_font, theme["body_color"],
                                    x=80, y=y, max_width=SLIDE_W * 2 // 3 - 120, line_height=48)
            return

        # Calculate item height
        has_body = any(it.get("body") for it in items)
        item_h = 90 if has_body else 62
        max_items = min(len(items), (SLIDE_H - y - 80) // item_h)

        for i, item in enumerate(items[:max_items]):
            icon = item.get("icon", "check")
            # Icon — number badge for each item
            num_font = _load_font(22, bold=True)
            badge_size = 32
            bx, by = 82, y + 6
            draw.ellipse([(bx, by), (bx + badge_size, by + badge_size)], fill=theme["accent"])
            bar = theme["accent"]
            bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
            badge_tc = (26, 26, 46) if bri > 128 else (255, 255, 255)
            if icon == "check":
                draw.text((bx + 6, by + 4), "✓", font=num_font, fill=badge_tc)
            else:
                draw.text((bx + 10, by + 4), "→", font=num_font, fill=badge_tc)

            ititle = str(item.get("title", ""))[:60]
            ibody = str(item.get("body", ""))[:90]
            draw.text((122, y + 4), ititle, font=item_title_font, fill=theme["title_color"])
            if ibody:
                self._draw_wrapped_text(draw, ibody, item_body_font, theme["body_color"],
                                        x=122, y=y + 46, max_width=SLIDE_W * 2 // 3 - 180, line_height=36)

            # Divider
            draw.line([(80, y + item_h - 4), (SLIDE_W * 2 // 3 - 60, y + item_h - 4)],
                      fill=theme["stripe_color"], width=2)
            y += item_h

        if content:
            y += 16
            self._draw_wrapped_text(draw, content, item_body_font, theme["muted_color"],
                                    x=80, y=y, max_width=SLIDE_W * 2 // 3 - 120, line_height=40)

    # ── Tech grid layout ──────────────────────────────────────────────────────

    def _render_tech_grid_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        subtitle = slide.get("subtitle", "")
        tech_items = slide.get("tech_items", [])

        title_font = _load_font(72, bold=True)
        sub_font = _load_font(34)
        layer_font = _load_font(30)
        tech_font = _load_font(36, bold=True)

        draw.rectangle([(0, 60), (SLIDE_W, 170)], fill=theme["bar_color"])
        bar = theme["bar_color"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        draw.text((80, 80), title[:72], font=title_font, fill=tc)

        if subtitle:
            draw.text((80, 178), subtitle[:100], font=sub_font, fill=theme["muted_color"])

        if not tech_items:
            return

        # 2-column cards
        cols = 2
        card_w = (SLIDE_W - 200) // cols
        card_h = 120
        gap = 20
        start_y = 240

        for i, tech in enumerate(tech_items[:8]):
            col = i % cols
            row = i // cols
            cx = 80 + col * (card_w + gap)
            cy = start_y + row * (card_h + gap)

            color = theme.get("info_color", theme["accent"]) if tech.get("color") == "accent" else theme["stripe_color"]
            draw.rectangle([(cx, cy), (cx + card_w, cy + card_h)], fill=theme["stripe_color"])
            draw.rectangle([(cx, cy), (cx + 6, cy + card_h)], fill=theme["accent"])

            icon = str(tech.get("icon", "•"))[:2]
            layer = str(tech.get("layer", ""))[:20]
            tech_name = str(tech.get("tech", ""))[:40]

            icon_font = _load_font(40)
            draw.text((cx + 20, cy + 18), icon, font=icon_font, fill=theme["accent"])
            draw.text((cx + 70, cy + 14), layer, font=layer_font, fill=theme["muted_color"])
            draw.text((cx + 70, cy + 52), tech_name, font=tech_font, fill=theme["title_color"])

    # ── Timeline layout ───────────────────────────────────────────────────────

    def _render_timeline_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        subtitle = slide.get("subtitle", "")
        events = slide.get("timeline", [])

        title_font = _load_font(72, bold=True)
        sub_font = _load_font(34)
        date_font = _load_font(28, bold=True)
        event_title_font = _load_font(34, bold=True)
        event_desc_font = _load_font(28)

        draw.rectangle([(0, 60), (SLIDE_W, 170)], fill=theme["bar_color"])
        bar = theme["bar_color"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        draw.text((80, 80), title[:72], font=title_font, fill=tc)

        if subtitle:
            draw.text((80, 178), subtitle[:100], font=sub_font, fill=theme["muted_color"])

        if not events:
            return

        # Horizontal timeline
        n = min(len(events), 7)
        timeline_y = 580
        start_x = 100
        end_x = SLIDE_W - 100
        step_w = (end_x - start_x) // max(n - 1, 1)

        # Draw horizontal line
        draw.rectangle([(start_x, timeline_y - 3), (end_x, timeline_y + 3)], fill=theme["muted_color"])

        for i, ev in enumerate(events[:n]):
            x = start_x + i * step_w

            # Node circle
            is_gate = "gate" in str(ev.get("title", "")).lower() or "review" in str(ev.get("date", "")).lower()
            node_color = theme["accent"] if is_gate else theme["bar_color"]
            r = 22 if is_gate else 16
            draw.ellipse([(x - r, timeline_y - r), (x + r, timeline_y + r)], fill=node_color)
            if is_gate:
                draw.ellipse([(x - 10, timeline_y - 10), (x + 10, timeline_y + 10)], fill=theme["bg"])

            # Date label (above)
            date_str = str(ev.get("date", ""))[:10]
            date_w = len(date_str) * 14
            draw.text((x - date_w // 2, timeline_y - 70), date_str, font=date_font, fill=theme["accent"])

            # Title (below)
            etitle = str(ev.get("title", ""))[:14]
            et_w = len(etitle) * 15
            draw.text((x - et_w // 2, timeline_y + 40), etitle, font=event_title_font, fill=theme["title_color"])

            # Description
            edesc = str(ev.get("desc", ""))[:20]
            ed_w = len(edesc) * 11
            draw.text((x - ed_w // 2, timeline_y + 85), edesc, font=event_desc_font, fill=theme["muted_color"])

    # ── Closing layout ────────────────────────────────────────────────────────

    def _render_closing_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        subtitle = slide.get("subtitle", "")
        items = slide.get("items", [])

        title_font = _load_font(80, bold=True)
        sub_font = _load_font(40)
        item_font = _load_font(36, bold=True)
        body_font = _load_font(28)

        # Full-width accent background top
        draw.rectangle([(0, 60), (SLIDE_W, 220)], fill=theme["bar_color"])
        bar = theme["bar_color"]
        bar_bri = (bar[0] * 299 + bar[1] * 587 + bar[2] * 114) // 1000
        tc = (26, 26, 46) if bar_bri > 128 else (255, 255, 255)
        draw.text((80, 80), title[:60], font=title_font, fill=tc)

        y = 228
        if subtitle:
            draw.text((80, y), subtitle[:80], font=sub_font, fill=theme["muted_color"])
            y += 60

        for item in items[:5]:
            icon = item.get("icon", "check")
            ititle = str(item.get("title", ""))[:60]
            ibody = str(item.get("body", ""))[:90]

            if icon == "check":
                draw.ellipse([(80, y + 4), (112, y + 36)], fill=theme["accent"])
                ck_bar = theme["accent"]
                ck_bri = (ck_bar[0] * 299 + ck_bar[1] * 587 + ck_bar[2] * 114) // 1000
                ck_tc = (26, 26, 46) if ck_bri > 128 else (255, 255, 255)
                check_font = _load_font(22, bold=True)
                draw.text((86, y + 8), "✓", font=check_font, fill=ck_tc)
            else:
                draw.polygon([(80, y + 12), (80, y + 28), (104, y + 20)], fill=theme["accent"])

            draw.text((130, y + 2), ititle, font=item_font, fill=theme["title_color"])
            if ibody:
                draw.text((130, y + 44), ibody, font=body_font, fill=theme["body_color"])

            y += 90 if ibody else 60
            if y > SLIDE_H - 100:
                break

    # ── Quote layout ──────────────────────────────────────────────────────────

    def _render_quote_layout(self, draw, slide, theme):
        quote = slide.get("title") or slide.get("content", "")
        attribution = slide.get("subtitle") or ""

        qm_font = _load_font(200, bold=True)
        q_font = _load_font(54, bold=False)
        attr_font = _load_font(36)

        draw.text((60, 100), "“", font=qm_font, fill=theme["accent"])
        self._draw_wrapped_text(draw, quote, q_font, theme["title_color"],
                                x=120, y=280, max_width=SLIDE_W - 260, line_height=75)

        if attribution:
            draw.text((120, SLIDE_H - 165), f"— {attribution[:100]}", font=attr_font, fill=theme["muted_color"])

    # ── Metric layout ─────────────────────────────────────────────────────────

    def _render_metric_layout(self, draw, slide, theme):
        title = slide.get("title", "")
        metric = slide.get("metric") or slide.get("subtitle", "")
        description = slide.get("content") or slide.get("description", "")

        title_font = _load_font(60, bold=True)
        metric_font = _load_font(200, bold=True)
        desc_font = _load_font(44)

        draw.text((80, 80), title[:80], font=title_font, fill=theme["title_color"])
        draw.rectangle([(80, 160), (500, 166)], fill=theme["accent"])
        draw.text((80, 220), str(metric)[:20], font=metric_font, fill=theme["accent"])

        if description:
            self._draw_wrapped_text(draw, description, desc_font, theme["body_color"],
                                    x=80, y=680, max_width=SLIDE_W * 2 // 3 - 120, line_height=60)

    # ── Shared text helper ────────────────────────────────────────────────────

    def _draw_wrapped_text(self, draw, text: str, font, color, x: int, y: int, max_width: int, line_height: int):
        if not text:
            return
        try:
            avg_char_w = font.getlength("x")
        except Exception:
            avg_char_w = font.size * 0.6 if hasattr(font, "size") else 10
        chars_per_line = max(1, int(max_width / max(avg_char_w, 1)))
        wrapped = textwrap.wrap(text, width=chars_per_line)
        cur_y = y
        for line in wrapped:
            draw.text((x, cur_y), line, font=font, fill=color)
            cur_y += line_height

    def to_png(self, img, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(str(path), "PNG", optimize=False)
        return path

    def to_thumbnail_b64(self, img) -> str:
        from PIL import Image
        thumb = img.resize((THUMB_W, THUMB_H), Image.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, "JPEG", quality=82)
        return base64.b64encode(buf.getvalue()).decode()


# ── Local TTS service ────────────────────────────────────────────────────────

class LocalTTSService:
    """TTS using macOS `say` → espeak-ng → ffmpeg silence (never fails)."""

    def synthesize(self, text: str, out_path: Path, voice_id: str = "samantha", rate: int = 180) -> Path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        voice_name = VOICES.get(voice_id, VOICES["samantha"])["name"]

        if self._try_macos_say(text, voice_name, rate, out_path):
            return out_path
        if self._try_espeak(text, out_path):
            return out_path
        duration = max(3.0, len(text.split()) / 2.5)
        return self._gen_silence(duration, out_path)

    def _try_macos_say(self, text: str, voice: str, rate: int, out_path: Path) -> bool:
        if not shutil.which("say"):
            return False
        try:
            aiff_path = out_path.with_suffix(".aiff")
            subprocess.run(
                ["say", "-v", voice, "-r", str(rate), "-o", str(aiff_path), text],
                check=True, capture_output=True, timeout=60,
            )
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(aiff_path), "-ar", "44100", "-ac", "1", str(out_path)],
                check=True, capture_output=True, timeout=30,
            )
            aiff_path.unlink(missing_ok=True)
            return True
        except Exception as e:
            logger.debug("[TTS] macOS say failed: %s", e)
            return False

    def _try_espeak(self, text: str, out_path: Path) -> bool:
        espeak = shutil.which("espeak-ng") or shutil.which("espeak")
        if not espeak:
            return False
        try:
            subprocess.run([espeak, "-w", str(out_path), text],
                           check=True, capture_output=True, timeout=30)
            return True
        except Exception as e:
            logger.debug("[TTS] espeak failed: %s", e)
            return False

    def _gen_silence(self, duration: float, out_path: Path) -> Path:
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
             "-t", str(duration), str(out_path)],
            check=True, capture_output=True, timeout=15,
        )
        return out_path


# ── FFmpeg video composer ─────────────────────────────────────────────────────

class FFmpegComposer:
    """Stitches per-slide PNG + WAV pairs into a final MP4 using FFmpeg."""

    def compose(
        self,
        slide_pngs: List[Path],
        slide_wavs: List[Path],
        out_path: Path,
        progress_cb: Optional[Callable[[int, str], None]] = None,
    ) -> Path:
        if len(slide_pngs) != len(slide_wavs):
            raise ValueError("PNG/WAV count mismatch")

        tmp_dir = out_path.parent / f"clips_{uuid.uuid4().hex[:8]}"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        try:
            clip_paths: List[Path] = []
            for i, (png, wav) in enumerate(zip(slide_pngs, slide_wavs)):
                if progress_cb:
                    progress_cb(i, f"Encoding slide {i + 1}/{len(slide_pngs)}")
                clip = tmp_dir / f"slide_{i:03d}.mp4"
                self._make_clip(png, wav, clip)
                clip_paths.append(clip)

            if progress_cb:
                progress_cb(len(slide_pngs), "Concatenating clips…")
            self._concat(clip_paths, out_path)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        return out_path

    def _make_clip(self, png: Path, wav: Path, out: Path) -> None:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-loop", "1", "-i", str(png),
                "-i", str(wav),
                "-c:v", "libx264", "-tune", "stillimage",
                "-c:a", "aac", "-b:a", "192k",
                "-pix_fmt", "yuv420p",
                "-shortest",
                "-movflags", "+faststart",
                str(out),
            ],
            check=True, capture_output=True, timeout=120,
        )

    def _concat(self, clips: List[Path], out: Path) -> None:
        list_file = out.parent / "concat_list.txt"
        list_file.write_text("\n".join(f"file '{c}'" for c in clips))
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-f", "concat", "-safe", "0", "-i", str(list_file),
                    "-c:v", "libx264", "-c:a", "aac",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    str(out),
                ],
                check=True, capture_output=True, timeout=300,
            )
        finally:
            list_file.unlink(missing_ok=True)


# ── SadTalker avatar paths ────────────────────────────────────────────────────

SADTALKER_DIR = Path(os.path.expanduser("~/.sdlc_studio/models/SadTalker"))
SADTALKER_CKPT = SADTALKER_DIR / "checkpoints"
SADTALKER_SOURCE_DIR = SADTALKER_DIR / "examples" / "source_image"
SADTALKER_DEFAULT_FACE = SADTALKER_SOURCE_DIR / "full_body_2.png"


def _pick_source_image(name: str) -> Path:
    """Return the first existing image among candidates, else the default face."""
    for n in ([name] if isinstance(name, str) else list(name)):
        p = SADTALKER_SOURCE_DIR / n
        if p.exists():
            return p
    return SADTALKER_DEFAULT_FACE


# Map avatar personas (from the UI) to the best-matching local SadTalker source image.
# Only local, open-source sample images are used — no external downloads.
AVATAR_SOURCE_MAP: Dict[str, list] = {
    "professional_male":   ["people_0.png", "full_body_2.png"],
    "professional_female": ["happy.png", "happy1.png"],
    "ceo":                 ["people_0.png", "full_body_1.png"],
    "engineer":            ["people_0.png"],
    "doctor":              ["happy.png"],
    "teacher":             ["happy1.png", "happy.png"],
    "scientist":           ["people_0.png"],
    "lawyer":              ["full_body_1.png"],
    "student":             ["happy1.png"],
    "police":              ["people_0.png"],
    "govt_officer":        ["full_body_2.png"],
    "news_anchor":         ["happy.png"],
    "minister":            ["full_body_1.png"],
    "chief_minister":      ["full_body_1.png"],
    "prime_minister":      ["full_body_2.png"],
    "farmer":              ["people_0.png"],
    "village_woman":       ["happy1.png"],
    "factory_worker":      ["people_0.png"],
    "poor_family":         ["happy.png"],
    "child":               ["happy1.png"],
    "cartoon":             ["art_0.png", "art_1.png"],
    "3d_avatar":           ["art_10.png", "art_0.png"],
}


def avatar_image_for(avatar_id: Optional[str]) -> Path:
    """Resolve an avatar persona id to a local source image path."""
    if not avatar_id:
        return SADTALKER_DEFAULT_FACE
    candidates = AVATAR_SOURCE_MAP.get(avatar_id.strip().lower())
    if candidates:
        return _pick_source_image(candidates)
    # Allow a raw filename to be passed directly
    direct = SADTALKER_SOURCE_DIR / avatar_id
    if direct.exists():
        return direct
    return SADTALKER_DEFAULT_FACE


# ── Avatar service — SadTalker real AI lip-sync ───────────────────────────────

class SadTalkerAvatarService:
    """
    Produces a real AI talking-head MP4 using SadTalker.
    The avatar actually lip-syncs to the narration audio.

    SadTalker is a local, open-source model that:
      - Detects face landmarks from a still photo
      - Extracts 3DMM expression coefficients from audio mel-spectrogram
      - Animates the face frame-by-frame using a neural renderer

    Runs fully locally — no paid APIs, no internet required after model download.
    """

    def generate(
        self,
        audio_wav: Path,
        out_path: Path,
        avatar_image: Optional[Path] = None,
    ) -> Optional[Path]:
        """Run SadTalker to generate a lip-synced talking head MP4."""
        if not audio_wav.exists():
            logger.error("[SadTalker] Audio file not found: %s", audio_wav)
            return None

        face_img = avatar_image if (avatar_image and avatar_image.exists()) else SADTALKER_DEFAULT_FACE
        if not face_img.exists():
            logger.error("[SadTalker] No face image available at %s", face_img)
            return None

        if not SADTALKER_DIR.exists() or not SADTALKER_CKPT.exists():
            logger.error("[SadTalker] SadTalker not found at %s", SADTALKER_DIR)
            return None

        result_dir = out_path.parent / f"sadtalker_tmp_{out_path.stem}"
        result_dir.mkdir(parents=True, exist_ok=True)

        try:
            env = os.environ.copy()
            env["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

            cmd = [
                "python3",
                str(SADTALKER_DIR / "inference.py"),
                "--driven_audio", str(audio_wav),
                "--source_image", str(face_img),
                "--checkpoint_dir", str(SADTALKER_CKPT),
                "--result_dir", str(result_dir),
                "--still",
                "--preprocess", "crop",
                "--size", "256",
            ]

            logger.info("[SadTalker] Running: %s", " ".join(cmd))
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=900,
                env=env,
                cwd=str(SADTALKER_DIR),
            )

            if proc.returncode != 0:
                logger.error("[SadTalker] Failed (rc=%d):\n%s", proc.returncode, proc.stderr[-2000:])
                return None

            # SadTalker saves to result_dir/<timestamp>/<name>.mp4
            mp4_files = list(result_dir.rglob("*.mp4"))
            if not mp4_files:
                logger.error("[SadTalker] No MP4 produced in %s", result_dir)
                return None

            # Pick the main output (not temp_*)
            main_mp4 = next((f for f in mp4_files if not f.name.startswith("temp_")), mp4_files[0])
            shutil.copy2(str(main_mp4), str(out_path))
            shutil.rmtree(result_dir, ignore_errors=True)

            logger.info("[SadTalker] Generated talking head: %s (%.1f KB)",
                        out_path.name, out_path.stat().st_size / 1024)
            return out_path

        except subprocess.TimeoutExpired:
            logger.error("[SadTalker] Timed out after 900s")
            shutil.rmtree(result_dir, ignore_errors=True)
            return None
        except Exception as exc:
            logger.error("[SadTalker] Exception: %s", exc, exc_info=True)
            shutil.rmtree(result_dir, ignore_errors=True)
            return None


# Keep old name as alias for backward compat
LocalAvatarService = SadTalkerAvatarService


# ── Job registry ─────────────────────────────────────────────────────────────

@dataclass
class StoryboardFrame:
    slide_idx: int
    title: str
    thumb_b64: str = ""
    audio_duration: float = 0.0
    status: str = "pending"   # pending | rendering | rendered


@dataclass
class VideoRenderJob:
    job_id: str
    project_id: int
    mode: str               # "slides" | "avatar"
    theme_id: str
    voice_id: str
    slides: List[Dict[str, Any]]
    avatar_id: str = "professional_male"
    status: str = "queued"  # queued | running | completed | failed
    percent: int = 0
    stage: str = "Queued"
    message: str = ""
    logs: List[str] = field(default_factory=list)
    storyboard: List[StoryboardFrame] = field(default_factory=list)
    video_artifact_id: Optional[int] = None
    avatar_artifact_id: Optional[int] = None
    video_path: Optional[str] = None
    avatar_path: Optional[str] = None
    duration_seconds: float = 0.0
    error: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    eta_seconds: Optional[float] = None
    fallback_used: bool = False


# Module-level job registry (in-memory, survives request lifecycle)
VIDEO_JOBS: Dict[str, VideoRenderJob] = {}
_jobs_lock = threading.Lock()


def create_job(
    project_id: int,
    slides: List[Dict[str, Any]],
    mode: str = "slides",
    theme_id: str = "ey_dark",
    voice_id: str = "samantha",
    avatar_id: str = "professional_male",
) -> VideoRenderJob:
    job_id = uuid.uuid4().hex
    storyboard = [
        StoryboardFrame(slide_idx=i, title=s.get("title", f"Slide {i + 1}"))
        for i, s in enumerate(slides)
    ]
    job = VideoRenderJob(
        job_id=job_id,
        project_id=project_id,
        mode=mode,
        theme_id=theme_id,
        voice_id=voice_id,
        slides=slides,
        avatar_id=avatar_id,
        storyboard=storyboard,
    )
    with _jobs_lock:
        VIDEO_JOBS[job_id] = job
    return job


def get_job(job_id: str) -> Optional[VideoRenderJob]:
    return VIDEO_JOBS.get(job_id)


# ── Pipeline runner ───────────────────────────────────────────────────────────

def run_pipeline(
    job: VideoRenderJob,
    db_session_factory,
    save_artifact_fn,
) -> None:
    _log(job, "Pipeline started")
    job.status = "running"
    job.stage = "Initializing"
    job.started_at = time.time()

    try:
        _run_pipeline_inner(job, db_session_factory, save_artifact_fn)
    except Exception as exc:
        logger.error("[VideoPipeline] Job %s failed: %s", job.job_id, exc, exc_info=True)
        job.status = "failed"
        job.error = str(exc)
        job.stage = "Failed"
        _log(job, f"ERROR: {exc}")


def _run_pipeline_inner(job, db_session_factory, save_artifact_fn):
    tmp_dir = VIDEO_OUTPUT_DIR / f"job_{job.job_id}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    slides = job.slides
    total = len(slides)

    renderer = PillowSlideRenderer()
    tts = LocalTTSService()
    composer = FFmpegComposer()

    slide_pngs: List[Path] = []
    slide_wavs: List[Path] = []

    # ── Phase 1: Render slide images ─────────────────────────────────────
    job.stage = "Rendering slides"
    _log(job, f"Rendering {total} slides with theme '{job.theme_id}'")

    for i, slide in enumerate(slides):
        pct = int(5 + (i / total) * 35)
        _progress(job, pct, f"Rendering slide {i + 1}/{total}: {slide.get('title', '')[:40]}")
        job.storyboard[i].status = "rendering"

        img = renderer.render(slide, job.theme_id, i + 1, total)
        png_path = tmp_dir / f"slide_{i:03d}.png"
        renderer.to_png(img, png_path)
        slide_pngs.append(png_path)

        job.storyboard[i].thumb_b64 = renderer.to_thumbnail_b64(img)
        job.storyboard[i].status = "rendered"
        _log(job, f"  ✓ Slide {i + 1} rendered ({slide.get('layout', 'content')} layout)")

    # ── Phase 2: Generate narration audio ─────────────────────────────────
    job.stage = "Generating narration"
    _log(job, f"Synthesizing audio with voice '{job.voice_id}'")

    for i, slide in enumerate(slides):
        pct = int(40 + (i / total) * 30)
        _progress(job, pct, f"TTS: slide {i + 1}/{total}")

        narration = (
            slide.get("speaker_notes")
            or slide.get("narration")
            or slide.get("content")
            or slide.get("title", "")
        )
        narration = (narration or "").strip()
        if len(narration) > 500:
            narration = narration[:500]

        wav_path = tmp_dir / f"audio_{i:03d}.wav"
        tts.synthesize(narration, wav_path, voice_id=job.voice_id)

        try:
            dur = _get_audio_duration(wav_path)
        except Exception:
            dur = 0.0
        job.storyboard[i].audio_duration = dur
        slide_wavs.append(wav_path)
        _log(job, f"  ✓ Audio {i + 1}: {dur:.1f}s")

    # ── Phase 3: Compose MP4 ──────────────────────────────────────────────
    job.stage = "Composing video"
    _progress(job, 72, "Composing final MP4…")
    _log(job, "Starting FFmpeg composition")

    out_mp4 = VIDEO_OUTPUT_DIR / f"project_{job.project_id}_{job.job_id}.mp4"

    def encode_cb(idx: int, msg: str):
        pct = int(72 + (idx / total) * 18)
        _progress(job, pct, msg)
        _log(job, f"  {msg}")

    composer.compose(slide_pngs, slide_wavs, out_mp4, progress_cb=encode_cb)
    job.video_path = str(out_mp4)
    job.duration_seconds = _get_video_duration(out_mp4)
    _log(job, f"Video composed: {job.duration_seconds:.1f}s → {out_mp4.name}")

    # ── Phase 4: Avatar mode (SadTalker lip-sync) ────────────────────────
    if job.mode == "avatar":
        job.stage = "Generating SadTalker avatar"
        _progress(job, 90, "Concatenating narration audio…")
        _log(job, "Concatenating slide audio for SadTalker")

        # Concatenate all slide WAVs into one file for SadTalker
        combined_wav = tmp_dir / "combined_narration.wav"
        _concat_audio(slide_wavs, combined_wav)

        _progress(job, 92, "Running SadTalker AI lip-sync (this takes 2–4 min)…")
        _log(job, "Running SadTalker — real AI talking head with lip-sync")

        avatar_svc = SadTalkerAvatarService()
        avatar_out = VIDEO_OUTPUT_DIR / f"avatar_{job.project_id}_{job.job_id}.mp4"
        face_img = avatar_image_for(job.avatar_id)
        _log(job, f"Avatar persona '{job.avatar_id}' → {face_img.name}")
        result = avatar_svc.generate(combined_wav, avatar_out, avatar_image=face_img)

        if result and result.exists():
            job.avatar_path = str(result)
            _log(job, f"✓ SadTalker avatar generated: {result.name}")
        else:
            job.fallback_used = True
            _log(job, "⚠ SadTalker failed — avatar_path will be None")

    # ── Phase 5: Persist artifacts ────────────────────────────────────────
    job.stage = "Saving artifacts"
    _progress(job, 97, "Saving to database…")

    video_id, avatar_id = save_artifact_fn(
        project_id=job.project_id,
        video_path=job.video_path,
        avatar_path=job.avatar_path,
        job_id=job.job_id,
        mode=job.mode,
        duration=job.duration_seconds,
        slide_count=total,
    )
    job.video_artifact_id = video_id
    job.avatar_artifact_id = avatar_id

    # ── Done ──────────────────────────────────────────────────────────────
    _progress(job, 100, "Render complete")
    job.status = "completed"
    job.stage = "Complete"
    _log(job, f"✓ Job {job.job_id} finished in {time.time() - job.started_at:.1f}s")

    shutil.rmtree(tmp_dir, ignore_errors=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _log(job: VideoRenderJob, msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    job.logs.append(f"[{ts}] {msg}")
    logger.debug("[VideoPipeline:%s] %s", job.job_id[:8], msg)


def _progress(job: VideoRenderJob, percent: int, message: str = "") -> None:
    job.percent = percent
    if message:
        job.message = message
    elapsed = time.time() - job.started_at
    if percent > 5:
        job.eta_seconds = elapsed / (percent / 100) * (1 - percent / 100)


def _get_audio_duration(wav_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(wav_path)],
        capture_output=True, text=True, timeout=10,
    )
    try:
        return float(result.stdout.strip())
    except Exception:
        return 3.0


def _get_video_duration(mp4_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(mp4_path)],
        capture_output=True, text=True, timeout=10,
    )
    try:
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def _concat_audio(wav_paths: List[Path], out: Path) -> None:
    list_file = out.parent / "audio_concat.txt"
    list_file.write_text("\n".join(f"file '{p}'" for p in wav_paths))
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
             "-i", str(list_file), "-c", "copy", str(out)],
            check=True, capture_output=True, timeout=60,
        )
    finally:
        list_file.unlink(missing_ok=True)
