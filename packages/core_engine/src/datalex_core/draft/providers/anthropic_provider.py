"""Anthropic provider for `datalex draft`.

Uses Anthropic's prompt-cache API: tags the system prompt + the last
few-shot block with `cache_control: ephemeral` so subsequent calls against
the same DataLex project pay only for the dynamic input portion. Default
model: claude-opus-4-7.
"""

from __future__ import annotations

import os
from typing import Any

from datalex_core.draft.providers.base import (
    CompletionResult,
    Provider,
    ProviderError,
)


DEFAULT_MODEL = "claude-opus-4-7"


class AnthropicProvider(Provider):
    name = "anthropic"

    def complete(
        self,
        *,
        system: str,
        few_shot: list[tuple[str, str]],
        user_message: str,
        model: str,
        max_tokens: int,
    ) -> CompletionResult:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise ProviderError("ANTHROPIC_API_KEY not set in environment.")
        try:
            import anthropic
        except ImportError as exc:
            raise ProviderError(
                "anthropic SDK not installed; install with `pip install datalex-cli[draft]`."
            ) from exc

        system_blocks: list[dict[str, Any]] = [
            {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
        ]

        few_shot_blocks: list[dict[str, Any]] = []
        for user_text, assistant_text in few_shot:
            few_shot_blocks.append(
                {
                    "type": "text",
                    "text": (
                        f"<example>\n<input>{user_text}</input>\n"
                        f"<output>{assistant_text}</output>\n</example>"
                    ),
                }
            )
        if few_shot_blocks:
            few_shot_blocks[-1]["cache_control"] = {"type": "ephemeral"}

        messages = [
            {
                "role": "user",
                "content": [
                    *few_shot_blocks,
                    {"type": "text", "text": user_message},
                ],
            }
        ]

        client = anthropic.Anthropic()
        response = client.messages.create(
            model=model or DEFAULT_MODEL,
            max_tokens=max_tokens,
            system=system_blocks,
            messages=messages,
        )
        text = "".join(
            block.text for block in response.content if getattr(block, "type", "") == "text"
        )
        usage = getattr(response, "usage", None)
        return CompletionResult(
            text=text,
            input_tokens=getattr(usage, "input_tokens", 0) if usage else 0,
            output_tokens=getattr(usage, "output_tokens", 0) if usage else 0,
            cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0 if usage else 0,
            cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0 if usage else 0,
            provider=self.name,
            model=model or DEFAULT_MODEL,
        )
