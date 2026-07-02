"""
native_diagram_renderer.py
===========================
A pure-Python diagram renderer with ZERO external binary dependencies
(no mermaid-cli, no PlantUML/Java, no graphviz). It exists so diagram
generation NEVER fails just because the demo machine doesn't have those
tools installed — every call to `render()` returns a usable SVG + PNG.

Used as the guaranteed-availability fallback by diagram_service.py:
  1. Try mermaid-cli (mmdc)   — prettiest, if installed
  2. Try PlantUML             — good for sequence diagrams, if installed
  3. Native renderer (this)   — always works, EY-themed, no dependencies

Supports the diagram kinds requested by the platform:
  architecture, workflow, sequence, process, dataflow, component, deployment

Input is a lightweight structured spec (nodes + edges + type) OR a raw
prompt string, which `spec_from_text()` heuristically parses into that
spec (arrow chains, numbered/bulleted lists, comma-separated steps).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import theme_engine as TE


@dataclass
class DiagramSpec:
    diagram_type: str = "workflow"     # architecture|workflow|sequence|process|dataflow|component|deployment
    title: str = ""
    nodes: list[str] = field(default_factory=list)
    edges: list[tuple[int, int]] = field(default_factory=list)   # (from_idx, to_idx)
    layers: list[list[str]] = field(default_factory=list)         # for architecture/deployment
    actors: list[str] = field(default_factory=list)               # for sequence


# ---------------------------------------------------------------------------
# Heuristic prompt -> spec parsing (no LLM required, instant, never fails)
# ---------------------------------------------------------------------------

def spec_from_text(prompt: str, diagram_type: str = "workflow") -> DiagramSpec:
    prompt = (prompt or "").strip() or "Process Overview"
    dtype = (diagram_type or "workflow").lower().strip()

    title = _title_for(prompt, dtype)

    # Mermaid-style arrow chain: "A --> B --> C" or "A -> B -> C"
    arrow_parts = re.split(r"\s*-{1,2}>\s*", prompt)
    if len(arrow_parts) >= 2:
        nodes = [_clean_label(p) for p in arrow_parts if _clean_label(p)]
        if dtype in ("architecture", "deployment"):
            return DiagramSpec(diagram_type=dtype, title=title, layers=[[n] for n in nodes])
        if dtype == "sequence":
            return DiagramSpec(diagram_type=dtype, title=title, actors=nodes)
        edges = [(i, i + 1) for i in range(len(nodes) - 1)]
        return DiagramSpec(diagram_type=dtype, title=title, nodes=nodes, edges=edges)

    # Numbered/bulleted lines: "1. X\n2. Y" or "- X\n- Y" or one per newline
    lines = [l.strip() for l in prompt.splitlines() if l.strip()]
    if len(lines) >= 2:
        nodes = [_clean_label(re.sub(r"^[\d.\-•)\s]+", "", l)) for l in lines]
        nodes = [n for n in nodes if n][:9]
        edges = [(i, i + 1) for i in range(len(nodes) - 1)]
        if dtype == "architecture" or dtype == "deployment":
            return DiagramSpec(diagram_type=dtype, title=title,
                               layers=[[n] for n in nodes])
        if dtype == "sequence":
            return DiagramSpec(diagram_type=dtype, title=title, actors=nodes)
        return DiagramSpec(diagram_type=dtype, title=title, nodes=nodes, edges=edges)

    # Comma-separated: "API Gateway, Auth Service, Core Service, Database"
    comma_parts = [p.strip() for p in prompt.split(",") if p.strip()]
    if len(comma_parts) >= 2:
        nodes = [_clean_label(p) for p in comma_parts][:9]
        edges = [(i, i + 1) for i in range(len(nodes) - 1)]
        if dtype in ("architecture", "deployment"):
            return DiagramSpec(diagram_type=dtype, title=title, layers=[[n] for n in nodes])
        return DiagramSpec(diagram_type=dtype, title=title, nodes=nodes, edges=edges)

    # Fallback: single-topic diagram — synthesize a generic 4-step flow so the
    # user never sees an empty/degenerate diagram for a short prompt.
    topic = _clean_label(prompt)[:40] or "Process"
    generic = {
        "architecture": DiagramSpec(diagram_type="architecture", title=title,
                                    layers=[["Presentation Layer"], ["Application Layer"],
                                            ["Data Layer"]]),
        "deployment": DiagramSpec(diagram_type="deployment", title=title,
                                  layers=[["Client"], ["Load Balancer"], ["App Servers"], ["Database"]]),
        "sequence": DiagramSpec(diagram_type="sequence", title=title,
                                actors=["User", "Frontend", "API", "Database"]),
    }.get(dtype)
    if generic:
        return generic
    nodes = [f"{topic} — Input", "Process", "Validate", f"{topic} — Output"]
    return DiagramSpec(diagram_type=dtype, title=title, nodes=nodes,
                       edges=[(0, 1), (1, 2), (2, 3)])


def _clean_label(s: str) -> str:
    s = re.sub(r'["\[\]{}]', "", s or "").strip()
    return s[:34]


_TYPE_TITLES = {
    "architecture": "Architecture Diagram", "deployment": "Deployment Diagram",
    "sequence": "Sequence Diagram", "process": "Process Flow",
    "dataflow": "Data Flow Diagram", "component": "Component Diagram",
    "workflow": "Workflow Diagram",
}


def _title_for(prompt: str, dtype: str) -> str:
    """A short, readable diagram title. Long/arrow-chain prompts describe the
    diagram's *content*, not a title, so we use a clean generic title in that
    case rather than truncating raw syntax into the header."""
    p = prompt.strip()
    if len(p) <= 40 and not re.search(r"-{1,2}>", p):
        return p
    return _TYPE_TITLES.get(dtype, "Diagram")


# ---------------------------------------------------------------------------
# Rendering — hand-built SVG (always available) + Pillow PNG (matches SVG)
# ---------------------------------------------------------------------------

CANVAS_W, CANVAS_H = 1400, 800


def render(spec: DiagramSpec, out_dir: str | Path, base_name: str) -> tuple[Path, Path]:
    """Render `spec` to `{out_dir}/{base_name}.svg` and `.png`. Always
    succeeds — pure Python, no external processes."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    svg_path = out_dir / f"{base_name}.svg"
    png_path = out_dir / f"{base_name}.png"

    layout = _layout_for(spec)
    svg_path.write_text(_to_svg(spec, layout), encoding="utf-8")
    _to_png(spec, layout, png_path)
    return svg_path, png_path


