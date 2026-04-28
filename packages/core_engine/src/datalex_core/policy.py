import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

import yaml

from datalex_core.issues import Issue
from datalex_core.modeling import normalize_model


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


def _modeling_convention(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    normalized = normalize_model(model)
    issues: List[Issue] = []

    allowed_model_kinds = set(_normalize_list(params.get("allowed_model_kinds")))
    allowed_layers = set(_normalize_list(params.get("allowed_layers")))
    allowed_entity_types = set(_normalize_list(params.get("allowed_entity_types")))
    require_candidate_keys_for_types = set(_normalize_list(params.get("require_candidate_keys_for_types")))
    require_dimension_refs_for_types = set(_normalize_list(params.get("require_dimension_refs_for_types")))
    require_data_vault_metadata = bool(params.get("require_data_vault_metadata", False))

    model_meta = normalized.get("model", {})
    model_kind = str(model_meta.get("kind", "physical"))
    model_layer = str(model_meta.get("layer", ""))

    if allowed_model_kinds and model_kind not in allowed_model_kinds:
        issues.append(
            _policy_issue(
                severity,
                f"POLICY_{policy_id}",
                f"Model kind '{model_kind}' is not allowed. Expected one of {sorted(allowed_model_kinds)}.",
                "/model/kind",
            )
        )

    if allowed_layers and model_layer not in allowed_layers:
        issues.append(
            _policy_issue(
                severity,
                f"POLICY_{policy_id}",
                f"Model layer '{model_layer or '(none)'}' is not allowed. Expected one of {sorted(allowed_layers)}.",
                "/model/layer",
            )
        )

    entities = normalized.get("entities", [])
    entity_map = {
        str(entity.get("name", "")): entity
        for entity in entities
        if isinstance(entity, dict) and entity.get("name")
    }

    def has_field(entity: Dict[str, Any], field_name: str) -> bool:
        return any(str(field.get("name", "")) == field_name for field in entity.get("fields", []))

    for entity in entities:
        entity_name = str(entity.get("name", ""))
        entity_type = str(entity.get("type", "table"))

        if allowed_entity_types and entity_type not in allowed_entity_types:
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{entity_name}' type '{entity_type}' is not allowed. Expected one of {sorted(allowed_entity_types)}.",
                    f"/entities/{entity_name}/type",
                )
            )

        if entity_type in require_candidate_keys_for_types:
            has_candidate_keys = bool(entity.get("candidate_keys"))
            has_primary_key = any(field.get("primary_key") is True for field in entity.get("fields", []))
            if not has_candidate_keys and not has_primary_key:
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Entity '{entity_name}' must declare candidate_keys or a primary key.",
                        f"/entities/{entity_name}/candidate_keys",
                    )
                )

        if entity_type in require_dimension_refs_for_types:
            dimension_refs = entity.get("dimension_refs")
            if not isinstance(dimension_refs, list) or not dimension_refs:
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Entity '{entity_name}' must declare dimension_refs.",
                        f"/entities/{entity_name}/dimension_refs",
                    )
                )

        if require_data_vault_metadata:
            if entity_type == "hub":
                business_keys = entity.get("business_keys")
                hash_key = str(entity.get("hash_key", "")).strip()
                if not isinstance(business_keys, list) or not business_keys:
                    issues.append(
                        _policy_issue(
                            severity,
                            f"POLICY_{policy_id}",
                            f"Hub '{entity_name}' must declare business_keys.",
                            f"/entities/{entity_name}/business_keys",
                        )
                    )
                if not hash_key or not has_field(entity, hash_key):
                    issues.append(
                        _policy_issue(
                            severity,
                            f"POLICY_{policy_id}",
                            f"Hub '{entity_name}' must declare a valid hash_key field.",
                            f"/entities/{entity_name}/hash_key",
                        )
                    )
            elif entity_type == "link":
                link_refs = entity.get("link_refs")
                if not isinstance(link_refs, list) or len(link_refs) < 2:
                    issues.append(
                        _policy_issue(
                            severity,
                            f"POLICY_{policy_id}",
                            f"Link '{entity_name}' must reference at least two hubs in link_refs.",
                            f"/entities/{entity_name}/link_refs",
                        )
                    )
                else:
                    for ref_name in link_refs:
                        referenced = entity_map.get(str(ref_name))
                        if referenced is None or str(referenced.get("type", "")) != "hub":
                            issues.append(
                                _policy_issue(
                                    severity,
                                    f"POLICY_{policy_id}",
                                    f"Link '{entity_name}' link_refs entry '{ref_name}' must reference a hub.",
                                    f"/entities/{entity_name}/link_refs",
                                )
                            )
                hash_key = str(entity.get("hash_key", "")).strip()
                if not hash_key or not has_field(entity, hash_key):
                    issues.append(
                        _policy_issue(
                            severity,
                            f"POLICY_{policy_id}",
                            f"Link '{entity_name}' must declare a valid hash_key field.",
                            f"/entities/{entity_name}/hash_key",
                        )
                    )
            elif entity_type == "satellite":
                parent_entity = str(entity.get("parent_entity", "")).strip()
                hash_diff_fields = entity.get("hash_diff_fields")
                if not parent_entity:
                    issues.append(
                        _policy_issue(
                            severity,
                            f"POLICY_{policy_id}",
                            f"Satellite '{entity_name}' must declare parent_entity.",
                            f"/entities/{entity_name}/parent_entity",
                        )
                    )
                else:
                    parent = entity_map.get(parent_entity)
                    if parent is None or str(parent.get("type", "")) not in {"hub", "link"}:
                        issues.append(
                            _policy_issue(
                                severity,
                                f"POLICY_{policy_id}",
                                f"Satellite '{entity_name}' parent_entity '{parent_entity}' must reference a hub or link.",
                                f"/entities/{entity_name}/parent_entity",
                            )
                        )
                if not isinstance(hash_diff_fields, list) or not hash_diff_fields:
                    issues.append(
                        _policy_issue(
                            severity,
                            f"POLICY_{policy_id}",
                            f"Satellite '{entity_name}' must declare hash_diff_fields.",
                            f"/entities/{entity_name}/hash_diff_fields",
                        )
                    )

            if entity_type in {"hub", "link", "satellite"}:
                for prop_name in ("load_timestamp_field", "record_source_field"):
                    field_name = str(entity.get(prop_name, "")).strip()
                    if not field_name or not has_field(entity, field_name):
                        issues.append(
                            _policy_issue(
                                severity,
                                f"POLICY_{policy_id}",
                                f"{entity_type.title()} '{entity_name}' must declare a valid {prop_name}.",
                                f"/entities/{entity_name}/{prop_name}",
                            )
                        )

    return issues


