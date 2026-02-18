import re
from typing import Any, Dict, List, Set

from dm_core.issues import Issue

PASCAL_CASE = re.compile(r"^[A-Z][A-Za-z0-9]*$")
SNAKE_CASE = re.compile(r"^[a-z][a-z0-9_]*$")
REL_REF = re.compile(r"^[A-Z][A-Za-z0-9]*\.[a-z][a-z0-9_]*$")
ALLOWED_CLASSIFICATIONS = {"PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "PCI", "PHI"}
ALLOWED_SENSITIVITY = {"public", "internal", "confidential", "restricted"}
PK_REQUIRED_TYPES = {"table"}


def _entity_field_refs(model: Dict[str, Any]) -> Set[str]:
    refs: Set[str] = set()
    for entity in model.get("entities", []):
        entity_name = entity.get("name", "")
        for field in entity.get("fields", []):
            field_name = field.get("name", "")
            if entity_name and field_name:
                refs.add(f"{entity_name}.{field_name}")
    return refs


def _entity_names(model: Dict[str, Any]) -> Set[str]:
    return {entity.get("name", "") for entity in model.get("entities", []) if entity.get("name")}


def _entity_field_names(model: Dict[str, Any]) -> Dict[str, Set[str]]:
    result: Dict[str, Set[str]] = {}
    for entity in model.get("entities", []):
        entity_name = entity.get("name", "")
        if not entity_name:
            continue
        names: Set[str] = set()
        for field in entity.get("fields", []):
            field_name = field.get("name", "")
            if field_name:
                names.add(field_name)
        result[entity_name] = names
    return result


def _relationship_graph(model: Dict[str, Any]) -> Dict[str, Set[str]]:
    graph: Dict[str, Set[str]] = {}
    for rel in model.get("relationships", []):
        from_ref = rel.get("from", "")
        to_ref = rel.get("to", "")
        if "." not in from_ref or "." not in to_ref:
            continue
        src = from_ref.split(".", 1)[0]
        dst = to_ref.split(".", 1)[0]
        graph.setdefault(src, set()).add(dst)
        graph.setdefault(dst, set())
    return graph


def _has_cycle(graph: Dict[str, Set[str]]) -> bool:
    state: Dict[str, int] = {node: 0 for node in graph}

    def visit(node: str) -> bool:
        if state[node] == 1:
            return True
        if state[node] == 2:
            return False
        state[node] = 1
        for nxt in graph.get(node, set()):
            if visit(nxt):
                return True
        state[node] = 2
        return False

    for node in graph:
        if state[node] == 0 and visit(node):
            return True
    return False


def _lint_indexes(model: Dict[str, Any], entity_field_map: Dict[str, Set[str]]) -> List[Issue]:
    issues: List[Issue] = []
    seen_index_names: Set[str] = set()

    for idx_def in model.get("indexes", []):
        idx_name = idx_def.get("name", "")
        entity_name = idx_def.get("entity", "")
        idx_fields = idx_def.get("fields", [])

        if idx_name in seen_index_names:
            issues.append(
                Issue(
                    severity="error",
                    code="DUPLICATE_INDEX",
                    message=f"Duplicate index name '{idx_name}'.",
                    path="/indexes",
                )
            )
        else:
            seen_index_names.add(idx_name)

        if entity_name and entity_name not in entity_field_map:
            issues.append(
                Issue(
                    severity="error",
                    code="INDEX_ENTITY_NOT_FOUND",
                    message=f"Index '{idx_name}' references non-existent entity '{entity_name}'.",
                    path="/indexes",
                )
            )
            continue

        entity_fields = entity_field_map.get(entity_name, set())
        for field_name in idx_fields:
            if field_name and field_name not in entity_fields:
                issues.append(
                    Issue(
                        severity="error",
                        code="INDEX_FIELD_NOT_FOUND",
                        message=f"Index '{idx_name}' references non-existent field '{entity_name}.{field_name}'.",
                        path="/indexes",
                    )
                )

    return issues


def _lint_glossary(model: Dict[str, Any], refs: Set[str]) -> List[Issue]:
    issues: List[Issue] = []
    seen_terms: Set[str] = set()

    for term_def in model.get("glossary", []):
        term = term_def.get("term", "")

        if term in seen_terms:
            issues.append(
                Issue(
                    severity="warn",
                    code="DUPLICATE_GLOSSARY_TERM",
                    message=f"Duplicate glossary term '{term}'.",
                    path="/glossary",
                )
            )
        else:
            seen_terms.add(term)

        for field_ref in term_def.get("related_fields", []):
            if field_ref and field_ref not in refs:
                issues.append(
                    Issue(
                        severity="error",
                        code="GLOSSARY_REF_NOT_FOUND",
                        message=f"Glossary term '{term}' references non-existent field '{field_ref}'.",
                        path="/glossary",
                    )
                )

    return issues


def _lint_grain_and_metrics(
    model: Dict[str, Any],
    entity_field_map: Dict[str, Set[str]],
) -> List[Issue]:
    issues: List[Issue] = []
    model_layer = str(model.get("model", {}).get("layer", "")).lower().strip()
    requires_grain = model_layer in {"transform", "report"}

    # Entity grain checks
    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        entity_type = str(entity.get("type", "table"))
        grain = entity.get("grain", []) if isinstance(entity.get("grain"), list) else []
        entity_fields = entity_field_map.get(entity_name, set())

        if requires_grain and entity_type in {"table", "view", "materialized_view"} and not grain:
            issues.append(
                Issue(
                    severity="error",
                    code="MISSING_GRAIN",
                    message=f"Entity '{entity_name}' must declare grain in '{model_layer}' layer models.",
                    path=f"/entities/{entity_name}",
                )
            )

        seen_grain: Set[str] = set()
        for field_name in grain:
            if field_name in seen_grain:
                issues.append(
                    Issue(
                        severity="error",
                        code="DUPLICATE_GRAIN_FIELD",
                        message=f"Entity '{entity_name}' grain contains duplicate field '{field_name}'.",
                        path=f"/entities/{entity_name}/grain",
                    )
                )
            seen_grain.add(field_name)

            if field_name not in entity_fields:
                issues.append(
                    Issue(
                        severity="error",
                        code="GRAIN_FIELD_NOT_FOUND",
                        message=f"Entity '{entity_name}' grain references non-existent field '{field_name}'.",
                        path=f"/entities/{entity_name}/grain",
                    )
                )

    # Metric checks
    metrics = model.get("metrics", [])
    if model_layer == "report" and not metrics:
        issues.append(
            Issue(
                severity="error",
                code="MISSING_METRICS",
                message="Report layer models must define at least one metric.",
                path="/metrics",
            )
        )

    seen_metric_names: Set[str] = set()
    for metric in metrics:
        name = str(metric.get("name", ""))
        entity_name = str(metric.get("entity", ""))
        entity_fields = entity_field_map.get(entity_name, set())

        if name in seen_metric_names:
            issues.append(
                Issue(
                    severity="error",
                    code="DUPLICATE_METRIC",
                    message=f"Duplicate metric name '{name}'.",
                    path="/metrics",
                )
            )
        else:
            seen_metric_names.add(name)

        if entity_name not in entity_field_map:
            issues.append(
                Issue(
                    severity="error",
                    code="METRIC_ENTITY_NOT_FOUND",
                    message=f"Metric '{name}' references non-existent entity '{entity_name}'.",
                    path="/metrics",
                )
            )
            continue

        for grain_field in metric.get("grain", []) if isinstance(metric.get("grain"), list) else []:
            if grain_field not in entity_fields:
                issues.append(
                    Issue(
                        severity="error",
                        code="METRIC_GRAIN_FIELD_NOT_FOUND",
                        message=f"Metric '{name}' grain field '{entity_name}.{grain_field}' does not exist.",
                        path=f"/metrics/{name}",
                    )
                )

        for dim_field in metric.get("dimensions", []) if isinstance(metric.get("dimensions"), list) else []:
            if dim_field not in entity_fields:
                issues.append(
                    Issue(
                        severity="error",
                        code="METRIC_DIMENSION_NOT_FOUND",
                        message=f"Metric '{name}' dimension field '{entity_name}.{dim_field}' does not exist.",
                        path=f"/metrics/{name}",
                    )
                )

        time_dim = str(metric.get("time_dimension", "")).strip()
        if time_dim and time_dim not in entity_fields:
            issues.append(
                Issue(
                    severity="error",
                    code="METRIC_TIME_DIMENSION_NOT_FOUND",
                    message=f"Metric '{name}' time_dimension '{entity_name}.{time_dim}' does not exist.",
                    path=f"/metrics/{name}",
                )
            )

        if metric.get("deprecated") is True and not metric.get("deprecated_message"):
            issues.append(
                Issue(
                    severity="warn",
                    code="METRIC_DEPRECATED_WITHOUT_MESSAGE",
                    message=f"Metric '{name}' is deprecated but missing deprecated_message.",
                    path=f"/metrics/{name}",
                )
            )

    return issues


def lint_issues(model: Dict[str, Any]) -> List[Issue]:
    issues: List[Issue] = []

    entities = model.get("entities", [])
    seen_entities: Set[str] = set()
    refs = _entity_field_refs(model)
    entity_field_map = _entity_field_names(model)

    for entity in entities:
        entity_name = entity.get("name", "")

        if entity_name in seen_entities:
            issues.append(
                Issue(
                    severity="error",
                    code="DUPLICATE_ENTITY",
                    message=f"Duplicate entity name '{entity_name}'.",
                    path="/entities",
                )
            )
        else:
            seen_entities.add(entity_name)

        if entity_name and not PASCAL_CASE.match(entity_name):
            issues.append(
                Issue(
                    severity="error",
                    code="INVALID_ENTITY_NAME",
                    message=f"Entity '{entity_name}' must be PascalCase.",
                    path="/entities",
                )
            )

        fields = entity.get("fields", [])
        field_names: Set[str] = set()
        has_pk = False

        for field in fields:
            name = field.get("name", "")
            if name in field_names:
                issues.append(
                    Issue(
                        severity="error",
                        code="DUPLICATE_FIELD",
                        message=f"Duplicate field '{name}' in entity '{entity_name}'.",
                        path=f"/entities/{entity_name}/fields",
                    )
                )
            else:
                field_names.add(name)

            if name and not SNAKE_CASE.match(name):
                issues.append(
                    Issue(
                        severity="error",
                        code="INVALID_FIELD_NAME",
                        message=f"Field '{entity_name}.{name}' must be snake_case.",
                        path=f"/entities/{entity_name}/fields",
                    )
                )

            if field.get("primary_key") is True:
                has_pk = True

            if field.get("computed") is True and not field.get("computed_expression"):
                issues.append(
                    Issue(
                        severity="warn",
                        code="MISSING_COMPUTED_EXPRESSION",
                        message=f"Computed field '{entity_name}.{name}' should have a computed_expression.",
                        path=f"/entities/{entity_name}/fields",
                    )
                )

            if field.get("deprecated") is True:
                issues.append(
                    Issue(
                        severity="warn",
                        code="DEPRECATED_FIELD",
                        message=f"Field '{entity_name}.{name}' is deprecated."
                        + (f" {field['deprecated_message']}" if field.get("deprecated_message") else ""),
                        path=f"/entities/{entity_name}/fields",
                    )
                )

        entity_type = entity.get("type", "table")
        if entity_type in PK_REQUIRED_TYPES and not has_pk:
            issues.append(
                Issue(
                    severity="warn",
                    code="MISSING_PRIMARY_KEY",
                    message=f"Table '{entity_name}' must have at least one primary key field.",
                    path=f"/entities/{entity_name}",
                )
            )

    for rel in model.get("relationships", []):
        from_ref = rel.get("from", "")
        to_ref = rel.get("to", "")
        name = rel.get("name", "<unnamed>")

        if from_ref and not REL_REF.match(from_ref):
            issues.append(
                Issue(
                    severity="error",
                    code="INVALID_RELATIONSHIP_REF",
                    message=f"Relationship '{name}' has invalid 'from' reference '{from_ref}'.",
                    path="/relationships",
                )
            )
        if to_ref and not REL_REF.match(to_ref):
            issues.append(
                Issue(
                    severity="error",
                    code="INVALID_RELATIONSHIP_REF",
                    message=f"Relationship '{name}' has invalid 'to' reference '{to_ref}'.",
                    path="/relationships",
                )
            )
        if from_ref and from_ref not in refs:
            issues.append(
                Issue(
                    severity="error",
                    code="RELATIONSHIP_REF_NOT_FOUND",
                    message=f"Relationship '{name}' from reference '{from_ref}' does not exist.",
                    path="/relationships",
                )
            )
        if to_ref and to_ref not in refs:
            issues.append(
                Issue(
                    severity="error",
                    code="RELATIONSHIP_REF_NOT_FOUND",
                    message=f"Relationship '{name}' to reference '{to_ref}' does not exist.",
                    path="/relationships",
                )
            )

    classification = model.get("governance", {}).get("classification", {})
    if isinstance(classification, dict):
        for target, value in classification.items():
            if target not in refs:
                issues.append(
                    Issue(
                        severity="error",
                        code="CLASSIFICATION_REF_NOT_FOUND",
                        message=f"Classification target '{target}' does not exist.",
                        path="/governance/classification",
                    )
                )
            if value not in ALLOWED_CLASSIFICATIONS:
                issues.append(
                    Issue(
                        severity="error",
                        code="INVALID_CLASSIFICATION",
                        message=f"Classification '{value}' is not allowed.",
                        path="/governance/classification",
                    )
                )

    issues.extend(_lint_indexes(model, entity_field_map))
    issues.extend(_lint_glossary(model, refs))
    issues.extend(_lint_grain_and_metrics(model, entity_field_map))

    graph = _relationship_graph(model)
    if graph and _has_cycle(graph):
        issues.append(
            Issue(
                severity="warn",
                code="CIRCULAR_RELATIONSHIPS",
                message="Circular entity relationships detected.",
                path="/relationships",
            )
        )

    return issues
