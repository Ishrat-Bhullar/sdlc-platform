"""
image_provider.py
===================
Image generation provider abstraction — mirrors avatar_provider.py's pattern
exactly (Protocol + concrete providers + one fallback-safe entrypoint).
Unlike avatar rendering (which always has a guaranteed-to-succeed local
SadTalker fallback), image generation has no local fallback: if no provider
is configured, or every configured provider fails, the single public
function returns None rather than raising. Callers (the presentation
pipeline) treat None as "no hero image this slide" and keep the existing
gradient/diagram/icon treatment — image generation failure must never stop
presentation generation.

Supported providers, tried in this order once a credential is found:
  1. Project BYOK (ProviderConfiguration rows for "openai_image" /
     "google_imagen" / "stability", same pattern as every other BYOK
     credential in this codebase).
  2. Deployment-wide env-var defaults, in a fixed priority order:
     OPENAI_IMAGE_API_KEY -> GOOGLE_IMAGEN_API_KEY -> STABILITY_API_KEY.

No provider is hardcoded as "the" image provider — adding a fourth provider
means adding one more class implementing ImageProvider and one more entry in
_ENV_PROVIDER_ORDER, nothing else changes.
"""
from __future__ import annotations

import base64
import json
from ..logging_config import get_logger
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

logger = get_logger("sdlc.image_provider")

_DEMO_KEY_SENTINEL = "demo-placeholder"


class ImageGenerationError(RuntimeError):
    """Raised by a provider's .generate() on failure; generate_image_with_
    fallback() catches this, logs, and tries the next configured provider —
    it never propagates out to callers."""


class ImageQuotaExceededError(ImageGenerationError):
    """A 402/403/429-style credit/quota response — kept distinct only so
    logs read clearly; behavior (try next provider, never raise) is
    identical to any other ImageGenerationError."""


@dataclass
class ImageResult:
    image_path: Path
    provider_used: str  # "openai_image" | "google_imagen" | "stability"


@runtime_checkable
class ImageProvider(Protocol):
    name: str

    def generate(self, prompt: str, out_path: Path, *, size: str = "1024x1024") -> Path:
        """Returns out_path on success. Raises ImageGenerationError on failure."""
        ...


class OpenAIImageProvider:
    """OpenAI Images API (DALL-E 3) — POST /v1/images/generations."""

    name = "openai_image"
    _URL = "https://api.openai.com/v1/images/generations"

    def __init__(self, api_key: str, model: str = "dall-e-3") -> None:
        self._api_key = api_key
        self._model = model

    def generate(self, prompt: str, out_path: Path, *, size: str = "1024x1024") -> Path:
        body = json.dumps({
            "model": self._model,
            "prompt": prompt,
            "size": size,
            "n": 1,
            "response_format": "url",
        }).encode()
        req = urllib.request.Request(
            self._URL, data=body, method="POST",
            headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="ignore")
            if exc.code == 429 or "insufficient_quota" in detail:
                raise ImageQuotaExceededError(f"openai_image quota: {detail[:300]}") from exc
            raise ImageGenerationError(f"openai_image HTTP {exc.code}: {detail[:300]}") from exc
        except Exception as exc:
            raise ImageGenerationError(f"openai_image request failed: {exc}") from exc

        data = payload.get("data") or []
        if not data or not data[0].get("url"):
            raise ImageGenerationError(f"openai_image returned no image url: {payload}")
        _download(data[0]["url"], out_path)
        return out_path


class GoogleImagenProvider:
    """Google Imagen via the Generative Language API's :predict endpoint —
    same raw-urllib, no-SDK style as llm_service.py's Gemini integration."""

    name = "google_imagen"
    _BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, api_key: str, model: str = "imagen-3.0-generate-002") -> None:
        self._api_key = api_key
        self._model = model

    def generate(self, prompt: str, out_path: Path, *, size: str = "1024x1024") -> Path:
        url = f"{self._BASE_URL}/{self._model}:predict?key={self._api_key}"
        body = json.dumps({
            "instances": [{"prompt": prompt}],
            "parameters": {"sampleCount": 1},
        }).encode()
        req = urllib.request.Request(url, data=body, method="POST",
                                      headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="ignore")
            if exc.code == 429:
                raise ImageQuotaExceededError(f"google_imagen quota: {detail[:300]}") from exc
            raise ImageGenerationError(f"google_imagen HTTP {exc.code}: {detail[:300]}") from exc
        except Exception as exc:
            raise ImageGenerationError(f"google_imagen request failed: {exc}") from exc

        predictions = payload.get("predictions") or []
        b64 = predictions[0].get("bytesBase64Encoded") if predictions else None
        if not b64:
            raise ImageGenerationError(f"google_imagen returned no image data: {payload}")
        out_path.write_bytes(base64.b64decode(b64))
        return out_path


