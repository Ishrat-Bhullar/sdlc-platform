from __future__ import annotations

import json
import os
import requests
from pydantic import BaseModel, ValidationError


class LLMConnectionError(RuntimeError):
    pass


class AgentOutputParsingError(RuntimeError):
    pass


# Preferred local models in priority order. The first one actually pulled in
# Ollama is used; if a call fails mid-flight we transparently fall back to the
# next available model. Overridable from Settings via env:
#   OLLAMA_MODEL            — pin/override the primary model
#   OLLAMA_MODEL_FALLBACKS  — comma-separated override of the whole chain
DEFAULT_MODEL_CHAIN = [
    "qwen3:32b",
    "qwen3:14b",
    "deepseek-r1:14b",
    "deepseek-r1:8b",
    "gemma2:9b",
    "gemma2:latest",
    "llama3.1:8b-instruct-q4_K_M",
    "llama3.1:8b",
    "mistral:latest",
]


# Per-task model routing. Each role names its preferred model first; the chain
# then falls back through progressively-more-available local models. Because
# `_ordered_candidates()` filters by what is actually installed in Ollama, an
# uninstalled preference (e.g. qwen3:14b) is skipped automatically and the next
# installed model is used — so this table works whatever the machine has pulled.
# Small models handle cheap structured tasks; larger models are reserved for the
# narrative-heavy stages (narration / video script).
ROLE_MODELS: dict[str, list[str]] = {
    "requirements":  ["gemma2:2b-instruct-q4_K_M", "gemma2:2b", "llama3.1:8b", "gemma2:9b"],
    "ba":            ["gemma2:2b-instruct-q4_K_M", "gemma2:2b", "llama3.1:8b", "gemma2:9b"],
    "architect":     ["gemma2:9b", "gemma2:latest", "llama3.1:8b"],
    "database":      ["gemma2:9b", "gemma2:latest", "llama3.1:8b"],
    "planning":      ["qwen3:14b", "gemma2:9b", "llama3.1:8b", "gemma2:2b"],
    "narration":     ["deepseek-r1:14b", "deepseek-r1:8b", "llama3.1:8b", "gemma2:9b"],
    "review":        ["qwen3:14b", "gemma2:9b", "llama3.1:8b"],
    "video_script":  ["deepseek-r1:14b", "deepseek-r1:8b", "llama3.1:8b", "gemma2:9b"],
}


def _resolve_model_chain(primary: str | None, role: str | None = None) -> list[str]:
    """Build the ordered model preference list from role + args + environment."""
    env_chain = os.getenv("OLLAMA_MODEL_FALLBACKS", "")
    chain: list[str] = []
    if primary:
        chain.append(primary)
    env_primary = os.getenv("OLLAMA_MODEL")
    if env_primary and env_primary not in chain:
        chain.append(env_primary)
    if role and role in ROLE_MODELS:
        chain.extend(ROLE_MODELS[role])
    if env_chain:
        chain.extend([m.strip() for m in env_chain.split(",") if m.strip()])
    else:
        chain.extend(DEFAULT_MODEL_CHAIN)
    # De-dupe, preserve order
    seen: set[str] = set()
    return [m for m in chain if not (m in seen or seen.add(m))]


