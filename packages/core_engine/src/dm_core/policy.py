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


def _naming_convention(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    entity_pattern_str = params.get("entity_pattern")
    field_pattern_str = params.get("field_pattern")
    relationship_pattern_str = params.get("relationship_pattern")
    index_pattern_str = params.get("index_pattern")

    patterns: Dict[str, Optional[re.Pattern[str]]] = {}
    issues: List[Issue] = []

    for label, pat_str in [
        ("entity_pattern", entity_pattern_str),
        ("field_pattern", field_pattern_str),
        ("relationship_pattern", relationship_pattern_str),
        ("index_pattern", index_pattern_str),
    ]:
        if pat_str is None:
            patterns[label] = None
            continue
        if not isinstance(pat_str, str) or not pat_str.strip():
            patterns[label] = None
            continue
        try:
            patterns[label] = re.compile(pat_str)
        except re.error:
            return [
                _policy_issue(
                    "error",
                    f"POLICY_{policy_id}_MISCONFIGURED",
                    f"Policy '{policy_id}' has invalid regex for {label}: '{pat_str}'.",
                    "/policies",
                )
            ]

    if not any(patterns.values()):
        return [
            _policy_issue(
                "error",
                f"POLICY_{policy_id}_MISCONFIGURED",
                f"Policy '{policy_id}' must define at least one naming pattern (entity_pattern, field_pattern, relationship_pattern, index_pattern).",
                "/policies",
            )
        ]

    ep = patterns.get("entity_pattern")
    fp = patterns.get("field_pattern")
    rp = patterns.get("relationship_pattern")
    ip = patterns.get("index_pattern")

    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        if ep and not ep.fullmatch(entity_name):
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity name '{entity_name}' does not match pattern '{entity_pattern_str}'.",
                    f"/entities/{entity_name}",
                )
            )
        if fp:
            for field in entity.get("fields", []):
                field_name = str(field.get("name", ""))
                if not fp.fullmatch(field_name):
                    issues.append(
                        _policy_issue(
                            severity,
                            f"POLICY_{policy_id}",
                            f"Field name '{entity_name}.{field_name}' does not match pattern '{field_pattern_str}'.",
                            f"/entities/{entity_name}/fields/{field_name}",
                        )
                    )

    if rp:
        for rel in model.get("relationships", []):
            rel_name = str(rel.get("name", ""))
            if not rp.fullmatch(rel_name):
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Relationship name '{rel_name}' does not match pattern '{relationship_pattern_str}'.",
                        f"/relationships/{rel_name}",
                    )
                )

    if ip:
        for idx in model.get("indexes", []):
            idx_name = str(idx.get("name", ""))
            if not ip.fullmatch(idx_name):
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Index name '{idx_name}' does not match pattern '{index_pattern_str}'.",
                        f"/indexes/{idx_name}",
                    )
                )

    return issues


def _require_indexes(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    min_fields = int(params.get("min_fields", 5))
    entity_types = set(_normalize_list(params.get("entity_types", ["table"])))

    indexed_entities: Set[str] = set()
    for idx in model.get("indexes", []):
        ent = str(idx.get("entity", ""))
        if ent:
            indexed_entities.add(ent)

    issues: List[Issue] = []
    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        entity_type = str(entity.get("type", "table")).lower()
        if entity_types and entity_type not in entity_types:
            continue
        field_count = len(entity.get("fields", []))
        if field_count >= min_fields and entity_name not in indexed_entities:
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{entity_name}' has {field_count} fields (>= {min_fields}) but no indexes defined.",
                    f"/entities/{entity_name}",
                )
            )

    return issues


def _require_owner(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    entity_types = set(_normalize_list(params.get("entity_types", [])))
    require_email = bool(params.get("require_email", False))
    email_pattern = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

    issues: List[Issue] = []
    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        entity_type = str(entity.get("type", "table")).lower()
        if entity_types and entity_type not in entity_types:
            continue

        owner = entity.get("owner")
        if not owner or (isinstance(owner, str) and not owner.strip()):
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{entity_name}' is missing an owner.",
                    f"/entities/{entity_name}",
                )
            )
        elif require_email and isinstance(owner, str) and not email_pattern.match(owner.strip()):
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{entity_name}' owner '{owner}' is not a valid email address.",
                    f"/entities/{entity_name}",
                )
            )

    return issues


def _require_sla(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    entity_types = set(_normalize_list(params.get("entity_types", ["table"])))
    required_tags = set(_normalize_list(params.get("required_tags", [])))
    require_freshness = bool(params.get("require_freshness", True))
    require_quality_score = bool(params.get("require_quality_score", False))

    issues: List[Issue] = []
    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        entity_type = str(entity.get("type", "table")).lower()
        entity_tags = set(_normalize_list(entity.get("tags", [])))

        if entity_types and entity_type not in entity_types:
            continue
        if required_tags and not required_tags.intersection(entity_tags):
            continue

        sla = entity.get("sla")
        if not isinstance(sla, dict) or not sla:
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{entity_name}' is missing an SLA definition.",
                    f"/entities/{entity_name}/sla",
                )
            )
            continue

        if require_freshness and not sla.get("freshness"):
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{entity_name}' SLA is missing 'freshness'.",
                    f"/entities/{entity_name}/sla",
                )
            )

        if require_quality_score and sla.get("quality_score") is None:
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{entity_name}' SLA is missing 'quality_score'.",
                    f"/entities/{entity_name}/sla",
                )
            )

    return issues


