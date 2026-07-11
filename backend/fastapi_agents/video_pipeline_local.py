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
from .logging_config import get_logger
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
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = get_logger(__name__)

# ── torchvision/basicsr compatibility shim ──────────────────────────────────
# `basicsr` (an unmaintained transitive dependency pulled in by gfpgan, which
# SadTalker's optional face-restoration enhancer uses) still does
# `from torchvision.transforms.functional_tensor import rgb_to_grayscale` — a
# module path torchvision removed in newer releases (the function moved to
# torchvision.transforms.functional, unchanged). Rather than downgrading
# torchvision project-wide to satisfy one legacy import, register a shim
# module in sys.modules before anything imports basicsr/gfpgan, so the import
# resolves without touching the installed torchvision package itself.
def _patch_torchvision_functional_tensor() -> None:
    import sys
    import types

    if "torchvision.transforms.functional_tensor" in sys.modules:
        return
    try:
        from torchvision.transforms import functional as _tv_functional
    except ImportError:
        return  # torchvision not installed — nothing to patch
    shim = types.ModuleType("torchvision.transforms.functional_tensor")
    shim.rgb_to_grayscale = _tv_functional.rgb_to_grayscale
    sys.modules["torchvision.transforms.functional_tensor"] = shim


_patch_torchvision_functional_tensor()

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

# Free, no-API-key Microsoft neural voices (via the `edge-tts` package), mapped
# onto the same voice_id options the frontend already exposes. Tried before
# macOS `say`/espeak-ng since it sounds meaningfully more human.
EDGE_TTS_VOICES: Dict[str, str] = {
    "samantha": "en-US-AriaNeural",
    "alex":     "en-US-GuyNeural",
    "victoria": "en-US-JennyNeural",
    "daniel":   "en-GB-RyanNeural",
    "karen":    "en-AU-NatashaNeural",
    "moira":    "en-IE-EmilyNeural",
    "tom":      "en-US-ChristopherNeural",
}

THEMES: Dict[str, Dict[str, Any]] = {
    # Authentic EY palette — charcoal 2E2E38 + signature yellow FFE600.
    # `ey` (light canvas) is the flagship, matching the downloadable .pptx.
    "ey": {
        "label": "EY Consulting",
        "bg":            (255, 255, 255),
        "accent":        (255, 230,   0),
        "title_color":   (46,  46,  56),
        "body_color":    (58,  58,  69),
        "muted_color":   (116, 116, 128),
        "bar_color":     (46,  46,  56),
        "footer_color":  (255, 255, 255),
        "stripe_color":  (246, 246, 250),
        "table_header":  (46,  46,  56),
        "table_alt":     (242, 242, 246),
        "success_color": (45,  183,  87),
        "warning_color": (255, 152,  49),
        "info_color":    (24,  140, 229),
    },
    "ey_dark": {
        "label": "EY Dark",
        "bg":            (46,  46,  56),
        "accent":        (255, 230,   0),
        "title_color":   (255, 255, 255),
        "body_color":    (222, 222, 226),
        "muted_color":   (155, 155, 168),
        "bar_color":     (255, 230,   0),
        "footer_color":  (35,  35,  43),
        "stripe_color":  (58,  58,  69),
        "table_header":  (255, 230,   0),
        "table_alt":     (58,  58,  69),
        "success_color": (45,  183,  87),
        "warning_color": (255, 152,  49),
        "info_color":    (79,  195, 247),
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
    # These three mirror theme_engine.py's government/startup/healthcare
    # palettes (same hex values, converted to RGB tuples) so a theme chosen
    # in the frontend renders consistently in both the downloadable .pptx
    # (pptx_builder.py, via theme_engine.py) and the rendered video (here) —
    # this dict is otherwise a separate, independent set of theme
    # definitions from theme_engine.py's, so new themes must be added here
    # too or they silently fall back to ey_dark in video renders only.
    "government": {
        "label": "Government",
        "bg":            (255, 255, 255),
        "accent":        (176, 141,  87),
        "title_color":   (11,   36,  71),
        "body_color":    (43,   51,  59),
        "muted_color":   (92,  107, 122),
        "bar_color":     (11,   36,  71),
        "footer_color":  (238, 241, 245),
        "stripe_color":  (241, 243, 246),
        "table_header":  (11,   36,  71),
        "table_alt":     (238, 241, 245),
        "success_color": (30,  125,  70),
        "warning_color": (183, 121,  31),
        "info_color":    (29,   91, 155),
    },
    "startup": {
        "label": "Startup",
        "bg":            (15,   15,  26),
        "accent":        (124,  92, 255),
        "title_color":   (255, 255, 255),
        "body_color":    (214, 214, 230),
        "muted_color":   (138, 138, 163),
        "bar_color":     (124,  92, 255),
        "footer_color":  (24,   24,  40),
        "stripe_color":  (24,   24,  40),
        "table_header":  (124,  92, 255),
        "table_alt":     (24,   24,  40),
        "success_color": (0,   224, 184),
        "warning_color": (255, 176,  32),
        "info_color":    (92,  168, 255),
    },
    "healthcare": {
        "label": "Healthcare",
        "bg":            (255, 255, 255),
        "accent":        (14,  110,  92),
        "title_color":   (23,   63,  58),
        "body_color":    (46,   74,  69),
        "muted_color":   (107, 138, 133),
        "bar_color":     (14,  110,  92),
        "footer_color":  (240, 247, 246),
        "stripe_color":  (234, 244, 242),
        "table_header":  (14,  110,  92),
        "table_alt":     (234, 244, 242),
        "success_color": (46,  158,  91),
        "warning_color": (217, 140,  43),
        "info_color":    (43,  143, 191),
    },
}

# ── Font loading ─────────────────────────────────────────────────────────────

def _load_font(size: int, bold: bool = False):
    from PIL import ImageFont
    # Avenir Next is the closest metric match to EYInterstate; prefer it so
    # the video frames read like the downloadable EY .pptx.
    candidates = [
        ("/System/Library/Fonts/Avenir Next.ttc",   3 if bold else 0),
        ("/System/Library/Fonts/HelveticaNeue.ttc", 1 if bold else 0),
        ("/System/Library/Fonts/Helvetica.ttc",     0),
        ("/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf", None),
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

# Emotion presets tune pacing + pitch so narration sounds like a real
# consultant, not a flat TTS engine. Values are relative multipliers/offsets.
EMOTION_PRESETS: Dict[str, Dict[str, float]] = {
    "confident":  {"rate": 1.00, "pitch": 0.98, "pause": 1.0},   # measured, authoritative
    "professional": {"rate": 1.00, "pitch": 1.00, "pause": 1.0},
    "warm":       {"rate": 0.95, "pitch": 1.02, "pause": 1.15},  # friendly, unhurried
    "energetic":  {"rate": 1.12, "pitch": 1.05, "pause": 0.8},   # upbeat pitch/demo
    "calm":       {"rate": 0.90, "pitch": 0.99, "pause": 1.25},  # slow, reassuring
    "authoritative": {"rate": 0.94, "pitch": 0.95, "pause": 1.1},
}


# Narration-style presets shift the emotion + pacing to match the audience —
# an Executive readout sounds different from a Technical deep-dive.
NARRATION_STYLE_PRESETS: Dict[str, Dict[str, Any]] = {
    "executive":   {"emotion": "authoritative", "pause": 1.15},
    "consultant":  {"emotion": "confident", "pause": 1.1},
    "professional": {"emotion": "professional", "pause": 1.0},
    "friendly":    {"emotion": "warm", "pause": 1.15},
    "technical":   {"emotion": "calm", "pause": 1.05},
}


@dataclass
class VoiceControls:
    """Human-like delivery controls exposed to the frontend voice panel.
    speed / pitch / volume are relative multipliers around 1.0; emotion +
    narration_style pick pacing/intonation presets; pause_scale and emphasis
    fine-tune rhythm. Backwards compatible: callers that only pass a voice_id
    still get sensible, consultant-grade defaults."""
    voice_id: str = "samantha"
    speed: float = 1.0          # 0.5 – 1.5 (1.0 = natural consultant pace)
    pitch: float = 1.0          # 0.8 – 1.2
    volume: float = 1.0         # 0.0 – 1.5
    emotion: str = "confident"
    narration_style: str = "consultant"  # executive|consultant|professional|friendly|technical
    pause_scale: float = 1.0    # 0.6 – 1.6 — length of pauses between sentences
    emphasis: float = 1.0       # 0.6 – 1.4 — how much key phrases are stressed
    base_rate: int = 172        # words/min at speed=1.0 — deliberately unhurried

    def resolved_emotion(self) -> str:
        style = NARRATION_STYLE_PRESETS.get(str(self.narration_style).lower())
        # An explicitly-set emotion wins; otherwise derive it from the style.
        if self.emotion and self.emotion != "confident":
            return self.emotion
        return style["emotion"] if style else self.emotion

    def resolved_pause(self) -> float:
        style = NARRATION_STYLE_PRESETS.get(str(self.narration_style).lower())
        return self.pause_scale * (style["pause"] if style else 1.0)


class LocalTTSService:
    """TTS using macOS `say` → espeak-ng → ffmpeg silence (never fails).

    Delivery is humanised: a slower default cadence, sentence-level pauses for
    natural rhythm, and post-processing for pitch/volume so the result sounds
    like a confident presenter rather than a robotic reader."""

    def synthesize(
        self,
        text: str,
        out_path: Path,
        voice_id: str = "samantha",
        rate: int | None = None,
        controls: "VoiceControls | None" = None,
    ) -> Path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        vc = controls or VoiceControls(voice_id=voice_id)
        if rate is not None and controls is None:  # legacy callers
            vc.base_rate = rate
        voice_name = VOICES.get(vc.voice_id, VOICES["samantha"])["name"]

        preset = EMOTION_PRESETS.get(str(vc.resolved_emotion()).lower(), EMOTION_PRESETS["confident"])
        eff_rate = int(max(90, min(260, vc.base_rate * vc.speed * preset["rate"])))
        spoken = self._humanize(text, preset["pause"] * vc.resolved_pause())

        if self._try_edge_tts(text, vc, preset, out_path):
            return out_path
        if self._try_macos_say(spoken, voice_name, eff_rate, out_path, vc, preset):
            return out_path
        if self._try_espeak(text, out_path):
            return out_path
        duration = max(3.0, len(text.split()) / 2.5)
        return self._gen_silence(duration, out_path)

    @classmethod
    def _prep_for_edge_tts(cls, text: str) -> str:
        """Same acronym/symbol normalisation as _humanize, minus the macOS
        `say`-specific [[slnc N]] pause markup (edge-tts would read that
        literally) — its neural voices already pause naturally on punctuation."""
        t = " ".join((text or "").split())
        if not t:
            return "."
        for a, b in cls._SPEAK_SUBS:
            t = t.replace(a, b)
        return " ".join(t.split())

    def _try_edge_tts(self, text: str, vc: "VoiceControls", preset: dict, out_path: Path) -> bool:
        """Free, no-API-key Microsoft neural voices — tried first since they
        sound meaningfully more human than macOS `say`/espeak-ng. Requires
        outbound network access to Microsoft's public TTS endpoint (no
        account/key); set DISABLE_EDGE_TTS=1 to force fully-offline operation."""
        if os.getenv("DISABLE_EDGE_TTS"):
            return False
        try:
            import edge_tts
        except ImportError:
            return False
        try:
            import asyncio
            voice = EDGE_TTS_VOICES.get(vc.voice_id, "en-US-AriaNeural")
            rate_pct = max(-50, min(50, int(round((vc.speed * preset.get("rate", 1.0) - 1.0) * 100))))
            pitch_hz = max(-50, min(50, int(round((vc.pitch * preset.get("pitch", 1.0) - 1.0) * 50))))
            spoken = self._prep_for_edge_tts(text)
            mp3_path = out_path.with_suffix(".edge.mp3")

            async def _run():
                communicate = edge_tts.Communicate(
                    spoken, voice, rate=f"{rate_pct:+d}%", pitch=f"{pitch_hz:+d}Hz",
                )
                await communicate.save(str(mp3_path))

            asyncio.run(_run())
            if not mp3_path.exists() or mp3_path.stat().st_size == 0:
                return False
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(mp3_path), "-ar", "44100", "-ac", "1", str(out_path)],
                check=True, capture_output=True, timeout=30,
            )
            mp3_path.unlink(missing_ok=True)
            return True
        except Exception as e:
            logger.debug("[TTS] edge-tts failed: %s", e)
            return False

    # Presentation symbols and terse tokens that a TTS engine mispronounces if
    # left raw — normalised to how a consultant would actually say them.
    _SPEAK_SUBS = [
        # Compound/acronym expansions first (before bare-symbol replacements).
        ("CI/CD", "C I C D"), ("e.g.", "for example"), ("i.e.", "that is"),
        ("etc.", "and so on"), ("APIs", "A P Is"), ("API", "A P I"),
        ("SDLC", "S D L C"), ("RBAC", "R BACK"), ("KPI", "K P I"),
        ("ROI", "R O I"), ("SLA", "S L A"), ("MFA", "M F A"),
        ("UI", "U I"), ("UX", "U X"), ("p95", "P ninety-five"),
        # Symbol softening.
        ("·", ", "), ("—", ", "), ("–", ", "), ("•", ", "),
        ("→", " leads to "), ("&", " and "), ("%", " percent"), ("/", " "),
    ]

    @classmethod
    def _humanize(cls, text: str, pause_scale: float) -> str:
        """Prepare narration for natural spoken delivery: expand/soften symbols
        and acronyms, then insert macOS `say` inline pauses for rhythm — a beat
        after sentences, a shorter one after commas / colons."""
        import re as _re
        t = " ".join((text or "").split())
        if not t:
            return "."
        for a, b in cls._SPEAK_SUBS:
            t = t.replace(a, b)
        t = " ".join(t.split())  # collapse doubled spaces from substitutions
        sent_pause = int(340 * pause_scale)
        comma_pause = int(160 * pause_scale)
        t = _re.sub(r"([.!?])\s+", rf"\1 [[slnc {sent_pause}]] ", t)
        t = _re.sub(r"([,;:])\s+", rf"\1 [[slnc {comma_pause}]] ", t)
        return t

    def _try_macos_say(self, text: str, voice: str, rate: int, out_path: Path,
                       vc: "VoiceControls | None" = None,
                       preset: dict | None = None) -> bool:
        if not shutil.which("say"):
            return False
        try:
            aiff_path = out_path.with_suffix(".aiff")
            subprocess.run(
                ["say", "-v", voice, "-r", str(rate), "-o", str(aiff_path), text],
                check=True, capture_output=True, timeout=90,
            )
            # Post-process pitch + volume for expressive, human delivery.
            filters = []
            pitch = (vc.pitch if vc else 1.0) * (preset.get("pitch", 1.0) if preset else 1.0)
            if abs(pitch - 1.0) > 0.01:
                # Shift pitch without changing tempo: resample then restore rate.
                filters.append(f"asetrate=44100*{pitch:.3f},aresample=44100,atempo={1.0/pitch:.3f}")
            vol = vc.volume if vc else 1.0
            if abs(vol - 1.0) > 0.01:
                filters.append(f"volume={max(0.0, min(2.0, vol)):.2f}")
            af = ["-af", ",".join(filters)] if filters else []
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(aiff_path), *af,
                 "-ar", "44100", "-ac", "1", str(out_path)],
                check=True, capture_output=True, timeout=45,
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


