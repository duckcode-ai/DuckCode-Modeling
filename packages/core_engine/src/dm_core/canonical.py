from copy import deepcopy
from typing import Any, Dict, List


def _sort_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(fields, key=lambda item: item.get("name", ""))


def _sort_entities(entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_entities = []
    for entity in entities:
        cloned = deepcopy(entity)
        cloned["fields"] = _sort_fields(cloned.get("fields", []))
        if "grain" in cloned and isinstance(cloned["grain"], list):
            cloned["grain"] = sorted(cloned["grain"])
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


def _sort_indexes(indexes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        deepcopy(indexes),
        key=lambda item: (item.get("name", ""), item.get("entity", "")),
    )


def _sort_glossary(glossary: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_terms = []
    for term in glossary:
        cloned = deepcopy(term)
        if "related_fields" in cloned and isinstance(cloned["related_fields"], list):
            cloned["related_fields"] = sorted(cloned["related_fields"])
        if "tags" in cloned and isinstance(cloned["tags"], list):
            cloned["tags"] = sorted(cloned["tags"])
        sorted_terms.append(cloned)
    return sorted(sorted_terms, key=lambda item: item.get("term", ""))


def _sort_metrics(metrics: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_metrics = []
    for metric in metrics:
        cloned = deepcopy(metric)
        if "grain" in cloned and isinstance(cloned["grain"], list):
            cloned["grain"] = sorted(cloned["grain"])
        if "dimensions" in cloned and isinstance(cloned["dimensions"], list):
            cloned["dimensions"] = sorted(cloned["dimensions"])
        if "tags" in cloned and isinstance(cloned["tags"], list):
            cloned["tags"] = sorted(cloned["tags"])
        sorted_metrics.append(cloned)
    return sorted(sorted_metrics, key=lambda item: item.get("name", ""))


def compile_model(model: Dict[str, Any]) -> Dict[str, Any]:
    canonical: Dict[str, Any] = {
        "model": deepcopy(model.get("model", {})),
        "entities": _sort_entities(model.get("entities", [])),
        "relationships": _sort_relationships(model.get("relationships", [])),
        "indexes": _sort_indexes(model.get("indexes", [])),
        "rules": _sort_rules(model.get("rules", [])),
        "metrics": _sort_metrics(model.get("metrics", [])),
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
    canonical["glossary"] = _sort_glossary(model.get("glossary", []))
    canonical["display"] = deepcopy(model.get("display", {}))

    owners = canonical["model"].get("owners")
    if isinstance(owners, list):
        canonical["model"]["owners"] = sorted(owners)

    return canonical
