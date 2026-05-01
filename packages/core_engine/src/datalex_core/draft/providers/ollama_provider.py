"""Ollama provider for `datalex draft`.

Speaks Ollama's HTTP API directly via stdlib urllib — no extra dependency.
Reads `OLLAMA_HOST` (default http://127.0.0.1:11434). Useful for local
development, on-prem deployments, and air-gapped environments where
shipping data to a hosted LLM isn't acceptable.

No prompt caching — Ollama's KV cache is per-request and there's no public
hook to ask the server to retain prefix state across calls.
"""

from __future__ import annotations

import json
import os
from urllib.error import URLError
from urllib.request import Request, urlopen

from datalex_core.draft.providers.base import (
    CompletionResult,
    Provider,
    ProviderError,
)


DEFAULT_HOST = "http://127.0.0.1:11434"
DEFAULT_MODEL = "llama3.1:8b"


class OllamaProvider(Provider):
    name = "ollama"

    def complete(
        self,
        *,
        system: str,
        few_shot: list[tuple[str, str]],
        user_message: str,
        model: str,
        max_tokens: int,
    ) -> CompletionResult:
        host = os.environ.get("OLLAMA_HOST", DEFAULT_HOST).rstrip("/")
        url = f"{host}/api/chat"

        messages: list[dict[str, str]] = [{"role": "system", "content": system}]
        for user_text, assistant_text in few_shot:
            messages.append({"role": "user", "content": user_text})
            messages.append({"role": "assistant", "content": assistant_text})
        messages.append({"role": "user", "content": user_message})

        payload = json.dumps(
            {
                "model": model or DEFAULT_MODEL,
                "messages": messages,
                "options": {"num_predict": max_tokens},
                "stream": False,
            }
        ).encode("utf-8")

        request = Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=300) as response:
                body = response.read()
        except URLError as exc:
            raise ProviderError(
                f"Could not reach Ollama at {host}. Start it with `ollama serve` or set OLLAMA_HOST. ({exc})"
            ) from exc

        result = json.loads(body)
        if "error" in result:
            raise ProviderError(f"Ollama error: {result['error']}")
        message = result.get("message") or {}
        text = message.get("content", "")
        return CompletionResult(
            text=text,
            input_tokens=result.get("prompt_eval_count", 0) or 0,
            output_tokens=result.get("eval_count", 0) or 0,
            provider=self.name,
            model=model or DEFAULT_MODEL,
        )
