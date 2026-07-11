from __future__ import annotations

from .logging_config import get_logger
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

logger = get_logger(__name__)


@dataclass(frozen=True)
class DiagramRenderResult:
    svg_path: str
    png_path: str


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _run_cmd(cmd: list[str]) -> None:
    logger.info("[diagram-render] running: %s", " ".join(cmd))
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def render_mermaid_to_svg_png(
    mermaid_source: str,
    out_dir: str | Path,
    base_name: str,
    *,
    mermaid_cli: str | None = None,
    plantuml: bool = False,
) -> DiagramRenderResult:
    """Render Mermaid diagram.

    Uses mermaid-cli if available (recommended, fully local).

    Required external tool:
      - mmdc (mermaid-cli) OR `mermaid_cli` pointing to an executable that can render to svg/png.

    If tool is missing, raises RuntimeError with install guidance.
    """
    out_dir = Path(out_dir)
    _ensure_dir(out_dir)

    svg_path = out_dir / f"{base_name}.svg"
    png_path = out_dir / f"{base_name}.png"

    # Write .mmd
    mmd_path = out_dir / f"{base_name}.mmd"
    mmd_path.write_text(mermaid_source, encoding="utf-8")

    # Prefer mmdc
    mmdc = mermaid_cli or os.getenv("MERMAID_CLI", "mmdc")

    # Render SVG
    try:
        _run_cmd([mmdc, "-i", str(mmd_path), "-o", str(svg_path), "--theme", "dark"])
        # Render PNG from SVG (recommended by mermaid-cli), but if it can't do both,
        # we do an extra conversion via svg->png.
        # Mermaid-cli supports -b background, and --output may be svg only depending on version.
        # We'll attempt direct PNG render first.
        _run_cmd([mmdc, "-i", str(mmd_path), "-o", str(png_path), "--theme", "dark"])
    except FileNotFoundError as exc:
        raise RuntimeError(
            "Mermaid rendering tool not found. Install mermaid-cli (mmdc). "
            "Example: npm i -g @mermaid-js/mermaid-cli"
        ) from exc

    return DiagramRenderResult(svg_path=str(svg_path), png_path=str(png_path))


def render_plantuml_to_svg_png(
    plantuml_source: str,
    out_dir: str | Path,
    base_name: str,
    *,
    plantuml_jar: str | None = None,
    plantuml_cmd: str | None = None,
) -> DiagramRenderResult:
    """Render PlantUML diagram source.

    Uses either:
      - `plantuml_cmd` (plantuml executable)
      - `plantuml_jar` (plantuml.jar)

    Outputs: base_name.svg and base_name.png
    """
    out_dir = Path(out_dir)
    _ensure_dir(out_dir)

    svg_path = out_dir / f"{base_name}.svg"
    png_path = out_dir / f"{base_name}.png"

    puml_path = out_dir / f"{base_name}.puml"
    puml_path.write_text(plantuml_source, encoding="utf-8")

    plantuml_cmd = plantuml_cmd or os.getenv("PLANTUML_CMD")
    plantuml_jar = plantuml_jar or os.getenv("PLANTUML_JAR")

    try:
        if plantuml_cmd:
            # e.g., plantuml -tsvg -tpng -o out_dir file.puml
            _run_cmd([plantuml_cmd, "-tsvg", "-tpng", "-o", str(out_dir), str(puml_path)])
        elif plantuml_jar:
            jar = plantuml_jar
            _run_cmd(["java", "-jar", jar, "-tsvg", "-tpng", "-o", str(out_dir), str(puml_path)])
        else:
            raise RuntimeError(
                "PlantUML renderer not configured. Set PLANTUML_CMD or PLANTUML_JAR. "
                "Example: PLANTUML_JAR=/path/to/plantuml.jar"
            )

        # PlantUML writes {base_name}.svg/png in out_dir when file name matches.
        if not svg_path.exists() or not png_path.exists():
            raise RuntimeError(f"PlantUML did not produce expected outputs: {svg_path}, {png_path}")

    except FileNotFoundError as exc:
        raise RuntimeError(
            "PlantUML executable/jar not found. Ensure Java is installed and configure PLANTUML_JAR or PLANTUML_CMD."
        ) from exc

    return DiagramRenderResult(svg_path=str(svg_path), png_path=str(png_path))

