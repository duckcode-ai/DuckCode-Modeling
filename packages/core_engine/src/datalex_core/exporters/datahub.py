"""DataHub MetadataChangeProposal payload for glossary + bindings.

DataHub treats glossary terms as `glossaryTerm` URNs and binds them to
columns via the `glossaryTerms` aspect on a `dataset`. We emit a list of
MCPs (Metadata Change Proposals) — the same shape DataHub's REST emitter
consumes via `datahub put`.

The `dataset` URN platform here is left as a placeholder (`datalex`) so
operators can rewrite it to the warehouse-specific platform on import.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ._shared import collect_glossary, iter_field_bindings, model_name


def _glossary_term_urn(term_id: str) -> str:
    return f"urn:li:glossaryTerm:{term_id}"


def _dataset_urn(model_name_value: str) -> str:
    # Operators are expected to rewrite the platform/env when ingesting.
    return f"urn:li:dataset:(urn:li:dataPlatform:datalex,{model_name_value},PROD)"


def export_datahub(model: Dict[str, Any]) -> Dict[str, Any]:
    name = model_name(model)
    dataset_urn = _dataset_urn(name)

    proposals: List[Dict[str, Any]] = []

    # Glossary term creation MCPs
    for term in collect_glossary(model):
        term_id = str(term.get("term") or "").strip()
        if not term_id:
            continue
        proposals.append(
            {
                "entityType": "glossaryTerm",
                "entityUrn": _glossary_term_urn(term_id),
                "aspectName": "glossaryTermInfo",
                "aspect": {
                    "name": term_id,
                    "definition": str(term.get("definition") or ""),
                    "termSource": "INTERNAL",
                },
            }
        )

    # Per-field binding MCPs (one schemaField per binding)
    for entity, field, binding in iter_field_bindings(model):
        proposals.append(
            {
                "entityType": "schemaField",
                "entityUrn": f"urn:li:schemaField:({dataset_urn},{entity}.{field})",
                "aspectName": "glossaryTerms",
                "aspect": {
                    "terms": [{"urn": _glossary_term_urn(binding["glossary_term"])}],
                    "auditStamp": {
                        "actor": "urn:li:corpuser:datalex",
                        "time": 0,
                    },
                    "datalex_status": binding["status"],
                },
            }
        )

    return {
        "target": "datahub",
        "version": "1.0",
        "model": name,
        "dataset_urn": dataset_urn,
        "proposals": proposals,
    }