# ── High-fidelity PPTX frame renderer ─────────────────────────────────────────

class PptxFrameRenderer:
    """Rasterises the *actual* generated .pptx into 1920×1080 frames via
    LibreOffice (PPTX → PDF → PNG). This guarantees the video is pixel-identical
    to the downloadable EY deck and supports every layout the deck supports
    (architecture, process, comparison, roadmap, …) — which the lightweight
    Pillow renderer does not. Falls back gracefully (returns None) when
    LibreOffice/poppler are unavailable, so the pipeline can drop back to
    PillowSlideRenderer."""

    def __init__(self, dpi: int = 144):  # 13.333in × 144 = 1920px exactly
        self.dpi = dpi
        self._soffice = shutil.which("soffice") or shutil.which("libreoffice")

    @property
    def available(self) -> bool:
        return bool(self._soffice)

    def render_all(self, slides: List[Dict[str, Any]], theme_id: str,
                   project_name: str, work_dir: Path) -> Optional[List[Any]]:
        if not self.available:
            return None
        try:
            from PIL import Image  # noqa: F401
            from fastapi_agents.pptx_builder import build_pptx_from_deck
        except Exception as exc:
            logger.warning("[PptxFrameRenderer] deps unavailable: %s", exc)
            return None

        try:
            work_dir.mkdir(parents=True, exist_ok=True)
            pptx_path = work_dir / "deck.pptx"
            pptx_path.write_bytes(
                build_pptx_from_deck(slides, project_name, theme_id=theme_id)
            )
            subprocess.run(
                [self._soffice, "--headless", "--norestore", "--convert-to", "pdf",
                 "--outdir", str(work_dir), str(pptx_path)],
                check=True, capture_output=True, timeout=240,
            )
            pdf_path = work_dir / "deck.pdf"
            if not pdf_path.exists():
                logger.warning("[PptxFrameRenderer] LibreOffice produced no PDF")
                return None
            images = self._pdf_to_images(pdf_path, work_dir)
            if not images or len(images) < len(slides):
                logger.warning("[PptxFrameRenderer] frame count %d < slides %d",
                               len(images) if images else 0, len(slides))
                # still usable if counts match closely; else bail
                if not images:
                    return None
            return images
        except Exception as exc:
            logger.warning("[PptxFrameRenderer] render failed, falling back: %s", exc)
            return None

    def _pdf_to_images(self, pdf_path: Path, work_dir: Path) -> List[Any]:
        from PIL import Image
        # Prefer pdf2image (poppler); fall back to pdftoppm CLI.
        try:
            from pdf2image import convert_from_path
            imgs = convert_from_path(str(pdf_path), dpi=self.dpi)
            return [self._fit(i) for i in imgs]
        except Exception:
            pass
        if shutil.which("pdftoppm"):
            prefix = work_dir / "frame"
            subprocess.run(
                ["pdftoppm", "-png", "-r", str(self.dpi), str(pdf_path), str(prefix)],
                check=True, capture_output=True, timeout=180,
            )
            frames = sorted(work_dir.glob("frame*.png"))
            return [self._fit(Image.open(f)) for f in frames]
        return []

    @staticmethod
    def _fit(img):
        from PIL import Image
        if img.size != (SLIDE_W, SLIDE_H):
            img = img.convert("RGB").resize((SLIDE_W, SLIDE_H), Image.LANCZOS)
        return img.convert("RGB")


