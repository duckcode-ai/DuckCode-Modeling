"""Smoke tests for the multi-provider draft pipeline.

Each provider is tested at the message-shape level using monkey-patched
SDK stand-ins, so we don't require the real anthropic/openai/genai/ollama
packages to be installed in the CI environment. The end-to-end "send to
the live API" path is user-driven — see scripts/draft/README.md.
"""

import os
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(
    0, str(Path(__file__).resolve().parent.parent / "packages" / "core_engine" / "src"),
)

from datalex_core.draft.providers import (
    AUTO_DETECT_ORDER,
    PROVIDERS,
    detect_provider,
    get_provider,
)
from datalex_core.draft.providers.anthropic_provider import AnthropicProvider
from datalex_core.draft.providers.base import (
    CompletionResult,
    Provider,
    ProviderError,
)
from datalex_core.draft.providers.gemini_provider import GeminiProvider
from datalex_core.draft.providers.ollama_provider import OllamaProvider
from datalex_core.draft.providers.openai_provider import OpenAIProvider


# ---------------------------------------------------------------- factory --

def test_factory_returns_explicit_provider_by_name():
    p = get_provider("openai")
    assert isinstance(p, OpenAIProvider)
    p = get_provider("anthropic")
    assert isinstance(p, AnthropicProvider)
    p = get_provider("gemini")
    assert isinstance(p, GeminiProvider)
    p = get_provider("ollama")
    assert isinstance(p, OllamaProvider)


def test_factory_rejects_unknown_provider_name():
    with pytest.raises(ProviderError, match="Unknown provider"):
        get_provider("not-a-real-provider")


def test_detect_provider_picks_anthropic_when_only_its_key_is_set():
    env = {"ANTHROPIC_API_KEY": "sk-ant"}
    assert detect_provider(env) == "anthropic"


def test_detect_provider_picks_openai_when_only_openai_key_is_set():
    env = {"OPENAI_API_KEY": "sk-openai"}
    assert detect_provider(env) == "openai"


def test_detect_provider_picks_gemini_when_only_google_key_is_set():
    env = {"GOOGLE_API_KEY": "ga-1"}
    assert detect_provider(env) == "gemini"


def test_detect_provider_recognizes_alternate_gemini_env_var_name():
    env = {"GEMINI_API_KEY": "ga-1"}
    assert detect_provider(env) == "gemini"


def test_detect_provider_falls_back_to_ollama_when_no_key_is_set():
    assert detect_provider({}) == "ollama"


def test_detect_provider_priority_order():
    """Anthropic > OpenAI > Gemini > Ollama. Confirms the auto-detect
    table. If you add a new provider, add a test row here."""
    assert AUTO_DETECT_ORDER[0][0] == "anthropic"
    assert AUTO_DETECT_ORDER[1][0] == "openai"
    assert AUTO_DETECT_ORDER[2][0] == "gemini"
    assert AUTO_DETECT_ORDER[-1][0] == "ollama"