# ---- layout -----------------------------------------------------------------

def _layout_for(spec: DiagramSpec) -> dict[str, Any]:
    if spec.diagram_type in ("architecture", "deployment") and spec.layers:
        return _layout_layers(spec)
    if spec.diagram_type == "sequence" and spec.actors:
        return _layout_sequence(spec)
    if spec.diagram_type == "component" and spec.nodes:
        return _layout_grid(spec)
    return _layout_flow(spec)


def _layout_flow(spec: DiagramSpec) -> dict[str, Any]:
    """Left-to-right chain — used for workflow/process/dataflow."""
    nodes = spec.nodes or ["Start", "Process", "End"]
    n = len(nodes)
    margin = 90
    gap = (CANVAS_W - 2 * margin) / max(n, 1)
    box_w, box_h = min(gap * 0.72, 220), 110
    y = CANVAS_H / 2 - box_h / 2
    boxes = []
    for i, label in enumerate(nodes):
        x = margin + i * gap + (gap - box_w) / 2
        boxes.append({"x": x, "y": y, "w": box_w, "h": box_h, "label": label, "idx": i})
    return {"kind": "flow", "boxes": boxes, "edges": spec.edges or [(i, i + 1) for i in range(n - 1)]}


def _layout_grid(spec: DiagramSpec) -> dict[str, Any]:
    nodes = spec.nodes
    n = len(nodes)
    cols = min(3, n) or 1
    rows = (n + cols - 1) // cols
    box_w, box_h = 260, 100
    gap_x = (CANVAS_W - cols * box_w) / (cols + 1)
    gap_y = (CANVAS_H - rows * box_h) / (rows + 1)
    boxes = []
    for i, label in enumerate(nodes):
        r, c = divmod(i, cols)
        x = gap_x + c * (box_w + gap_x)
        y = gap_y + r * (box_h + gap_y)
        boxes.append({"x": x, "y": y, "w": box_w, "h": box_h, "label": label, "idx": i})
    return {"kind": "grid", "boxes": boxes, "edges": spec.edges}


def _layout_layers(spec: DiagramSpec) -> dict[str, Any]:
    layers = spec.layers
    n = len(layers)
    margin = 60
    layer_h = (CANVAS_H - 2 * margin) / max(n, 1)
    rows = []
    for i, comps in enumerate(layers):
        y = margin + i * layer_h
        rows.append({"y": y, "h": layer_h - 20, "label": f"Layer {i+1}" if not comps else "",
                    "components": comps})
    return {"kind": "layers", "rows": rows}