# ── FFmpeg video composer ─────────────────────────────────────────────────────

class FFmpegComposer:
    """Stitches per-slide PNG + WAV pairs into a final MP4 using FFmpeg.

    Dynamic-video treatment (subtle, presentation-appropriate — never
    distracting):
      * a slow Ken-Burns zoom on every slide so nothing feels static
      * a short cross-fade in/out at each slide boundary (section transitions)
      * adaptive hold: the clip lasts at least as long as its narration, plus a
        complexity-based minimum so dense slides breathe longer than simple ones

    fps and resolution are configurable per render job.
    """

    fps: int = 30
    resolution: tuple = (1920, 1080)

    def compose(
        self,
        slide_pngs: List[Path],
        slide_wavs: List[Path],
        out_path: Path,
        progress_cb: Optional[Callable[[int, str], None]] = None,
        durations: Optional[List[float]] = None,
        motion: bool = True,
        slide_pngs_open: Optional[List[Optional[Path]]] = None,
        motion_styles: Optional[List[str]] = None,
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
                dur = None
                if durations and i < len(durations):
                    dur = durations[i]
                png_open = slide_pngs_open[i] if slide_pngs_open and i < len(slide_pngs_open) else None
                if png_open is not None:
                    # Cartoon presenter: animate mouth open/closed in sync
                    # with the narration's volume instead of a static hold.
                    try:
                        self._make_clip_animated_mouth(png, png_open, wav, clip, duration=dur)
                        clip_paths.append(clip)
                        continue
                    except Exception as exc:
                        logger.warning("[FFmpegComposer] Animated mouth failed for slide %d (%s); "
                                       "falling back to static presenter", i + 1, exc)
                style = motion_styles[i] if motion_styles and i < len(motion_styles) else "fade"
                self._make_clip(png, wav, clip, duration=dur, motion=motion,
                                direction=i % 4, motion_style=style)
                clip_paths.append(clip)

            if progress_cb:
                progress_cb(len(slide_pngs), "Concatenating clips…")
            self._concat(clip_paths, out_path)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        return out_path

    def _make_clip_animated_mouth(self, png_closed: Path, png_open: Path, wav: Path, out: Path,
                                  duration: Optional[float] = None) -> None:
        """Builds a slide clip whose presenter's mouth switches between the
        closed/open frames in time with the narration's volume envelope
        (see _compute_mouth_segments). No Ken-Burns zoom on this path — the
        zoom transform would need to apply identically across frame swaps to
        stay aligned, which isn't worth the complexity for a cartoon
        presenter; a plain scaled hold reads fine and keeps the mouth sync
        exact."""
        segments = _compute_mouth_segments(wav)
        audio_dur = _get_audio_duration(wav)
        hold = max(duration or 0.0, audio_dur + 0.6, 3.0)

        # Pad/trim the segment list to exactly cover `hold` seconds so the
        # video doesn't freeze on the last audio frame while the hold continues.
        total_seg = sum(d for d, _ in segments)
        if total_seg < hold:
            segments = segments + [(hold - total_seg, "closed")]

        list_path = out.parent / f"{out.stem}_frames.txt"
        with open(list_path, "w") as f:
            for dur_s, state in segments:
                src = png_open if state == "open" else png_closed
                f.write(f"file '{src.resolve()}'\n")
                f.write(f"duration {dur_s:.3f}\n")
            # Concat demuxer requires the last file repeated without a
            # trailing duration line to avoid truncating the final segment.
            last_src = png_open if segments[-1][1] == "open" else png_closed
            f.write(f"file '{last_src.resolve()}'\n")

        rw, rh = self.resolution
        fps = int(self.fps)
        fade = 0.4
        vf = (
            f"scale={rw}:{rh},fps={fps},"
            f"fade=t=in:st=0:d={fade},"
            f"fade=t=out:st={max(hold - fade, 0):.2f}:d={fade}"
        )

        try:
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-f", "concat", "-safe", "0", "-i", str(list_path),
                    "-i", str(wav),
                    "-vf", vf,
                    "-c:v", "libx264", "-preset", "medium",
                    "-c:a", "aac", "-b:a", "192k",
                    "-pix_fmt", "yuv420p",
                    "-t", f"{hold:.2f}",
                    "-shortest",
                    str(out),
                ],
                check=True, capture_output=True, timeout=120,
            )
        finally:
            list_path.unlink(missing_ok=True)

    # Per-slide Ken-Burns intensity, keyed by animation_planner.SlideTransition.
    # transition_type. This is an honest, whole-frame zoom/pan variation —
    # ffmpeg's zoompan filter has no notion of "this card" within a static
    # PNG, so "zoom on important elements"/"highlight important cards" is
    # approximated as a stronger/snappier push-in on the whole frame, not
    # true region-targeted zooming. Transition types with no meaningful
    # motion distinction (fade/push/wipe/cut/morph) keep the original 1.06
    # gentle default.
    _MOTION_STYLE_ZOOM = {
        "zoom": 1.12,               # slides with a hero_image — stronger push-in
        "reveal": 1.08,             # step-reveal content — a bit more pronounced than default
        "progressive_diagram": 1.08,
        "highlight": 1.15,          # key-stat/quote moments — the snappiest zoom
    }

    def _make_clip(self, png: Path, wav: Path, out: Path,
                   duration: Optional[float] = None, motion: bool = True,
                   direction: int = 0, motion_style: str = "fade") -> None:
        # Resolve hold time: narration length, floored by a readable minimum.
        try:
            audio_dur = _get_audio_duration(wav)
        except Exception:
            audio_dur = 0.0
        hold = max(duration or 0.0, audio_dur + 0.6, 3.0)
        fps = int(self.fps)
        rw, rh = self.resolution
        frames = max(int(hold * fps), fps)

        vf_parts: List[str] = []
        if motion:
            # Gentle Ken-Burns: zoom 1.00 → ~1.06 by default, stronger for
            # content-aware motion_style values (see _MOTION_STYLE_ZOOM).
            # Oversample first so the zoom stays crisp (no shimmer).
            z_end = self._MOTION_STYLE_ZOOM.get(motion_style, 1.06)
            zexpr = f"min(zoom+{(z_end - 1.0) / frames:.6f},{z_end})"
            # Alternate pan origin for visual variety between slides.
            pan = [
                ("iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),          # center
                ("0", "0"),                                        # top-left
                ("iw-(iw/zoom)", "0"),                             # top-right
                ("iw/2-(iw/zoom/2)", "ih-(ih/zoom)"),             # bottom
            ][direction % 4]
            vf_parts.append(
                f"scale={rw*2}:{rh*2},zoompan=z='{zexpr}':x='{pan[0]}':y='{pan[1]}'"
                f":d={frames}:s={rw}x{rh}:fps={fps}"
            )
        else:
            vf_parts.append(f"scale={rw}:{rh},fps={fps}")
        # Cross-friendly fades at the boundaries → smooth section transitions.
        fade = 0.4
        vf_parts.append(f"fade=t=in:st=0:d={fade}")
        vf_parts.append(f"fade=t=out:st={max(hold - fade, 0):.2f}:d={fade}")
        vf = ",".join(vf_parts)

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-loop", "1", "-t", f"{hold:.2f}", "-i", str(png),
                "-i", str(wav),
                "-vf", vf,
                "-c:v", "libx264", "-preset", "medium",
                "-c:a", "aac", "-b:a", "192k",
                "-pix_fmt", "yuv420p",
                "-t", f"{hold:.2f}",
                "-af", "apad",             # pad audio to the full hold time
                "-movflags", "+faststart",
                str(out),
            ],
            check=True, capture_output=True, timeout=180,
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
    "farmer":              ["farmer_real.jpg"],
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


