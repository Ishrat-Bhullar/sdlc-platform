"""
services/video_generation_service.py
=====================================
Low-level building blocks for the Presentation Video Generation Pipeline.

This module is intentionally separate from `agents/presentation_video_agent.py`
(which owns LLM-driven content generation) so that *rendering* concerns —
text-to-speech, slide rasterization, video composition, and AI avatar
generation — stay independently testable and swappable. It is consumed by
`VideoGenerationPipeline` in `agents/presentation_video_agent.py`, which is
in turn called from `routes/presentation_routes.py`.

Components:
    NarrationService   — Azure Speech (primary) -> Coqui XTTS (fallback) TTS
    SlideRenderer       — PPTX -> per-slide PNG via LibreOffice headless + pdf2image
    VideoComposer        — slide images + narration audio -> MP4 (FFmpeg)

No mock/placeholder logic: every method either performs the real operation or
raises a clear, actionable exception that callers can catch to apply a
fallback. AI avatar generation (talking-head lip-sync) lives separately in
video_pipeline_local.py's SadTalkerAvatarService — fully local, no paid API.
"""
from __future__ import annotations

import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)

ProgressCallback = Optional[Callable[[str, int, str], None]]  # (stage, percent, message)


def _emit(progress_cb: ProgressCallback, stage: str, percent: int, message: str = "") -> None:
    if progress_cb:
        try:
            progress_cb(stage, percent, message)
        except Exception:
            logger.debug("[VideoGenerationService] progress callback raised", exc_info=True)


# ---------------------------------------------------------------------------
# Config dataclasses (decoupled from the API-layer Pydantic schemas so this
# module has no FastAPI/Pydantic dependency)
# ---------------------------------------------------------------------------

@dataclass
class VoiceConfig:
    provider: str = "azure"            # "azure" | "coqui"
    voice_name: str = "en-US-AriaNeural"
    language: str = "en-US"
    speed: float = 1.0
    pitch: float = 0.0


@dataclass
class AvatarRenderConfig:
    enabled: bool = False
    avatar_mode: str = "preset"        # "preset" | "custom"
    avatar_value: str = "Professional Male"
    scene: str = "Office"
    background: str = ""
    image_url: str | None = None       # optional user-supplied avatar portrait


# ---------------------------------------------------------------------------
# Narration (TTS): Azure Speech primary, Coqui XTTS fallback
# ---------------------------------------------------------------------------

class NarrationService:
    """Generates narration audio. Tries Azure Cognitive Services Speech SDK
    first (AZURE_SPEECH_KEY / AZURE_SPEECH_REGION env vars); if the SDK is
    not installed, not configured, or the call fails for any reason, falls
    back to local Coqui XTTS synthesis so narration generation never
    hard-fails the overall video pipeline."""

    def __init__(self, voice_config: VoiceConfig):
        self.voice_config = voice_config

    def synthesize(self, text: str, out_path: Path) -> Path:
        if not text or not text.strip():
            raise ValueError("[NarrationService] Cannot synthesize empty narration text")

        try:
            return self._synthesize_azure(text, out_path)
        except Exception as exc:
            logger.warning(
                "[NarrationService] Azure Speech unavailable/failed (%s) — falling back to Coqui XTTS",
                exc,
            )
            return self._synthesize_coqui(text, out_path)

    def _synthesize_azure(self, text: str, out_path: Path) -> Path:
        import azure.cognitiveservices.speech as speechsdk  # type: ignore

        speech_key = os.getenv("AZURE_SPEECH_KEY")
        speech_region = os.getenv("AZURE_SPEECH_REGION")
        if not speech_key or not speech_region:
            raise RuntimeError("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not configured")

        speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
        speech_config.speech_synthesis_voice_name = self.voice_config.voice_name
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
        )

        out_path.parent.mkdir(parents=True, exist_ok=True)
        audio_config = speechsdk.audio.AudioOutputConfig(filename=str(out_path))
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)

        rate_pct = int(round((self.voice_config.speed - 1.0) * 100))
        pitch_pct = int(round(self.voice_config.pitch * 100))
        ssml = (
            f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            f'xml:lang="{self.voice_config.language}">'
            f'<voice name="{self.voice_config.voice_name}">'
            f'<prosody rate="{rate_pct:+d}%" pitch="{pitch_pct:+d}%">{_xml_escape(text)}</prosody>'
            f'</voice></speak>'
        )

        result = synthesizer.speak_ssml_async(ssml).get()
        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            details = getattr(result, "cancellation_details", None)
            raise RuntimeError(f"Azure speech synthesis failed: {result.reason} ({details})")

        return out_path

    def _synthesize_coqui(self, text: str, out_path: Path) -> Path:
        tts = _get_cached_coqui_model(os.getenv("COQUI_TTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2"))

        out_path.parent.mkdir(parents=True, exist_ok=True)
        speaker_wav = os.getenv("COQUI_SPEAKER_WAV")  # optional reference voice clip for cloning
        lang_code = (self.voice_config.language or "en").split("-")[0]

        kwargs: dict = {"text": text, "file_path": str(out_path), "language": lang_code}
        if speaker_wav and Path(speaker_wav).exists():
            kwargs["speaker_wav"] = speaker_wav
        else:
            # XTTS requires a speaker reference; without one fall back to the
            # library's bundled default speaker if the model exposes one.
            default_speaker = os.getenv("COQUI_DEFAULT_SPEAKER")
            if default_speaker:
                kwargs["speaker"] = default_speaker

        tts.tts_to_file(**kwargs)
        return out_path


_coqui_model_cache: dict[str, object] = {}


