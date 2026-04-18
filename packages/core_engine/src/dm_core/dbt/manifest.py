"""dbt manifest.json -> DataLex source/model importer with idempotent round-trip.

Design:
  * Stable key = `unique_id` from the manifest (e.g. `source.my_project.raw.orders`,
    `model.my_project.stg_orders`). Stored under `meta.datalex.dbt.unique_id`.
  * On re-import, existing DataLex files are *merged*, not overwritten. User-authored
    fields (description, tests, sensitivity, owner, etc.) are preserved; only fields
    the manifest owns (database/schema/columns' data_type) get refreshed.
  * The importer emits ready-to-write dicts; callers choose where to write them
    (typically under `sources/` and `models/`).

What we do NOT do here: write files. A thin wrapper does that — `write_import_result`
in this module — but users can choose to merge into an existing project tree manually
via their own logic.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


# ------------------------ public API ------------------------


@dataclass
class ImportResult:
    sources: Dict[str, Dict[str, Any]] = field(default_factory=dict)  # name -> doc
    models: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)


def import_manifest(
    manifest_path: str,
    existing_project_root: Optional[str] = None,
) -> ImportResult:
    """Parse a dbt manifest.json and return merged DataLex source/model docs.

    When `existing_project_root` is provided, documents with matching
    `meta.datalex.dbt.unique_id` are merged (user-authored fields preserved).
    """
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    existing = _load_existing_by_unique_id(existing_project_root) if existing_project_root else {}

    result = ImportResult()

    nodes = manifest.get("nodes") or {}
    sources = manifest.get("sources") or {}

    # Sources are keyed by source_name in dbt; group per source_name so we emit one file per source.
    sources_grouped: Dict[str, List[Dict[str, Any]]] = {}
    for uid, node in sources.items():
        source_name = node.get("source_name") or node.get("name")
        sources_grouped.setdefault(source_name, []).append(node)

    for source_name, tables in sources_grouped.items():
        doc = _build_source_doc(source_name, tables, existing)
        result.sources[doc["name"]] = doc

    for uid, node in nodes.items():
        if node.get("resource_type") != "model":
            continue
        doc = _build_model_doc(node, existing)
        result.models[doc["name"]] = doc

    return result


def write_import_result(result: ImportResult, out_root: str) -> List[str]:
    """Persist an ImportResult into a DataLex-style tree under out_root.

    Writes:
      <out_root>/sources/<name>.yaml
      <out_root>/models/dbt/<name>.yaml
    """
    out = Path(out_root)
    written: List[str] = []

    for doc in result.sources.values():
        path = out / "sources" / f"{doc['name']}.yaml"
        _write_yaml(path, doc)
        written.append(str(path))

    for doc in result.models.values():
        path = out / "models" / "dbt" / f"{doc['name']}.yaml"
        _write_yaml(path, doc)
        written.append(str(path))

    return written


# ------------------------ builders ------------------------


def _build_source_doc(
    source_name: str,
    tables: List[Dict[str, Any]],
    existing: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    # Source-level attributes come from the first table (dbt stores them per-node; pick any).
    first = tables[0]
    database = first.get("database")
    schema = first.get("schema")

    # Look for an existing source doc matching any of these tables' unique_ids so we
    # preserve cross-table user fields (e.g., source-level owner).
    existing_doc: Optional[Dict[str, Any]] = None
    for t in tables:
        uid = t.get("unique_id")
        existing_doc = existing.get(uid) or existing_doc

    doc: Dict[str, Any] = {
        "kind": "source",
        "name": _safe_name(source_name),
    }
    if existing_doc:
        _merge_preserving_user_fields(doc, existing_doc, keys=("description", "owner", "tags", "loader", "loaded_at_field", "freshness"))

    if database:
        doc["database"] = database
    if schema:
        doc["schema"] = schema

    table_docs: List[Dict[str, Any]] = []
    for t in tables:
        table_docs.append(_build_source_table_doc(t, existing_doc))
    doc["tables"] = table_docs

    # meta.datalex.dbt.unique_id list, so re-import can find this doc even if one table is renamed.
    doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {
        "unique_ids": sorted(t.get("unique_id") for t in tables if t.get("unique_id")),
    }
    return doc


def _build_source_table_doc(
    t: Dict[str, Any],
    existing_source: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    name = _safe_name(t.get("name", ""))
    table_doc: Dict[str, Any] = {"name": name}

    # Locate prior table body if present
    prior_table: Dict[str, Any] = {}
    if existing_source:
        for candidate in existing_source.get("tables", []) or []:
            if candidate.get("name") == name:
                prior_table = candidate
                break

    if t.get("description"):
        table_doc["description"] = t["description"]
    elif prior_table.get("description"):
        table_doc["description"] = prior_table["description"]

    if t.get("identifier") and t["identifier"] != name:
        table_doc["identifier"] = t["identifier"]
    if t.get("loaded_at_field"):
        table_doc["loaded_at_field"] = t["loaded_at_field"]
    if t.get("freshness"):
        table_doc["freshness"] = t["freshness"]

    # columns
    cols_out: List[Dict[str, Any]] = []
    prior_cols = {c.get("name"): c for c in (prior_table.get("columns") or []) if c.get("name")}
    for c in t.get("columns", {}).values() if isinstance(t.get("columns"), dict) else (t.get("columns") or []):
        cols_out.append(_build_source_column_doc(c, prior_cols.get(c.get("name"), {})))
    if cols_out:
        table_doc["columns"] = cols_out

    # unique_id preserved at table level too
    if t.get("unique_id"):
        table_doc.setdefault("meta", {}).setdefault("datalex", {}).setdefault("dbt", {})[
            "unique_id"
        ] = t["unique_id"]

    return table_doc


def _build_source_column_doc(c: Dict[str, Any], prior: Dict[str, Any]) -> Dict[str, Any]:
    doc: Dict[str, Any] = {"name": c.get("name")}
    # type: manifest owns it; prefer manifest value if present
    if c.get("data_type"):
        doc["type"] = c["data_type"]
    elif prior.get("type"):
        doc["type"] = prior["type"]

    # user-authored: preserve
    for k in ("description", "sensitivity", "tags"):
        if prior.get(k):
            doc[k] = prior[k]
    # manifest description wins only if user has no override
    if c.get("description") and "description" not in doc:
        doc["description"] = c["description"]

    return doc


def _build_model_doc(
    node: Dict[str, Any],
    existing: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    name = _safe_name(node.get("name", ""))
    uid = node.get("unique_id")
    prior = existing.get(uid, {}) if uid else {}

    doc: Dict[str, Any] = {
        "kind": "model",
        "name": name,
    }
    # user-owned fields preserved
    _merge_preserving_user_fields(
        doc, prior, keys=("description", "owner", "domain", "tags", "materialization", "contract"),
    )

    # manifest-owned fields
    config = node.get("config") or {}
    if config.get("materialized") and "materialization" not in doc:
        doc["materialization"] = config["materialized"]
    if node.get("database"):
        doc["database"] = node["database"]
    if node.get("schema"):
        doc["schema"] = node["schema"]
    if node.get("description") and "description" not in doc:
        doc["description"] = node["description"]

    # depends_on — from manifest; represent both refs and sources
    depends: List[Dict[str, Any]] = []
    for parent_uid in (node.get("depends_on", {}) or {}).get("nodes", []) or []:
        if parent_uid.startswith("model."):
            depends.append({"ref": _safe_name(parent_uid.rsplit(".", 1)[-1])})
        elif parent_uid.startswith("source."):
            parts = parent_uid.split(".")
            if len(parts) >= 4:
                depends.append({"source": {"source": _safe_name(parts[-2]), "name": _safe_name(parts[-1])}})
    if depends:
        doc["depends_on"] = depends

    # columns
    prior_cols = {c.get("name"): c for c in (prior.get("columns") or []) if c.get("name")}
    cols_out: List[Dict[str, Any]] = []
    columns_raw = node.get("columns") or {}
    column_iter = columns_raw.values() if isinstance(columns_raw, dict) else columns_raw
    for c in column_iter:
        cols_out.append(_build_model_column_doc(c, prior_cols.get(c.get("name"), {})))
    if cols_out:
        doc["columns"] = cols_out

    if uid:
        doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {"unique_id": uid}

    return doc


def _build_model_column_doc(c: Dict[str, Any], prior: Dict[str, Any]) -> Dict[str, Any]:
    doc: Dict[str, Any] = {"name": c.get("name")}
    if c.get("data_type"):
        doc["type"] = c["data_type"]
    elif prior.get("type"):
        doc["type"] = prior["type"]

    for k in ("description", "sensitivity", "tags", "terms", "tests", "constraints"):
        if prior.get(k):
            doc[k] = prior[k]
    if c.get("description") and "description" not in doc:
        doc["description"] = c["description"]
    return doc


# ------------------------ helpers ------------------------


def _load_existing_by_unique_id(project_root: str) -> Dict[str, Dict[str, Any]]:
    """Walk the project tree and index every doc by its `meta.datalex.dbt.unique_id(s)`."""
    out: Dict[str, Dict[str, Any]] = {}
    root = Path(project_root)
    if not root.exists():
        return out
    for path in root.rglob("*.yaml"):
        try:
            with path.open("r", encoding="utf-8") as f:
                doc = yaml.safe_load(f)
        except Exception:
            continue
        if not isinstance(doc, dict):
            continue
        meta = (doc.get("meta") or {}).get("datalex") or {}
        dbt_meta = meta.get("dbt") or {}
        uid = dbt_meta.get("unique_id")
        uids = dbt_meta.get("unique_ids") or ([uid] if uid else [])
        for u in uids:
            if u:
                out[u] = doc
    return out


def _merge_preserving_user_fields(
    dst: Dict[str, Any],
    src: Dict[str, Any],
    keys: tuple,
) -> None:
    for k in keys:
        if src.get(k) not in (None, "", [], {}):
            dst[k] = src[k]


def _safe_name(name: str) -> str:
    """DataLex names must match ^[a-z][a-z0-9_]*$ — coerce dbt names that drift."""
    import re

    if not name:
        return "unnamed"
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9_]", "_", s)
    if not re.match(r"^[a-z]", s):
        s = "n_" + s
    return s


def _write_yaml(path: Path, doc: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(doc, f, sort_keys=False, default_flow_style=False, allow_unicode=True)
