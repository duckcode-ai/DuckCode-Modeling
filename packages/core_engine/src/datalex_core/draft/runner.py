"""Pure-function AI-assisted DataLex starter generation.

Takes a condensed dbt manifest dict (from `condense_manifest`) and returns a
schema-validated DataLex YAML string + a usage summary. The actual LLM call
is delegated to a `Provider` (Anthropic, OpenAI, Gemini, Ollama) — see
`providers/`. CLI argparse, filesystem I/O, and diff/print logic live in
`datalex_cli.main.cmd_draft` so this module stays testable and free of
side effects.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from datalex_core.draft.prompt import build_neutral_messages
from datalex_core.draft.providers import (
    CompletionResult,
    ProviderError,
    get_provider,
)

YAML_FENCE_RE = re.compile(r"```ya?ml\s*\n(.*?)\n```", re.DOTALL)


class DraftError(RuntimeError):
    """Raised when drafting fails: missing API key, malformed model output,
    or schema-validation failure on the produced YAML."""


def draft_starter(
    *,
    condensed: dict[str, Any],
    domain: str,
    owner: str,
    provider: str | None = None,
    model: str | None = None,
    max_tokens: int = 8000,
    schema_path: Path | None = None,
) -> tuple[str, dict[str, Any]]:
    """Produce a DataLex starter YAML + usage summary from a condensed dbt
    manifest. `provider` controls which LLM is called; pass None to
    auto-detect from the environment (Anthropic > OpenAI > Gemini > Ollama
    fallback)."""
    system, few_shot, user_message = build_neutral_messages(
        domain=domain, owner=owner, condensed=condensed,
    )

    try:
        chosen = get_provider(provider)
    except ProviderError as exc:
        raise DraftError(str(exc)) from exc

    try:
        completion: CompletionResult = chosen.complete(
            system=system,
            few_shot=few_shot,
            user_message=user_message,
            model=model or "",
            max_tokens=max_tokens,
        )
    except ProviderError as exc:
        raise DraftError(str(exc)) from exc

    match = YAML_FENCE_RE.search(completion.text)
    if not match:
        raise DraftError(
            f"model response did not contain a fenced YAML block. "
            f"Provider: {completion.provider}. Raw output: {completion.text[:1000]}"
        )
    yaml_text = match.group(1).strip() + "\n"

    parsed = _validate(yaml_text, schema_path)
    summary: dict[str, Any] = {
        "entities": len(parsed.get("entities") or []),
        "fields": sum(len(e.get("fields") or []) for e in (parsed.get("entities") or [])),
        "relationships": len(parsed.get("relationships") or []),
        "rules": len(parsed.get("rules") or []),
        "provider": completion.provider,
        "model": completion.model,
        "input_tokens": completion.input_tokens,
        "output_tokens": completion.output_tokens,
        "cache_read_tokens": completion.cache_read_tokens,
        "cache_write_tokens": completion.cache_write_tokens,
    }
    return yaml_text, summary


def _validate(yaml_text: str, schema_path: Path | None) -> dict[str, Any]:
    parsed = yaml.safe_load(yaml_text)
    if schema_path is None or not schema_path.exists():
        return parsed
    try:
        import jsonschema
    except ImportError:
        return parsed
    schema = json.loads(schema_path.read_text())
    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(parsed), key=lambda e: list(e.absolute_path))
    if errors:
        details = "\n".join(
            f"  {'.'.join(str(p) for p in err.absolute_path) or '<root>'}: {err.message}"
            for err in errors
        )
        raise DraftError(f"schema validation FAILED:\n{details}")
    return parsed
