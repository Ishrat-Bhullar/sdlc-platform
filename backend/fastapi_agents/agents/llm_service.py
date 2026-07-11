"""
agents/llm_service.py
======================
The single import point for every LLM call in the platform. No agent and no
route should import OllamaClient (or any provider SDK) directly anymore —
they construct an `LLMService` and call `.generate_json()` / `.generate_text()`
on it. The caller never learns which backend actually answered.

Resolution order for every call:
  1. The current project's own BYOK key (ProviderConfiguration row, enabled,
     a real non-placeholder key) — a user's own credential always wins.
  2. The deployment's default Azure OpenAI key, configured once via the
     DEFAULT_AZURE_OPENAI_* environment variables below. This is "the one
     place" a senior engineer pastes the production Azure key for the real
     demo/deployment — Azure is the primary provider once configured.
  3. The deployment's default Groq key, configured via GROQ_API_KEY. A fast,
     cheap dev/testing provider, tried only when Azure is not configured —
     purely config-driven: leave GROQ_API_KEY set during development and
     blank DEFAULT_AZURE_OPENAI_* to use it; the moment Azure is configured
     it takes over automatically, no code changes either way.
  4. The deployment's default OpenAI (GPT) key, configured via the
     DEFAULT_OPENAI_* environment variables — tried only if Azure and Groq
     above are not configured or fail.
  5. Ollama, transparently, as the final fallback — used ONLY when none of
     the default cloud keys above are configured (or all fail), reusing
     OllamaClient's existing role-aware local-model chain.

Groq, OpenAI, and openai_compatible all speak the same generic Bearer-auth
chat-completions shape via _call_chat_completions (Groq's API is OpenAI-
compatible, so it needs no dedicated call method); Azure OpenAI differs only
in URL shape (deployment name in the path, api-key header, api-version query
param), which is handled by a dedicated branch there.
"""
from __future__ import annotations

import json
from ..logging_config import get_logger
import os
import re
import time
import urllib.error
import urllib.request
from typing import Any

from pydantic import BaseModel, ValidationError

from .llm_client import AgentOutputParsingError, OllamaClient

logger = get_logger("sdlc.llm_service")

# Seeded demo rows use this sentinel as a placeholder key — never treat it as
# a real, usable credential (mirrors the check ai_service.py used to do).
_DEMO_KEY_SENTINEL = "demo-placeholder"

# Some providers front their API with Cloudflare, which blocks urllib's
# default "Python-urllib/x.y" User-Agent (HTTP 403, Cloudflare error 1010) —
# confirmed reproducible against Groq. A normal browser-like UA passes; sent
# on every cloud request since it's harmless for providers that don't check it.
_DEFAULT_UA = "Mozilla/5.0 (compatible; SDLCStudio-LLMService/1.0)"

_DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
    "groq": "https://api.groq.com/openai/v1",
}
_DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-haiku-20240307",
    "gemini": "gemini-2.0-flash",
    "groq": "llama-3.3-70b-versatile",
}

# The provider values the deployment-wide default config accepts. Per-project
# BYOK additionally accepts "anthropic"/"gemini" (see CloudProviderConfig
# docstring). Groq is included here (unlike anthropic/gemini) because it has
# its own dedicated deployment-default env-var tier — see
# default_groq_config_from_env() — a fast/cheap dev-time provider that sits
# ahead of Azure/OpenAI in the resolution order but is purely config-driven:
# leave GROQ_API_KEY blank and the chain falls through to Azure/OpenAI with
# zero code changes (e.g. swapping in the senior's Azure key for a demo).
DEFAULT_PATH_PROVIDERS = ("groq", "openai", "azure_openai", "openai_compatible")

_AZURE_DEFAULT_API_VERSION = "2024-06-01"


# Matches both a per-minute-limit wait ("try again in 16.14s") and a
# daily-quota-exhaustion wait ("try again in 1h43m6.24s") — the h/m groups
# are optional so a bare seconds tail still matches.
_RETRY_AFTER_HMS_RE = re.compile(r"try again in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s", re.IGNORECASE)