def _layout_sequence(spec: DiagramSpec) -> dict[str, Any]:
    actors = spec.actors
    n = len(actors)
    margin = 100
    gap = (CANVAS_W - 2 * margin) / max(n - 1, 1)
    lanes = [{"x": margin + i * gap, "label": a} for i, a in enumerate(actors)]
    messages = [(i, i + 1, f"step {i+1}") for i in range(n - 1)]
    return {"kind": "sequence", "lanes": lanes, "messages": messages}


# ---- SVG ---------------------------------------------------------------------

def _svg_theme() -> dict[str, str]:
    t = TE.get_theme("ey")
    return {"bg": t["bg"], "accent": t["accent"], "charcoal": t["bg3"],
            "text": t["title_text"], "muted": t["muted"], "card": t["bg2"],
            "hairline": t["hairline"]}


def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _to_svg(spec: DiagramSpec, layout: dict[str, Any]) -> str:
    th = _svg_theme()
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS_W} {CANVAS_H}" '
        f'width="{CANVAS_W}" height="{CANVAS_H}">',
        f'<rect width="100%" height="100%" fill="#{th["bg"]}"/>',
    ]
    if spec.title:
        parts.append(f'<text x="40" y="46" font-family="Arial, sans-serif" font-size="26" '
                    f'font-weight="700" fill="#{th["text"]}">{_esc(spec.title)}</text>')
        parts.append(f'<rect x="40" y="58" width="60" height="4" fill="#{th["accent"]}"/>')

    kind = layout["kind"]
    if kind in ("flow", "grid"):
        boxes = layout["boxes"]
        by_idx = {b["idx"]: b for b in boxes}
        for (a, b) in layout.get("edges", []) or []:
            if a in by_idx and b in by_idx:
                x1, y1 = by_idx[a]["x"] + by_idx[a]["w"], by_idx[a]["y"] + by_idx[a]["h"] / 2
                x2, y2 = by_idx[b]["x"], by_idx[b]["y"] + by_idx[b]["h"] / 2
                if by_idx[a]["y"] != by_idx[b]["y"]:  # grid: connect edges vertically if needed
                    x1, y1 = by_idx[a]["x"] + by_idx[a]["w"] / 2, by_idx[a]["y"] + by_idx[a]["h"]
                    x2, y2 = by_idx[b]["x"] + by_idx[b]["w"] / 2, by_idx[b]["y"]
                parts.append(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" '
                            f'stroke="#{th["muted"]}" stroke-width="2.5" marker-end="url(#arrow)"/>')
        parts.append(
            f'<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" '
            f'orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#{th["muted"]}"/></marker></defs>'
        )
        for i, b in enumerate(boxes):
            parts.append(
                f'<rect x="{b["x"]:.0f}" y="{b["y"]:.0f}" width="{b["w"]:.0f}" height="{b["h"]:.0f}" '
                f'rx="10" fill="#{th["card"]}" stroke="#{th["hairline"]}" stroke-width="1.5"/>'
            )
            parts.append(f'<rect x="{b["x"]:.0f}" y="{b["y"]:.0f}" width="6" height="{b["h"]:.0f}" '
                        f'fill="#{th["accent"]}"/>')
            parts.append(_svg_wrapped_text(b["x"] + b["w"] / 2, b["y"] + b["h"] / 2, b["label"],
                                          th["text"], size=17, max_chars=20))
    elif kind == "layers":
        for i, row in enumerate(layout["rows"]):
            parts.append(f'<rect x="60" y="{row["y"]:.0f}" width="{CANVAS_W-120}" height="{row["h"]:.0f}" '
                        f'rx="10" fill="#{th["charcoal"]}"/>')
            parts.append(f'<rect x="60" y="{row["y"]:.0f}" width="6" height="{row["h"]:.0f}" fill="#{th["accent"]}"/>')
            comps = row["components"] or [row["label"]]
            comp_w = (CANVAS_W - 160) / max(len(comps), 1)
            for j, comp in enumerate(comps):
                cx = 90 + j * comp_w
                parts.append(f'<rect x="{cx:.0f}" y="{row["y"]+row["h"]*0.18:.0f}" '
                            f'width="{comp_w*0.88:.0f}" height="{row["h"]*0.64:.0f}" rx="8" '
                            f'fill="#{th["accent"]}"/>')
                parts.append(_svg_wrapped_text(cx + comp_w * 0.44, row["y"] + row["h"] / 2, comp,
                                              th["charcoal"], size=15, max_chars=18, bold=True))
            if i < len(layout["rows"]) - 1:
                ny = row["y"] + row["h"] + 10
                parts.append(f'<line x1="{CANVAS_W/2}" y1="{row["y"]+row["h"]:.0f}" '
                            f'x2="{CANVAS_W/2}" y2="{ny:.0f}" stroke="#{th["muted"]}" stroke-width="2" '
                            f'marker-end="url(#arrow)"/>')
    elif kind == "sequence":
        top, bottom = 90, CANVAS_H - 60
        for lane in layout["lanes"]:
            parts.append(f'<line x1="{lane["x"]:.0f}" y1="{top}" x2="{lane["x"]:.0f}" y2="{bottom}" '
                        f'stroke="#{th["hairline"]}" stroke-width="2" stroke-dasharray="4,4"/>')
            parts.append(f'<rect x="{lane["x"]-70:.0f}" y="{top-50}" width="140" height="42" rx="8" '
                        f'fill="#{th["charcoal"]}"/>')
            parts.append(_svg_wrapped_text(lane["x"], top - 29, lane["label"], th["text"],
                                          size=14, max_chars=16, bold=True))
        lanes_by_i = {i: l["x"] for i, l in enumerate(layout["lanes"])}
        for k, (a, b, msg) in enumerate(layout["messages"]):
            y = top + 60 + k * ((bottom - top - 60) / max(len(layout["messages"]), 1))
            x1, x2 = lanes_by_i[a], lanes_by_i[b]
            parts.append(f'<line x1="{x1:.0f}" y1="{y:.0f}" x2="{x2:.0f}" y2="{y:.0f}" '
                        f'stroke="#{th["accent"]}" stroke-width="2.5" marker-end="url(#arrow)"/>')
            parts.append(_svg_wrapped_text((x1 + x2) / 2, y - 12, msg, th["muted"], size=12, max_chars=20))
        parts.append(
            f'<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" '
            f'orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#{th["accent"]}"/></marker></defs>'
        )

    parts.append("</svg>")
    return "\n".join(parts)