def _get_cached_coqui_model(model_name: str):
    if model_name not in _coqui_model_cache:
        from TTS.api import TTS  # type: ignore
        _coqui_model_cache[model_name] = TTS(model_name)
    return _coqui_model_cache[model_name]


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


# ---------------------------------------------------------------------------
# Slide rendering: PPTX -> per-slide PNG images via LibreOffice headless
# ---------------------------------------------------------------------------

class SlideRenderer:
    """Converts a built .pptx file into one PNG image per slide using
    LibreOffice headless (soffice -> PDF) plus pdf2image (PDF -> PNG). This
    reuses the real PPTX layout already produced by pptx_builder.py instead
    of re-implementing slide rendering."""

    def __init__(self, soffice_bin: str | None = None, dpi: int = 150):
        self.soffice_bin = soffice_bin or os.getenv("SOFFICE_BIN", "soffice")
        self.dpi = dpi

    def render(self, pptx_path: Path, out_dir: Path) -> list[Path]:
        out_dir.mkdir(parents=True, exist_ok=True)

        self._convert_to_pdf(pptx_path, out_dir)
        pdf_path = out_dir / (pptx_path.stem + ".pdf")
        if not pdf_path.exists():
            raise RuntimeError(f"[SlideRenderer] LibreOffice did not produce expected PDF at {pdf_path}")

        return self._pdf_to_images(pdf_path, out_dir)

    def _convert_to_pdf(self, pptx_path: Path, out_dir: Path) -> None:
        cmd = [
            self.soffice_bin, "--headless", "--norestore",
            "--convert-to", "pdf", "--outdir", str(out_dir), str(pptx_path),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=180)
        except FileNotFoundError as exc:
            raise RuntimeError(
                "LibreOffice ('soffice') is not installed/available on PATH. "
                "Install LibreOffice or set the SOFFICE_BIN environment variable to its binary path."
            ) from exc
        except subprocess.CalledProcessError as exc:
            stderr = exc.stderr.decode(errors="ignore") if exc.stderr else str(exc)
            raise RuntimeError(f"LibreOffice PPTX->PDF conversion failed: {stderr}") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("LibreOffice PPTX->PDF conversion timed out") from exc

    def _pdf_to_images(self, pdf_path: Path, out_dir: Path) -> list[Path]:
        from pdf2image import convert_from_path  # type: ignore

        images = convert_from_path(str(pdf_path), dpi=self.dpi)
        if not images:
            raise RuntimeError(f"[SlideRenderer] No pages rendered from {pdf_path}")

        paths: list[Path] = []
        for i, img in enumerate(images, start=1):
            img_path = out_dir / f"slide_{i:03d}.png"
            img.save(img_path, "PNG")
            paths.append(img_path)
        return paths


# ---------------------------------------------------------------------------
# Video composition: slide images + narration audio -> MP4 via pure FFmpeg
# (no MoviePy — matches the migration already done in video_pipeline_local.py,
# so there is exactly one video-encoding strategy in the codebase).
# ---------------------------------------------------------------------------

class VideoComposer:
    """Combines per-slide images and matching per-slide narration audio into
    a single narrated MP4 by shelling out to ffmpeg directly per slide, then
    concatenating — the same approach as the live /video/render pipeline.
    Requires a working ffmpeg + ffprobe binary on PATH."""

    def __init__(self, fps: int = 24, resolution: tuple[int, int] = (1920, 1080)):
        self.fps = fps
        self.resolution = resolution

    def compose(self, slide_images: list[Path], slide_audio: list[Path], out_path: Path) -> Path:
        import subprocess
        import shutil as _shutil
        import uuid as _uuid

        if not slide_images:
            raise ValueError("[VideoComposer] No slide images provided")
        if len(slide_images) != len(slide_audio):
            raise ValueError(
                f"[VideoComposer] slide_images ({len(slide_images)}) and "
                f"slide_audio ({len(slide_audio)}) count mismatch"
            )

        out_path.parent.mkdir(parents=True, exist_ok=True)
        rw, rh = self.resolution
        tmp_dir = out_path.parent / f"clips_{_uuid.uuid4().hex[:8]}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            clip_paths: list[Path] = []
            for i, (img_path, audio_path) in enumerate(zip(slide_images, slide_audio)):
                clip = tmp_dir / f"slide_{i:03d}.mp4"
                subprocess.run(
                    [
                        "ffmpeg", "-y",
                        "-loop", "1", "-i", str(img_path),
                        "-i", str(audio_path),
                        "-vf", f"scale={rw}:{rh},fps={self.fps}",
                        "-c:v", "libx264", "-tune", "stillimage",
                        "-c:a", "aac", "-b:a", "192k",
                        "-pix_fmt", "yuv420p", "-shortest",
                        "-movflags", "+faststart",
                        str(clip),
                    ],
                    check=True, capture_output=True, timeout=120,
                )
                clip_paths.append(clip)

            list_file = tmp_dir / "concat_list.txt"
            list_file.write_text("\n".join(f"file '{c}'" for c in clip_paths))
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-f", "concat", "-safe", "0", "-i", str(list_file),
                    "-c:v", "libx264", "-c:a", "aac",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                    str(out_path),
                ],
                check=True, capture_output=True, timeout=300,
            )
        except subprocess.CalledProcessError as exc:
            stderr = exc.stderr.decode(errors="ignore") if exc.stderr else str(exc)
            raise RuntimeError(f"[VideoComposer] ffmpeg encoding failed: {stderr[-800:]}") from exc
        finally:
            _shutil.rmtree(tmp_dir, ignore_errors=True)

        return out_path