from __future__ import annotations

import json
import os
import requests
from pydantic import BaseModel, ValidationError


class LLMConnectionError(RuntimeError):
    pass


class AgentOutputParsingError(RuntimeError):
    pass


class OllamaClient:
    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        timeout: int = 180,
    ):
        self.model = model or os.getenv("OLLAMA_MODEL", "llama3.1:8b-instruct-q4_K_M")
        self.base_url = (
            base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        ).rstrip("/")
        if self.base_url.endswith("/api"):
            self.base_url = self.base_url[:-4]
        self.timeout = timeout

    def generate(self, system: str, prompt: str, temperature: float = 0.2) -> str:
        try:
            response = requests.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "system": system,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": temperature},
                },
                timeout=self.timeout,
            )
            response.raise_for_status()

        except requests.RequestException as exc:
            raise LLMConnectionError(
                f"Could not connect to Ollama: {exc}"
            ) from exc

        try:
            body = response.json()

        except ValueError as exc:
            raise LLMConnectionError(
                f"Invalid response from Ollama: {exc}"
            ) from exc

        if not body.get("response"):
            raise LLMConnectionError("Ollama returned empty response")

        return body.get("response")


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