def _deprecation_check(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    require_message = bool(params.get("require_message", True))
    check_references = bool(params.get("check_references", True))

    deprecated_fields: Set[str] = set()
    issues: List[Issue] = []

    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        for field in entity.get("fields", []):
            field_name = str(field.get("name", ""))
            if field.get("deprecated") is True:
                ref = f"{entity_name}.{field_name}"
                deprecated_fields.add(ref)
                if require_message:
                    msg = field.get("deprecated_message")
                    if not isinstance(msg, str) or not msg.strip():
                        issues.append(
                            _policy_issue(
                                severity,
                                f"POLICY_{policy_id}",
                                f"Deprecated field '{ref}' is missing a deprecated_message with migration guidance.",
                                f"/entities/{entity_name}/fields/{field_name}",
                            )
                        )

    if check_references and deprecated_fields:
        for rel in model.get("relationships", []):
            rel_name = str(rel.get("name", ""))
            from_ref = str(rel.get("from", ""))
            to_ref = str(rel.get("to", ""))
            if from_ref in deprecated_fields:
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Relationship '{rel_name}' references deprecated field '{from_ref}'.",
                        f"/relationships/{rel_name}",
                    )
                )
            if to_ref in deprecated_fields:
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Relationship '{rel_name}' references deprecated field '{to_ref}'.",
                        f"/relationships/{rel_name}",
                    )
                )

        for idx in model.get("indexes", []):
            idx_name = str(idx.get("name", ""))
            idx_entity = str(idx.get("entity", ""))
            for idx_field in _normalize_list(idx.get("fields", [])):
                ref = f"{idx_entity}.{idx_field}"
                if ref in deprecated_fields:
                    issues.append(
                        _policy_issue(
                            severity,
                            f"POLICY_{policy_id}",
                            f"Index '{idx_name}' references deprecated field '{ref}'.",
                            f"/indexes/{idx_name}",
                        )
                    )

    return issues


