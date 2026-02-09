from copy import deepcopy
from typing import Any, Dict, List


def _sort_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(fields, key=lambda item: item.get("name", ""))


def _sort_entities(entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_entities = []
    for entity in entities:
        cloned = deepcopy(entity)
        cloned["fields"] = _sort_fields(cloned.get("fields", []))
        if "tags" in cloned and isinstance(cloned["tags"], list):
            cloned["tags"] = sorted(cloned["tags"])
        sorted_entities.append(cloned)
    return sorted(sorted_entities, key=lambda item: item.get("name", ""))


def _sort_relationships(relationships: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        relationships,
        key=lambda item: (
            item.get("name", ""),
            item.get("from", ""),
            item.get("to", ""),
            item.get("cardinality", ""),
        ),
    )


def _sort_rules(rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(rules, key=lambda item: (item.get("name", ""), item.get("target", "")))


def compile_model(model: Dict[str, Any]) -> Dict[str, Any]:
    canonical: Dict[str, Any] = {
        "model": deepcopy(model.get("model", {})),
        "entities": _sort_entities(model.get("entities", [])),
        "relationships": _sort_relationships(model.get("relationships", [])),
        "rules": _sort_rules(model.get("rules", [])),
    }

    governance = deepcopy(model.get("governance", {}))
    classification = governance.get("classification")
    if isinstance(classification, dict):
        governance["classification"] = {
            key: classification[key] for key in sorted(classification.keys())
        }
    stewards = governance.get("stewards")
    if isinstance(stewards, dict):
        governance["stewards"] = {key: stewards[key] for key in sorted(stewards.keys())}

    canonical["governance"] = governance
    canonical["display"] = deepcopy(model.get("display", {}))

    owners = canonical["model"].get("owners")
    if isinstance(owners, list):
        canonical["model"]["owners"] = sorted(owners)

    return canonical
