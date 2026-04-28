"""Canonicalizer agent — lift staging columns into a logical canonical layer.

Detects columns that recur across staging models with the same name and
similar descriptions, then proposes a logical entity carrying each column
once with a `description_ref` pointing at a shared `{% docs %}` block.

This is the unique value-add: P0.2 made the round-trip doc-block-aware,
so this agent can safely emit `description_ref` and `.md` payloads
knowing the emitter will round-trip them losslessly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

from ._shared import (
    StagingColumn,
    canonical_entity_token,
    collect_staging_models,
    pascal_case,
    singularize,
    strip_staging_prefix,
)


@dataclass
class CanonicalizerProposal:
    entities: List[Dict[str, Any]] = field(default_factory=list)
    doc_blocks: Dict[str, str] = field(default_factory=dict)
    notes: List[str] = field(default_factory=list)

    def to_proposal_changes(
        self,
        out_dir: str = "DataLex/logical",
        docs_path: str = "DataLex/docs/_canonical.md",
    ) -> List[Dict[str, Any]]:
        """Render as create_file proposal changes for the apply pipeline."""
        changes: List[Dict[str, Any]] = []
        if self.doc_blocks:
            md_lines: List[str] = []
            for name, body in sorted(self.doc_blocks.items()):
                md_lines.append(f"{{% docs {name} %}}")
                md_lines.append(body)
                md_lines.append("{% enddocs %}")
                md_lines.append("")
            changes.append(
                {
                    "type": "create_file",
                    "path": docs_path,
                    "overwrite": False,
                    "content": "\n".join(md_lines).strip() + "\n",
                    "rationale": "Shared dbt doc-block file for canonical column descriptions.",
                }
            )
        for entity in self.entities:
            slug = entity["name"].lower()
            changes.append(
                {
                    "type": "create_file",
                    "path": f"{out_dir}/{slug}.model.yaml",
                    "overwrite": False,
                    "content": _render_entity_yaml(entity),
                    "rationale": f"Logical canonical entity {entity['name']} lifted from staging.",
                }
            )
        return changes


def _render_entity_yaml(entity: Dict[str, Any]) -> str:
    import yaml as _yaml

    return _yaml.safe_dump(
        {
            "kind": "model",
            "name": entity["name"],
            "layer": "logical",
            "description": entity.get("description") or "",
            "domain": entity.get("domain") or "",
            "columns": entity.get("columns") or [],
            "meta": {"datalex": {"source": "canonicalizer", "from": entity.get("sources", [])}},
        },
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
    )


def _column_key(col: StagingColumn) -> str:
    return col.name.strip().lower()


def _description_match(a: str, b: str, threshold: float = 0.6) -> bool:
    if not a or not b:
        # Mismatched empties still merge — prefer the longer one downstream.
        return True
    if a.strip() == b.strip():
        return True
    ratio = SequenceMatcher(None, a.lower(), b.lower()).ratio()
    return ratio >= threshold


def propose_canonical_layer(
    models: Dict[str, Dict[str, Any]],
    *,
    min_recurrence: int = 2,
) -> CanonicalizerProposal:
    """Group staging columns by canonical entity and emit a logical model.

    Columns that recur in `min_recurrence` or more staging models are
    promoted into the canonical entity; one-off columns are kept on the
    individual staging model and noted in `proposal.notes`.
    """
    staging = collect_staging_models(models)
    proposal = CanonicalizerProposal()
    if not staging:
        proposal.notes.append("No staging-layer models detected.")
        return proposal

    # Group columns by canonical entity noun (last token of the staging
    # model name, singularized, pascal-cased). `stg_segment_events` and
    # `stg_amplitude_events` both bucket under `Event`.
    grouped: Dict[str, Dict[str, List[StagingColumn]]] = {}
    sources_for_entity: Dict[str, List[str]] = {}
    for sm in staging:
        entity_name = pascal_case(singularize(canonical_entity_token(sm.name)))
        sources_for_entity.setdefault(entity_name, []).append(sm.name)
        bucket = grouped.setdefault(entity_name, {})
        for col in sm.columns:
            bucket.setdefault(_column_key(col), []).append(col)

    for entity_name, columns_by_key in grouped.items():
        entity_columns: List[Dict[str, Any]] = []
        for key, occurrences in columns_by_key.items():
            if len(occurrences) < min_recurrence:
                # Singleton — leave on staging; only note it once.
                if len(occurrences) == 1 and len(grouped) == 1:
                    proposal.notes.append(
                        f"Column {entity_name}.{occurrences[0].name} is unique to "
                        f"{occurrences[0].model} — kept on staging."
                    )
                continue

            descriptions = [c.description for c in occurrences if c.description.strip()]
            description = max(descriptions, key=len) if descriptions else ""
            if descriptions and any(not _description_match(description, d) for d in descriptions):
                proposal.notes.append(
                    f"Column {entity_name}.{occurrences[0].name} has divergent descriptions "
                    f"across {[c.model for c in occurrences]} — picked the longest; review."
                )
            data_types = sorted({c.data_type for c in occurrences if c.data_type})
            data_type = data_types[0] if data_types else ""
            if len(data_types) > 1:
                proposal.notes.append(
                    f"Column {entity_name}.{occurrences[0].name} has divergent types "
                    f"{data_types} — picked {data_type}; reconcile in the canonical entity."
                )

            doc_block_name = f"{entity_name.lower()}__{occurrences[0].name}"
            if description:
                proposal.doc_blocks[doc_block_name] = description

            col_doc: Dict[str, Any] = {
                "name": occurrences[0].name,
                "type": data_type or "unknown",
            }
            if description:
                col_doc["description"] = f'{{{{ doc("{doc_block_name}") }}}}'
                col_doc["description_ref"] = {"doc": doc_block_name}
            if any(c.primary_key for c in occurrences):
                col_doc["primary_key"] = True
            sensitivities = sorted({c.sensitivity for c in occurrences if c.sensitivity})
            if sensitivities:
                col_doc["sensitivity"] = sensitivities[0]
            entity_columns.append(col_doc)

        if not entity_columns:
            continue

        proposal.entities.append(
            {
                "name": entity_name,
                "type": "logical_entity",
                "description": f"Canonical {entity_name} entity lifted from staging.",
                "domain": "",
                "sources": sorted(sources_for_entity.get(entity_name, [])),
                "columns": entity_columns,
            }
        )

    if not proposal.entities:
        proposal.notes.append(
            "No columns recurred across staging models — canonical layer is empty. "
            "Lower --min-recurrence or add more staging models."
        )
    return proposal