# SadTalker's inference.py imports these at module load; if any is missing the
# whole "Human Avatar" render fails deep inside a subprocess with no clear
# signal to the UI. Checking them up front lets us report an accurate,
# actionable status instead of a silent "unavailable" after a failed render.
_SADTALKER_PY_DEPS = ["torch", "torchvision", "facexlib", "gfpgan", "kornia",
                      "face_alignment", "yacs", "pydub", "basicsr"]

_sadtalker_status_cache: dict | None = None


def sadtalker_status(force: bool = False) -> dict:
    """Probe SadTalker availability: install dir, checkpoints, and every
    Python dependency inference.py needs. Cached after first successful/failed
    check (import probing is not free) — pass force=True to re-probe, e.g.
    after the user installs missing packages."""
    global _sadtalker_status_cache
    if _sadtalker_status_cache is not None and not force:
        return _sadtalker_status_cache

    missing_deps: list[str] = []
    for mod in _SADTALKER_PY_DEPS:
        try:
            __import__(mod)
        except Exception:
            missing_deps.append(mod)

    dir_ok = SADTALKER_DIR.exists()
    ckpt_ok = SADTALKER_CKPT.exists() and any(SADTALKER_CKPT.iterdir()) if SADTALKER_CKPT.exists() else False
    script_ok = (SADTALKER_DIR / "inference.py").exists()

    available = dir_ok and ckpt_ok and script_ok and not missing_deps
    if available:
        reason = "SadTalker ready — Human Avatar lip-sync is available."
    elif not dir_ok:
        reason = f"SadTalker not installed at {SADTALKER_DIR}."
    elif not ckpt_ok:
        reason = "SadTalker checkpoints missing or empty."
    elif not script_ok:
        reason = "SadTalker inference.py not found."
    else:
        reason = f"Missing Python packages: {', '.join(missing_deps)}. Install with: pip install {' '.join(missing_deps)}"

    _sadtalker_status_cache = {
        "available": available,
        "dir_ok": dir_ok,
        "checkpoints_ok": ckpt_ok,
        "script_ok": script_ok,
        "missing_dependencies": missing_deps,
        "message": reason,
    }
    return _sadtalker_status_cache


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

    # SadTalker renders at roughly this many seconds of wall-clock time per
    # second of driven audio on typical local hardware (CPU / Apple MPS) —
    # measured ~16x on an otherwise-idle M-series Mac with the (default-off)
    # enhancer disabled, but real-world runs compete with other CPU load
    # (background OS processes, other apps) and can run much slower. Kept
    # generous so a busy machine doesn't get cut off mid-render.
    SECONDS_PER_AUDIO_SECOND = 45
    # The (opt-in) gfpgan enhancer adds substantial per-frame overhead on
    # top of that baseline — scale the timeout up automatically when enabled
    # rather than making callers remember to raise it themselves.
    ENHANCER_TIMEOUT_MULTIPLIER = 3

    def __init__(self) -> None:
        self.last_error: Optional[str] = None

    def _resolve_timeout(self, audio_wav: Path) -> int:
        """SadTalker's runtime scales with narration length, not a fixed
        constant — a hardcoded short timeout silently drops the avatar video
        for any real (multi-slide) presentation. Scale the timeout off the
        actual audio duration, with an env override for slower/faster boxes."""
        env_override = os.getenv("SADTALKER_TIMEOUT_SECONDS")
        if env_override:
            try:
                return int(env_override)
            except ValueError:
                pass
        try:
            duration = _get_audio_duration(audio_wav)
        except Exception:
            duration = 60.0
        multiplier = self.SECONDS_PER_AUDIO_SECOND
        if os.getenv("SADTALKER_ENHANCER", "").strip():
            multiplier *= self.ENHANCER_TIMEOUT_MULTIPLIER
        scaled = int(duration * multiplier)
        return max(1800, scaled)

    def generate(
        self,
        audio_wav: Path,
        out_path: Path,
        avatar_image: Optional[Path] = None,
    ) -> Optional[Path]:
        """Run SadTalker to generate a lip-synced talking head MP4."""
        self.last_error = None
        status = sadtalker_status()
        if not status["available"]:
            self.last_error = status["message"]
            logger.error("[SadTalker] Unavailable: %s", status["message"])
            return None

        if not audio_wav.exists():
            self.last_error = f"Narration audio not found: {audio_wav}"
            logger.error("[SadTalker] Audio file not found: %s", audio_wav)
            return None

        face_img = avatar_image if (avatar_image and avatar_image.exists()) else SADTALKER_DEFAULT_FACE
        if not face_img.exists():
            self.last_error = f"No avatar face image available at {face_img}"
            logger.error("[SadTalker] No face image available at %s", face_img)
            return None

        if not SADTALKER_DIR.exists() or not SADTALKER_CKPT.exists():
            self.last_error = f"SadTalker not installed at {SADTALKER_DIR}"
            logger.error("[SadTalker] SadTalker not found at %s", SADTALKER_DIR)
            return None

        result_dir = out_path.parent / f"sadtalker_tmp_{out_path.stem}"
        result_dir.mkdir(parents=True, exist_ok=True)
        timeout = self._resolve_timeout(audio_wav)

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
            # Face-restoration enhancer: meaningfully improves visual quality
            # but (a) downloads an extra ~80MB model on first use with no
            # progress reported mid-request, and (b) adds significant
            # per-frame overhead on top of SadTalker's own ~16x-realtime
            # baseline. Opt-in only — off by default so the reliable, faster
            # path stays the default for demos. Enable with SADTALKER_ENHANCER=gfpgan
            # once the model has been pre-downloaded and the extra wait is acceptable.
            enhancer = os.getenv("SADTALKER_ENHANCER", "").strip()
            if enhancer:
                cmd += ["--enhancer", enhancer]

            logger.info("[SadTalker] Running (timeout=%ds): %s", timeout, " ".join(cmd))
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
                cwd=str(SADTALKER_DIR),
            )

            if proc.returncode != 0:
                self.last_error = f"SadTalker exited with code {proc.returncode}: {proc.stderr[-500:]}"
                logger.error("[SadTalker] Failed (rc=%d):\n%s", proc.returncode, proc.stderr[-2000:])
                return None

            # SadTalker saves to result_dir/<timestamp>/<name>.mp4
            mp4_files = list(result_dir.rglob("*.mp4"))
            if not mp4_files:
                self.last_error = "SadTalker produced no output video"
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
            self.last_error = (
                f"SadTalker avatar rendering timed out after {timeout}s. The narration for this "
                "presentation is long enough that AI lip-sync couldn't finish in time on this "
                "machine — set SADTALKER_TIMEOUT_SECONDS to a higher value to allow more time, "
                "or shorten the narration."
            )
            logger.error("[SadTalker] Timed out after %ds", timeout)
            shutil.rmtree(result_dir, ignore_errors=True)
            return None
        except Exception as exc:
            self.last_error = f"SadTalker failed: {exc}"
            logger.error("[SadTalker] Exception: %s", exc, exc_info=True)
            shutil.rmtree(result_dir, ignore_errors=True)
            return None


# Keep old name as alias for backward compat
LocalAvatarService = SadTalkerAvatarService


def _draw_captions(img, text: str, theme_id: str, left: int = 140, right: int = 140):
    """Burn a clean caption band with the narration onto a slide frame. `left`
    and `right` are the band's horizontal margins — insetting on the presenter's
    side keeps captions clear of the presenter figure."""
    from PIL import Image, ImageDraw
    theme = THEMES.get(theme_id, THEMES["ey"])
    words = " ".join(str(text).split())
    band_w_chars = max(int((SLIDE_W - left - right) / 21), 30)
    if len(words) > band_w_chars * 2:
        words = words[: band_w_chars * 2 - 3].rsplit(" ", 1)[0] + "…"
    font = _load_font(30)
    lines, cur = [], ""
    for w in words.split(" "):
        if len(cur) + len(w) + 1 > band_w_chars:
            lines.append(cur); cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    lines = lines[:2]
    band_h = 40 + len(lines) * 42
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    y0 = SLIDE_H - 60 - band_h - 20
    d.rectangle([(left, y0), (SLIDE_W - right, y0 + band_h)], fill=(46, 46, 56, 215))
    d.rectangle([(left, y0), (left + 6, y0 + band_h)], fill=(*theme["accent"], 255))
    for i, ln in enumerate(lines):
        d.text((left + 32, y0 + 20 + i * 42), ln, font=font, fill=(255, 255, 255, 255))
    base.alpha_composite(overlay)
    return base.convert("RGB")


# ── Cartoon presenter — professional corporate explainer (default) ────────────

