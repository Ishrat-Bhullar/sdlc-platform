"""
agents/presentation/video_pipeline.py
=======================================
Video Generation Pipeline (fully local — Coqui XTTS / Piper + LibreOffice
+ FFmpeg, no cloud APIs, no API keys, works completely offline). Relocated
verbatim from agents/presentation_video_agent.py's VideoGenerationPipeline
section as part of the agents/<name>/ architectural refactor -- content
unchanged.

Additive extension — does NOT modify the LLM-driven stages in agent.py. It
consumes their *output* (pptx bytes + per-slide speaker notes + the full
narration script) to render a downloadable MP4. It is triggered separately
from presentation_routes.py so text generation and video rendering can be
retried independently and the existing /generate/presentation flow is
completely unaffected.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel

from ...services.video_generation_service import (
    NarrationService,
    SlideRenderer,
    VideoComposer,
    VoiceConfig,
)

logger = logging.getLogger(__name__)


class VideoGenerationResult(BaseModel):
    narrated_video_path: str | None = None
    video_available: bool = False
    slide_image_count: int = 0
    duration_seconds: float | None = None


def _emit_progress(progress_cb, stage: str, percent: int, message: str = "") -> None:
    if progress_cb:
        try:
            progress_cb(stage, percent, message)
        except Exception:
            logger.debug("[VideoGenerationPipeline] progress callback raised", exc_info=True)


class VideoGenerationPipeline:
    """Renders a single narrated presentation.mp4 from an already-generated
    presentation (pptx bytes + per-slide speaker notes + the full narration
    script). 100% local: no network calls, no API keys.

    Pipeline stages (matching the WebSocket progress events emitted by the
    caller in presentation_routes.py):
        generating_script   — emitted by the caller before invoking this
                               pipeline, while the LLM presentation content
                               itself is produced (not part of this class)
        generating_voice    — per-slide local TTS narration (Coqui XTTS,
                               falling back to Piper)
        rendering_slides    — PPTX -> per-slide PNG images (LibreOffice + pdf2image)
        composing_video     — slide images + narration -> MP4 (FFmpeg)
        completed           — presentation.mp4 is ready
    """

    def __init__(self, work_dir: str | Path | None = None):
        self.work_dir = Path(work_dir or os.getenv("VIDEO_PIPELINE_WORKDIR", "./storage/video_work"))

    def run(
        self,
        *,
        pptx_bytes: bytes,
        slides: list[dict],
        full_script: str,
        voice_config: VoiceConfig,
        video_enabled: bool = True,
        progress_cb=None,
    ) -> VideoGenerationResult:
        result = VideoGenerationResult()
        if not video_enabled:
            _emit_progress(progress_cb, "completed", 100, "Video generation skipped (video_enabled=false)")
            return result

        session_dir = self.work_dir / f"session_{datetime.now().strftime('%Y%m%d%H%M%S%f')}"
        session_dir.mkdir(parents=True, exist_ok=True)

        # 1. Write PPTX to disk, render to per-slide images
        _emit_progress(progress_cb, "rendering_slides", 25, "Rendering slides to images")
        pptx_path = session_dir / "presentation.pptx"
        pptx_path.write_bytes(pptx_bytes)

        renderer = SlideRenderer()
        slide_images = renderer.render(pptx_path, session_dir / "slides")
        result.slide_image_count = len(slide_images)
        _emit_progress(progress_cb, "rendering_slides", 40, f"Rendered {len(slide_images)} slide images")

        # 2. Per-slide narration audio (speaker_notes, falling back to title)
        _emit_progress(progress_cb, "generating_voice", 50, "Synthesizing narration audio")
        narration_service = NarrationService(voice_config)
        audio_dir = session_dir / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)

        slide_audio_paths: list[Path] = []
        for idx, slide in enumerate(slides, start=1):
            text = (slide.get("speaker_notes") or slide.get("title") or "").strip() or "."
            audio_path = audio_dir / f"slide_{idx:03d}.wav"
            narration_service.synthesize(text, audio_path)
            slide_audio_paths.append(audio_path)
            _emit_progress(
                progress_cb, "generating_voice",
                50 + int(20 * idx / max(len(slides), 1)),
                f"Synthesized narration for slide {idx}/{len(slides)}",
            )

        # Defensive alignment in case slide/audio counts ever drift
        if slide_audio_paths and len(slide_audio_paths) < len(slide_images):
            last = slide_audio_paths[-1]
            slide_audio_paths.extend([last] * (len(slide_images) - len(slide_audio_paths)))
        slide_images = slide_images[: len(slide_audio_paths)] if slide_audio_paths else slide_images
        slide_audio_paths = slide_audio_paths[: len(slide_images)]

        # 3. Compose narrated slideshow video
        _emit_progress(progress_cb, "composing_video", 80, "Composing final presentation.mp4")
        composer = VideoComposer()
        narrated_path = session_dir / "presentation.mp4"
        composer.compose(slide_images, slide_audio_paths, narrated_path)
        result.narrated_video_path = str(narrated_path)
        result.video_available = True

        try:
            import subprocess
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(narrated_path)],
                capture_output=True, text=True, timeout=10,
            )
            result.duration_seconds = float(probe.stdout.strip())
        except Exception:
            logger.debug("[VideoGenerationPipeline] Could not probe video duration", exc_info=True)

        _emit_progress(progress_cb, "completed", 100, "Presentation video ready")
        return result
