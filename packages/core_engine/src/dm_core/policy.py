import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

import yaml

from dm_core.issues import Issue


def load_policy_pack(path: str) -> Dict[str, Any]:
    policy_path = Path(path)
    if not policy_path.exists():
        raise FileNotFoundError(f"Policy pack not found: {path}")

    with policy_path.open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)

    if loaded is None:
        return {}

    if not isinstance(loaded, dict):
        raise ValueError("Policy pack must parse to a YAML object at root.")

    return loaded


def _policy_issue(severity: str, code: str, message: str, path: str = "/") -> Issue:
    return Issue(severity=severity, code=code, message=message, path=path)


def _normalize_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value]
    return []


def _field_refs(model: Dict[str, Any]) -> Set[str]:
    refs: Set[str] = set()
    for entity in model.get("entities", []):
        entity_name = entity.get("name", "")
        for field in entity.get("fields", []):
            field_name = field.get("name", "")
            if entity_name and field_name:
                refs.add(f"{entity_name}.{field_name}")
    return refs


def _classification(model: Dict[str, Any]) -> Dict[str, str]:
    governance = model.get("governance", {})
    classification = governance.get("classification", {})
    if isinstance(classification, dict):
        return {str(k): str(v) for k, v in classification.items()}
    return {}


def _require_entity_tags(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    required_tags = set(_normalize_list(params.get("tags")))
    mode = str(params.get("mode", "any")).lower()

    if not required_tags:
        return [
            _policy_issue(
                "error",
                f"POLICY_{policy_id}_MISCONFIGURED",
                f"Policy '{policy_id}' must define at least one required tag.",
                "/policies",
            )
        ]

    issues: List[Issue] = []
    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        entity_tags = set(_normalize_list(entity.get("tags", [])))

        if mode == "all":
            matches = required_tags.issubset(entity_tags)
        else:
            matches = bool(required_tags.intersection(entity_tags))

        if not matches:
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    (
                        f"Entity '{entity_name}' must include "
                        f"{'all' if mode == 'all' else 'at least one'} of tags {sorted(required_tags)}."
                    ),
                    f"/entities/{entity_name}",
                )
            )

    return issues


def _require_field_descriptions(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    exempt_primary_key = bool(params.get("exempt_primary_key", True))
    issues: List[Issue] = []

    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        for field in entity.get("fields", []):
            field_name = str(field.get("name", ""))
            if exempt_primary_key and field.get("primary_key") is True:
                continue
            description = field.get("description")
            if not isinstance(description, str) or not description.strip():
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Field '{entity_name}.{field_name}' is missing a description.",
                        f"/entities/{entity_name}/fields/{field_name}",
                    )
                )

    return issues


def _classification_required_for_tags(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    tracked_tags = set(_normalize_list(params.get("field_tags")))
    allowed_classifications = set(_normalize_list(params.get("allowed_classifications")))
    name_regex = params.get("field_name_regex")

    compiled_pattern: Optional[re.Pattern[str]] = None
    if isinstance(name_regex, str) and name_regex.strip():
        try:
            compiled_pattern = re.compile(name_regex)
        except re.error:
            return [
                _policy_issue(
                    "error",
                    f"POLICY_{policy_id}_MISCONFIGURED",
                    f"Policy '{policy_id}' has invalid regex '{name_regex}'.",
                    "/policies",
                )
            ]

    classification = _classification(model)
    issues: List[Issue] = []

    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        for field in entity.get("fields", []):
            field_name = str(field.get("name", ""))
            ref = f"{entity_name}.{field_name}"
            field_tags = set(_normalize_list(field.get("tags")))

            by_tag = bool(tracked_tags and tracked_tags.intersection(field_tags))
            by_name = bool(compiled_pattern and compiled_pattern.search(field_name))
            if not by_tag and not by_name:
                continue

            value = classification.get(ref)
            if value is None:
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Field '{ref}' requires governance.classification.",
                        "/governance/classification",
                    )
                )
                continue

            if allowed_classifications and value not in allowed_classifications:
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        (
                            f"Field '{ref}' classification '{value}' is not allowed. "
                            f"Expected one of {sorted(allowed_classifications)}."
                        ),
                        "/governance/classification",
                    )
                )

    return issues


def _rule_target_required(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    target_types = set(_normalize_list(params.get("field_types")))
    refs = _field_refs(model)
    rule_targets = {
        str(rule.get("target", ""))
        for rule in model.get("rules", [])
        if isinstance(rule, dict)
    }

    issues: List[Issue] = []
    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        for field in entity.get("fields", []):
            field_name = str(field.get("name", ""))
            ref = f"{entity_name}.{field_name}"
            if ref not in refs:
                continue

            field_type = str(field.get("type", "")).lower()
            if target_types and field_type not in target_types:
                continue

            if ref not in rule_targets:
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Field '{ref}' requires at least one rule target entry.",
                        "/rules",
                    )
                )

    return issues


_POLICY_HANDLERS = {
    "require_entity_tags": _require_entity_tags,
    "require_field_descriptions": _require_field_descriptions,
    "classification_required_for_tags": _classification_required_for_tags,
    "rule_target_required": _rule_target_required,
}


def policy_issues(model: Dict[str, Any], policy_pack: Dict[str, Any]) -> List[Issue]:
    policies = policy_pack.get("policies", [])
    if not isinstance(policies, list):
        return [
            _policy_issue(
                "error",
                "INVALID_POLICY_PACK",
                "Policy pack requires a list at root key 'policies'.",
                "/policies",
            )
        ]

    issues: List[Issue] = []
    for index, policy in enumerate(policies):
        if not isinstance(policy, dict):
            issues.append(
                _policy_issue(
                    "error",
                    "INVALID_POLICY",
                    f"Policy at index {index} must be an object.",
                    f"/policies/{index}",
                )
            )
            continue

        enabled = bool(policy.get("enabled", True))
        if not enabled:
            continue

        policy_id = str(policy.get("id") or f"POLICY_{index + 1}")
        policy_type = str(policy.get("type", "")).strip()
        severity = str(policy.get("severity", "error")).lower()
        params = policy.get("params", {})

        if severity not in {"info", "warn", "error"}:
            issues.append(
                _policy_issue(
                    "error",
                    f"POLICY_{policy_id}_MISCONFIGURED",
                    f"Policy '{policy_id}' has invalid severity '{severity}'.",
                    f"/policies/{index}",
                )
            )
            continue

        if not isinstance(params, dict):
            issues.append(
                _policy_issue(
                    "error",
                    f"POLICY_{policy_id}_MISCONFIGURED",
                    f"Policy '{policy_id}' params must be an object.",
                    f"/policies/{index}/params",
                )
            )
            continue

        handler = _POLICY_HANDLERS.get(policy_type)
        if handler is None:
            issues.append(
                _policy_issue(
                    "warn",
                    f"POLICY_{policy_id}_UNKNOWN_TYPE",
                    f"Unknown policy type '{policy_type}' skipped.",
                    f"/policies/{index}/type",
                )
            )
            continue

        issues.extend(handler(model=model, severity=severity, policy_id=policy_id, params=params))

    return issues