class CartoonPresenterService:
    """Draws a clean, professional cartoon presenter (not childish) and
    composites it onto a slide frame. The presenter stands to the side so it
    never covers content, and can gesture toward the slide ("point") or face
    the audience ("talk"). Rendered fully locally with Pillow — no assets, no
    downloads. A talking-head lip-sync avatar remains available via the
    "human" presenter (SadTalker); this is the lightweight default."""

    # Personas that get the farmer illustration instead of the default
    # business-suit presenter — matches the rural-governance avatar options
    # already offered in the picker (farmer, village_woman).
    _FARMER_PERSONAS = {"farmer", "village_woman"}

    def composite(self, slide_img, theme_id: str, gesture: str = "talk",
                  hero: bool = False, position: str = "right", persona: str = "professional_male",
                  mouth_state: str = "closed"):
        from PIL import Image, ImageOps
        theme = THEMES.get(theme_id, THEMES["ey"])
        h = SLIDE_H
        # Hero slides (title/section/closing) have right-side whitespace → a
        # larger figure on the right. Content slides (and anything on the LEFT,
        # where titles are left-aligned) get a compact corner presenter that
        # tucks into the margin so it never covers the content.
        left_side = str(position).lower() == "left"
        frac = 0.52 if (hero and not left_side) else 0.34
        pw = int(h * frac)
        ph = int(pw * 1.65)
        gest = gesture
        if str(persona).lower() in self._FARMER_PERSONAS:
            presenter = self._draw_farmer_presenter(pw, ph, theme, gest, mouth_state=mouth_state)
        else:
            presenter = self._draw_presenter(pw, ph, theme, gest, mouth_state=mouth_state)
        if str(position).lower() == "left":
            presenter = ImageOps.mirror(presenter)  # face/point toward content
            x = 60 if hero else 18
        else:
            x = SLIDE_W - pw - (60 if hero else 18)
        y = SLIDE_H - ph - (60 if hero else 40)
        base = slide_img.convert("RGBA")
        base.alpha_composite(presenter, (x, y))
        return base.convert("RGB")

    def _draw_presenter(self, w: int, h: int, theme: dict, gesture: str, mouth_state: str = "closed"):
        from PIL import Image, ImageDraw
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)

        accent = tuple(theme["accent"])
        charcoal = (46, 46, 56)
        suit = (52, 58, 74)          # navy-charcoal business suit
        suit_dark = (38, 42, 55)
        shirt = (245, 246, 250)
        skin = (233, 196, 166)
        skin_sh = (214, 176, 146)
        hair = (58, 46, 40)

        cx = w // 2
        # Soft ground shadow for grounding
        d.ellipse([cx - w * 0.32, h - h * 0.05, cx + w * 0.32, h], fill=(0, 0, 0, 40))

        # ── Torso / suit jacket (rounded shoulders) ──────────────────────────
        sh_top = int(h * 0.42)
        d.rounded_rectangle([cx - w * 0.34, sh_top, cx + w * 0.34, h - 2],
                            radius=int(w * 0.22), fill=suit)
        # Lapels + shirt V
        d.polygon([(cx - w * 0.10, sh_top + 6), (cx + w * 0.10, sh_top + 6),
                   (cx, sh_top + h * 0.20)], fill=shirt)
        d.polygon([(cx - w * 0.10, sh_top + 6), (cx, sh_top + h * 0.20),
                   (cx - w * 0.02, sh_top + h * 0.10)], fill=suit_dark)
        d.polygon([(cx + w * 0.10, sh_top + 6), (cx, sh_top + h * 0.20),
                   (cx + w * 0.02, sh_top + h * 0.10)], fill=suit_dark)
        # Tie in EY yellow — the signature pop of colour
        d.polygon([(cx - w * 0.03, sh_top + h * 0.06), (cx + w * 0.03, sh_top + h * 0.06),
                   (cx + w * 0.05, sh_top + h * 0.24), (cx, sh_top + h * 0.30),
                   (cx - w * 0.05, sh_top + h * 0.24)], fill=accent)

        # ── Neck + head ──────────────────────────────────────────────────────
        neck_w = w * 0.11
        d.rectangle([cx - neck_w, sh_top - h * 0.06, cx + neck_w, sh_top + 8], fill=skin_sh)
        head_r = w * 0.20
        head_cy = int(h * 0.24)
        d.ellipse([cx - head_r, head_cy - head_r * 1.15, cx + head_r, head_cy + head_r * 1.1],
                  fill=skin)
        # Ears
        d.ellipse([cx - head_r - 6, head_cy - 6, cx - head_r + 10, head_cy + 18], fill=skin)
        d.ellipse([cx + head_r - 10, head_cy - 6, cx + head_r + 6, head_cy + 18], fill=skin)
        # Hair — neat professional cut
        d.chord([cx - head_r - 2, head_cy - head_r * 1.25, cx + head_r + 2, head_cy + head_r * 0.3],
                180, 360, fill=hair)
        d.rectangle([cx - head_r - 2, head_cy - head_r * 0.55, cx - head_r + 8, head_cy + head_r * 0.2],
                    fill=hair)
        d.rectangle([cx + head_r - 8, head_cy - head_r * 0.55, cx + head_r + 2, head_cy + head_r * 0.2],
                    fill=hair)
        # Eyes (maintaining eye contact — looking at the audience)
        eye_y = head_cy
        for ex in (cx - head_r * 0.42, cx + head_r * 0.42):
            d.ellipse([ex - 9, eye_y - 7, ex + 9, eye_y + 7], fill=(255, 255, 255))
            d.ellipse([ex - 4, eye_y - 4, ex + 4, eye_y + 4], fill=charcoal)
        # Eyebrows
        d.line([cx - head_r * 0.58, eye_y - 16, cx - head_r * 0.24, eye_y - 19], fill=hair, width=4)
        d.line([cx + head_r * 0.24, eye_y - 19, cx + head_r * 0.58, eye_y - 16], fill=hair, width=4)
        # Mouth — amplitude-driven "talking" state: an open oval when the
        # narration audio is loud at this instant, a closed smile otherwise.
        # Not phoneme-accurate lip-sync, but reads as talking vs. silent.
        if mouth_state == "open":
            d.ellipse([cx - head_r * 0.22, eye_y + head_r * 0.28, cx + head_r * 0.22, eye_y + head_r * 0.58],
                      fill=(120, 60, 55))
            d.ellipse([cx - head_r * 0.14, eye_y + head_r * 0.32, cx + head_r * 0.14, eye_y + head_r * 0.46],
                      fill=(210, 90, 90))
        else:
            d.arc([cx - head_r * 0.4, eye_y + 6, cx + head_r * 0.4, eye_y + head_r * 0.55],
                  15, 165, fill=(150, 90, 80), width=4)

        # ── Arms / gesture ───────────────────────────────────────────────────
        arm_w = int(w * 0.13)
        if gesture == "point":
            # Raised arm pointing up-left toward the slide content
            d.line([(cx - w * 0.28, sh_top + h * 0.06), (cx - w * 0.46, sh_top - h * 0.02)],
                   fill=suit, width=arm_w)
            # Hand + pointing finger
            hx, hy = cx - w * 0.47, sh_top - h * 0.03
            d.ellipse([hx - 12, hy - 12, hx + 12, hy + 12], fill=skin)
            d.line([(hx, hy), (hx - 22, hy - 14)], fill=skin, width=8)
        else:
            # Open-hand welcoming gesture at waist height
            d.line([(cx - w * 0.28, sh_top + h * 0.08), (cx - w * 0.36, sh_top + h * 0.30)],
                   fill=suit, width=arm_w)
            hx, hy = cx - w * 0.36, sh_top + h * 0.32
            d.ellipse([hx - 13, hy - 13, hx + 13, hy + 13], fill=skin)
        # Resting right arm
        d.line([(cx + w * 0.28, sh_top + h * 0.08), (cx + w * 0.30, sh_top + h * 0.34)],
               fill=suit, width=arm_w)
        hx2, hy2 = cx + w * 0.30, sh_top + h * 0.35
        d.ellipse([hx2 - 12, hy2 - 12, hx2 + 12, hy2 + 12], fill=skin)

        return img

    def _draw_farmer_presenter(self, w: int, h: int, theme: dict, gesture: str, mouth_state: str = "closed"):
        """Rural-governance persona: turban, mustache, kurta, dhoti, holding a
        wheat sheaf — same flat, hand-drawn illustration style as the default
        presenter, just a different figure, so it fits Panchayati Raj / rural
        stakeholder contexts (farmer, village_woman personas)."""
        import math as _math
        from PIL import Image, ImageDraw
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)

        charcoal = (46, 46, 56)
        turban = (232, 178, 58)       # mustard/saffron turban
        turban_sh = (203, 148, 36)
        turban_hi = (247, 202, 92)
        kurta = (247, 243, 231)       # cream kurta
        kurta_sh = (222, 216, 198)
        dhoti = (150, 108, 66)        # earthy brown dhoti
        dhoti_sh = (124, 86, 48)
        skin = (196, 148, 108)
        skin_sh = (172, 124, 88)
        hair = (40, 32, 28)
        wheat = (224, 182, 78)
        wheat_dark = (196, 150, 54)
        stalk = (104, 144, 82)

        cx = w // 2
        d.ellipse([cx - w * 0.34, h - h * 0.04, cx + w * 0.34, h], fill=(0, 0, 0, 40))

        # ── Dhoti — voluminous, balloons out at the hip then tapers to a
        # cinched ankle before the bare foot, unlike straight trousers ──────
        sh_top = int(h * 0.42)
        hip_y = sh_top + h * 0.20
        knee_y = sh_top + h * 0.52
        ankle_y = h - h * 0.06
        for side in (-1, 1):
            d.polygon([
                (cx + side * w * 0.03, hip_y),
                (cx + side * w * 0.30, hip_y + h * 0.06),
                (cx + side * w * 0.26, knee_y),
                (cx + side * w * 0.15, ankle_y),
                (cx + side * w * 0.05, ankle_y),
                (cx + side * w * 0.02, knee_y),
            ], fill=dhoti)
            d.polygon([
                (cx + side * w * 0.30, hip_y + h * 0.06),
                (cx + side * w * 0.26, knee_y),
                (cx + side * w * 0.22, knee_y + 4),
                (cx + side * w * 0.27, hip_y + h * 0.08),
            ], fill=dhoti_sh)
        d.polygon([(cx - w * 0.11, sh_top + h * 0.16), (cx + w * 0.11, sh_top + h * 0.16),
                   (cx + w * 0.15, hip_y + 6), (cx - w * 0.15, hip_y + 6)], fill=dhoti_sh)
        # Bare feet (visible toes)
        for side in (-1, 1):
            fx = cx + side * w * 0.10
            d.ellipse([fx - w * 0.075, ankle_y - 6, fx + w * 0.075, h + 2], fill=skin_sh)
            for t in range(3):
                tx = fx - w * 0.045 + t * w * 0.045
                d.ellipse([tx - 3, h - 6, tx + 3, h + 2], fill=skin)

        # ── Kurta (collarless, button placket, rolled sleeves) ───────────────
        d.rounded_rectangle([cx - w * 0.33, sh_top, cx + w * 0.33, sh_top + h * 0.36],
                            radius=int(w * 0.17), fill=kurta)
        d.line([(cx, sh_top + 4), (cx, sh_top + h * 0.32)], fill=kurta_sh, width=3)
        for by in (0.09, 0.18, 0.27):
            d.ellipse([cx - 3, sh_top + h * by - 3, cx + 3, sh_top + h * by + 3], fill=kurta_sh)

        # ── Neck + head ───────────────────────────────────────────────────────
        neck_w = w * 0.10
        d.rectangle([cx - neck_w, sh_top - h * 0.05, cx + neck_w, sh_top + 6], fill=skin_sh)
        head_r = w * 0.19
        head_cy = int(h * 0.23)
        d.ellipse([cx - head_r, head_cy - head_r * 0.95, cx + head_r, head_cy + head_r * 1.15],
                  fill=skin)
        d.ellipse([cx - head_r - 5, head_cy - 4, cx - head_r + 9, head_cy + 16], fill=skin)
        d.ellipse([cx + head_r - 9, head_cy - 4, cx + head_r + 5, head_cy + 16], fill=skin)

        # Turban — big rounded dome sitting high, with horizontal wrap bands
        # confined to the dome (never crossing onto the face) and a side
        # puff/knot, matching a traditional pagri silhouette.
        turb_top = head_cy - head_r * 1.85
        turb_bottom = head_cy - head_r * 0.25   # dome's lower edge — stays above the eyeline
        turb_l, turb_r = cx - head_r * 1.25, cx + head_r * 1.25
        d.ellipse([turb_l, turb_top, turb_r, head_cy + head_r * 0.15], fill=turban)
        # Wrap folds — evenly spaced horizontal bands confined between the
        # dome's top and its lower edge, so they never reach the face.
        band_span = turb_bottom - (turb_top + head_r * 0.35)
        for k in range(4):
            yy = turb_top + head_r * 0.35 + band_span * (k / 3)
            inset = head_r * 0.15 * (1 - abs(k - 1.5) / 1.5)
            d.arc([turb_l + 4 + inset, yy - head_r * 0.22, turb_r - 4 - inset, yy + head_r * 0.22],
                  10, 170, fill=turban_sh, width=3)
        d.arc([turb_l + head_r * 0.15, turb_top, turb_r - head_r * 0.15, turb_top + head_r * 0.9],
              200, 340, fill=turban_hi, width=4)
        # Side puff / knot, tucked above the ear
        d.ellipse([cx + head_r * 0.65, turb_top - head_r * 0.08, cx + head_r * 1.25, turb_top + head_r * 0.42],
                  fill=turban_sh)
        d.ellipse([cx + head_r * 0.75, turb_top + head_r * 0.02, cx + head_r * 1.12, turb_top + head_r * 0.3],
                  fill=turban)

        # Eyes
        eye_y = head_cy + head_r * 0.05
        for ex in (cx - head_r * 0.40, cx + head_r * 0.40):
            d.ellipse([ex - 8, eye_y - 6, ex + 8, eye_y + 6], fill=(255, 255, 255))
            d.ellipse([ex - 3.5, eye_y - 3.5, ex + 3.5, eye_y + 3.5], fill=charcoal)
        d.line([cx - head_r * 0.56, eye_y - 15, cx - head_r * 0.22, eye_y - 18], fill=hair, width=3)
        d.line([cx + head_r * 0.22, eye_y - 18, cx + head_r * 0.56, eye_y - 15], fill=hair, width=3)

        # Mustache — thick, with curled ends (the defining rural-presenter feature)
        must_y = eye_y + head_r * 0.55
        d.arc([cx - head_r * 0.55, must_y - 10, cx, must_y + 12], 195, 360, fill=hair, width=8)
        d.arc([cx, must_y - 10, cx + head_r * 0.55, must_y + 12], 180, 345, fill=hair, width=8)
        d.ellipse([cx - head_r * 0.58, must_y - 2, cx - head_r * 0.44, must_y + 10], fill=hair)
        d.ellipse([cx + head_r * 0.44, must_y - 2, cx + head_r * 0.58, must_y + 10], fill=hair)
        # Mouth beneath the mustache — amplitude-driven open/closed state
        # (see _draw_presenter for the same logic on the default persona).
        if mouth_state == "open":
            d.ellipse([cx - head_r * 0.18, must_y + 4, cx + head_r * 0.18, must_y + head_r * 0.34],
                      fill=(110, 55, 50))
            d.ellipse([cx - head_r * 0.11, must_y + 7, cx + head_r * 0.11, must_y + head_r * 0.21],
                      fill=(200, 85, 85))
        else:
            d.arc([cx - head_r * 0.32, must_y + 6, cx + head_r * 0.32, must_y + head_r * 0.5],
                  15, 165, fill=(150, 90, 80), width=3)

        # ── Arms + wheat sheaf ────────────────────────────────────────────────
        arm_w = int(w * 0.12)
        if gesture == "point":
            d.line([(cx - w * 0.28, sh_top + h * 0.06), (cx - w * 0.46, sh_top - h * 0.02)],
                   fill=kurta, width=arm_w)
            hx, hy = cx - w * 0.47, sh_top - h * 0.03
            d.ellipse([hx - 11, hy - 11, hx + 11, hy + 11], fill=skin)
        else:
            d.line([(cx - w * 0.27, sh_top + h * 0.08), (cx - w * 0.34, sh_top + h * 0.28)],
                   fill=kurta, width=arm_w)
            hx, hy = cx - w * 0.35, sh_top + h * 0.30
            d.ellipse([hx - 12, hy - 12, hx + 12, hy + 12], fill=skin)
        # Resting arm holding the wheat sheaf against the chest
        d.line([(cx + w * 0.27, sh_top + h * 0.08), (cx + w * 0.24, sh_top + h * 0.32)],
               fill=kurta, width=arm_w)
        hx2, hy2 = cx + w * 0.24, sh_top + h * 0.33
        d.ellipse([hx2 - 11, hy2 - 11, hx2 + 11, hy2 + 11], fill=skin)

        # Wheat sheaf: a fuller fan of stalks with drooping golden heads,
        # held prominently in front rather than a thin sprig.
        for ang in (-32, -16, 0, 16, 32, 46):
            rad = _math.radians(ang - 92)
            L = h * (0.26 if abs(ang) < 20 else 0.22)
            ex = hx2 + L * _math.cos(rad)
            ey = hy2 + L * _math.sin(rad)
            d.line([(hx2, hy2), (ex, ey)], fill=stalk, width=3)
            # Drooping seed head: an elongated ellipse angled along the stalk
            head_img = Image.new("RGBA", (26, 44), (0, 0, 0, 0))
            hd = ImageDraw.Draw(head_img)
            hd.ellipse([4, 0, 22, 40], fill=wheat)
            hd.ellipse([8, 4, 18, 34], fill=wheat_dark)
            rotated = head_img.rotate(-ang * 0.6, expand=True, resample=Image.BICUBIC)
            img.alpha_composite(rotated, (int(ex - rotated.width / 2), int(ey - rotated.height * 0.65)))
        d.ellipse([hx2 - 9, hy2 - 7, hx2 + 9, hy2 + 11], fill=stalk)  # binding knot

        return img


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
    # Presenter system: cartoon (default) | human | voice_only | none
    presenter_type: str = "cartoon"
    presenter_position: str = "right"     # right | left
    # Human-like voice controls (see VoiceControls)
    voice_speed: float = 1.0
    voice_pitch: float = 1.0
    voice_volume: float = 1.0
    voice_emotion: str = "confident"
    narration_style: str = "consultant"
    pause_scale: float = 1.0
    emphasis: float = 1.0
    # Video controls
    resolution: str = "1080p"             # 720p | 1080p | 1440p
    fps: int = 30
    captions: bool = False
    motion: bool = True                    # Ken-Burns / camera motion toggle
    # Additive, independent of `captions` (which burns a caption band onto
    # slide PNGs) — this produces real downloadable .srt/.vtt sidecar files.
    generate_subtitle_files: bool = False
    srt_path: Optional[str] = None
    vtt_path: Optional[str] = None
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
    avatar_error: Optional[str] = None
    avatar_provider_used: Optional[str] = None  # "d-id" | "sadtalker" | None if avatar mode wasn't used