# ---------------------------------------------------------------------------
# Custom rule support — selector-based evaluators
#
# These three rules let orgs encode `stg_*`/`int_*`/`fct_*` conventions
# and required `meta` keys (steward, review_date, …) without forking the
# policy engine. Selectors filter which entities a rule applies to so a
# single pack can hold layer-specific rules side-by-side.


_LAYER_PREFIXES = {
    "stg": ("stg_",),
    "int": ("int_",),
    "fct": ("fct_", "fact_"),
    "dim": ("dim_",),
    "mart": ("mart_", "marts_"),
}


def _entity_layer(entity: Dict[str, Any]) -> str:
    """Infer entity layer from explicit field then name prefix."""
    declared = str(entity.get("layer") or "").strip().lower()
    if declared:
        return declared
    name = str(entity.get("name") or "").lower()
    for layer, prefixes in _LAYER_PREFIXES.items():
        if any(name.startswith(p) for p in prefixes):
            return layer
    return ""


def _entity_matches_selector(entity: Dict[str, Any], selector: Dict[str, Any]) -> bool:
    """Return True if the entity matches the optional selector block.

    Supported keys:
      * `layer`: stg|int|fct|dim|mart (matches `_entity_layer`)
      * `tag`: entity carries this tag
      * `path_glob`: matched against `entity.meta.source_path` if present
    Missing selector keys are treated as wildcards.
    """
    if not isinstance(selector, dict) or not selector:
        return True
    layer = str(selector.get("layer") or "").strip().lower()
    if layer and _entity_layer(entity) != layer:
        return False
    tag = str(selector.get("tag") or "").strip()
    if tag and tag not in _normalize_list(entity.get("tags")):
        return False
    glob = str(selector.get("path_glob") or "").strip()
    if glob:
        meta = entity.get("meta") or {}
        source_path = str(meta.get("source_path") or "")
        if not source_path or not _glob_match(source_path, glob):
            return False
    return True


