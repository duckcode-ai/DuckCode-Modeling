import json
from pathlib import Path
from typing import Any, Dict, List

from jsonschema import Draft202012Validator

from dm_core.issues import Issue


def load_schema(schema_path: str) -> Dict[str, Any]:
    path = Path(schema_path)
    if not path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _to_json_path(parts: List[Any]) -> str:
    if not parts:
        return "/"
    formatted = []
    for part in parts:
        formatted.append(str(part))
    return "/" + "/".join(formatted)


def schema_issues(model: Dict[str, Any], schema: Dict[str, Any]) -> List[Issue]:
    validator = Draft202012Validator(schema)
    issues: List[Issue] = []

    for error in sorted(validator.iter_errors(model), key=lambda e: list(e.absolute_path)):
        issues.append(
            Issue(
                severity="error",
                code="SCHEMA_VALIDATION_FAILED",
                message=error.message,
                path=_to_json_path(list(error.absolute_path)),
            )
        )

    return issues