# Module-level job registry (in-memory, survives request lifecycle)
VIDEO_JOBS: Dict[str, VideoRenderJob] = {}
_jobs_lock = threading.Lock()


def create_job(
    project_id: int,
    slides: List[Dict[str, Any]],
    mode: str = "slides",
    theme_id: str = "ey",
    voice_id: str = "samantha",
    avatar_id: str = "professional_male",
    presenter_type: str = "cartoon",
    presenter_position: str = "right",
    voice_speed: float = 1.0,
    voice_pitch: float = 1.0,
    voice_volume: float = 1.0,
    voice_emotion: str = "confident",
    narration_style: str = "consultant",
    pause_scale: float = 1.0,
    emphasis: float = 1.0,
    resolution: str = "1080p",
    fps: int = 30,
    captions: bool = False,
    motion: bool = True,
    generate_subtitle_files: bool = False,
) -> VideoRenderJob:
    job_id = uuid.uuid4().hex
    # presenter_type is the single source of truth for which render path
    # runs — a "human" presenter drives SadTalker lip-sync (mode="avatar"),
    # everything else renders the narrated (optionally cartoon-overlaid)
    # slideshow. Previously `mode` was only forced to "avatar" when
    # presenter_type=="human" but never reset otherwise, so a stale
    # mode="avatar" from an earlier request (frontend's `mode`/`presenter_type`
    # are separate fields that can drift out of sync) would keep running
    # SadTalker even after switching to Cartoon Presenter. Always derive it.
    mode = "avatar" if presenter_type == "human" else ("slides" if mode == "avatar" else mode)
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
        presenter_type=presenter_type,
        presenter_position=presenter_position,
        voice_speed=voice_speed,
        voice_pitch=voice_pitch,
        voice_volume=voice_volume,
        voice_emotion=voice_emotion,
        narration_style=narration_style,
        pause_scale=pause_scale,
        emphasis=emphasis,
        resolution=resolution,
        fps=fps,
        captions=captions,
        motion=motion,
        generate_subtitle_files=generate_subtitle_files,
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
    if not shutil.which("ffmpeg"):
        raise RuntimeError(
            "ffmpeg is not installed or not on PATH — video rendering requires ffmpeg. "
            "Install it (e.g. `brew install ffmpeg` on macOS, `apt install ffmpeg` on Linux) and retry."
        )

    tmp_dir = VIDEO_OUTPUT_DIR / f"job_{job.job_id}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    slides = job.slides
    total = len(slides)

    renderer = PillowSlideRenderer()
    tts = LocalTTSService()
    composer = FFmpegComposer()

    slide_pngs: List[Path] = []
    slide_pngs_open: List[Optional[Path]] = []  # mouth-open variant, cartoon presenter only
    slide_wavs: List[Path] = []

    # ── Phase 1: Render slide images ─────────────────────────────────────
    job.stage = "Rendering slides"
    _log(job, f"Rendering {total} slides with theme '{job.theme_id}'")

    # Cartoon presenter is composited beside content so it never covers it.
    presenter_svc = CartoonPresenterService() if job.presenter_type == "cartoon" else None

    # High-fidelity path: rasterise the real EY .pptx so the video matches the
    # downloadable deck exactly and supports every layout. Falls back to the
    # lightweight Pillow renderer if LibreOffice/poppler aren't available.
    hi_frames = None
    try:
        project_name = (slides[0].get("title") if slides else None) or f"Project {job.project_id}"
        hi_frames = PptxFrameRenderer().render_all(
            slides, job.theme_id, project_name, tmp_dir / "pptx_frames"
        )
        if hi_frames:
            _log(job, f"Using high-fidelity PPTX frames ({len(hi_frames)} rendered)")
    except Exception as exc:
        _log(job, f"PPTX frame render unavailable ({exc}); using Pillow renderer")
        hi_frames = None

    for i, slide in enumerate(slides):
        pct = int(5 + (i / total) * 35)
        _progress(job, pct, f"Rendering slide {i + 1}/{total}: {slide.get('title', '')[:40]}")
        job.storyboard[i].status = "rendering"

        if hi_frames and i < len(hi_frames):
            base_img = hi_frames[i]
        else:
            base_img = renderer.render(slide, job.theme_id, i + 1, total)

        cap_text = ""
        cl, cr = 140, 140
        if job.captions:
            cap_text = (slide.get("narration") or slide.get("speaker_notes") or "").strip()
            if presenter_svc is not None:
                if str(job.presenter_position).lower() == "left":
                    cl = 560
                else:
                    cr = 560

        def _finish(mouth_state: str):
            """Composite the presenter (at the given mouth state, if any) and
            captions onto a fresh copy of the base slide image."""
            frame = base_img.copy()
            if presenter_svc is not None:
                layout = slide.get("layout")
                gesture = "point" if layout in ("architecture", "process", "chart", "timeline", "table", "tech_grid", "roadmap", "comparison") else "talk"
                hero = layout in ("title", "section", "closing", "quote")
                frame = presenter_svc.composite(frame, job.theme_id, gesture=gesture, hero=hero,
                                                position=job.presenter_position, persona=job.avatar_id,
                                                mouth_state=mouth_state)
            if cap_text:
                frame = _draw_captions(frame, cap_text, job.theme_id, left=cl, right=cr)
            return frame

        img = _finish("closed")
        png_path = tmp_dir / f"slide_{i:03d}.png"
        renderer.to_png(img, png_path)
        slide_pngs.append(png_path)

        # Cartoon presenter also gets a mouth-open variant so the composer
        # can animate a simple amplitude-driven "talking" effect — skipped
        # for other presenter types (human/none), which don't use this frame.
        if presenter_svc is not None:
            img_open = _finish("open")
            png_open_path = tmp_dir / f"slide_{i:03d}_open.png"
            renderer.to_png(img_open, png_open_path)
            slide_pngs_open.append(png_open_path)
        else:
            slide_pngs_open.append(None)

        job.storyboard[i].thumb_b64 = renderer.to_thumbnail_b64(img)
        job.storyboard[i].status = "rendered"
        _log(job, f"  ✓ Slide {i + 1} rendered ({slide.get('layout', 'content')} layout)")

    # ── Phase 2: Generate narration audio ─────────────────────────────────
    job.stage = "Generating narration"
    _log(job, f"Synthesizing audio · voice '{job.voice_id}' · emotion '{job.voice_emotion}'")

    controls = VoiceControls(
        voice_id=job.voice_id,
        speed=job.voice_speed,
        pitch=job.voice_pitch,
        volume=job.voice_volume,
        emotion=job.voice_emotion,
        narration_style=job.narration_style,
        pause_scale=job.pause_scale,
        emphasis=job.emphasis,
    )
    slide_durations: List[float] = []
    narration_texts: List[str] = []

    for i, slide in enumerate(slides):
        pct = int(40 + (i / total) * 30)
        _progress(job, pct, f"TTS: slide {i + 1}/{total}")

        narration = (
            slide.get("narration")
            or slide.get("speaker_notes")
            or slide.get("content")
            or slide.get("title", "")
        )
        narration = (narration or "").strip()
        if len(narration) > 900:
            narration = narration[:900]

        wav_path = tmp_dir / f"audio_{i:03d}.wav"
        tts.synthesize(narration, wav_path, controls=controls)

        try:
            dur = _get_audio_duration(wav_path)
        except Exception:
            dur = 0.0
        job.storyboard[i].audio_duration = dur
        # Adaptive timing: complex slides hold longer than simple ones, even if
        # the narration is short, so viewers can absorb dense visuals.
        hold = max(dur + 0.6, _slide_min_duration(slide))
        slide_durations.append(hold)
        slide_wavs.append(wav_path)
        narration_texts.append(narration)
        _log(job, f"  ✓ Audio {i + 1}: {dur:.1f}s → hold {hold:.1f}s")

    # ── Phase 3: Compose MP4 ──────────────────────────────────────────────
    job.stage = "Composing video"
    _progress(job, 72, "Composing final MP4…")
    _log(job, "Starting FFmpeg composition")

    out_mp4 = VIDEO_OUTPUT_DIR / f"project_{job.project_id}_{job.job_id}.mp4"

    def encode_cb(idx: int, msg: str):
        pct = int(72 + (idx / total) * 18)
        _progress(job, pct, msg)
        _log(job, f"  {msg}")

    _RES = {"720p": (1280, 720), "1080p": (1920, 1080), "1440p": (2560, 1440)}
    composer.fps = int(job.fps or 30)
    composer.resolution = _RES.get(job.resolution, (1920, 1080))

    # Animation Planner: derive a per-slide Ken-Burns motion style from each
    # slide's layout/hero_image (architecture/process/roadmap -> a stronger
    # progressive-reveal zoom; a slide with a hero_image -> a push-in zoom).
    # Every slide's own layout/hero_image is already available on `slides`
    # (posted from the editor / the presentation pipeline's exported deck),
    # so no extra LLM call or lookup is needed here.
    from . import animation_planner as _AP
    _scenes_for_motion = [
        {"scene_number": i + 1, "layout": sl.get("layout") or sl.get("visual_suggestions", ""),
         "hero_image": sl.get("hero_image")}
        for i, sl in enumerate(slides)
    ]
    _transitions = _AP.plan_transitions(_scenes_for_motion)
    motion_styles = ["fade"] + [t.transition_type for t in _transitions]

    composer.compose(slide_pngs, slide_wavs, out_mp4, progress_cb=encode_cb,
                     durations=slide_durations, motion=job.motion,
                     slide_pngs_open=slide_pngs_open if presenter_svc is not None else None,
                     motion_styles=motion_styles)
    job.video_path = str(out_mp4)
    job.duration_seconds = _get_video_duration(out_mp4)
    _log(job, f"Video composed: {job.duration_seconds:.1f}s → {out_mp4.name}")

    if job.generate_subtitle_files:
        try:
            from .services.subtitle_generator import build_cues, write_subtitle_files
            cues = build_cues(narration_texts, slide_durations)
            srt_path, vtt_path = write_subtitle_files(cues, VIDEO_OUTPUT_DIR, f"project_{job.project_id}_{job.job_id}")
            job.srt_path = str(srt_path)
            job.vtt_path = str(vtt_path)
            _log(job, f"Subtitle files generated: {srt_path.name}, {vtt_path.name}")
        except Exception as exc:
            logger.warning("[VideoPipeline] Subtitle generation failed (non-fatal): %s", exc)
            _log(job, f"⚠ Subtitle generation skipped: {exc}")

    # ── Phase 4: Avatar mode (D-ID, SadTalker fallback) ──────────────────
    if job.mode == "avatar":
        job.stage = "Generating SadTalker avatar"
        _progress(job, 90, "Concatenating narration audio…")
        _log(job, "Concatenating slide audio for SadTalker")

        # Concatenate all slide WAVs into one file for SadTalker
        combined_wav = tmp_dir / "combined_narration.wav"
        _concat_audio(slide_wavs, combined_wav)

        _progress(job, 92, "Rendering AI avatar (D-ID, falling back to local SadTalker if needed)…")
        _log(job, "Rendering AI avatar — D-ID primary, SadTalker automatic fallback")

        from .agents.avatar_provider import render_avatar_with_fallback, AvatarRenderError

        avatar_out = VIDEO_OUTPUT_DIR / f"avatar_{job.project_id}_{job.job_id}.mp4"
        face_img = avatar_image_for(job.avatar_id)
        _log(job, f"Avatar persona '{job.avatar_id}' → {face_img.name}")

        # db_session_factory is a FastAPI generator dependency (get_db), not a
        # plain callable — must be advanced with next(), same pattern
        # presentation_routes.py's _save_video_artifacts uses.
        db_session = next(db_session_factory()) if db_session_factory else None
        try:
            render_result = render_avatar_with_fallback(
                narration_text=" ".join(t for t in narration_texts if t),
                audio_wav=combined_wav,
                out_path=avatar_out,
                avatar_image=face_img,
                voice_id=job.voice_id,
                db=db_session,
                project_id=job.project_id,
            )
            job.avatar_path = str(render_result.video_path)
            job.avatar_provider_used = render_result.provider_used
            job.fallback_used = render_result.fallback_occurred
            job.avatar_error = render_result.primary_error
            _log(job, f"✓ Avatar generated via {render_result.provider_used}"
                       + (f" (fell back from D-ID: {render_result.primary_error})" if render_result.fallback_occurred else ""))
        except AvatarRenderError as exc:
            # Both D-ID (if configured) and SadTalker failed — matches the
            # pre-existing "SadTalker failed" outcome exactly (no avatar_path,
            # fallback_used + avatar_error surfaced), just from either provider.
            job.fallback_used = True
            job.avatar_error = str(exc)
            _log(job, f"⚠ Avatar rendering failed — avatar_path will be None ({job.avatar_error})")
        finally:
            if db_session is not None:
                db_session.close()

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


