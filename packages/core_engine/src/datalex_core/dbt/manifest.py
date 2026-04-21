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

from datalex_core.dbt.catalog import CatalogIndex, load_catalog


# ------------------------ public API ------------------------


@dataclass
class ImportResult:
    sources: Dict[str, Dict[str, Any]] = field(default_factory=dict)  # name -> doc
    models: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    # source_path: dbt's `original_file_path` per doc, so callers can mirror the
    # dbt project's folder layout when writing. Keyed like the parent dict —
    # source_paths["sources"][<name>] and source_paths["models"][<name>]. Always
    # populated for new imports; absent-or-empty means "no known source path,
    # fall back to flat layout."
    source_paths: Dict[str, Dict[str, str]] = field(
        default_factory=lambda: {"sources": {}, "models": {}}
    )


def import_manifest(
    manifest_path: str,
    existing_project_root: Optional[str] = None,
    catalog_path: Optional[str] = None,
) -> ImportResult:
    """Parse a dbt manifest.json and return merged DataLex source/model docs.

    When `existing_project_root` is provided, documents with matching
    `meta.datalex.dbt.unique_id` are merged (user-authored fields preserved).

    When `catalog_path` is provided (typically `<dbt_project>/target/catalog.json`,
    populated by `dbt docs generate`), column types missing from the manifest
    fall back to the catalog before defaulting to "unknown". This lets
    projects that only run `dbt docs generate` (not `dbt compile`) still
    import real column types.
    """
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    existing = _load_existing_by_unique_id(existing_project_root) if existing_project_root else {}
    catalog = load_catalog(catalog_path) if catalog_path else CatalogIndex()

    result = ImportResult()

    nodes = manifest.get("nodes") or {}
    sources = manifest.get("sources") or {}

    # Sources are keyed by source_name in dbt; group per source_name so we emit one file per source.
    sources_grouped: Dict[str, List[Dict[str, Any]]] = {}
    for uid, node in sources.items():
        source_name = node.get("source_name") or node.get("name")
        sources_grouped.setdefault(source_name, []).append(node)

    for source_name, tables in sources_grouped.items():
        doc = _build_source_doc(source_name, tables, existing, catalog)
        result.sources[doc["name"]] = doc
        src_path = _common_source_path(tables)
        if src_path:
            result.source_paths["sources"][doc["name"]] = src_path

    for uid, node in nodes.items():
        if node.get("resource_type") != "model":
            continue
        doc = _build_model_doc(node, existing, catalog)
        result.models[doc["name"]] = doc
        model_path = node.get("original_file_path") or ""
        if model_path:
            # Record the dbt source path so writers can mirror the tree.
            result.source_paths["models"][doc["name"]] = model_path

    # Count columns that landed as "unknown" — these come from manifest nodes
    # without a populated `data_type` (i.e. the user hasn't run `dbt compile`
    # or `dbt docs generate`). Surfacing the count lets the CLI + API server
    # print a single actionable line instead of each column silently
    # defaulting to a generic type.
    unknown = _count_unknown_types(result)
    if unknown > 0:
        result.warnings.append(
            f"{unknown} column(s) have no data type — run `dbt compile` "
            "or `dbt docs generate` to populate types, or edit them inline "
            "in the DataLex Inspector."
        )

    return result


def _count_unknown_types(result: ImportResult) -> int:
    """Count how many columns in the import result have `type: unknown`."""
    n = 0
    for src in result.sources.values():
        for tbl in src.get("tables", []) or []:
            for c in tbl.get("columns", []) or []:
                if c.get("type") == "unknown":
                    n += 1
    for mdl in result.models.values():
        for c in mdl.get("columns", []) or []:
            if c.get("type") == "unknown":
                n += 1
    return n


def _common_source_path(tables: List[Dict[str, Any]]) -> str:
    """Return a representative `original_file_path` for a group of source nodes.

    All tables under a single source_name usually live in the same schema.yml
    — use the first table's path. If paths diverge (rare), pick the shortest so
    we write the source file at the most general dbt folder it covers.
    """
    paths = [str(t.get("original_file_path") or "") for t in tables]
    paths = [p for p in paths if p]
    if not paths:
        return ""
    return min(paths, key=len)


def write_import_result(
    result: ImportResult,
    out_root: str,
    *,
    preserve_layout: bool = True,
) -> List[str]:
    """Persist an ImportResult into a DataLex-style tree under out_root.

    When `preserve_layout` is True (the default) and the ImportResult carries
    per-doc `source_path` entries, each DataLex file is written at the same
    relative path as the original dbt file — so `models/staging/stg_customers.sql`
    lands as `<out_root>/models/staging/stg_customers.yaml`. When no source_path
    is recorded, falls back to the legacy flat layout:
      <out_root>/sources/<name>.yaml
      <out_root>/models/dbt/<name>.yaml
    """
    out = Path(out_root)
    written: List[str] = []

    src_paths = result.source_paths if preserve_layout else {"sources": {}, "models": {}}

    for name, doc in result.sources.items():
        rel = src_paths.get("sources", {}).get(name) or ""
        path = _resolve_source_out_path(out, name, rel)
        _write_yaml(path, doc)
        written.append(str(path))

    for name, doc in result.models.items():
        rel = src_paths.get("models", {}).get(name) or ""
        path = _resolve_model_out_path(out, name, rel)
        _write_yaml(path, doc)
        written.append(str(path))

    return written


