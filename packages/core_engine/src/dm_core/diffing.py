import glob
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from dm_core.canonical import compile_model
from dm_core.loader import load_yaml_model


def _index_entities(model: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {entity.get("name", ""): entity for entity in model.get("entities", [])}


def _index_fields(entity: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {field.get("name", ""): field for field in entity.get("fields", [])}


def _relationship_key(relationship: Dict[str, Any]) -> Tuple[str, str, str, str]:
    return (
        relationship.get("name", ""),
        relationship.get("from", ""),
        relationship.get("to", ""),
        relationship.get("cardinality", ""),
    )


def _index_key(idx: Dict[str, Any]) -> str:
    fields = ",".join(idx.get("fields", []))
    return f"{idx.get('name', '')}|{idx.get('entity', '')}|{fields}|{idx.get('unique', False)}"


def _diff_indexes(
    old_canonical: Dict[str, Any], new_canonical: Dict[str, Any]
) -> Tuple[List[str], List[str], List[str]]:
    old_indexes = {_index_key(idx) for idx in old_canonical.get("indexes", [])}
    new_indexes = {_index_key(idx) for idx in new_canonical.get("indexes", [])}

    old_names = {idx.get("name", "") for idx in old_canonical.get("indexes", [])}
    new_names = {idx.get("name", "") for idx in new_canonical.get("indexes", [])}

    added = sorted(new_names - old_names)
    removed = sorted(old_names - new_names)
    breaking: List[str] = []
    for name in removed:
        if name:
            breaking.append(f"Index removed: {name}")

    return added, removed, breaking


def _diff_metrics(
    old_canonical: Dict[str, Any], new_canonical: Dict[str, Any]
) -> Tuple[List[str], List[str], List[Dict[str, Any]], List[str]]:
    old_metrics = {m.get("name", ""): m for m in old_canonical.get("metrics", []) if m.get("name")}
    new_metrics = {m.get("name", ""): m for m in new_canonical.get("metrics", []) if m.get("name")}

    old_names = set(old_metrics.keys())
    new_names = set(new_metrics.keys())

    added = sorted(new_names - old_names)
    removed = sorted(old_names - new_names)
    changed: List[Dict[str, Any]] = []
    breaking: List[str] = []

    for name in removed:
        breaking.append(f"Metric removed: {name}")

    for name in sorted(old_names & new_names):
        old_metric = old_metrics[name]
        new_metric = new_metrics[name]
        if old_metric == new_metric:
            continue

        changed_fields: List[str] = []
        for field in (
            "entity",
            "expression",
            "aggregation",
            "grain",
            "dimensions",
            "time_dimension",
            "owner",
            "deprecated",
        ):
            if old_metric.get(field) != new_metric.get(field):
                changed_fields.append(field)

        changed.append({"metric": name, "changed_fields": sorted(changed_fields)})

        if any(f in {"entity", "expression", "aggregation", "grain", "time_dimension"} for f in changed_fields):
            breaking.append(f"Metric contract changed: {name}")

    return added, removed, changed, breaking


def semantic_diff(old_model: Dict[str, Any], new_model: Dict[str, Any]) -> Dict[str, Any]:
    old_canonical = compile_model(old_model)
    new_canonical = compile_model(new_model)

    old_entities = _index_entities(old_canonical)
    new_entities = _index_entities(new_canonical)

    old_entity_names = set(old_entities.keys())
    new_entity_names = set(new_entities.keys())

    added_entities = sorted(name for name in new_entity_names - old_entity_names if name)
    removed_entities = sorted(name for name in old_entity_names - new_entity_names if name)

    changed_entities: List[Dict[str, Any]] = []
    breaking_changes: List[str] = []

    for name in sorted(old_entity_names & new_entity_names):
        old_entity = old_entities[name]
        new_entity = new_entities[name]

        old_fields = _index_fields(old_entity)
        new_fields = _index_fields(new_entity)

        old_field_names = set(old_fields.keys())
        new_field_names = set(new_fields.keys())

        added_fields = sorted(field for field in new_field_names - old_field_names if field)
        removed_fields = sorted(field for field in old_field_names - new_field_names if field)

        type_changes = []
        nullability_changes = []

        for field in sorted(old_field_names & new_field_names):
            old_field = old_fields[field]
            new_field = new_fields[field]
            old_type = old_field.get("type")
            new_type = new_field.get("type")
            if old_type != new_type:
                type_changes.append(
                    {"field": field, "from_type": old_type, "to_type": new_type}
                )
                breaking_changes.append(f"Field type changed: {name}.{field}")

            old_nullable = old_field.get("nullable", True)
            new_nullable = new_field.get("nullable", True)
            if old_nullable != new_nullable:
                nullability_changes.append(
                    {
                        "field": field,
                        "from_nullable": old_nullable,
                        "to_nullable": new_nullable,
                    }
                )
                if old_nullable and not new_nullable:
                    breaking_changes.append(f"Field became non-nullable: {name}.{field}")

        if removed_fields:
            for field in removed_fields:
                breaking_changes.append(f"Field removed: {name}.{field}")

        if added_fields or removed_fields or type_changes or nullability_changes:
            changed_entities.append(
                {
                    "entity": name,
                    "added_fields": added_fields,
                    "removed_fields": removed_fields,
                    "type_changes": type_changes,
                    "nullability_changes": nullability_changes,
                }
            )

    old_relationships = {_relationship_key(item) for item in old_canonical.get("relationships", [])}
    new_relationships = {_relationship_key(item) for item in new_canonical.get("relationships", [])}

    added_relationships = [
        {"name": key[0], "from": key[1], "to": key[2], "cardinality": key[3]}
        for key in sorted(new_relationships - old_relationships)
    ]
    removed_relationships = [
        {"name": key[0], "from": key[1], "to": key[2], "cardinality": key[3]}
        for key in sorted(old_relationships - new_relationships)
    ]

    for entity in removed_entities:
        breaking_changes.append(f"Entity removed: {entity}")

    added_indexes, removed_indexes, index_breaking = _diff_indexes(old_canonical, new_canonical)
    breaking_changes.extend(index_breaking)
    added_metrics, removed_metrics, changed_metrics, metric_breaking = _diff_metrics(old_canonical, new_canonical)
    breaking_changes.extend(metric_breaking)

    return {
        "summary": {
            "added_entities": len(added_entities),
            "removed_entities": len(removed_entities),
            "changed_entities": len(changed_entities),
            "added_relationships": len(added_relationships),
            "removed_relationships": len(removed_relationships),
            "added_indexes": len(added_indexes),
            "removed_indexes": len(removed_indexes),
            "added_metrics": len(added_metrics),
            "removed_metrics": len(removed_metrics),
            "changed_metrics": len(changed_metrics),
            "breaking_change_count": len(sorted(set(breaking_changes))),
        },
        "added_entities": added_entities,
        "removed_entities": removed_entities,
        "changed_entities": changed_entities,
        "added_relationships": added_relationships,
        "removed_relationships": removed_relationships,
        "added_indexes": added_indexes,
        "removed_indexes": removed_indexes,
        "added_metrics": added_metrics,
        "removed_metrics": removed_metrics,
        "changed_metrics": changed_metrics,
        "breaking_changes": sorted(set(breaking_changes)),
        "has_breaking_changes": bool(breaking_changes),
    }


def _find_model_files(directory: str) -> Dict[str, str]:
    """Find all model YAML files in a directory, keyed by model name."""
    dir_path = Path(directory).resolve()
    models: Dict[str, str] = {}
    for pattern in ["**/*.model.yaml", "**/*.model.yml"]:
        for path in sorted(dir_path.glob(pattern)):
            try:
                data = load_yaml_model(str(path))
                name = data.get("model", {}).get("name", "")
                if name:
                    models[name] = str(path)
            except Exception:
                continue
    return models


def project_diff(
    old_dir: str,
    new_dir: str,
) -> Dict[str, Any]:
    """Compare two directories of model files and produce a project-level diff.

    Returns a summary of added/removed/changed models and per-model diffs.
    """
    old_models = _find_model_files(old_dir)
    new_models = _find_model_files(new_dir)

    old_names = set(old_models.keys())
    new_names = set(new_models.keys())

    added_models = sorted(new_names - old_names)
    removed_models = sorted(old_names - new_names)
    common_models = sorted(old_names & new_names)

    model_diffs: Dict[str, Dict[str, Any]] = {}
    all_breaking: List[str] = []

    for name in common_models:
        old_model = load_yaml_model(old_models[name])
        new_model = load_yaml_model(new_models[name])
        diff = semantic_diff(old_model, new_model)

        has_changes = (
            diff["summary"]["added_entities"] > 0
            or diff["summary"]["removed_entities"] > 0
            or diff["summary"]["changed_entities"] > 0
            or diff["summary"]["added_relationships"] > 0
            or diff["summary"]["removed_relationships"] > 0
            or diff["summary"]["added_indexes"] > 0
            or diff["summary"]["removed_indexes"] > 0
            or diff["summary"]["added_metrics"] > 0
            or diff["summary"]["removed_metrics"] > 0
            or diff["summary"]["changed_metrics"] > 0
        )

        if has_changes:
            model_diffs[name] = diff
            for bc in diff["breaking_changes"]:
                all_breaking.append(f"[{name}] {bc}")

    for name in removed_models:
        all_breaking.append(f"Model removed: {name}")

    return {
        "summary": {
            "added_models": len(added_models),
            "removed_models": len(removed_models),
            "changed_models": len(model_diffs),
            "unchanged_models": len(common_models) - len(model_diffs),
            "breaking_change_count": len(all_breaking),
        },
        "added_models": added_models,
        "removed_models": removed_models,
        "changed_models": list(model_diffs.keys()),
        "model_diffs": model_diffs,
        "breaking_changes": sorted(all_breaking),
        "has_breaking_changes": bool(all_breaking),
    }