# Complexity-weighted minimum hold times (seconds). Dense, information-rich
# layouts stay on screen longer so the audience can read and absorb them.
_LAYOUT_MIN_DURATION: Dict[str, float] = {
    "title": 4.0, "section": 3.5, "divider": 3.5, "quote": 5.0, "closing": 5.0,
    "agenda": 6.0, "items": 7.0, "content": 6.0, "two_col": 8.0, "two_column": 8.0,
    "comparison": 8.0, "kpi_cards": 6.0, "stats_grid": 7.0, "chart": 8.0,
    "table": 9.0, "tech_grid": 8.0, "process": 8.5, "architecture": 10.0,
    "roadmap": 8.0, "timeline": 7.5,
}


def _slide_min_duration(slide: Dict[str, Any]) -> float:
    base = _LAYOUT_MIN_DURATION.get(str(slide.get("layout", "content")), 6.0)
    # Extra dwell for slides carrying a lot of discrete elements.
    n_items = (len(slide.get("items", []) or [])
               + len(slide.get("steps", []) or [])
               + len(slide.get("layers", []) or [])
               + len((slide.get("table", {}) or {}).get("rows", []))
               + len((slide.get("chart", {}) or {}).get("data", [])))
    return base + min(n_items * 0.35, 4.0)


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


