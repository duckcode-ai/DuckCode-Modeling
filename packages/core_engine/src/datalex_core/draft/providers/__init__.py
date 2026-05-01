"""Provider factory for `datalex draft`.

Resolves a provider by explicit name or auto-detects from environment
variables. Auto-detect priority: ANTHROPIC_API_KEY > OPENAI_API_KEY >
GOOGLE_API_KEY/GEMINI_API_KEY > Ollama (always available locally).

Adding a new provider: drop a `<name>_provider.py` module under this
directory exporting a `Provider` subclass, then register it in
`PROVIDERS` below.
"""

from __future__ import annotations

import os
from typing import Callable

from datalex_core.draft.providers.anthropic_provider import AnthropicProvider
from datalex_core.draft.providers.base import (
    CompletionResult,
    Provider,
    ProviderError,
)
from datalex_core.draft.providers.gemini_provider import GeminiProvider
from datalex_core.draft.providers.ollama_provider import OllamaProvider
from datalex_core.draft.providers.openai_provider import OpenAIProvider


PROVIDERS: dict[str, Callable[[], Provider]] = {
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
    "gemini": GeminiProvider,
    "ollama": OllamaProvider,
}


AUTO_DETECT_ORDER: list[tuple[str, list[str]]] = [
    ("anthropic", ["ANTHROPIC_API_KEY"]),
    ("openai", ["OPENAI_API_KEY"]),
    ("gemini", ["GOOGLE_API_KEY", "GEMINI_API_KEY"]),
    # Ollama is always last — local-first, no key needed. Reachability is
    # verified at call time, not detect time, so we don't probe the socket
    # here. Users with no other key configured land on Ollama by default.
    ("ollama", []),
]


def detect_provider(env: dict[str, str] | None = None) -> str:
    """Pick a provider name from the environment when no --provider flag
    is passed. Order: Anthropic > OpenAI > Gemini > Ollama."""
    env = env if env is not None else os.environ
    for name, env_vars in AUTO_DETECT_ORDER:
        if not env_vars:
            return name  # Ollama default fallback
        if any(env.get(v) for v in env_vars):
            return name
    return "ollama"


def get_provider(name: str | None = None) -> Provider:
    """Resolve a Provider instance by explicit name or auto-detect."""
    chosen = (name or detect_provider()).lower()
    if chosen not in PROVIDERS:
        raise ProviderError(
            f"Unknown provider '{chosen}'. Available: {', '.join(sorted(PROVIDERS))}."
        )
    return PROVIDERS[chosen]()


__all__ = [
    "AUTO_DETECT_ORDER",
    "AnthropicProvider",
    "CompletionResult",
    "GeminiProvider",
    "OllamaProvider",
    "OpenAIProvider",
    "PROVIDERS",
    "Provider",
    "ProviderError",
    "detect_provider",
    "get_provider",
]