class AzureOpenAIImageProvider:
    """Azure OpenAI image generation — generic to whatever deployment the
    user has configured (e.g. gpt-image-1 or a dall-e-3 deployment), not
    hardcoded to one model. Same URL shape as llm_service.py's Azure chat
    call: deployment name in the path, api-key header, api-version query
    param. Azure's images/generations endpoint returns either a `url` (as
    dall-e-3 does) or a `b64_json` (as gpt-image-1 does) per image — both
    are handled here so either deployment type works unchanged."""

    name = "azure_openai_image"

    def __init__(self, api_key: str, endpoint: str, deployment: str, api_version: str) -> None:
        self._api_key = api_key
        self._endpoint = endpoint.rstrip("/")
        self._deployment = deployment
        self._api_version = api_version

    def generate(self, prompt: str, out_path: Path, *, size: str = "1024x1024") -> Path:
        url = (
            f"{self._endpoint}/openai/deployments/{self._deployment}"
            f"/images/generations?api-version={self._api_version}"
        )
        body = json.dumps({"prompt": prompt, "size": size, "n": 1}).encode()
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"api-key": self._api_key, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="ignore")
            if exc.code == 429 or "insufficient_quota" in detail:
                raise ImageQuotaExceededError(f"azure_openai_image quota: {detail[:300]}") from exc
            raise ImageGenerationError(f"azure_openai_image HTTP {exc.code}: {detail[:300]}") from exc
        except Exception as exc:
            raise ImageGenerationError(f"azure_openai_image request failed: {exc}") from exc

        data = payload.get("data") or []
        if not data:
            raise ImageGenerationError(f"azure_openai_image returned no image data: {payload}")
        item = data[0]
        if item.get("b64_json"):
            out_path.write_bytes(base64.b64decode(item["b64_json"]))
            return out_path
        if item.get("url"):
            _download(item["url"], out_path)
            return out_path
        raise ImageGenerationError(f"azure_openai_image returned neither url nor b64_json: {payload}")