def _svg_wrapped_text(cx: float, cy: float, text: str, color_hex: str, size: int = 16,
                      max_chars: int = 20, bold: bool = False) -> str:
    words = (text or "").split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 > max_chars:
            lines.append(cur); cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    lines = lines[:3] or [text[:max_chars]]
    fw = "700" if bold else "600"
    out = []
    start_y = cy - (len(lines) - 1) * (size * 0.6)
    for i, ln in enumerate(lines):
        out.append(
            f'<text x="{cx:.0f}" y="{start_y + i * size * 1.2:.0f}" text-anchor="middle" '
            f'font-family="Arial, sans-serif" font-size="{size}" font-weight="{fw}" '
            f'fill="#{color_hex}">{_esc(ln)}</text>'
        )
    return "\n".join(out)


# ---- PNG (Pillow — mirrors the SVG layout so both formats agree) ------------

def _to_png(spec: DiagramSpec, layout: dict[str, Any], out_path: Path) -> None:
    from PIL import Image, ImageDraw
    th = TE.get_theme("ey")

    def rgb(hexname: str) -> tuple[int, int, int]:
        h = th[hexname].lstrip("#")
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    img = Image.new("RGB", (CANVAS_W, CANVAS_H), rgb("bg"))
    d = ImageDraw.Draw(img)
    font_title = _diagram_font(24, bold=True)
    font_label = _diagram_font(16, bold=True)
    font_small = _diagram_font(12)

    if spec.title:
        d.text((40, 30), spec.title, font=font_title, fill=rgb("title_text"))
        d.rectangle([(40, 62), (100, 66)], fill=rgb("accent"))

    kind = layout["kind"]
    if kind in ("flow", "grid"):
        boxes = layout["boxes"]
        by_idx = {b["idx"]: b for b in boxes}
        for (a, b) in layout.get("edges", []) or []:
            if a in by_idx and b in by_idx:
                ba, bb = by_idx[a], by_idx[b]
                if ba["y"] == bb["y"]:
                    x1, y1 = ba["x"] + ba["w"], ba["y"] + ba["h"] / 2
                    x2, y2 = bb["x"], bb["y"] + bb["h"] / 2
                else:
                    x1, y1 = ba["x"] + ba["w"] / 2, ba["y"] + ba["h"]
                    x2, y2 = bb["x"] + bb["w"] / 2, bb["y"]
                d.line([(x1, y1), (x2, y2)], fill=rgb("muted"), width=3)
                _arrow_head(d, x1, y1, x2, y2, rgb("muted"))
        for b in boxes:
            _rounded_card(d, b["x"], b["y"], b["w"], b["h"], rgb("bg2"), rgb("hairline"), rgb("accent"))
            _wrapped_text(d, b["x"] + b["w"] / 2, b["y"] + b["h"] / 2, b["label"],
                        font_label, rgb("title_text"), max_w=b["w"] - 20)
    elif kind == "layers":
        for i, row in enumerate(layout["rows"]):
            d.rounded_rectangle([(60, row["y"]), (CANVAS_W - 60, row["y"] + row["h"])],
                               radius=10, fill=rgb("bg3"))
            d.rectangle([(60, row["y"]), (66, row["y"] + row["h"])], fill=rgb("accent"))
            comps = row["components"] or [row["label"]]
            comp_w = (CANVAS_W - 160) / max(len(comps), 1)
            for j, comp in enumerate(comps):
                cx = 90 + j * comp_w
                cy = row["y"] + row["h"] * 0.18
                d.rounded_rectangle([(cx, cy), (cx + comp_w * 0.88, cy + row["h"] * 0.64)],
                                   radius=8, fill=rgb("accent"))
                _wrapped_text(d, cx + comp_w * 0.44, cy + row["h"] * 0.32, comp, font_label,
                            rgb("bg3"), max_w=comp_w * 0.8)
            if i < len(layout["rows"]) - 1:
                ny = row["y"] + row["h"] + 10
                d.line([(CANVAS_W / 2, row["y"] + row["h"]), (CANVAS_W / 2, ny)],
                      fill=rgb("muted"), width=3)
                _arrow_head(d, CANVAS_W / 2, row["y"] + row["h"], CANVAS_W / 2, ny, rgb("muted"))
    elif kind == "sequence":
        top, bottom = 90, CANVAS_H - 60
        for lane in layout["lanes"]:
            d.line([(lane["x"], top), (lane["x"], bottom)], fill=rgb("hairline"), width=2)
            d.rounded_rectangle([(lane["x"] - 70, top - 50), (lane["x"] + 70, top - 8)],
                               radius=8, fill=rgb("bg3"))
            _wrapped_text(d, lane["x"], top - 29, lane["label"], font_label, rgb("title_text"), max_w=130)
        lanes_by_i = {i: l["x"] for i, l in enumerate(layout["lanes"])}
        n_msg = max(len(layout["messages"]), 1)
        for k, (a, b, msg) in enumerate(layout["messages"]):
            y = top + 60 + k * ((bottom - top - 60) / n_msg)
            x1, x2 = lanes_by_i[a], lanes_by_i[b]
            d.line([(x1, y), (x2, y)], fill=rgb("accent"), width=3)
            _arrow_head(d, x1, y, x2, y, rgb("accent"))
            _wrapped_text(d, (x1 + x2) / 2, y - 14, msg, font_small, rgb("muted"), max_w=abs(x2 - x1))

    img.save(out_path, "PNG")


