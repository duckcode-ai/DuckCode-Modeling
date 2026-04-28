"""Atlan import payload for DataLex glossary + bindings.

Atlan's glossary REST/bulk-loader format expects three collections:
  * glossaries  — top-level container per domain
  * categories  — optional groupings
  * terms       — glossary entries with `assignedEntities`

We emit a single glossary scoped to the model's domain (when present) and
attach every field binding as an `assignedEntity` reference of shape
`<entity>.<field>`. Reviewers paste this JSON into Atlan's bulk import or
hand it off to a small custom loader; the structure is stable and lossless.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ._shared import collect_glossary, iter_field_bindings, model_domain, model_name


def export_atlan(model: Dict[str, Any]) -> Dict[str, Any]:
    domain = model_domain(model) or "default"
    name = model_name(model)
    glossary_name = f"DataLex/{name}"

    bindings_by_term: Dict[str, List[Dict[str, str]]] = {}
    for entity, field, binding in iter_field_bindings(model):
        bindings_by_term.setdefault(binding["glossary_term"], []).append(
            {
                "qualifiedName": f"{entity}.{field}",
                "typeName": "Column",
                "status": binding["status"],
            }
        )

    terms: List[Dict[str, Any]] = []
    for term in collect_glossary(model):
        term_id = str(term.get("term") or "").strip()
        if not term_id:
            continue
        terms.append(
            {
                "name": term_id,
                "shortDescription": str(term.get("definition") or ""),
                "longDescription": str(term.get("definition_long") or term.get("definition") or ""),
                "tags": list(term.get("tags") or []),
                "assignedEntities": bindings_by_term.get(term_id, []),
                "qualifiedName": f"{glossary_name}/{term_id}",
            }
        )

    return {
        "target": "atlan",
        "version": "1.0",
        "domain": domain,
        "glossary": {
            "name": glossary_name,
            "qualifiedName": glossary_name,
            "shortDescription": f"Glossary exported from DataLex model {name}.",
        },
        "terms": terms,
    }
