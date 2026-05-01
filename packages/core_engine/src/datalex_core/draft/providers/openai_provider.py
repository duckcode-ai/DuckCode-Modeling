"""OpenAI provider for `datalex draft`.

Uses the standard `chat.completions.create` API. OpenAI auto-caches
prefixes >1024 tokens since 2024 — no explicit cache_control needed. We
pass system + few-shot + user as separate messages and let the provider
dedupe. Default model: gpt-4.1.
"""

from __future__ import annotations

import os

from datalex_core.draft.providers.base import (
    CompletionResult,
    Provider,
    ProviderError,
)


DEFAULT_MODEL = "gpt-4.1"


class OpenAIProvider(Provider):
    name = "openai"

    def complete(
        self,
        *,
        system: str,
        few_shot: list[tuple[str, str]],
        user_message: str,
        model: str,
        max_tokens: int,
    ) -> CompletionResult:
        if not os.environ.get("OPENAI_API_KEY"):
            raise ProviderError("OPENAI_API_KEY not set in environment.")
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise ProviderError(
                "openai SDK not installed; install with `pip install datalex-cli[draft-openai]`."
            ) from exc

        messages: list[dict[str, str]] = [{"role": "system", "content": system}]
        for user_text, assistant_text in few_shot:
            messages.append({"role": "user", "content": user_text})
            messages.append({"role": "assistant", "content": assistant_text})
        messages.append({"role": "user", "content": user_message})

        client = OpenAI()
        response = client.chat.completions.create(
            model=model or DEFAULT_MODEL,
            messages=messages,  # type: ignore[arg-type]
            max_completion_tokens=max_tokens,
        )
        choice = response.choices[0]
        text = choice.message.content or ""
        usage = response.usage
        cache_read = 0
        if usage is not None:
            details = getattr(usage, "prompt_tokens_details", None)
            if details is not None:
                cache_read = getattr(details, "cached_tokens", 0) or 0
        return CompletionResult(
            text=text,
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
            cache_read_tokens=cache_read,
            provider=self.name,
            model=model or DEFAULT_MODEL,
        )