def _glob_match(text: str, pattern: str) -> bool:
    import fnmatch
    return fnmatch.fnmatch(text, pattern)


def _selected_entities(model: Dict[str, Any], selector: Dict[str, Any]):
    for entity in model.get("entities", []) or []:
        if _entity_matches_selector(entity, selector):
            yield entity


def _regex_per_layer(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    """Enforce a regex per layer prefix.

    Example params:
      patterns:
        stg: "^stg_[a-z][a-z0-9_]*$"
        fct: "^fct_[a-z][a-z0-9_]*$"
    """
    patterns_raw = params.get("patterns") or {}
    if not isinstance(patterns_raw, dict) or not patterns_raw:
        return [
            _policy_issue(
                "error",
                f"POLICY_{policy_id}_MISCONFIGURED",
                f"Policy '{policy_id}' must define a non-empty 'patterns' map.",
                "/policies",
            )
        ]

    compiled: Dict[str, "re.Pattern[str]"] = {}
    for layer, regex in patterns_raw.items():
        try:
            compiled[str(layer).lower()] = re.compile(str(regex))
        except re.error as err:
            return [
                _policy_issue(
                    "error",
                    f"POLICY_{policy_id}_MISCONFIGURED",
                    f"Policy '{policy_id}' has invalid regex for layer '{layer}': {err}",
                    "/policies",
                )
            ]

    selector = params.get("selectors") or {}
    issues: List[Issue] = []
    for entity in _selected_entities(model, selector):
        layer = _entity_layer(entity)
        if not layer or layer not in compiled:
            continue
        name = str(entity.get("name") or "")
        if not compiled[layer].match(name):
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{name}' (layer={layer}) does not match required pattern "
                    f"'{compiled[layer].pattern}'.",
                    f"/entities/{name}",
                )
            )
    return issues


def _required_meta_keys(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    """Require entities to define specific keys in `meta`.

    Example params:
      keys: ["owner", "steward", "review_date"]
      selectors: { layer: "fct" }   # optional
    """
    required = _normalize_list(params.get("keys"))
    if not required:
        return [
            _policy_issue(
                "error",
                f"POLICY_{policy_id}_MISCONFIGURED",
                f"Policy '{policy_id}' must list at least one required meta key.",
                "/policies",
            )
        ]
    selector = params.get("selectors") or {}
    issues: List[Issue] = []
    for entity in _selected_entities(model, selector):
        meta = entity.get("meta") or {}
        missing = [k for k in required if not (isinstance(meta, dict) and meta.get(k) not in (None, "", [], {}))]
        if missing:
            name = str(entity.get("name") or "")
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{name}' is missing required meta keys: {sorted(missing)}.",
                    f"/entities/{name}/meta",
                )
            )
    return issues


