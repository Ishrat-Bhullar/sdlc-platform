from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .architect_diagram_tools import (
    DiagramRenderResult,
    render_mermaid_to_svg_png,
    render_plantuml_to_svg_png,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DiagramArtifact:
    diagram_type: str
    source_format: str
    source: str
    svg_bytes: bytes
    png_bytes: bytes
    source_filename: str
    svg_filename: str
    png_filename: str


def generate_svg_png_bytes_from_render_result(render: DiagramRenderResult) -> tuple[bytes, bytes]:
    svg_bytes = Path(render.svg_path).read_bytes()
    png_bytes = Path(render.png_path).read_bytes()
    return svg_bytes, png_bytes


def build_diagram_artifact_for_mermaid(
    *,
    diagram_type: str,
    mermaid_source: str,
    out_dir: str | Path,
    base_name: str,
) -> DiagramArtifact:
    render = render_mermaid_to_svg_png(mermaid_source, out_dir, base_name)
    svg_bytes, png_bytes = generate_svg_png_bytes_from_render_result(render)

    return DiagramArtifact(
        diagram_type=diagram_type,
        source_format="mermaid",
        source=mermaid_source,
        svg_bytes=svg_bytes,
        png_bytes=png_bytes,
        source_filename=f"{base_name}.mmd",
        svg_filename=f"{base_name}.svg",
        png_filename=f"{base_name}.png",
    )


def build_diagram_artifact_for_plantuml(
    *,
    diagram_type: str,
    plantuml_source: str,
    out_dir: str | Path,
    base_name: str,
) -> DiagramArtifact:
    render = render_plantuml_to_svg_png(plantuml_source, out_dir, base_name)
    svg_bytes, png_bytes = generate_svg_png_bytes_from_render_result(render)

    return DiagramArtifact(
        diagram_type=diagram_type,
        source_format="plantuml",
        source=plantuml_source,
        svg_bytes=svg_bytes,
        png_bytes=png_bytes,
        source_filename=f"{base_name}.puml",
        svg_filename=f"{base_name}.svg",
        png_filename=f"{base_name}.png",
    )


def write_artifact_files(base_path: str | Path, project_id: int, agent_run_id: int | None, artifacts: list[DiagramArtifact]) -> dict[str, Any]:
    """Write diagram source/svg/png to disk. Returns metadata for DB persistence.

    Stores into:
      {base_path}/project_{project_id}/agent_run_{agent_run_id or 'na'}/{diagram_type}/...
    """
    base_path = Path(base_path)
    run_part = f"agent_run_{agent_run_id}" if agent_run_id is not None else "agent_run_na"

    files_meta: dict[str, Any] = {"files": []}

    for a in artifacts:
        type_dir = base_path / f"project_{project_id}" / run_part / a.diagram_type
        type_dir.mkdir(parents=True, exist_ok=True)

        source_path = type_dir / a.source_filename
        svg_path = type_dir / a.svg_filename
        png_path = type_dir / a.png_filename

        source_path.write_text(a.source, encoding="utf-8")
        svg_path.write_bytes(a.svg_bytes)
        png_path.write_bytes(a.png_bytes)

        files_meta["files"].append({
            "diagram_type": a.diagram_type,
            "source_format": a.source_format,
            "source_path": str(source_path),
            "svg_path": str(svg_path),
            "png_path": str(png_path),
        })

    return files_meta


def default_storage_base() -> Path:
    # Keep consistent with existing STORAGE_BASE_PATH usage in main.py
    import os

    return Path(os.getenv("STORAGE_BASE_PATH", "./storage"))