def test_factory_passes_through_explicit_choice_even_when_other_keys_set(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    p = get_provider("ollama")  # explicit beats auto-detect
    assert isinstance(p, OllamaProvider)


def test_providers_table_exposes_all_four():
    assert set(PROVIDERS) == {"anthropic", "openai", "gemini", "ollama"}
    for name, cls in PROVIDERS.items():
        instance = cls()
        assert isinstance(instance, Provider)
        assert instance.name == name


# ----------------------------------------------------- per-provider shapes --

def test_anthropic_missing_api_key_raises_provider_error(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ProviderError, match="ANTHROPIC_API_KEY"):
        AnthropicProvider().complete(
            system="s", few_shot=[], user_message="u", model="", max_tokens=10,
        )


def test_anthropic_marks_system_with_cache_control(monkeypatch):
    """Anthropic SDK is mocked at module-import boundary so we can assert
    the message shape without hitting the network."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")

    captured: dict[str, Any] = {}

    class FakeUsage:
        input_tokens = 100
        output_tokens = 50
        cache_read_input_tokens = 80
        cache_creation_input_tokens = 0

    class FakeBlock:
        type = "text"
        text = "hello"

    class FakeResponse:
        content = [FakeBlock()]
        usage = FakeUsage()

    class FakeMessages:
        def create(self, **kwargs: Any) -> FakeResponse:
            captured.update(kwargs)
            return FakeResponse()

    class FakeAnthropic:
        def __init__(self) -> None:
            self.messages = FakeMessages()

    fake_module = type(sys)("anthropic")
    fake_module.Anthropic = FakeAnthropic  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "anthropic", fake_module)

    result = AnthropicProvider().complete(
        system="SYS",
        few_shot=[("u1", "a1"), ("u2", "a2")],
        user_message="USER",
        model="claude-opus-4-7",
        max_tokens=512,
    )
    assert result.text == "hello"
    assert result.cache_read_tokens == 80
    assert captured["model"] == "claude-opus-4-7"
    # System should be a list with cache_control on the only block.
    assert isinstance(captured["system"], list)
    assert captured["system"][0]["cache_control"] == {"type": "ephemeral"}
    # Last few-shot block must carry cache_control too (prompt-cache hint).
    last_fs_block = captured["messages"][0]["content"][1]
    assert last_fs_block.get("cache_control") == {"type": "ephemeral"}


def test_openai_missing_api_key_raises_provider_error(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ProviderError, match="OPENAI_API_KEY"):
        OpenAIProvider().complete(
            system="s", few_shot=[], user_message="u", model="", max_tokens=10,
        )


def test_openai_builds_alternating_role_messages(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    captured: dict[str, Any] = {}

    class FakeChoice:
        class message:
            content = "openai-reply"
        message = message()

    class FakeUsageDetails:
        cached_tokens = 32

    class FakeUsage:
        prompt_tokens = 200
        completion_tokens = 100
        prompt_tokens_details = FakeUsageDetails()

    class FakeResponse:
        choices = [FakeChoice()]
        usage = FakeUsage()

    class FakeChat:
        def __init__(self) -> None:
            self.completions = self
        def create(self, **kwargs: Any) -> FakeResponse:
            captured.update(kwargs)
            return FakeResponse()

    class FakeOpenAI:
        def __init__(self) -> None:
            self.chat = FakeChat()

    fake_module = type(sys)("openai")
    fake_module.OpenAI = FakeOpenAI  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "openai", fake_module)

    result = OpenAIProvider().complete(
        system="SYS",
        few_shot=[("u1", "a1"), ("u2", "a2")],
        user_message="USER",
        model="gpt-4.1",
        max_tokens=256,
    )
    assert result.text == "openai-reply"
    assert result.cache_read_tokens == 32
    msgs = captured["messages"]
    assert msgs[0] == {"role": "system", "content": "SYS"}
    assert msgs[1] == {"role": "user", "content": "u1"}
    assert msgs[2] == {"role": "assistant", "content": "a1"}
    assert msgs[3] == {"role": "user", "content": "u2"}
    assert msgs[4] == {"role": "assistant", "content": "a2"}
    assert msgs[5] == {"role": "user", "content": "USER"}


def test_gemini_missing_api_key_raises_provider_error(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(ProviderError, match="GOOGLE_API_KEY"):
        GeminiProvider().complete(
            system="s", few_shot=[], user_message="u", model="", max_tokens=10,
        )


def test_gemini_builds_history_with_system_instruction(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "ga-1")
    captured: dict[str, Any] = {}

    class FakeUsage:
        prompt_token_count = 150
        candidates_token_count = 75
        cached_content_token_count = 0

    class FakeResponse:
        text = "gemini-reply"
        usage_metadata = FakeUsage()

    class FakeChat:
        def send_message(self, msg: str, generation_config: dict[str, Any]) -> FakeResponse:
            captured["user_message"] = msg
            captured["generation_config"] = generation_config
            return FakeResponse()

    class FakeModel:
        def __init__(self, model_name: str, system_instruction: str) -> None:
            captured["model_name"] = model_name
            captured["system_instruction"] = system_instruction
        def start_chat(self, history: list[dict[str, Any]]) -> FakeChat:
            captured["history"] = history
            return FakeChat()

    fake_module = type(sys)("google.generativeai")
    fake_module.configure = lambda api_key: captured.setdefault("api_key", api_key)  # type: ignore[attr-defined]
    fake_module.GenerativeModel = FakeModel  # type: ignore[attr-defined]
    parent = type(sys)("google")
    parent.generativeai = fake_module  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "google", parent)
    monkeypatch.setitem(sys.modules, "google.generativeai", fake_module)

    result = GeminiProvider().complete(
        system="SYS",
        few_shot=[("u1", "a1"), ("u2", "a2")],
        user_message="USER",
        model="gemini-2.5-pro",
        max_tokens=128,
    )
    assert result.text == "gemini-reply"
    assert captured["model_name"] == "gemini-2.5-pro"
    assert captured["system_instruction"] == "SYS"
    assert captured["history"][0] == {"role": "user", "parts": ["u1"]}
    assert captured["history"][1] == {"role": "model", "parts": ["a1"]}
    assert captured["user_message"] == "USER"


def test_ollama_posts_chat_payload_via_urllib(monkeypatch):
    """The Ollama provider speaks plain HTTP — no SDK install. Patch
    urlopen at the module level."""
    monkeypatch.setenv("OLLAMA_HOST", "http://ollama.local:11434")
    captured: dict[str, Any] = {}

    class FakeResponse:
        def read(self) -> bytes:
            import json
            return json.dumps(
                {
                    "message": {"content": "ollama-reply"},
                    "prompt_eval_count": 25,
                    "eval_count": 12,
                }
            ).encode("utf-8")
        def __enter__(self):
            return self
        def __exit__(self, *args: Any) -> None:
            pass

    def fake_urlopen(req: Any, timeout: int = 0) -> FakeResponse:
        captured["url"] = req.full_url
        captured["data"] = req.data
        captured["timeout"] = timeout
        return FakeResponse()

    import datalex_core.draft.providers.ollama_provider as ollama_mod
    monkeypatch.setattr(ollama_mod, "urlopen", fake_urlopen)

    result = OllamaProvider().complete(
        system="SYS",
        few_shot=[("u1", "a1")],
        user_message="USER",
        model="llama3.1:8b",
        max_tokens=64,
    )
    assert result.text == "ollama-reply"
    assert result.input_tokens == 25
    assert result.output_tokens == 12
    assert captured["url"] == "http://ollama.local:11434/api/chat"
    import json
    payload = json.loads(captured["data"])
    assert payload["model"] == "llama3.1:8b"
    assert payload["stream"] is False
    assert payload["options"]["num_predict"] == 64
    assert payload["messages"][0] == {"role": "system", "content": "SYS"}
    assert payload["messages"][-1] == {"role": "user", "content": "USER"}


def test_ollama_default_host_is_localhost_when_env_unset(monkeypatch):
    monkeypatch.delenv("OLLAMA_HOST", raising=False)
    captured: dict[str, str] = {}

    class FakeResponse:
        def read(self) -> bytes:
            import json
            return json.dumps({"message": {"content": "ok"}}).encode("utf-8")
        def __enter__(self):
            return self
        def __exit__(self, *args: Any) -> None:
            pass

    def fake_urlopen(req: Any, timeout: int = 0) -> FakeResponse:
        captured["url"] = req.full_url
        return FakeResponse()

    import datalex_core.draft.providers.ollama_provider as ollama_mod
    monkeypatch.setattr(ollama_mod, "urlopen", fake_urlopen)

    OllamaProvider().complete(
        system="x", few_shot=[], user_message="x", model="", max_tokens=1,
    )
    assert captured["url"].startswith("http://127.0.0.1:11434")
