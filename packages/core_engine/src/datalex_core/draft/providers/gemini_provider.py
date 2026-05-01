"""Gemini provider for `datalex draft`.

Uses google-generativeai. System prompt goes through the dedicated
`system_instruction` parameter; few-shot pairs become alternating
user/model `Content` entries; user message is the final user content.
Default model: gemini-2.5-pro. Skips explicit context-caching API for
v1 — keeps the implementation simple; can revisit when adoption demand
shows up.
"""

from __future__ import annotations

import os

from datalex_core.draft.providers.base import (
    CompletionResult,
    Provider,
    ProviderError,
)


DEFAULT_MODEL = "gemini-2.5-pro"


class GeminiProvider(Provider):
    name = "gemini"

    def complete(
        self,
        *,
        system: str,
        few_shot: list[tuple[str, str]],
        user_message: str,
        model: str,
        max_tokens: int,
    ) -> CompletionResult:
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ProviderError("GOOGLE_API_KEY (or GEMINI_API_KEY) not set in environment.")
        try:
            import google.generativeai as genai
        except ImportError as exc:
            raise ProviderError(
                "google-generativeai SDK not installed; install with "
                "`pip install datalex-cli[draft-gemini]`."
            ) from exc

        genai.configure(api_key=api_key)
        gemini_model = genai.GenerativeModel(
            model_name=model or DEFAULT_MODEL,
            system_instruction=system,
        )

        history = []
        for user_text, assistant_text in few_shot:
            history.append({"role": "user", "parts": [user_text]})
            history.append({"role": "model", "parts": [assistant_text]})

        chat = gemini_model.start_chat(history=history)
        response = chat.send_message(
            user_message,
            generation_config={"max_output_tokens": max_tokens},
        )
        text = getattr(response, "text", "") or ""
        usage = getattr(response, "usage_metadata", None)
        return CompletionResult(
            text=text,
            input_tokens=getattr(usage, "prompt_token_count", 0) if usage else 0,
            output_tokens=getattr(usage, "candidates_token_count", 0) if usage else 0,
            cache_read_tokens=getattr(usage, "cached_content_token_count", 0) or 0 if usage else 0,
            provider=self.name,
            model=model or DEFAULT_MODEL,
        )