class StabilityAIProvider:
    """Stability AI's v2beta image-generation endpoint. Unlike the other two
    providers, this endpoint returns raw image bytes directly in the response
    body (Accept: image/*) rather than a URL/base64 wrapper."""

    name = "stability"
    _URL = "https://api.stability.ai/v2beta/stable-image/generate/core"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def generate(self, prompt: str, out_path: Path, *, size: str = "1024x1024") -> Path:
        boundary = "----sdlcstudioimage"
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\n{prompt}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"output_format\"\r\n\r\npng\r\n"
            f"--{boundary}--\r\n"
        ).encode()
        req = urllib.request.Request(
            self._URL, data=body, method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Accept": "image/*",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                image_bytes = resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="ignore")
            if exc.code in (402, 429):
                raise ImageQuotaExceededError(f"stability quota: {detail[:300]}") from exc
            raise ImageGenerationError(f"stability HTTP {exc.code}: {detail[:300]}") from exc
        except Exception as exc:
            raise ImageGenerationError(f"stability request failed: {exc}") from exc

        if not image_bytes:
            raise ImageGenerationError("stability returned an empty image response")
        out_path.write_bytes(image_bytes)
        return out_path


def _download(url: str, out_path: Path) -> None:
    with urllib.request.urlopen(url, timeout=60) as resp:
        out_path.write_bytes(resp.read())


# Deployment-default env-var tiers, tried in this order when no project BYOK
# image credential is configured. Adding a new provider = one more entry here
# plus one more class above — nothing else in the pipeline changes.
_ENV_PROVIDER_ORDER = ("openai_image", "google_imagen", "stability", "azure_openai_image")
_ENV_KEY_VARS = {
    "openai_image": "OPENAI_IMAGE_API_KEY",
    "google_imagen": "GOOGLE_IMAGEN_API_KEY",
    "stability": "STABILITY_API_KEY",
    "azure_openai_image": "AZURE_OPENAI_IMAGE_API_KEY",
}
_AZURE_IMAGE_DEFAULT_API_VERSION = "2024-04-01-preview"


def _build_provider(provider_name: str, api_key: str, **extra: str) -> ImageProvider:
    if provider_name == "openai_image":
        return OpenAIImageProvider(api_key)
    if provider_name == "google_imagen":
        return GoogleImagenProvider(api_key)
    if provider_name == "stability":
        return StabilityAIProvider(api_key)
    if provider_name == "azure_openai_image":
        return AzureOpenAIImageProvider(
            api_key,
            endpoint=extra.get("endpoint", ""),
            deployment=extra.get("deployment", ""),
            api_version=extra.get("api_version") or _AZURE_IMAGE_DEFAULT_API_VERSION,
        )
    raise ValueError(f"unknown image provider: {provider_name}")


def _azure_image_config_from_env() -> tuple[str, dict[str, str]] | None:
    api_key = os.getenv("AZURE_OPENAI_IMAGE_API_KEY", "").strip()
    endpoint = os.getenv("AZURE_OPENAI_IMAGE_ENDPOINT", "").strip()
    deployment = os.getenv("AZURE_OPENAI_IMAGE_DEPLOYMENT", "").strip()
    if not (api_key and endpoint and deployment):
        return None
    return api_key, {
        "endpoint": endpoint,
        "deployment": deployment,
        "api_version": os.getenv("AZURE_OPENAI_IMAGE_API_VERSION", "").strip() or _AZURE_IMAGE_DEFAULT_API_VERSION,
    }


def get_image_credential(
    db=None, project_id: int | None = None, *, providers: tuple[str, ...] | None = None,
) -> tuple[str, str, dict[str, str]] | None:
    """Returns (provider_name, api_key, extra_config) for the first configured
    image credential, or None if none is configured anywhere. `extra_config`
    carries provider-specific fields beyond a bare API key (currently only
    azure_openai_image's endpoint/deployment/api_version; empty dict for
    every other provider). Checks project BYOK first (mirroring
    LLMService._resolve_project_byok / avatar_provider.get_did_credential),
    then the env-var deployment defaults in _ENV_PROVIDER_ORDER.

    `providers`, if given, restricts resolution to that allowlist — used by
    the presentation pipeline to stay Azure-only; every other caller passes
    nothing and keeps today's full-order behavior."""
    order = tuple(p for p in _ENV_PROVIDER_ORDER if providers is None or p in providers)

    if db is not None and project_id is not None:
        try:
            from ..models import ProviderConfiguration
            from .llm_service import _decrypt_provider_key

            configs = (
                db.query(ProviderConfiguration)
                .filter(
                    ProviderConfiguration.project_id == project_id,
                    ProviderConfiguration.provider_name.in_(order),
                    ProviderConfiguration.enabled == True,  # noqa: E712
                )
                .all()
            )
            by_name = {c.provider_name: c for c in configs}
            for name in order:
                cfg = by_name.get(name)
                if cfg and cfg.encrypted_key:
                    raw = _decrypt_provider_key(cfg.encrypted_key)
                    if raw and _DEMO_KEY_SENTINEL not in raw:
                        if name == "azure_openai_image":
                            extra = {
                                "endpoint": getattr(cfg, "base_url", None) or "",
                                "deployment": getattr(cfg, "model", None) or "",
                                "api_version": getattr(cfg, "api_version", None) or _AZURE_IMAGE_DEFAULT_API_VERSION,
                            }
                            if extra["endpoint"] and extra["deployment"]:
                                return name, raw, extra
                            continue
                        return name, raw, {}
        except Exception as exc:
            logger.warning("image_provider: BYOK resolution failed: %s", exc)

    for name in order:
        if name == "azure_openai_image":
            resolved = _azure_image_config_from_env()
            if resolved:
                api_key, extra = resolved
                return name, api_key, extra
            continue
        api_key = os.getenv(_ENV_KEY_VARS[name], "").strip()
        if api_key:
            return name, api_key, {}
    return None


# Simple in-process cache: identical (prompt, size) pairs within one process
# lifetime reuse the same generated file instead of re-calling the image API.
# Cleared never — matches "cache generated prompts, reuse assets" without
# needing a persistence layer for a same-process, same-deployment concern.
_image_cache: dict[tuple[str, str], Path] = {}


def generate_image_with_fallback(
    prompt: str,
    out_path: Path,
    *,
    size: str = "1024x1024",
    db=None,
    project_id: int | None = None,
    providers: tuple[str, ...] | None = None,
) -> ImageResult | None:
    """The one function callers should invoke. Returns None — never raises —
    when no image provider is configured or every configured provider fails,
    so the presentation pipeline can always fall back to its existing
    gradient/diagram/icon treatment without special-casing image failure.

    `providers`, if given, restricts resolution to that allowlist (e.g. the
    presentation pipeline passes `("azure_openai_image",)` to stay
    Azure-only); default `None` preserves today's full-order behavior for
    any other caller."""
    cache_key = (prompt, size)
    cached = _image_cache.get(cache_key)
    if cached is not None and cached.exists():
        logger.info("[ImageProvider] Cache hit for prompt (skipping API call)")
        return ImageResult(image_path=cached, provider_used="cache")

    credential = get_image_credential(db, project_id, providers=providers)
    if credential is None:
        return None

    provider_name, api_key, extra = credential
    try:
        provider = _build_provider(provider_name, api_key, **extra)
        path = provider.generate(prompt, out_path, size=size)
        _image_cache[cache_key] = path
        logger.info("[ImageProvider] Image generated via %s", provider_name)
        return ImageResult(image_path=path, provider_used=provider_name)
    except ImageGenerationError as exc:
        logger.warning("[ImageProvider] %s failed (%s) — no further image providers configured; "
                        "continuing without a hero image for this slide.", provider_name, exc)
        return None
