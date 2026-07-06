"""
tts_provider.py
================
TTS provider abstraction. Wraps (does not replace) the two TTS engines that
already exist in this codebase:

  - services.video_generation_service.NarrationService — Azure Speech
    primary, Coqui XTTS fallback (used by the secondary presentation_video_
    agent.VideoGenerationPipeline).
  - video_pipeline_local.LocalTTSService — edge-tts/macOS say/espeak-ng
    chain (used by the real, user-facing /video/render pipeline).

Both are structurally different (different constructor args, different
voice-config shapes) because they serve two different existing pipelines.
This module gives them one common Protocol so future providers (ElevenLabs,
etc. — Phase 2) can be added without touching either pipeline's call sites.
"""
from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class TTSProvider(Protocol):
    name: str

    def synthesize(self, text: str, out_path: Path) -> Path: ...


class AzureCoquiTTSProvider:
    """Adapter over services.video_generation_service.NarrationService —
    structural wrapping only, the existing Azure-primary/Coqui-fallback
    chain inside that class is untouched."""

    name = "azure_coqui"

    def __init__(self, voice_config) -> None:
        from ..services.video_generation_service import NarrationService
        self._svc = NarrationService(voice_config)

    def synthesize(self, text: str, out_path: Path) -> Path:
        return self._svc.synthesize(text, out_path)


class LocalTTSProvider:
    """Adapter over video_pipeline_local.LocalTTSService — the TTS engine
    actually used by the real, user-facing /video/render pipeline
    (edge-tts -> macOS say -> espeak-ng -> silence, never fails)."""

    name = "local"

    def __init__(self, voice_id: str = "samantha", controls=None) -> None:
        from ..video_pipeline_local import LocalTTSService
        self._svc = LocalTTSService()
        self._voice_id = voice_id
        self._controls = controls

    def synthesize(self, text: str, out_path: Path) -> Path:
        return self._svc.synthesize(text, out_path, voice_id=self._voice_id, controls=self._controls)

# Phase 2 will add ElevenLabsTTSProvider here implementing the same
# Protocol; no caller changes needed then since callers only ever depend
# on TTSProvider.
