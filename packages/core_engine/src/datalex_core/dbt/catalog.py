"""dbt catalog.json -> per-column data_type lookup.

Populated by `dbt docs generate`, `catalog.json` contains the actual column
types introspected from the warehouse — the same information `dbt compile`
tries to fill into `manifest.json`'s `columns[].data_type`, but persisted
even when dbt-compile didn't manage to populate it.

We use this as a *fallback* type source after the manifest: if a column has
`data_type` in the manifest we keep it (cheaper, and user has already opted
into compile-time types), otherwise we look here before falling back to
user-authored types or "unknown". This lets users who only run
`dbt docs generate` (common in projects that rely on the dbt docs site) still
get real types into DataLex without a live warehouse connection.

The file layout is:
    {
      "nodes":   { "<unique_id>": { "columns": { "<col>": { "type": "..." } } } },
      "sources": { "<unique_id>": { "columns": { "<col>": { "type": "..." } } } }
    }

Column lookups are case-insensitive on the column name, because dbt may
lowercase/uppercase names depending on the warehouse (Snowflake uppercases
identifiers; Postgres folds to lowercase). Looking up by the exact case the
manifest uses wouldn't find the catalog entry on those warehouses.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional


@dataclass
class CatalogIndex:
    """In-memory index mapping `unique_id -> {column_name_lower: data_type}`."""

    by_unique_id: Dict[str, Dict[str, str]] = field(default_factory=dict)

    def column_type(self, unique_id: str, column_name: str) -> Optional[str]:
        if not unique_id or not column_name:
            return None
        cols = self.by_unique_id.get(unique_id)
        if not cols:
            return None
        return cols.get(column_name.lower())

    def is_empty(self) -> bool:
        return not self.by_unique_id


def load_catalog(catalog_path: str) -> CatalogIndex:
    """Parse a dbt catalog.json into a CatalogIndex.

    Returns an empty index if the file is missing or unparseable — callers
    treat this as "no catalog available" and fall through to the next type
    source rather than erroring.
    """
    p = Path(catalog_path)
    if not p.exists():
        return CatalogIndex()
    try:
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f) or {}
    except Exception:
        return CatalogIndex()

    idx = CatalogIndex()
    # `nodes` holds models/seeds/snapshots; `sources` holds source tables.
    # Both share the same per-node shape, so index them identically.
    for section in ("nodes", "sources"):
        nodes = data.get(section) or {}
        if not isinstance(nodes, dict):
            continue
        for uid, node in nodes.items():
            if not isinstance(node, dict):
                continue
            cols = node.get("columns") or {}
            if not isinstance(cols, dict):
                continue
            mapped: Dict[str, str] = {}
            for col_name, col_info in cols.items():
                if not isinstance(col_info, dict):
                    continue
                # dbt catalog stores this under "type" (not "data_type" as in
                # manifest nodes). Normalize to a simple string.
                dtype = col_info.get("type")
                if isinstance(dtype, str) and dtype.strip():
                    mapped[str(col_name).lower()] = dtype.strip()
            if mapped and isinstance(uid, str):
                idx.by_unique_id[uid] = mapped
    return idx


def default_catalog_path(dbt_project_dir: str) -> Path:
    """The canonical location dbt writes catalog.json to."""
    return Path(dbt_project_dir) / "target" / "catalog.json"