def _layer_constraint(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    """Per-layer constraints on entity attributes.

    Example params:
      layers:
        stg:
          materialization: ["view", "ephemeral"]
        fct:
          requires: ["grain", "owner"]
    """
    layers_raw = params.get("layers") or {}
    if not isinstance(layers_raw, dict) or not layers_raw:
        return [
            _policy_issue(
                "error",
                f"POLICY_{policy_id}_MISCONFIGURED",
                f"Policy '{policy_id}' must define a non-empty 'layers' map.",
                "/policies",
            )
        ]

    issues: List[Issue] = []
    for entity in model.get("entities", []) or []:
        layer = _entity_layer(entity)
        if not layer:
            continue
        rules = layers_raw.get(layer)
        if not isinstance(rules, dict):
            continue
        name = str(entity.get("name") or "")
        meta = entity.get("meta") or {}

        allowed = _normalize_list(rules.get("materialization"))
        if allowed:
            actual = str(entity.get("materialization") or meta.get("materialized") or "").lower()
            if actual and actual not in {a.lower() for a in allowed}:
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Entity '{name}' (layer={layer}) has materialization "
                        f"'{actual}'; allowed: {sorted({a.lower() for a in allowed})}.",
                        f"/entities/{name}/materialization",
                    )
                )

        for key in _normalize_list(rules.get("requires")):
            value = entity.get(key)
            if value in (None, "", [], {}) and not (isinstance(meta, dict) and meta.get(key) not in (None, "", [], {})):
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Entity '{name}' (layer={layer}) is missing required attribute '{key}'.",
                        f"/entities/{name}/{key}",
                    )
                )
    return issues


def _entity_contract_enforced(entity: Dict[str, Any]) -> bool:
    if not isinstance(entity, dict):
        return False
    contract = entity.get("contract") or {}
    if isinstance(contract, dict) and contract.get("enforced"):
        return True
    config = entity.get("config") or {}
    if isinstance(config, dict):
        config_contract = config.get("contract") or {}
        if isinstance(config_contract, dict) and config_contract.get("enforced"):
            return True
    meta = entity.get("meta") or {}
    if isinstance(meta, dict):
        datalex = meta.get("datalex") if isinstance(meta.get("datalex"), dict) else {}
        if str(datalex.get("contracts") or "").lower() == "enforced":
            return True
    return False


def _require_contract(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    """Require selected entities to enforce a dbt contract.

    Example params:
      selectors: { layer: "fct" }
    """
    selector = params.get("selectors") or {}
    issues: List[Issue] = []
    for entity in _selected_entities(model, selector):
        if not _entity_contract_enforced(entity):
            name = str(entity.get("name") or "")
            issues.append(
                _policy_issue(
                    severity,
                    f"POLICY_{policy_id}",
                    f"Entity '{name}' does not enforce a dbt contract.",
                    f"/entities/{name}/contract",
                )
            )
    return issues


def _require_data_type_when_contracted(
    model: Dict[str, Any],
    severity: str,
    policy_id: str,
    params: Dict[str, Any],
) -> List[Issue]:
    """When `contract.enforced` is true, every column must declare a real type."""
    selector = params.get("selectors") or {}
    issues: List[Issue] = []
    for entity in _selected_entities(model, selector):
        if not _entity_contract_enforced(entity):
            continue
        name = str(entity.get("name") or "")
        for field in entity.get("fields", []) or entity.get("columns", []) or []:
            if not isinstance(field, dict):
                continue
            field_name = str(field.get("name") or "")
            data_type = field.get("data_type") or field.get("type") or ""
            if not data_type or str(data_type).lower() == "unknown":
                issues.append(
                    _policy_issue(
                        severity,
                        f"POLICY_{policy_id}",
                        f"Contracted entity '{name}' column '{field_name}' has no concrete data_type.",
                        f"/entities/{name}/fields/{field_name}/data_type",
                    )
                )
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
    "modeling_convention": _modeling_convention,
    "regex_per_layer": _regex_per_layer,
    "required_meta_keys": _required_meta_keys,
    "layer_constraint": _layer_constraint,
    "require_contract": _require_contract,
    "require_data_type_when_contracted": _require_data_type_when_contracted,
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
