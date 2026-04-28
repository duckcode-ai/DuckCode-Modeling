"""Shared helpers for catalog exporters: collect glossary + column bindings."""

from __future__ import annotations

from typing import Any, Dict, Iterator, List, Optional, Tuple


def _model_meta(model: Dict[str, Any]) -> Dict[str, Any]:
    section = model.get("model")
    return section if isinstance(section, dict) else {}


def collect_glossary(model: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return the glossary entries from a compiled DataLex model."""
    glossary = model.get("glossary")
    if not isinstance(glossary, list):
        return []
    out: List[Dict[str, Any]] = []
    for term in glossary:
        if not isinstance(term, dict):
            continue
        if not term.get("term"):
            continue
        out.append(term)
    return out


def iter_field_bindings(model: Dict[str, Any]) -> Iterator[Tuple[str, str, Dict[str, Any]]]:
    """Yield `(entity_name, field_name, binding)` for every field that
    declares a glossary binding.

    A binding may take three shapes (in order of precedence):
      1. `binding: { glossary_term: <id>, status: proposed|approved }`
      2. `terms: [<term_id>, ...]` (legacy — promoted to status="approved")
      3. `meta.glossary_term: <id>` (legacy fallback)
    """
    for entity in model.get("entities", []) or []:
        if not isinstance(entity, dict):
            continue
        entity_name = str(entity.get("name") or "")
        for field in entity.get("fields", []) or entity.get("columns", []) or []:
            if not isinstance(field, dict):
                continue
            field_name = str(field.get("name") or "")
            binding = _normalize_binding(field)
            if binding is None:
                continue
            yield entity_name, field_name, binding


def _normalize_binding(field: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw = field.get("binding")
    if isinstance(raw, dict) and raw.get("glossary_term"):
        return {
            "glossary_term": str(raw["glossary_term"]),
            "status": str(raw.get("status") or "approved").lower(),
        }
    legacy = field.get("terms")
    if isinstance(legacy, list) and legacy:
        first = str(legacy[0])
        if first:
            return {"glossary_term": first, "status": "approved"}
    meta = field.get("meta") if isinstance(field.get("meta"), dict) else {}
    legacy_meta = meta.get("glossary_term")
    if legacy_meta:
        return {"glossary_term": str(legacy_meta), "status": "approved"}
    return None


def model_name(model: Dict[str, Any]) -> str:
    name = _model_meta(model).get("name")
    return str(name) if name else "datalex_model"


def model_domain(model: Dict[str, Any]) -> str:
    return str(_model_meta(model).get("domain") or "")