def _compute_mouth_segments(wav_path: Path, window_s: float = 0.12) -> List[Tuple[float, str]]:
    """Amplitude-based "lip sync": splits the narration WAV into short windows
    and marks each as mouth 'open' or 'closed' based on RMS loudness at that
    instant. Not phoneme-accurate (that needs a real viseme/ML model), but a
    mouth that opens while talking and closes during pauses reads as
    "talking" — enough for a cartoon presenter without SadTalker's cost.
    Returns a list of (duration_seconds, state) segments covering the whole
    file; on any failure returns a single 'closed' segment for the full
    duration so callers can fall back to the static presenter unchanged."""
    import wave
    import audioop

    total_duration = _get_audio_duration(wav_path)
    try:
        with wave.open(str(wav_path), "rb") as wf:
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            n_frames_per_window = max(1, int(framerate * window_s))
            frames = wf.readframes(wf.getnframes())
    except Exception:
        return [(max(total_duration, 0.1), "closed")]

    if not frames or sampwidth not in (1, 2, 3, 4):
        return [(max(total_duration, 0.1), "closed")]

    bytes_per_frame = sampwidth * n_channels
    window_bytes = n_frames_per_window * bytes_per_frame
    rms_values: List[float] = []
    for start in range(0, len(frames), window_bytes):
        chunk = frames[start:start + window_bytes]
        if len(chunk) < bytes_per_frame:
            break
        try:
            rms_values.append(audioop.rms(chunk, sampwidth))
        except Exception:
            rms_values.append(0)

    if not rms_values:
        return [(max(total_duration, 0.1), "closed")]

    # Threshold relative to this clip's own loudness range (not an absolute
    # constant) so it adapts to quieter/louder narration/voices.
    peak = max(rms_values) or 1
    threshold = peak * 0.18

    segments: List[Tuple[float, str]] = []
    for rms in rms_values:
        state = "open" if rms > threshold else "closed"
        if segments and segments[-1][1] == state:
            idx = len(segments) - 1
            segments[idx] = (segments[idx][0] + window_s, state)
        else:
            segments.append((window_s, state))

    # Reconcile total with the real audio duration (window count is an
    # approximation) so the mouth animation exactly spans the clip.
    computed_total = sum(d for d, _ in segments)
    if computed_total > 0 and total_duration > 0:
        scale = total_duration / computed_total
        segments = [(d * scale, s) for d, s in segments]

    return segments or [(max(total_duration, 0.1), "closed")]


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
