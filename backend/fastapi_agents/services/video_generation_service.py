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
    VideoComposer        — slide images + narration audio -> MP4 (MoviePy/FFmpeg)
    AvatarVideoService  — talking-avatar MP4 via the Hedra API

No mock/placeholder logic: every method either performs the real operation or
raises a clear, actionable exception that callers can catch to apply a
fallback (e.g. Hedra failure -> narrated-slideshow-only video).
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import requests

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
    image_url: str | None = None       # optional explicit avatar portrait for Hedra


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
# Video composition: slide images + narration audio -> MP4 via MoviePy/FFmpeg
# ---------------------------------------------------------------------------

class VideoComposer:
    """Combines per-slide images and matching per-slide narration audio into
    a single narrated MP4. MoviePy shells out to FFmpeg for final encoding,
    so a working ffmpeg binary must be available on PATH (or set IMAGEIO_FFMPEG_EXE)."""

    def __init__(self, fps: int = 24, resolution: tuple[int, int] = (1920, 1080)):
        self.fps = fps
        self.resolution = resolution

    def compose(self, slide_images: list[Path], slide_audio: list[Path], out_path: Path) -> Path:
        from moviepy.editor import ImageClip, AudioFileClip, concatenate_videoclips  # type: ignore

        if not slide_images:
            raise ValueError("[VideoComposer] No slide images provided")
        if len(slide_images) != len(slide_audio):
            raise ValueError(
                f"[VideoComposer] slide_images ({len(slide_images)}) and "
                f"slide_audio ({len(slide_audio)}) count mismatch"
            )

        clips = []
        audio_clips = []
        try:
            for img_path, audio_path in zip(slide_images, slide_audio):
                audio_clip = AudioFileClip(str(audio_path))
                audio_clips.append(audio_clip)
                duration = max(audio_clip.duration, 1.0)
                image_clip = (
                    ImageClip(str(img_path))
                    .set_duration(duration)
                    .resize(newsize=self.resolution)
                    .set_audio(audio_clip)
                )
                clips.append(image_clip)

            final = concatenate_videoclips(clips, method="compose")
            out_path.parent.mkdir(parents=True, exist_ok=True)
            final.write_videofile(
                str(out_path),
                fps=self.fps,
                codec="libx264",
                audio_codec="aac",
                threads=4,
                logger=None,
            )
            final.close()
        finally:
            for c in clips:
                try:
                    c.close()
                except Exception:
                    pass
            for a in audio_clips:
                try:
                    a.close()
                except Exception:
                    pass

        return out_path


# ---------------------------------------------------------------------------
# AI Avatar video generation via the Hedra API
# ---------------------------------------------------------------------------

class HedraAvatarError(RuntimeError):
    """Raised for any Hedra configuration/API/timeout failure. Callers treat
    this as a recoverable condition and fall back to the narrated slideshow
    video rather than failing the whole generation."""