def _parse_retry_after(detail: str) -> float | None:
    """Providers that rate-limit (Groq's free tier, notably) tell you the
    exact wait in their error body — e.g. "Please try again in 16.14s" for a
    per-minute limit, or "Please try again in 1h43m6.24s" for a daily-quota
    exhaustion — far more precise than guessing a fixed backoff, and lets the
    caller recognize a not-worth-waiting-for delay instead of retrying blind."""
    m = _RETRY_AFTER_HMS_RE.search(detail or "")
    if not m:
        return None
    hours, minutes, seconds = m.groups()
    return (int(hours or 0) * 3600) + (int(minutes or 0) * 60) + float(seconds)


class ProviderUnavailableError(RuntimeError):
    """Raised internally when a cloud provider call fails; the caller always
    catches this and falls back to the next provider in the chain."""

    def __init__(self, message: str, *, rate_limited: bool = False, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.rate_limited = rate_limited
        self.retry_after = retry_after


class CloudProviderConfig(BaseModel):
    """One normalized shape for every cloud provider this service can call.
    provider: "openai" | "azure_openai" | "openai_compatible" | "groq" | "anthropic" | "gemini"
    (anthropic and gemini are narrow BYOK-only special cases — not part of
    the generic default-config path; groq DOES have its own default-config
    env-var tier — see default_groq_config_from_env — but is otherwise
    handled by the same generic Bearer-auth branch as openai/openai_compatible)."""
    provider: str
    api_key: str
    base_url: str
    model: str
    api_version: str | None = None


def default_groq_config_from_env() -> CloudProviderConfig | None:
    """The deployment-wide Groq key — a fast/cheap dev-time provider tried
    BEFORE Azure/OpenAI. Groq's chat-completions API is OpenAI-compatible,
    so it needs no dedicated _call_groq method: _call_chat_completions'
    generic Bearer-auth branch (the same one openai/openai_compatible use)
    handles it unchanged. Returns None (silently) if GROQ_API_KEY is unset —
    this is how the dev->demo provider swap works with zero code changes:
    blank this env var and set DEFAULT_AZURE_OPENAI_* instead, and the
    resolution loop in _produce_text falls through to Azure automatically."""
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return None
    return CloudProviderConfig(
        provider="groq",
        api_key=api_key,
        base_url=os.getenv("GROQ_BASE_URL", "").strip() or _DEFAULT_BASE_URLS["groq"],
        model=os.getenv("GROQ_MODEL", "").strip() or _DEFAULT_MODELS["groq"],
    )


def default_azure_config_from_env() -> CloudProviderConfig | None:
    """The deployment-wide Azure OpenAI key — tried first among the two
    default cloud slots. Returns None (silently) if unset."""
    api_key = os.getenv("DEFAULT_AZURE_OPENAI_API_KEY", "").strip()
    base_url = os.getenv("DEFAULT_AZURE_OPENAI_ENDPOINT", "").strip()
    model = os.getenv("DEFAULT_AZURE_OPENAI_DEPLOYMENT", "").strip()
    if not (api_key and base_url and model):
        return None
    return CloudProviderConfig(
        provider="azure_openai",
        api_key=api_key,
        base_url=base_url,
        model=model,
        api_version=os.getenv("DEFAULT_AZURE_OPENAI_API_VERSION", "").strip() or _AZURE_DEFAULT_API_VERSION,
    )


def default_openai_config_from_env() -> CloudProviderConfig | None:
    """The deployment-wide OpenAI (GPT) key — tried only if the Azure default
    above is not configured or fails. Returns None (silently) if unset."""
    api_key = os.getenv("DEFAULT_OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    return CloudProviderConfig(
        provider="openai",
        api_key=api_key,
        base_url=os.getenv("DEFAULT_OPENAI_BASE_URL", "").strip() or _DEFAULT_BASE_URLS["openai"],
        model=os.getenv("DEFAULT_OPENAI_MODEL", "").strip() or _DEFAULT_MODELS["openai"],
    )


def _decrypt_provider_key(ciphertext: str) -> str:
    from cryptography.fernet import Fernet

    from ..models import PROVIDER_KEY_ENCRYPTION_KEY
    return Fernet(PROVIDER_KEY_ENCRYPTION_KEY.encode()).decrypt(ciphertext.encode()).decode()


def build_cloud_config(
    provider_name: str,
    api_key: str,
    *,
    base_url: str | None = None,
    model: str | None = None,
    api_version: str | None = None,
) -> CloudProviderConfig | None:
    """Build a CloudProviderConfig from a stored (or just-submitted)
    ProviderConfiguration row, filling in sane per-provider defaults for
    base_url/model when the row predates those columns."""
    resolved_base_url = base_url or _DEFAULT_BASE_URLS.get(provider_name, "")
    resolved_model = model or _DEFAULT_MODELS.get(provider_name, "")
    if not api_key or not resolved_base_url or not resolved_model:
        return None
    return CloudProviderConfig(
        provider=provider_name,
        api_key=api_key,
        base_url=resolved_base_url,
        model=resolved_model,
        api_version=api_version,
    )


class LLMService:
    """Construct one per call site (cheap — it does no I/O until a generate*
    method is actually invoked). Pass `db`/`project_id` so per-project BYOK
    can be resolved; omit them for call sites with no project context (the
    service still correctly falls through default-cloud -> Ollama)."""

    def __init__(
        self,
        db: Any = None,
        project_id: int | None = None,
        *,
        role: str | None = None,
        timeout: int | None = None,
        provider_lock: str | tuple[str, ...] | None = None,
    ) -> None:
        self.db = db
        self.project_id = project_id
        self.role = role
        self.timeout = timeout
        # When set (e.g. "azure_openai", or an ordered chain like
        # ("azure_openai", "groq")), _produce_text only ever tries
        # BYOK/default configs matching one of these providers, tried in
        # order, before falling through to Ollama — used by the
        # presentation pipeline, which must stay on its own curated
        # provider chain (Azure primary, Groq fallback) rather than picking
        # up whatever BYOK/default the rest of the platform would otherwise
        # prefer (OpenAI, etc). A bare string is normalized to a
        # single-provider chain for backward compatibility. Every other
        # caller leaves this None and keeps today's full BYOK -> Azure ->
        # Groq -> OpenAI -> Ollama resolution, unchanged.
        self.provider_lock = provider_lock
        self._lock_chain: tuple[str, ...] = (
            (provider_lock,) if isinstance(provider_lock, str) else tuple(provider_lock or ())
        )
        self._last_provider = "ollama"

    # -- resolution -----------------------------------------------------
    def _resolve_project_byok(self) -> CloudProviderConfig | None:
        if self.db is None or self.project_id is None:
            return None
        try:
            from ..models import ProviderConfiguration

            configs = (
                self.db.query(ProviderConfiguration)
                .filter(
                    ProviderConfiguration.project_id == self.project_id,
                    ProviderConfiguration.enabled == True,  # noqa: E712
                )
                .all()
            )
            for cfg in configs:
                if not cfg.encrypted_key:
                    continue
                raw_key = _decrypt_provider_key(cfg.encrypted_key)
                if not raw_key or _DEMO_KEY_SENTINEL in raw_key:
                    continue
                built = build_cloud_config(
                    cfg.provider_name,
                    raw_key,
                    base_url=getattr(cfg, "base_url", None),
                    model=getattr(cfg, "model", None),
                    api_version=getattr(cfg, "api_version", None),
                )
                if built:
                    return built
        except Exception as exc:
            logger.warning("LLMService: BYOK resolution failed: %s", exc)
        return None

    def _resolve_default_groq(self) -> CloudProviderConfig | None:
        return default_groq_config_from_env()

    def _resolve_default_azure(self) -> CloudProviderConfig | None:
        return default_azure_config_from_env()

    def _resolve_default_openai(self) -> CloudProviderConfig | None:
        return default_openai_config_from_env()

    def has_cloud_path(self) -> bool:
        """Cheap, no-network check of whether a cloud provider is currently
        configured for this call (BYOK or one of the three deployment
        defaults). Used only to size prompts/inputs to the active
        context-window budget — never for business-logic branching, so
        callers still never learn *which* provider actually serves the
        request."""
        if self._lock_chain:
            byok = self._resolve_project_byok()
            locked_byok = byok is not None and byok.provider in self._lock_chain
            return locked_byok or any(
                self._resolve_locked_default(lock) is not None for lock in self._lock_chain
            )
        return (
            self._resolve_project_byok() is not None
            or self._resolve_default_azure() is not None
            or self._resolve_default_groq() is not None
            or self._resolve_default_openai() is not None
        )

    def has_generous_context_path(self) -> bool:
        """Like has_cloud_path(), but deliberately EXCLUDES Groq: Groq's
        free-tier budget is a strict tokens-PER-MINUTE cap (e.g. 12000 TPM on
        llama-3.3-70b-versatile) that's far smaller than a genuine GPT-4-class
        context window despite Groq being a "cloud" provider by every other
        measure. Content sized on the assumption that "any cloud path exists
        -> don't truncate" comfortably blows straight through that TPM limit
        as an immediate HTTP 413, not a retryable 429 — so callers that skip
        truncation whenever *a* cloud path exists (has_cloud_path) end up
        oversizing the prompt specifically when Groq is what actually serves
        it. Used by the presentation pipeline, which produces the largest
        prompts in the platform (full multi-artifact context) and hit this
        exact failure. Azure OpenAI and OpenAI keep the "don't truncate"
        treatment; Groq gets the same conservative cap the Ollama fallback
        already uses."""
        generous = ("azure_openai", "openai")
        if self._lock_chain:
            byok = self._resolve_project_byok()
            locked_byok = byok is not None and byok.provider in self._lock_chain and byok.provider in generous
            return locked_byok or any(
                lock in generous and self._resolve_locked_default(lock) is not None
                for lock in self._lock_chain
            )
        byok = self._resolve_project_byok()
        if byok is not None and byok.provider in generous:
            return True
        return self._resolve_default_azure() is not None or self._resolve_default_openai() is not None

    def _resolve_locked_default(self, lock: str) -> CloudProviderConfig | None:
        """The deployment-default resolver matching one entry of the lock
        chain, or None if that entry doesn't correspond to one of the
        default tiers ("azure_openai" and "groq" are wired today)."""
        if lock == "azure_openai":
            return self._resolve_default_azure()
        if lock == "groq":
            return self._resolve_default_groq()
        return None

    def last_provider_used(self) -> str:
        """For logging only — e.g. 'cloud:openai', 'cloud:azure_openai', 'ollama'."""
        return self._last_provider

    # -- the one generic HTTP shape for OpenAI / Azure / compatible --------
    def _call_chat_completions(
        self,
        cfg: CloudProviderConfig,
        system: str,
        user: str,
        *,
        json_mode: bool,
        temperature: float = 0.2,
    ) -> str:
        if cfg.provider == "anthropic":
            return self._call_anthropic(cfg, system, user)

        if cfg.provider == "gemini":
            return self._call_gemini(cfg, system, user, json_mode=json_mode, temperature=temperature)

        if cfg.provider == "azure_openai":
            url = (
                f"{cfg.base_url.rstrip('/')}/openai/deployments/{cfg.model}"
                f"/chat/completions?api-version={cfg.api_version or '2024-06-01'}"
            )
            headers = {"api-key": cfg.api_key, "Content-Type": "application/json", "User-Agent": _DEFAULT_UA}
            body: dict[str, Any] = {
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": temperature,
            }
        else:  # "openai" or "openai_compatible" — identical Bearer-auth shape
            url = f"{cfg.base_url.rstrip('/')}/chat/completions"
            headers = {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json", "User-Agent": _DEFAULT_UA}
            body = {
                "model": cfg.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": temperature,
            }

        if json_mode:
            body["response_format"] = {"type": "json_object"}

        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout or 60) as resp:
                payload = json.loads(resp.read())
                return payload["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="ignore")
            raise ProviderUnavailableError(f"{cfg.provider} HTTP {exc.code}: {detail[:500]}", rate_limited=(exc.code == 429), retry_after=_parse_retry_after(detail) if exc.code == 429 else None) from exc
        except Exception as exc:
            raise ProviderUnavailableError(f"{cfg.provider} call failed: {exc}") from exc

    def _call_anthropic(self, cfg: CloudProviderConfig, system: str, user: str) -> str:
        # 8192 covers Claude 3.5+ Sonnet-class and newer BYOK models without a
        # beta header. Enterprise-depth deliverables (full BRDs, DB schemas,
        # test suites) routinely need more than the old 4096 ceiling — that
        # was silently truncating output. Older Opus-3/Haiku-class models cap
        # lower server-side; a per-model lookup isn't worth the complexity
        # here since the existing generate_json/generate_text callers already
        # fall back to Ollama on any provider error, including a 400 from an
        # over-limit request.
        body = json.dumps(
            {
                "model": cfg.model,
                "max_tokens": 8192,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            }
        ).encode()
        req = urllib.request.Request(
            (cfg.base_url.rstrip("/") or "https://api.anthropic.com/v1") + "/messages",
            data=body,
            headers={
                "x-api-key": cfg.api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
                "User-Agent": _DEFAULT_UA,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout or 60) as resp:
                return json.loads(resp.read())["content"][0]["text"]
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="ignore")
            raise ProviderUnavailableError(f"anthropic HTTP {exc.code}: {detail[:500]}", rate_limited=(exc.code == 429), retry_after=_parse_retry_after(detail) if exc.code == 429 else None) from exc
        except Exception as exc:
            raise ProviderUnavailableError(f"anthropic call failed: {exc}") from exc

    def _call_gemini(
        self, cfg: CloudProviderConfig, system: str, user: str, *, json_mode: bool, temperature: float = 0.2
    ) -> str:
        # Gemini's API key is a URL query parameter, not a header — this is
        # intentional per Google's documented REST auth (not a security
        # regression specific to this integration; same as any Google API
        # key-based REST endpoint).
        url = f"{cfg.base_url.rstrip('/')}/models/{cfg.model}:generateContent?key={cfg.api_key}"
        body: dict[str, Any] = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": temperature},
        }
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"

        req = urllib.request.Request(
            url, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "User-Agent": _DEFAULT_UA}, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout or 60) as resp:
                payload = json.loads(resp.read())
                candidates = payload.get("candidates") or []
                if not candidates:
                    raise ProviderUnavailableError(f"gemini returned no candidates: {payload}")
                parts = candidates[0].get("content", {}).get("parts", [])
                text = "".join(p.get("text", "") for p in parts)
                if not text:
                    raise ProviderUnavailableError(f"gemini returned empty content: {payload}")
                return text
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="ignore")
            raise ProviderUnavailableError(f"gemini HTTP {exc.code}: {detail[:500]}", rate_limited=(exc.code == 429), retry_after=_parse_retry_after(detail) if exc.code == 429 else None) from exc
        except ProviderUnavailableError:
            raise
        except Exception as exc:
            raise ProviderUnavailableError(f"gemini call failed: {exc}") from exc

    def test_connection(self, cfg: CloudProviderConfig) -> str:
        """Exercises the exact call path production generation uses, so 'Test
        Connection' in the UI can never drift from what real calls do."""
        return self._call_chat_completions(cfg, "Reply with the single word: ok", "ok", json_mode=False)

    def test_ollama(self) -> str:
        """Explicitly tests the local Ollama fallback, bypassing cloud
        resolution — used by the 'Test Connection' button for the Ollama row
        specifically, where the intent is unambiguous (test Ollama, not
        whichever provider would normally win the resolution order)."""
        return self._ollama_client().generate(system="Reply with the single word: ok", prompt="ok")

    # -- Ollama fallback (unmodified engine, just constructed here) --------
    def _ollama_client(self) -> OllamaClient:
        return OllamaClient(role=self.role, timeout=self.timeout or 170)

    # A rate limit clears within its own window (Groq's free tier resets in
    # single-digit-to-low-double-digit seconds — its own error body gives the
    # exact wait, parsed by _parse_retry_after) — worth waiting out on the
    # SAME provider before burning the fallback chain (and eventually
    # landing on Ollama, which may not even be installed) over a transient
    # 429. A multi-stage pipeline (Storytelling -> Scene Planner -> Slide
    # Designer -> Review) can hit this more than once in a row as the
    # rolling per-minute quota keeps being consumed, hence 2 retries.
    _RATE_LIMIT_FALLBACK_DELAY_SECONDS = 12  # used only if the provider didn't tell us a wait time
    _RATE_LIMIT_MAX_RETRIES = 2
    # A per-minute rate limit clears fast and is worth waiting out. A daily
    # quota exhaustion (Groq reports this as the same 429 shape, just with a
    # "try again in 1h43m..." style wait — which _parse_retry_after doesn't
    # even match, since it only parses a bare "<seconds>s" tail) is a
    # different situation: waiting won't help within a request's lifetime, so
    # don't retry past this ceiling — fall through to the next provider tier
    # immediately instead of blocking the request for over a minute.
    _RATE_LIMIT_MAX_WAIT_SECONDS = 60

    # -- one text-producing attempt, tried in provider order, never raises
    # unless provider_lock is set and no matching provider is configured --
    def _produce_text(self, system: str, prompt: str, *, json_mode: bool, temperature: float) -> str:
        if self._lock_chain:
            byok = self._resolve_project_byok()
            candidates: list[CloudProviderConfig | None] = []
            for lock in self._lock_chain:
                candidates.append(byok if byok is not None and byok.provider == lock else None)
                candidates.append(self._resolve_locked_default(lock))
        else:
            candidates = [self._resolve_project_byok(), self._resolve_default_azure(),
                          self._resolve_default_groq(), self._resolve_default_openai()]

        for cfg in candidates:
            if cfg is None:
                continue
            attempt = 0
            while True:
                try:
                    text = self._call_chat_completions(cfg, system, prompt, json_mode=json_mode, temperature=temperature)
                    self._last_provider = f"cloud:{cfg.provider}"
                    logger.info("LLMService: request served by %s (role=%s)", self._last_provider, self.role)
                    return text
                except Exception as exc:
                    rate_limited = getattr(exc, "rate_limited", False)
                    delay = (getattr(exc, "retry_after", None) or self._RATE_LIMIT_FALLBACK_DELAY_SECONDS) + 1
                    if rate_limited and attempt < self._RATE_LIMIT_MAX_RETRIES and delay <= self._RATE_LIMIT_MAX_WAIT_SECONDS:
                        attempt += 1
                        logger.warning(
                            "LLMService: provider %s rate-limited — retrying in %.1fs (attempt %d/%d)",
                            cfg.provider, delay, attempt, self._RATE_LIMIT_MAX_RETRIES,
                        )
                        time.sleep(delay)
                        continue
                    logger.warning("LLMService: provider %s failed (%s) — falling back", cfg.provider, exc)
                    break

        # Every candidate in the resolution order above — including a
        # locked chain such as ("azure_openai", "groq") — is now either
        # unconfigured or has failed. Fall through to the local Ollama
        # fallback exactly like the unlocked path does: a cloud provider
        # outage must never crash the calling pipeline (see Presentation
        # Video Agent, which relies on this for Azure -> Groq -> Ollama).
        client = self._ollama_client()
        self._last_provider = "ollama"
        logger.info("LLMService: request served by ollama (role=%s)", self.role)
        if json_mode:
            return client.generate(system=system, prompt=prompt, temperature=temperature)
        return client.complete(system=system, prompt=prompt, temperature=temperature)

    # -- public API -----------------------------------------------------
    def generate_text(self, system: str, prompt: str, temperature: float = 0.4) -> str:
        """Plain-text generation (no forced JSON envelope)."""
        return self._produce_text(system, prompt, json_mode=False, temperature=temperature)

    def generate_json(
        self,
        system: str,
        prompt: str,
        schema: type[BaseModel],
        max_retries: int = 2,
    ) -> BaseModel:
        """Structured JSON generation, Pydantic-validated, with a
        retry-with-corrective-prompt loop — replaces the old
        `call_and_validate(client, ...)` helper every agent used to call
        directly against a raw OllamaClient."""
        last_error: str | None = None
        current_prompt = prompt

        for _ in range(max_retries + 1):
            raw = self._produce_text(system, current_prompt, json_mode=True, temperature=0.2)
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                last_error = str(exc)
                current_prompt = (
                    f"{prompt}\n\nPrevious output invalid JSON: {exc}. Return ONLY valid JSON."
                )
                continue

            try:
                return schema.model_validate(data)
            except ValidationError as exc:
                last_error = str(exc)
                current_prompt = (
                    f"{prompt}\n\nSchema validation failed: {exc}. "
                    f"Fix the structure and return ONLY valid JSON."
                )
                continue

        raise AgentOutputParsingError(f"Failed after retries. Last error: {last_error}")