class OllamaClient:
    """Ollama client with an automatic local-model fallback chain.

    Backwards compatible: `.model` still exposes the active model string and the
    `model=` constructor arg still pins a primary model. Internally the client
    keeps an ordered preference list (Qwen3 32B → 14B → DeepSeek R1 → …), picks
    the first one that is actually installed, and — if a generation call fails —
    retries down the chain so a missing model never hard-stops the pipeline."""

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        timeout: int | None = None,
        role: str | None = None,
        **_ignored,  # tolerate legacy provider=/api_key= kwargs from old callers
    ):
        self.base_url = (
            base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        ).rstrip("/")
        if self.base_url.endswith("/api"):
            self.base_url = self.base_url[:-4]
        # Per-call timeout defaults to 60s (env-overridable) so no single LLM
        # call can freeze the pipeline; callers fall back on TimeoutError.
        self.timeout = timeout if timeout is not None else int(os.getenv("OLLAMA_TIMEOUT", "60"))
        self.role = role
        self._chain = _resolve_model_chain(model, role)
        self._available: list[str] | None = None
        # `.model` reports the current best guess; refined lazily against Ollama.
        self.model = self._chain[0]

    @classmethod
    def for_role(cls, role: str, **kwargs) -> "OllamaClient":
        """Factory: a client whose model chain is tuned for a pipeline stage
        (see ROLE_MODELS) — e.g. OllamaClient.for_role('narration')."""
        return cls(role=role, **kwargs)

    def _list_installed(self) -> list[str]:
        if self._available is not None:
            return self._available
        try:
            resp = requests.get(f"{self.base_url}/api/tags", timeout=10)
            resp.raise_for_status()
            names = [m.get("name", "") for m in resp.json().get("models", [])]
            self._available = [n for n in names if n]
        except Exception:
            self._available = []  # can't introspect → just try the chain in order
        return self._available

    def _ordered_candidates(self) -> list[str]:
        """Chain filtered/ordered by what's installed (base-name aware), while
        still allowing untested chain entries as a last resort."""
        installed = self._list_installed()
        if not installed:
            return list(self._chain)

        def matches(pref: str) -> str | None:
            if pref in installed:
                return pref
            base = pref.split(":")[0]
            for name in installed:              # e.g. want "qwen3:32b", have "qwen3:32b-q4"
                if name == pref or name.split(":")[0] == base and pref.split(":")[0] == base:
                    if name.startswith(pref) or name.split(":")[0] == base:
                        return name
            return None

        ordered: list[str] = []
        for pref in self._chain:
            hit = matches(pref)
            if hit and hit not in ordered:
                ordered.append(hit)
        # Fall back to any remaining installed models, then untried chain entries
        for name in installed:
            if name not in ordered:
                ordered.append(name)
        return ordered or list(self._chain)

    def generate(self, system: str, prompt: str, temperature: float = 0.2) -> str:
        candidates = self._ordered_candidates()
        last_exc: Exception | None = None
        for model_name in candidates:
            try:
                response = requests.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": model_name,
                        "system": system,
                        "prompt": prompt,
                        "format": "json",
                        "stream": False,
                        # num_ctx raised from Ollama's 2048 default: small local
                        # models were silently truncating mid-JSON on
                        # multi-slide schemas, producing "too short" outputs
                        # and wasted retries. num_predict is left uncapped
                        # (-1) — the per-call `timeout` above is what actually
                        # bounds worst-case latency, not token count.
                        "options": {"temperature": temperature, "num_ctx": 4096},
                    },
                    timeout=self.timeout,
                )
                response.raise_for_status()
                body = response.json()
                if not body.get("response"):
                    raise LLMConnectionError("Ollama returned empty response")
                self.model = model_name  # remember the winner
                return body.get("response")
            except (requests.RequestException, ValueError, LLMConnectionError) as exc:
                last_exc = exc
                continue  # try the next model in the fallback chain

        raise LLMConnectionError(
            f"All local models failed ({', '.join(candidates) or 'none configured'}). "
            f"Last error: {last_exc}"
        )

    def complete(self, system: str, prompt: str, temperature: float = 0.4) -> str:
        """Plain-TEXT generation (no forced JSON) with the same fallback chain.
        Used by the AI presentation chat / toolbar for beautify, rewrite,
        translate, narration edits, etc. — where a JSON envelope would be wrong."""
        candidates = self._ordered_candidates()
        last_exc: Exception | None = None
        for model_name in candidates:
            try:
                response = requests.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": model_name,
                        "system": system,
                        "prompt": prompt,
                        "stream": False,
                        # num_ctx raised from Ollama's 2048 default: small local
                        # models were silently truncating mid-JSON on
                        # multi-slide schemas, producing "too short" outputs
                        # and wasted retries. num_predict is left uncapped
                        # (-1) — the per-call `timeout` above is what actually
                        # bounds worst-case latency, not token count.
                        "options": {"temperature": temperature, "num_ctx": 4096},
                    },
                    timeout=self.timeout,
                )
                response.raise_for_status()
                body = response.json()
                text = (body.get("response") or "").strip()
                if not text:
                    raise LLMConnectionError("Ollama returned empty response")
                self.model = model_name
                return text
            except (requests.RequestException, ValueError, LLMConnectionError) as exc:
                last_exc = exc
                continue
        raise LLMConnectionError(
            f"All local models failed for text completion. Last error: {last_exc}"
        )


def call_and_validate(
    client: OllamaClient,
    system: str,
    prompt: str,
    schema: type[BaseModel],
    max_retries: int = 2,
) -> BaseModel:

    last_error = None
    current_prompt = prompt

    for _ in range(max_retries + 1):
        raw = client.generate(system=system, prompt=current_prompt)

        try:
            data = json.loads(raw)

        except json.JSONDecodeError as exc:
            last_error = str(exc)
            current_prompt = (
                f"{prompt}\n\nPrevious output invalid JSON: {exc}. "
                f"Return ONLY valid JSON."
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

    raise AgentOutputParsingError(
        f"Failed after retries. Last error: {last_error}"
    )
