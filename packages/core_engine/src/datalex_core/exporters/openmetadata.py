"""OpenMetadata payload for glossary + bindings.

OpenMetadata models a glossary as a top-level entity with nested
`GlossaryTerm` items. Each term carries a list of related entities (table
columns) via FQN strings. The shape produced here matches the JSON the
OpenMetadata Glossary import accepts.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ._shared import collect_glossary, iter_field_bindings, model_domain, model_name


def export_openmetadata(model: Dict[str, Any]) -> Dict[str, Any]:
    name = model_name(model)
    domain = model_domain(model) or None
    glossary_id = f"datalex.{name}"

    bindings_by_term: Dict[str, List[str]] = {}
    for entity, field, binding in iter_field_bindings(model):
        # OpenMetadata FQNs are dotted: <service>.<database>.<schema>.<table>.<column>
        # We use a placeholder service so operators can rewrite during ingest.
        fqn = f"datalex.{name}.{entity}.{field}"
        bindings_by_term.setdefault(binding["glossary_term"], []).append(fqn)

    terms: List[Dict[str, Any]] = []
    for term in collect_glossary(model):
        term_id = str(term.get("term") or "").strip()
        if not term_id:
            continue
        terms.append(
            {
                "name": term_id,
                "displayName": term_id.replace("_", " "),
                "description": str(term.get("definition") or ""),
                "tags": list(term.get("tags") or []),
                "relatedTerms": [],
                "synonyms": list(term.get("synonyms") or []),
                "references": [],
                "fqn": f"{glossary_id}.{term_id}",
                "relatedEntities": bindings_by_term.get(term_id, []),
            }
        )

    glossary: Dict[str, Any] = {
        "name": glossary_id,
        "displayName": f"DataLex {name}",
        "description": f"Glossary exported from DataLex model {name}.",
    }
    if domain:
        glossary["domain"] = domain

    return {
        "target": "openmetadata",
        "version": "1.0",
        "glossary": glossary,
        "terms": terms,
    }
