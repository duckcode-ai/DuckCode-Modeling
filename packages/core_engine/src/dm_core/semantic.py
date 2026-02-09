import re
from typing import Any, Dict, List, Set

from dm_core.issues import Issue

PASCAL_CASE = re.compile(r"^[A-Z][A-Za-z0-9]*$")
SNAKE_CASE = re.compile(r"^[a-z][a-z0-9_]*$")
REL_REF = re.compile(r"^[A-Z][A-Za-z0-9]*\.[a-z][a-z0-9_]*$")
ALLOWED_CLASSIFICATIONS = {"PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "PCI"}


def _entity_field_refs(model: Dict[str, Any]) -> Set[str]:
    refs: Set[str] = set()
    for entity in model.get("entities", []):
        entity_name = entity.get("name", "")
        for field in entity.get("fields", []):
            field_name = field.get("name", "")
            if entity_name and field_name:
                refs.add(f"{entity_name}.{field_name}")
    return refs


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


def lint_issues(model: Dict[str, Any]) -> List[Issue]:
    issues: List[Issue] = []

    entities = model.get("entities", [])
    seen_entities: Set[str] = set()
    refs = _entity_field_refs(model)

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

        if entity.get("type") == "table" and not has_pk:
            issues.append(
                Issue(
                    severity="error",
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