def _custom_expression(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    scope = str(params.get("scope", "entity")).lower()
    expression = str(params.get("expression", "")).strip()
    message_template = str(params.get("message", "")).strip()

    if not expression:
        return [
            _policy_issue(
                "error",
                f"POLICY_{policy_id}_MISCONFIGURED",
                f"Policy '{policy_id}' must define an 'expression'.",
                "/policies",
            )
        ]

    issues: List[Issue] = []

    if scope == "entity":
        for entity in model.get("entities", []):
            entity_name = str(entity.get("name", ""))
            ctx = {
                "name": entity_name,
                "type": str(entity.get("type", "table")),
                "tags": _normalize_list(entity.get("tags", [])),
                "field_count": len(entity.get("fields", [])),
                "has_owner": bool(entity.get("owner")),
                "has_sla": bool(entity.get("sla")),
                "has_description": bool(entity.get("description")),
                "schema": str(entity.get("schema", "")),
                "subject_area": str(entity.get("subject_area", "")),
            }
            try:
                result = eval(expression, {"__builtins__": {}}, ctx)  # noqa: S307
            except Exception:
                return [
                    _policy_issue(
                        "error",
                        f"POLICY_{policy_id}_MISCONFIGURED",
                        f"Policy '{policy_id}' expression failed for entity '{entity_name}': '{expression}'.",
                        "/policies",
                    )
                ]
            if not result:
                msg = message_template.replace("{name}", entity_name) if message_template else (
                    f"Entity '{entity_name}' failed custom policy check: {expression}"
                )
                issues.append(
                    _policy_issue(severity, f"POLICY_{policy_id}", msg, f"/entities/{entity_name}")
                )

    elif scope == "field":
        for entity in model.get("entities", []):
            entity_name = str(entity.get("name", ""))
            for field in entity.get("fields", []):
                field_name = str(field.get("name", ""))
                ref = f"{entity_name}.{field_name}"
                ctx = {
                    "name": field_name,
                    "entity": entity_name,
                    "type": str(field.get("type", "")),
                    "nullable": bool(field.get("nullable", True)),
                    "primary_key": bool(field.get("primary_key", False)),
                    "unique": bool(field.get("unique", False)),
                    "has_description": bool(field.get("description")),
                    "deprecated": bool(field.get("deprecated", False)),
                    "sensitivity": str(field.get("sensitivity", "")),
                    "has_default": field.get("default") is not None,
                    "has_check": bool(field.get("check")),
                    "computed": bool(field.get("computed", False)),
                    "foreign_key": bool(field.get("foreign_key", False)),
                    "tags": _normalize_list(field.get("tags", [])),
                }
                try:
                    result = eval(expression, {"__builtins__": {}}, ctx)  # noqa: S307
                except Exception:
                    return [
                        _policy_issue(
                            "error",
                            f"POLICY_{policy_id}_MISCONFIGURED",
                            f"Policy '{policy_id}' expression failed for field '{ref}': '{expression}'.",
                            "/policies",
                        )
                    ]
                if not result:
                    msg = message_template.replace("{name}", ref) if message_template else (
                        f"Field '{ref}' failed custom policy check: {expression}"
                    )
                    issues.append(
                        _policy_issue(
                            severity, f"POLICY_{policy_id}", msg,
                            f"/entities/{entity_name}/fields/{field_name}",
                        )
                    )

    elif scope == "model":
        model_meta = model.get("model", {})
        ctx = {
            "name": str(model_meta.get("name", "")),
            "version": str(model_meta.get("version", "")),
            "domain": str(model_meta.get("domain", "")),
            "state": str(model_meta.get("state", "")),
            "layer": str(model_meta.get("layer", "")),
            "entity_count": len(model.get("entities", [])),
            "relationship_count": len(model.get("relationships", [])),
            "index_count": len(model.get("indexes", [])),
            "metric_count": len(model.get("metrics", [])),
            "has_governance": bool(model.get("governance")),
            "has_glossary": bool(model.get("glossary")),
            "has_rules": bool(model.get("rules")),
            "has_metrics": bool(model.get("metrics")),
        }
        try:
            result = eval(expression, {"__builtins__": {}}, ctx)  # noqa: S307
        except Exception:
            return [
                _policy_issue(
                    "error",
                    f"POLICY_{policy_id}_MISCONFIGURED",
                    f"Policy '{policy_id}' expression failed: '{expression}'.",
                    "/policies",
                )
            ]
        if not result:
            msg = message_template.replace("{name}", ctx["name"]) if message_template else (
                f"Model failed custom policy check: {expression}"
            )
            issues.append(_policy_issue(severity, f"POLICY_{policy_id}", msg, "/model"))

    else:
        return [
            _policy_issue(
                "error",
                f"POLICY_{policy_id}_MISCONFIGURED",
                f"Policy '{policy_id}' has invalid scope '{scope}'. Expected 'entity', 'field', or 'model'.",
                "/policies",
            )
        ]

    return issues


_POLICY_HANDLERS = {
    "require_entity_tags": _require_entity_tags,
    "require_field_descriptions": _require_field_descriptions,
    "classification_required_for_tags": _classification_required_for_tags,
    "rule_target_required": _rule_target_required,
    "naming_convention": _naming_convention,
    "require_indexes": _require_indexes,
    "require_owner": _require_owner,
    "require_sla": _require_sla,
    "deprecation_check": _deprecation_check,
    "custom_expression": _custom_expression,
}


def merge_policy_packs(*packs: Dict[str, Any]) -> Dict[str, Any]:
    """Merge multiple policy packs with later packs overriding earlier ones.

    Policies are merged by ``id``: if two packs define a policy with the same
    ``id``, the later definition wins (full replacement).  Policies with unique
    ids are appended.  The ``pack`` metadata comes from the **last** pack.
    """
    if not packs:
        return {"pack": {"name": "merged", "version": "1.0.0"}, "policies": []}

    merged_pack_meta: Dict[str, Any] = {}
    policy_map: Dict[str, Dict[str, Any]] = {}  # keyed by policy id
    order: List[str] = []

    for pack in packs:
        if not isinstance(pack, dict):
            continue
        pack_meta = pack.get("pack")
        if isinstance(pack_meta, dict):
            merged_pack_meta = pack_meta

        for policy in pack.get("policies", []):
            if not isinstance(policy, dict):
                continue
            pid = str(policy.get("id", ""))
            if not pid:
                continue
            if pid not in policy_map:
                order.append(pid)
            policy_map[pid] = policy

    return {
        "pack": merged_pack_meta or {"name": "merged", "version": "1.0.0"},
        "policies": [policy_map[pid] for pid in order if pid in policy_map],
    }


def load_policy_pack_with_inheritance(path: str) -> Dict[str, Any]:
    """Load a policy pack, resolving ``pack.extends`` references.

    If the pack defines ``pack.extends`` (a string path or list of paths),
    the referenced base packs are loaded first and merged in order, with the
    current pack applied last (highest priority).
    """
    pack = load_policy_pack(path)
    extends = pack.get("pack", {}).get("extends")
    if not extends:
        return pack

    base_paths = _normalize_list(extends)
    base_dir = Path(path).parent

    bases: List[Dict[str, Any]] = []
    for bp in base_paths:
        resolved = (base_dir / bp).resolve()
        if resolved.exists():
            bases.append(load_policy_pack_with_inheritance(str(resolved)))

    bases.append(pack)
    return merge_policy_packs(*bases)


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