def _diagram_font(size: int, bold: bool = False):
    from PIL import ImageFont
    for path, idx in TE.FONT_STACK["pillow_candidates_bold" if bold else "pillow_candidates_regular"]:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size, index=idx) if idx is not None else ImageFont.truetype(path, size)
            except Exception:
                continue
    return __import__("PIL.ImageFont", fromlist=["ImageFont"]).load_default()


def _rounded_card(d, x, y, w, h, fill, border, accent):
    d.rounded_rectangle([(x, y), (x + w, y + h)], radius=10, fill=fill, outline=border, width=1)
    d.rectangle([(x, y), (x + 6, y + h)], fill=accent)


def _arrow_head(d, x1, y1, x2, y2, color, size=8):
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    for da in (0.5, -0.5):
        a = ang + math.pi - da
        d.line([(x2, y2), (x2 + size * math.cos(a), y2 + size * math.sin(a))], fill=color, width=3)


def _wrapped_text(d, cx, cy, text, font, color, max_w=180):
    words = (text or "").split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        try:
            tw = d.textlength(test, font=font)
        except Exception:
            tw = len(test) * (font.size * 0.55 if hasattr(font, "size") else 8)
        if tw > max_w and cur:
            lines.append(cur); cur = w
        else:
            cur = test
    if cur:
        lines.append(cur)
    lines = lines[:3]
    line_h = (font.size if hasattr(font, "size") else 16) * 1.25
    start_y = cy - (len(lines) - 1) * line_h / 2
    for i, ln in enumerate(lines):
        try:
            tw = d.textlength(ln, font=font)
        except Exception:
            tw = len(ln) * 8
        d.text((cx - tw / 2, start_y + i * line_h - line_h / 2), ln, font=font, fill=color)
