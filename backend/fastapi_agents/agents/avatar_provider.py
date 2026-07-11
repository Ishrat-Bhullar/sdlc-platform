"""
avatar_provider.py
===================
Avatar rendering provider abstraction. D-ID (cloud, high quality, credit-
limited) is primary; the existing, unmodified local SadTalker pipeline is the
automatic fallback. Callers use only `render_avatar_with_fallback()` — they
never construct a provider directly or branch on which one answered.

D-ID credit discipline: exactly one attempt per render, no retries. Each
`POST /talks` call consumes a credit regardless of outcome, and the free tier
here is a low fixed budget — automatic retries could exhaust it on a single
flaky render. On any D-ID error the code falls straight to SadTalker for that
render; the next render tries D-ID fresh.
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

logger = get_logger("sdlc.avatar_provider")

_DEMO_KEY_SENTINEL = "demo-placeholder"


class AvatarRenderError(RuntimeError):
    """Raised by a provider's .generate() on unrecoverable failure; the
    orchestrator catches this and falls back to the next provider."""


class DIDQuotaExceededError(AvatarRenderError):
    """A 402/403-style credit/quota response from D-ID specifically — kept
    distinct from a generic AvatarRenderError only so logs read clearly
    ("D-ID out of credits" vs. an opaque failure); behavior is identical
    (fallback, no retry)."""


@dataclass
class AvatarRenderResult:
    video_path: Path
    provider_used: str            # "d-id" | "sadtalker"
    fallback_occurred: bool = False
    primary_error: str | None = None  # set only when fallback_occurred


@runtime_checkable
class AvatarProvider(Protocol):
    name: str

    def generate(self, *, narration_text: str, audio_wav: Path, out_path: Path,
                 avatar_image: Path | None = None) -> Path:
        """Returns out_path on success. Raises AvatarRenderError on failure.
        Providers use whichever input they actually need: SadTalker drives
        lip-sync from `audio_wav` (ignores narration_text); D-ID's Clips API
        (see DIDAvatarProvider) is text-driven and uses `narration_text` with
        its own built-in presenter voice (ignores audio_wav/avatar_image —
        it renders one of its own stock presenters, not a custom photo)."""
        ...


class SadTalkerAvatarProvider:
    """Thin adapter over the existing, unmodified video_pipeline_local.
    SadTalkerAvatarService — does not reimplement SadTalker, just normalizes
    its Optional[Path]-returning contract into raise/return so it composes
    cleanly with DIDAvatarProvider behind one Protocol."""

    name = "sadtalker"

    def __init__(self) -> None:
        from ..video_pipeline_local import SadTalkerAvatarService
        self._svc = SadTalkerAvatarService()

    def generate(self, *, narration_text: str, audio_wav: Path, out_path: Path,
                 avatar_image: Path | None = None) -> Path:
        result = self._svc.generate(audio_wav, out_path, avatar_image=avatar_image)
        if result is None or not result.exists():
            raise AvatarRenderError(self._svc.last_error or "SadTalker failed for an unknown reason")
        return result


# Confirmed via a real account probe (GET /clips/presenters, zero-cost) that
# this integration targets D-ID's Clips API (POST /clips), not the older
# Talks API (POST /talks) — the account's trial credits are scoped to Clips.
# Clips renders one of D-ID's own stock presenters reading given text aloud
# in its own built-in voice; it does not accept a custom source photo or a
# custom pre-recorded narration track the way Talks does.
_DEFAULT_PRESENTER_ID = "v2_public_Amber@0zSz8kflCN"  # female; "v2_public_Adam@0GLJgELXjc" is the male alternative

# Voice ids already carry a gender (see video_pipeline_local.VOICES /
# persona_engine.PersonaProfile.voice_id) — reuse that signal to at least
# pick a presenter of matching gender, so a persona like "Farmer" (voice_id
# "tom", male) doesn't visibly mismatch the rendered presenter.
_FEMALE_VOICE_IDS = {"samantha", "victoria", "karen", "moira"}
_PRESENTER_BY_GENDER = {"male": "v2_public_Adam@0GLJgELXjc", "female": _DEFAULT_PRESENTER_ID}


def presenter_id_for_voice(voice_id: str | None) -> str:
    gender = "female" if (voice_id or "").strip().lower() in _FEMALE_VOICE_IDS else "male"
    return _PRESENTER_BY_GENDER[gender]


class DIDAvatarProvider:
    """D-ID Clips API (https://api.d-id.com/clips). Basic Auth using the
    stored credential string exactly as D-ID issues it (their dashboard-
    copied API key is already in the Basic-Auth-ready 'email:key' shape —
    used verbatim, never re-derived beyond the one required base64 wrap for
    the Authorization header)."""

    name = "d-id"
    _BASE_URL = "https://api.d-id.com"
    _POLL_INTERVAL_SECONDS = 4
    _POLL_TIMEOUT_SECONDS = 300  # typical narration lengths render well under 5 min

    def __init__(self, credential: str, presenter_id: str | None = None) -> None:
        self._auth_header = "Basic " + base64.b64encode(credential.encode()).decode()
        self._presenter_id = presenter_id or _DEFAULT_PRESENTER_ID

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        url = f"{self._BASE_URL}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            url, data=data, method=method,
            headers={"Authorization": self._auth_header, "Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="ignore")
            if exc.code in (401, 403):
                raise AvatarRenderError(f"d-id auth error HTTP {exc.code}: {detail[:300]}") from exc
            if exc.code == 402 or "InsufficientCredits" in detail:
                raise DIDQuotaExceededError(f"d-id insufficient credits: {detail[:300]}") from exc
            raise AvatarRenderError(f"d-id HTTP {exc.code}: {detail[:300]}") from exc
        except Exception as exc:
            raise AvatarRenderError(f"d-id request failed: {exc}") from exc

    def generate(self, *, narration_text: str, audio_wav: Path, out_path: Path,
                 avatar_image: Path | None = None) -> Path:
        text = (narration_text or "").strip()
        if not text:
            raise AvatarRenderError("no narration text available for D-ID Clips (text-driven API)")

        create_resp = self._request("POST", "/clips", {
            "presenter_id": self._presenter_id,
            "script": {"type": "text", "input": text},
        })
        clip_id = create_resp.get("id")
        if not clip_id:
            raise AvatarRenderError(f"d-id did not return a clip id: {create_resp}")

        deadline = time.time() + self._POLL_TIMEOUT_SECONDS
        while time.time() < deadline:
            time.sleep(self._POLL_INTERVAL_SECONDS)
            status_resp = self._request("GET", f"/clips/{clip_id}")
            status = status_resp.get("status")
            if status == "done":
                result_url = status_resp.get("result_url")
                if not result_url:
                    raise AvatarRenderError(f"d-id clip done but no result_url: {status_resp}")
                self._download(result_url, out_path)
                return out_path
            if status == "error":
                raise AvatarRenderError(f"d-id render error: {status_resp.get('error') or status_resp}")
            # "created" / "started" — keep polling

        raise AvatarRenderError(f"d-id render timed out after {self._POLL_TIMEOUT_SECONDS}s (clip_id={clip_id})")

    def _download(self, url: str, out_path: Path) -> None:
        with urllib.request.urlopen(url, timeout=60) as resp:
            out_path.write_bytes(resp.read())

    def get_credits(self) -> dict:
        """Zero-cost reachability/credit check — does not create a clip, so
        it never consumes a credit."""
        return self._request("GET", "/credits")


def get_did_credential(db=None, project_id: int | None = None) -> str | None:
    """Reads the D-ID BYOK credential the same way LLMService._resolve_project_byok
    reads LLM credentials, scoped to provider_name == 'd_id'. D-ID is a video
    credential, not an LLM credential, so it is intentionally NOT plumbed
    through LLMService. Falls back to the deployment-wide D_ID_API_KEY env
    var if no enabled project-level row exists (mirrors the Azure/OpenAI
    env-default + BYOK-override pattern in llm_service.py)."""
    if db is not None and project_id is not None:
        try:
            from ..models import ProviderConfiguration
            from .llm_service import _decrypt_provider_key

            cfg = (
                db.query(ProviderConfiguration)
                .filter(
                    ProviderConfiguration.project_id == project_id,
                    ProviderConfiguration.provider_name == "d_id",
                    ProviderConfiguration.enabled == True,  # noqa: E712
                )
                .first()
            )
            if cfg and cfg.encrypted_key:
                raw = _decrypt_provider_key(cfg.encrypted_key)
                if raw and _DEMO_KEY_SENTINEL not in raw:
                    return raw
        except Exception as exc:
            logger.warning("avatar_provider: BYOK resolution failed: %s", exc)
    return os.getenv("D_ID_API_KEY", "").strip() or None


def render_avatar_with_fallback(
    *,
    narration_text: str = "",
    audio_wav: Path,
    out_path: Path,
    avatar_image: Path | None,
    voice_id: str | None = None,
    db=None,
    project_id: int | None = None,
) -> AvatarRenderResult:
    """The one function callers should invoke. D-ID first (if configured),
    SadTalker fallback on any D-ID failure or when D-ID isn't configured at
    all. Never retries D-ID within a single render. `narration_text` is
    required for D-ID (its Clips API is text-driven — see DIDAvatarProvider);
    SadTalker ignores it and drives lip-sync from `audio_wav` instead.
    `voice_id` (the persona's chosen voice) picks a gender-matched D-ID
    presenter via presenter_id_for_voice() — best-effort, not exact identity
    matching, just avoids an obvious mismatch."""
    credential = get_did_credential(db, project_id)
    primary_error: str | None = None

    if credential:
        try:
            did_provider = DIDAvatarProvider(credential, presenter_id=presenter_id_for_voice(voice_id))
            path = did_provider.generate(narration_text=narration_text, audio_wav=audio_wav,
                                          out_path=out_path, avatar_image=avatar_image)
            return AvatarRenderResult(video_path=path, provider_used="d-id", fallback_occurred=False)
        except AvatarRenderError as exc:
            logger.warning(
                "[AvatarProvider] D-ID failed (%s) — falling back to SadTalker. "
                "No retry attempted (each D-ID call consumes a credit).", exc,
            )
            primary_error = str(exc)

    sadtalker_provider = SadTalkerAvatarProvider()
    path = sadtalker_provider.generate(narration_text=narration_text, audio_wav=audio_wav,
                                        out_path=out_path, avatar_image=avatar_image)  # raises if this also fails
    return AvatarRenderResult(
        video_path=path,
        provider_used="sadtalker",
        fallback_occurred=credential is not None,  # only a "true fallback" if D-ID was actually tried
        primary_error=primary_error,
    )
