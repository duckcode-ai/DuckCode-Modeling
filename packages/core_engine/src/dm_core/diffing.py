from typing import Any, Dict, List, Tuple

from dm_core.canonical import compile_model


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

    return {
        "summary": {
            "added_entities": len(added_entities),
            "removed_entities": len(removed_entities),
            "changed_entities": len(changed_entities),
            "added_relationships": len(added_relationships),
            "removed_relationships": len(removed_relationships),
            "breaking_change_count": len(sorted(set(breaking_changes))),
        },
        "added_entities": added_entities,
        "removed_entities": removed_entities,
        "changed_entities": changed_entities,
        "added_relationships": added_relationships,
        "removed_relationships": removed_relationships,
        "breaking_changes": sorted(set(breaking_changes)),
        "has_breaking_changes": bool(breaking_changes),
    }