class AvatarVideoService:
    """Generates a talking-avatar video using the Hedra API
    (https://www.hedra.com). Requires HEDRA_API_KEY. Reuses the
    already-synthesized narration audio (via NarrationService) as the
    avatar's voice track, so narration stays consistent between the
    narrated-slideshow and avatar render modes."""

    BASE_URL = os.getenv("HEDRA_API_BASE_URL", "https://api.hedra.com/web-app/public")

    def __init__(self, api_key: str | None = None, poll_interval: float = 5.0, timeout: float = 600.0):
        self.api_key = api_key or os.getenv("HEDRA_API_KEY")
        self.poll_interval = poll_interval
        self.timeout = timeout

    def _headers(self) -> dict:
        if not self.api_key:
            raise HedraAvatarError("HEDRA_API_KEY is not configured")
        return {"X-API-KEY": self.api_key, "Accept": "application/json"}

    def generate(
        self,
        narration_audio_path: Path,
        avatar_config: AvatarRenderConfig,
        out_path: Path,
        progress_cb: ProgressCallback = None,
    ) -> Path:
        if not self.api_key:
            raise HedraAvatarError("HEDRA_API_KEY is not configured — cannot use Hedra avatar mode")

        _emit(progress_cb, "generating_avatar", 60, "Uploading narration audio to Hedra")
        audio_asset_id = self._upload_asset(narration_audio_path, asset_type="audio")

        image_asset_id = None
        if avatar_config.image_url:
            image_asset_id = self._upload_asset_from_url(avatar_config.image_url, asset_type="image")

        _emit(progress_cb, "generating_avatar", 65, "Requesting Hedra avatar generation job")
        job_id = self._create_generation_job(audio_asset_id, image_asset_id, avatar_config)

        _emit(progress_cb, "generating_avatar", 70, "Rendering avatar video (this can take a few minutes)")
        video_url = self._poll_job(job_id, progress_cb)

        _emit(progress_cb, "generating_avatar", 90, "Downloading avatar video")
        self._download(video_url, out_path)
        return out_path

    def _upload_asset(self, file_path: Path, asset_type: str) -> str:
        create_resp = requests.post(
            f"{self.BASE_URL}/assets",
            headers=self._headers(),
            json={"name": file_path.name, "type": asset_type},
            timeout=30,
        )
        self._raise_for_status(create_resp, "create asset")
        asset_id = create_resp.json()["id"]

        with open(file_path, "rb") as f:
            upload_resp = requests.post(
                f"{self.BASE_URL}/assets/{asset_id}/upload",
                headers=self._headers(),
                files={"file": (file_path.name, f)},
                timeout=120,
            )
        self._raise_for_status(upload_resp, "upload asset")
        return asset_id

    def _upload_asset_from_url(self, image_url: str, asset_type: str) -> str:
        img_resp = requests.get(image_url, timeout=30)
        img_resp.raise_for_status()
        tmp_path = Path(tempfile.gettempdir()) / f"hedra_avatar_src_{int(time.time())}.png"
        tmp_path.write_bytes(img_resp.content)
        try:
            return self._upload_asset(tmp_path, asset_type)
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass

    def _create_generation_job(
        self, audio_asset_id: str, image_asset_id: str | None, avatar_config: AvatarRenderConfig
    ) -> str:
        prompt = f"A {avatar_config.avatar_value} presenting in a {avatar_config.scene} setting"
        if avatar_config.background:
            prompt += f", background: {avatar_config.background}"

        payload: dict = {
            "type": "video",
            "ai_model_id": os.getenv("HEDRA_MODEL_ID", "hedra-character-2"),
            "audio_id": audio_asset_id,
            "generated_video_inputs": {"text_prompt": prompt},
        }
        if image_asset_id:
            payload["start_keyframe_id"] = image_asset_id

        resp = requests.post(f"{self.BASE_URL}/generations", headers=self._headers(), json=payload, timeout=30)
        self._raise_for_status(resp, "create generation job")
        return resp.json()["id"]

    def _poll_job(self, job_id: str, progress_cb: ProgressCallback) -> str:
        start = time.time()
        last_pct = 70
        while time.time() - start < self.timeout:
            resp = requests.get(f"{self.BASE_URL}/generations/{job_id}/status", headers=self._headers(), timeout=30)
            self._raise_for_status(resp, "poll generation status")
            data = resp.json()
            status_value = data.get("status")

            if status_value == "complete":
                video_url = data.get("url") or (data.get("asset") or {}).get("url")
                if not video_url:
                    raise HedraAvatarError("Hedra job completed but returned no video URL")
                return video_url
            if status_value in ("error", "failed"):
                raise HedraAvatarError(f"Hedra generation job failed: {data.get('error_message', 'unknown error')}")

            last_pct = min(last_pct + 2, 88)
            _emit(progress_cb, "generating_avatar", last_pct, f"Avatar rendering in progress ({status_value})")
            time.sleep(self.poll_interval)

        raise HedraAvatarError(f"Hedra generation job {job_id} timed out after {self.timeout}s")

    def _download(self, url: str, out_path: Path) -> None:
        resp = requests.get(url, stream=True, timeout=120)
        resp.raise_for_status()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)

    @staticmethod
    def _raise_for_status(resp: "requests.Response", action: str) -> None:
        if resp.status_code >= 400:
            raise HedraAvatarError(f"Hedra API error during {action}: {resp.status_code} {resp.text[:300]}")