def _resolve_source_out_path(out: Path, name: str, source_rel: str) -> Path:
    """Decide where to write a source doc.

    dbt source definitions live inside schema.yml / sources.yml (YAML, not SQL).
    The original_file_path points at the source schema file itself, so several
    source_names can share one file. To avoid collisions, we still write one
    DataLex file per source_name — but we place it under the SAME FOLDER as the
    original schema file. Falls back to `sources/<name>.yaml` when path unknown.
    """
    if source_rel:
        parent = _safe_relative(Path(source_rel).parent)
        return (out / parent / f"{name}.yaml").resolve(strict=False) if False else (out / parent / f"{name}.yaml")
    return out / "sources" / f"{name}.yaml"


def _resolve_model_out_path(out: Path, name: str, model_rel: str) -> Path:
    """Decide where to write a model doc.

    dbt model files are SQL — `models/staging/stg_customers.sql`. The DataLex
    counterpart is a sibling YAML with the same stem: `.../stg_customers.yaml`.
    Falls back to the legacy flat layout when path is unknown.
    """
    if model_rel:
        p = _safe_relative(Path(model_rel))
        return out / p.with_suffix(".yaml")
    return out / "models" / "dbt" / f"{name}.yaml"


def _safe_relative(p: Path) -> Path:
    """Guard against absolute paths or `..` segments sneaking out of out_root.

    dbt's `original_file_path` is already relative, but be defensive in case a
    manifest has an unexpected shape (e.g. packages installed via dbt deps).
    """
    parts = [seg for seg in p.parts if seg not in ("", "..", "/", ".")]
    return Path(*parts) if parts else Path(".")


# ------------------------ builders ------------------------


def _build_source_doc(
    source_name: str,
    tables: List[Dict[str, Any]],
    existing: Dict[str, Dict[str, Any]],
    catalog: CatalogIndex,
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
        table_docs.append(_build_source_table_doc(t, existing_doc, catalog))
    doc["tables"] = table_docs

    # meta.datalex.dbt.unique_id list, so re-import can find this doc even if one table is renamed.
    doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {
        "unique_ids": sorted(t.get("unique_id") for t in tables if t.get("unique_id")),
    }
    return doc


def _build_source_table_doc(
    t: Dict[str, Any],
    existing_source: Optional[Dict[str, Any]],
    catalog: CatalogIndex,
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
    tbl_uid = t.get("unique_id") or ""
    for c in t.get("columns", {}).values() if isinstance(t.get("columns"), dict) else (t.get("columns") or []):
        cols_out.append(
            _build_source_column_doc(c, prior_cols.get(c.get("name"), {}), catalog, tbl_uid)
        )
    if cols_out:
        table_doc["columns"] = cols_out

    # unique_id preserved at table level too
    if t.get("unique_id"):
        table_doc.setdefault("meta", {}).setdefault("datalex", {}).setdefault("dbt", {})[
            "unique_id"
        ] = t["unique_id"]

    return table_doc


def _build_source_column_doc(
    c: Dict[str, Any],
    prior: Dict[str, Any],
    catalog: CatalogIndex,
    table_unique_id: str,
) -> Dict[str, Any]:
    doc: Dict[str, Any] = {"name": c.get("name")}
    # Type precedence:
    #   1. manifest `data_type` (from `dbt compile`) — freshest, already parsed
    #   2. catalog.json `type` (from `dbt docs generate`) — real warehouse types
    #   3. prior user-authored type (preserved across re-imports)
    #   4. "unknown" sentinel — UI renders as "—" and importer warns
    if c.get("data_type"):
        doc["type"] = c["data_type"]
    else:
        catalog_type = catalog.column_type(table_unique_id, c.get("name") or "")
        if catalog_type:
            doc["type"] = catalog_type
        elif prior.get("type"):
            doc["type"] = prior["type"]
        else:
            doc["type"] = "unknown"

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
    catalog: CatalogIndex,
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
        cols_out.append(
            _build_model_column_doc(c, prior_cols.get(c.get("name"), {}), catalog, uid or "")
        )
    if cols_out:
        doc["columns"] = cols_out

    if uid:
        doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {"unique_id": uid}

    return doc


def _build_model_column_doc(
    c: Dict[str, Any],
    prior: Dict[str, Any],
    catalog: CatalogIndex,
    model_unique_id: str,
) -> Dict[str, Any]:
    doc: Dict[str, Any] = {"name": c.get("name")}
    # Type precedence:
    #   1. manifest `data_type` (populated by `dbt compile`)
    #   2. catalog.json `type` (populated by `dbt docs generate`)
    #   3. prior user-authored type (preserved across re-imports)
    #   4. "unknown" sentinel — UI renders as "—" and importer warns so
    #      users know to run `dbt compile` or `dbt docs generate`.
    if c.get("data_type"):
        doc["type"] = c["data_type"]
    else:
        catalog_type = catalog.column_type(model_unique_id, c.get("name") or "")
        if catalog_type:
            doc["type"] = catalog_type
        elif prior.get("type"):
            doc["type"] = prior["type"]
        else:
            doc["type"] = "unknown"

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
