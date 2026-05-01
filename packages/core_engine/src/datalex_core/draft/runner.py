"""Pure-function AI-assisted DataLex starter generation.

Takes a condensed dbt manifest dict (from `condense_manifest`) and returns a
schema-validated DataLex YAML string + a usage summary. CLI argparse,
filesystem I/O, and diff/print logic live in `datalex_cli.main.cmd_draft` so
this module stays testable and free of side effects.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import yaml

from datalex_core.draft.prompt import build_messages

YAML_FENCE_RE = re.compile(r"```ya?ml\s*\n(.*?)\n```", re.DOTALL)


class DraftError(RuntimeError):
    """Raised when drafting fails: missing API key, malformed model output,
    or schema-validation failure on the produced YAML."""


def draft_starter(
    *,
    condensed: dict[str, Any],
    domain: str,
    owner: str,
    model: str = "claude-opus-4-7",
    max_tokens: int = 8000,
    schema_path: Path | None = None,
) -> tuple[str, dict[str, Any]]:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise DraftError("ANTHROPIC_API_KEY not set in environment.")
    try:
        import anthropic
    except ImportError as exc:
        raise DraftError(
            "anthropic SDK not installed; install with `pip install datalex-cli[draft]`."
        ) from exc

    client = anthropic.Anthropic()
    system, messages = build_messages(domain=domain, owner=owner, condensed=condensed)
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    text = "".join(
        block.text for block in response.content if getattr(block, "type", "") == "text"
    )
    match = YAML_FENCE_RE.search(text)
    if not match:
        raise DraftError(
            "model response did not contain a fenced YAML block. "
            f"Raw output: {text[:1000]}"
        )
    yaml_text = match.group(1).strip() + "\n"

    parsed = _validate(yaml_text, schema_path)
    summary: dict[str, Any] = {
        "entities": len(parsed.get("entities") or []),
        "fields": sum(len(e.get("fields") or []) for e in (parsed.get("entities") or [])),
        "relationships": len(parsed.get("relationships") or []),
        "rules": len(parsed.get("rules") or []),
    }
    usage = getattr(response, "usage", None)
    if usage is not None:
        summary["input_tokens"] = getattr(usage, "input_tokens", 0)
        summary["output_tokens"] = getattr(usage, "output_tokens", 0)
        summary["cache_read_tokens"] = getattr(usage, "cache_read_input_tokens", 0) or 0
        summary["cache_write_tokens"] = getattr(usage, "cache_creation_input_tokens", 0) or 0
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
