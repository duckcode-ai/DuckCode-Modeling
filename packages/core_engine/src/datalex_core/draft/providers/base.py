"""Provider abstraction for `datalex draft`.

Each concrete provider (Anthropic, OpenAI, Gemini, Ollama) translates a
neutral message format — system + few-shot pairs + user message — into the
provider's native API and returns a `CompletionResult`. This keeps
`runner.py` provider-agnostic: it just builds the messages and the chosen
provider does the rest.

Caching is left as a per-provider concern. Anthropic uses explicit
`cache_control` markers; OpenAI auto-caches prefixes >1024 tokens; Gemini
has its own context-caching API; Ollama doesn't cache. Each provider does
what it can.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class CompletionResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    provider: str = ""
    model: str = ""


class ProviderError(RuntimeError):
    """Raised when a provider can't fulfill a request — missing API key,
    SDK not installed, transport error, model rejected the request, etc."""


class Provider(ABC):
    """Common surface every provider implements."""

    name: str

    @abstractmethod
    def complete(
        self,
        *,
        system: str,
        few_shot: list[tuple[str, str]],
        user_message: str,
        model: str,
        max_tokens: int,
    ) -> CompletionResult:
        ...
