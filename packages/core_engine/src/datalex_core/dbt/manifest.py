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
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from datalex_core.dbt.catalog import CatalogIndex, load_catalog
from datalex_core.dbt.doc_blocks import DocBlockIndex, find_description_ref


# ------------------------ public API ------------------------


@dataclass
class ImportResult:
    sources: Dict[str, Dict[str, Any]] = field(default_factory=dict)  # name -> doc
    models: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    snapshots: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    seeds: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    exposures: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    unit_tests: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    semantic_models: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    # source_path: dbt's `original_file_path` per doc, so callers can mirror the
    # dbt project's folder layout when writing. Keyed like the parent dict —
    # source_paths["sources"][<name>] and source_paths["models"][<name>]. Always
    # populated for new imports; absent-or-empty means "no known source path,
    # fall back to flat layout."
    source_paths: Dict[str, Dict[str, str]] = field(
        default_factory=lambda: {
            "sources": {},
            "models": {},
            "snapshots": {},
            "seeds": {},
            "exposures": {},
            "unit_tests": {},
            "semantic_models": {},
        }
    )


def import_manifest(
    manifest_path: str,
    existing_project_root: Optional[str] = None,
    catalog_path: Optional[str] = None,
    dbt_project_root: Optional[str] = None,
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
    # Build the doc-block index from the dbt project root if explicitly known
    # so that rendered descriptions resolved by dbt at parse time can be
    # reversed back to `{{ doc("name") }}` references on the DataLex side.
    # We do NOT auto-infer from the manifest path: a temp manifest with no
    # surrounding project would scan the entire filesystem.
    doc_blocks: Optional[DocBlockIndex] = None
    if dbt_project_root:
        doc_blocks = DocBlockIndex.build(dbt_project_root)

    result = ImportResult()

    nodes = manifest.get("nodes") or {}
    sources = manifest.get("sources") or {}

    # Index generic tests (relationships / not_null / unique / accepted_values)
    # once up-front. dbt stores tests as top-level nodes that depend on the
    # model or source they test; without this index the column builders would
    # silently drop every FK on import (the bug Phase 0.2 fixes).
    test_index = _build_test_index(manifest)

    # Sources are keyed by source_name in dbt; group per source_name so we emit one file per source.
    sources_grouped: Dict[str, List[Dict[str, Any]]] = {}
    for uid, node in sources.items():
        source_name = node.get("source_name") or node.get("name")
        sources_grouped.setdefault(source_name, []).append(node)

    for source_name, tables in sources_grouped.items():
        doc = _build_source_doc(source_name, tables, existing, catalog, test_index, doc_blocks)
        result.sources[doc["name"]] = doc
        src_path = _common_source_path(tables)
        if src_path:
            result.source_paths["sources"][doc["name"]] = src_path

    for uid, node in nodes.items():
        rt = node.get("resource_type")
        rel_path = node.get("original_file_path") or ""
        if rt == "model":
            doc = _build_model_doc(node, existing, catalog, test_index, doc_blocks)
            result.models[doc["name"]] = doc
            if rel_path:
                result.source_paths["models"][doc["name"]] = rel_path
        elif rt == "snapshot":
            doc = _build_snapshot_doc(node, existing, catalog, doc_blocks)
            result.snapshots[doc["name"]] = doc
            if rel_path:
                result.source_paths["snapshots"][doc["name"]] = rel_path
        elif rt == "seed":
            doc = _build_seed_doc(node, existing, catalog, doc_blocks)
            result.seeds[doc["name"]] = doc
            if rel_path:
                result.source_paths["seeds"][doc["name"]] = rel_path
        elif rt == "unit_test":
            doc = _build_unit_test_doc(node)
            result.unit_tests[doc["name"]] = doc
            if rel_path:
                result.source_paths["unit_tests"][doc["name"]] = rel_path

    for uid, node in (manifest.get("exposures") or {}).items():
        doc = _build_exposure_doc(node)
        result.exposures[doc["name"]] = doc
        rel_path = node.get("original_file_path") or ""
        if rel_path:
            result.source_paths["exposures"][doc["name"]] = rel_path

    for uid, node in (manifest.get("semantic_models") or {}).items():
        doc = _build_semantic_model_doc(node)
        result.semantic_models[doc["name"]] = doc
        rel_path = node.get("original_file_path") or ""
        if rel_path:
            result.source_paths["semantic_models"][doc["name"]] = rel_path

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
    test_index: Optional[Dict[Tuple[str, str], List[Any]]] = None,
    doc_blocks: Optional[DocBlockIndex] = None,
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
        table_docs.append(_build_source_table_doc(t, existing_doc, catalog, test_index, doc_blocks))
    doc["tables"] = table_docs

    _attach_description_ref(doc, existing_doc, doc_blocks)

    # meta.datalex.dbt.unique_id list, so re-import can find this doc even if one table is renamed.
    doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {
        "unique_ids": sorted(t.get("unique_id") for t in tables if t.get("unique_id")),
    }
    return doc


def _build_source_table_doc(
    t: Dict[str, Any],
    existing_source: Optional[Dict[str, Any]],
    catalog: CatalogIndex,
    test_index: Optional[Dict[Tuple[str, str], List[Any]]] = None,
    doc_blocks: Optional[DocBlockIndex] = None,
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
            _build_source_column_doc(c, prior_cols.get(c.get("name"), {}), catalog, tbl_uid, test_index, doc_blocks)
        )
    if cols_out:
        table_doc["columns"] = cols_out

    _attach_description_ref(table_doc, prior_table, doc_blocks)

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
    test_index: Optional[Dict[Tuple[str, str], List[Any]]] = None,
    doc_blocks: Optional[DocBlockIndex] = None,
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
    for k in ("description", "description_ref", "sensitivity", "tags"):
        if prior.get(k):
            doc[k] = prior[k]
    # manifest description wins only if user has no override
    if c.get("description") and "description" not in doc:
        doc["description"] = c["description"]

    _attach_description_ref(doc, prior, doc_blocks)

    _apply_column_tests(doc, prior, test_index, table_unique_id, c.get("name") or "")

    return doc


def _build_model_doc(
    node: Dict[str, Any],
    existing: Dict[str, Dict[str, Any]],
    catalog: CatalogIndex,
    test_index: Optional[Dict[Tuple[str, str], List[Any]]] = None,
    doc_blocks: Optional[DocBlockIndex] = None,
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
        doc, prior, keys=("description", "description_ref", "owner", "domain", "tags", "materialization", "contract", "interface"),
    )

    interface_meta = ((node.get("meta") or {}).get("datalex") or {}).get("interface")
    if interface_meta and "interface" not in doc:
        doc["interface"] = interface_meta

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
            _build_model_column_doc(c, prior_cols.get(c.get("name"), {}), catalog, uid or "", test_index, doc_blocks)
        )
    if cols_out:
        doc["columns"] = cols_out

    _attach_description_ref(doc, prior, doc_blocks)

    if uid:
        doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {"unique_id": uid}

    return doc


def _build_model_column_doc(
    c: Dict[str, Any],
    prior: Dict[str, Any],
    catalog: CatalogIndex,
    model_unique_id: str,
    test_index: Optional[Dict[Tuple[str, str], List[Any]]] = None,
    doc_blocks: Optional[DocBlockIndex] = None,
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

    for k in ("description", "description_ref", "sensitivity", "tags", "terms", "tests", "constraints"):
        if prior.get(k):
            doc[k] = prior[k]
    if c.get("description") and "description" not in doc:
        doc["description"] = c["description"]

    _attach_description_ref(doc, prior, doc_blocks)

    _apply_column_tests(doc, prior, test_index, model_unique_id, c.get("name") or "")

    return doc


def _build_snapshot_doc(
    node: Dict[str, Any],
    existing: Dict[str, Dict[str, Any]],
    catalog: CatalogIndex,
    doc_blocks: Optional[DocBlockIndex] = None,
) -> Dict[str, Any]:
    """Build a DataLex snapshot doc from a dbt manifest snapshot node.

    dbt snapshots carry SCD strategy + unique_key as first-class config.
    These are critical for round-trip — losing them breaks behaviour.
    """
    name = _safe_name(node.get("name", ""))
    uid = node.get("unique_id")
    prior = existing.get(uid, {}) if uid else {}

    config = node.get("config") or {}
    doc: Dict[str, Any] = {
        "kind": "snapshot",
        "name": name,
    }
    _merge_preserving_user_fields(
        doc, prior, keys=("description", "description_ref", "owner", "tags", "meta"),
    )
    if node.get("database"):
        doc["database"] = node["database"]
    if node.get("schema"):
        doc["schema"] = node["schema"]
    if node.get("description") and "description" not in doc:
        doc["description"] = node["description"]

    # SCD config — strategy/unique_key/check_cols/updated_at
    scd: Dict[str, Any] = {}
    for key in ("strategy", "unique_key", "updated_at"):
        if config.get(key) is not None:
            scd[key] = config[key]
    if isinstance(config.get("check_cols"), list):
        scd["check_cols"] = list(config["check_cols"])
    if isinstance(config.get("invalidate_hard_deletes"), bool):
        scd["invalidate_hard_deletes"] = config["invalidate_hard_deletes"]
    if scd:
        doc["snapshot"] = scd

    cols_out: List[Dict[str, Any]] = []
    columns_raw = node.get("columns") or {}
    column_iter = columns_raw.values() if isinstance(columns_raw, dict) else columns_raw
    prior_cols = {c.get("name"): c for c in (prior.get("columns") or []) if c.get("name")}
    for c in column_iter:
        col_doc: Dict[str, Any] = {"name": c.get("name")}
        if c.get("data_type"):
            col_doc["type"] = c["data_type"]
        else:
            ct = catalog.column_type(uid or "", c.get("name") or "")
            if ct:
                col_doc["type"] = ct
            elif (prior_cols.get(c.get("name")) or {}).get("type"):
                col_doc["type"] = prior_cols[c.get("name")]["type"]
            else:
                col_doc["type"] = "unknown"
        if c.get("description"):
            col_doc["description"] = c["description"]
        _attach_description_ref(col_doc, prior_cols.get(c.get("name"), {}), doc_blocks)
        cols_out.append(col_doc)
    if cols_out:
        doc["columns"] = cols_out

    _attach_description_ref(doc, prior, doc_blocks)
    if uid:
        doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {"unique_id": uid}
    return doc


def _build_seed_doc(
    node: Dict[str, Any],
    existing: Dict[str, Dict[str, Any]],
    catalog: CatalogIndex,
    doc_blocks: Optional[DocBlockIndex] = None,
) -> Dict[str, Any]:
    """Build a DataLex seed doc from a dbt manifest seed node."""
    name = _safe_name(node.get("name", ""))
    uid = node.get("unique_id")
    prior = existing.get(uid, {}) if uid else {}

    doc: Dict[str, Any] = {"kind": "seed", "name": name}
    _merge_preserving_user_fields(
        doc, prior, keys=("description", "description_ref", "owner", "tags", "meta"),
    )
    if node.get("description") and "description" not in doc:
        doc["description"] = node["description"]

    cols_out: List[Dict[str, Any]] = []
    columns_raw = node.get("columns") or {}
    column_iter = columns_raw.values() if isinstance(columns_raw, dict) else columns_raw
    for c in column_iter:
        col_doc: Dict[str, Any] = {"name": c.get("name")}
        if c.get("data_type"):
            col_doc["type"] = c["data_type"]
        if c.get("description"):
            col_doc["description"] = c["description"]
        cols_out.append(col_doc)
    if cols_out:
        doc["columns"] = cols_out

    _attach_description_ref(doc, prior, doc_blocks)
    if uid:
        doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {"unique_id": uid}
    return doc


def _build_exposure_doc(node: Dict[str, Any]) -> Dict[str, Any]:
    """Build a DataLex exposure doc.

    dbt exposures describe downstream consumers (dashboards, ML models,
    notebooks). DataLex tracks them so the readiness gate can flag stale
    owners and missing maturity.
    """
    name = _safe_name(node.get("name", ""))
    doc: Dict[str, Any] = {"kind": "exposure", "name": name}
    for k in ("description", "label", "type", "url", "maturity"):
        if node.get(k):
            doc[k] = node[k]
    owner = node.get("owner") or {}
    if isinstance(owner, dict):
        owner_doc = {k: v for k, v in owner.items() if v}
        if owner_doc:
            doc["owner"] = owner_doc
    depends = []
    for parent_uid in (node.get("depends_on", {}) or {}).get("nodes", []) or []:
        if parent_uid.startswith("model."):
            depends.append({"ref": _safe_name(parent_uid.rsplit(".", 1)[-1])})
        elif parent_uid.startswith("source."):
            parts = parent_uid.split(".")
            if len(parts) >= 4:
                depends.append({"source": {"source": _safe_name(parts[-2]), "name": _safe_name(parts[-1])}})
    if depends:
        doc["depends_on"] = depends
    if node.get("unique_id"):
        doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {"unique_id": node["unique_id"]}
    return doc


def _build_unit_test_doc(node: Dict[str, Any]) -> Dict[str, Any]:
    """Build a DataLex unit-test doc from a dbt 1.8+ unit test node."""
    name = _safe_name(node.get("name", ""))
    doc: Dict[str, Any] = {"kind": "unit_test", "name": name}
    if node.get("description"):
        doc["description"] = node["description"]
    if node.get("model"):
        doc["model"] = _safe_name(node["model"])
    if isinstance(node.get("given"), list):
        doc["given"] = list(node["given"])
    if isinstance(node.get("expect"), dict):
        doc["expect"] = dict(node["expect"])
    if isinstance(node.get("overrides"), dict):
        doc["overrides"] = dict(node["overrides"])
    if node.get("unique_id"):
        doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {"unique_id": node["unique_id"]}
    return doc


def _build_semantic_model_doc(node: Dict[str, Any]) -> Dict[str, Any]:
    """Build a DataLex semantic-model doc from a dbt MetricFlow semantic_model."""
    name = _safe_name(node.get("name", ""))
    doc: Dict[str, Any] = {"kind": "semantic_model", "name": name}
    for k in ("description", "label", "model"):
        if node.get(k):
            doc[k] = node[k] if k != "model" else _safe_name(str(node[k]))
    for collection in ("entities", "dimensions", "measures"):
        items = node.get(collection)
        if isinstance(items, list) and items:
            doc[collection] = list(items)
    defaults = node.get("defaults")
    if isinstance(defaults, dict) and defaults:
        doc["defaults"] = dict(defaults)
    if node.get("unique_id"):
        doc.setdefault("meta", {}).setdefault("datalex", {})["dbt"] = {"unique_id": node["unique_id"]}
    return doc


def _attach_description_ref(
    doc: Dict[str, Any],
    prior: Optional[Dict[str, Any]],
    doc_blocks: Optional[DocBlockIndex],
) -> None:
    """Attach `description_ref` so emit.py can re-emit `{{ doc("…") }}`.

    Precedence: a prior user-authored ref always wins. If the prior YAML
    didn't carry one but the manifest description matches a known doc-block
    body, recover the reference from the index. This is what makes a fresh
    `dbt import → emit` round-trip lossless on doc-block-bound columns.
    """
    if isinstance(prior, dict) and prior.get("description_ref"):
        doc.setdefault("description_ref", prior["description_ref"])
        return
    if "description_ref" in doc:
        return
    description = doc.get("description")
    if not description or not doc_blocks:
        return
    ref = find_description_ref(str(description), doc_blocks)
    if ref:
        doc["description_ref"] = ref


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
    if not name:
        return "unnamed"
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9_]", "_", s)
    if not re.match(r"^[a-z]", s):
        s = "n_" + s
    return s


# ------------------------ generic-test extraction ------------------------
#
# dbt stores generic tests (`not_null`, `unique`, `relationships`, custom, ...)
# as top-level nodes under `manifest.nodes` with `resource_type == "test"`.
# They point at the tested model/source via `attached_node` (modern dbt) or
# `depends_on.nodes` (older dbt), and at the column via `column_name`.
#
# Before v1.0.6 the importer silently dropped every generic test. The biggest
# casualty was `relationships` tests — the primary way dbt users declare FKs
# — so imported projects rendered without any edges on the diagram even when
# schema.yml had full FK coverage. These helpers reconstruct that information
# and hand it to `_apply_column_tests` below.


def _test_parent_unique_id(node: Dict[str, Any]) -> Optional[str]:
    """Return the unique_id of the model/source a generic test is attached to.

    Strategy:
      1. Modern dbt (1.5+) exposes `attached_node` directly — trust it.
      2. Older dbt records every ref/source the test touches under
         `depends_on.nodes`. For most tests there's exactly one parent; for
         `relationships` tests two show up (parent model + `to:` target), so
         we exclude the ref'd target and pick what's left.
      3. Final fallback: the first dep, so we degrade gracefully rather than
         dropping the test entirely.
    """
    attached = node.get("attached_node")
    if attached:
        return attached
    deps = [
        n
        for n in ((node.get("depends_on") or {}).get("nodes") or [])
        if n.startswith("model.") or n.startswith("source.")
    ]
    if not deps:
        return None
    if len(deps) == 1:
        return deps[0]
    meta = node.get("test_metadata") or {}
    kwargs = meta.get("kwargs") or {}
    to_raw = str(kwargs.get("to") or "")
    m = re.search(r"ref\(\s*['\"]([^'\"]+)['\"]", to_raw)
    if m:
        target_name = m.group(1)
        non_target = [d for d in deps if d.rsplit(".", 1)[-1] != target_name]
        if len(non_target) == 1:
            return non_target[0]
    return deps[0]


def _build_test_index(
    manifest: Dict[str, Any],
) -> Dict[Tuple[str, str], List[Any]]:
    """Index column-level generic tests by (parent_unique_id, column_name).

    Each list entry is already in the dbt-native schema.yml shape — bare
    strings (`"not_null"`, `"unique"`) or single-key dicts (`{"relationships":
    {...}}`, `{"accepted_values": {...}}`) — so the emitter can pass them
    through verbatim on save for a lossless round-trip.
    """
    idx: Dict[Tuple[str, str], List[Any]] = {}
    nodes = manifest.get("nodes") or {}
    for _uid, node in nodes.items():
        if node.get("resource_type") != "test":
            continue
        meta = node.get("test_metadata") or {}
        name = meta.get("name")
        if not name:
            continue
        col = node.get("column_name")
        if not col:
            # Model-level tests have no column_name — skip for now; they'd
            # round-trip into a different (model-level) `tests:` block.
            continue
        parent = _test_parent_unique_id(node)
        if not parent:
            continue
        kwargs = meta.get("kwargs") or {}
        if name == "not_null":
            entry: Any = "not_null"
        elif name == "unique":
            entry = "unique"
        elif name == "relationships":
            entry = {
                "relationships": {
                    "to": kwargs.get("to") or "",
                    "field": kwargs.get("field") or "id",
                }
            }
        elif name == "accepted_values":
            entry = {"accepted_values": {"values": kwargs.get("values") or []}}
        else:
            # Custom / namespaced tests — carry through by name so emit.py
            # preserves the declaration.
            entry = {name: {k: v for k, v in kwargs.items() if k != "column_name"}}
        idx.setdefault((parent, col), []).append(entry)
    return idx


def _resolve_relationships_target(to_raw: Any) -> Optional[str]:
    """Resolve a `relationships.to:` jinja expression to a DataLex entity name.

    Handles `ref('x')` and `source('s','t')` — the two shapes dbt emits.
    Returns None for anything else so the caller can fall back to emitting the
    raw `tests:` list without a derived `foreign_key:` shorthand.
    """
    s = str(to_raw or "")
    if not s:
        return None
    m = re.search(r"ref\(\s*['\"]([^'\"]+)['\"]", s)
    if m:
        return _safe_name(m.group(1))
    m = re.search(r"source\(\s*['\"][^'\"]+['\"]\s*,\s*['\"]([^'\"]+)['\"]", s)
    if m:
        return _safe_name(m.group(1))
    return None


def _apply_column_tests(
    doc: Dict[str, Any],
    prior: Dict[str, Any],
    test_index: Optional[Dict[Tuple[str, str], List[Any]]],
    parent_uid: str,
    column_name: str,
) -> None:
    """Merge tests from the manifest test index onto an emitted column doc.

    We do three things:
      1. Union the new tests into the column's existing `tests:` list (prior
         user-authored tests win on exact equality).
      2. Derive DataLex-native shorthands (`nullable: false`, `unique: true`,
         `foreign_key: {entity, field}`) so the frontend schemaAdapter and the
         validation layer don't need to re-parse the `tests:` list at read
         time.
      3. Leave the raw `tests:` list in place — `dbt/emit.py` passes it through
         verbatim, so a subsequent dbt save round-trips losslessly.

    Designed to be idempotent: calling it on a column that was already imported
    (with `prior` carrying the previous DataLex doc) merges new tests but
    doesn't clobber user-authored shorthands.
    """
    if not test_index:
        return
    new_tests = test_index.get((parent_uid, column_name)) or []
    if not new_tests:
        return

    existing_tests: List[Any] = list(doc.get("tests") or [])
    for t in new_tests:
        if t not in existing_tests:
            existing_tests.append(t)
    if existing_tests:
        doc["tests"] = existing_tests

    # Union with prior-authored shorthands — never overwrite user intent.
    for t in new_tests:
        if t == "not_null":
            if doc.get("nullable") is None and prior.get("nullable") is None:
                doc["nullable"] = False
        elif t == "unique":
            if not doc.get("unique") and not prior.get("unique"):
                doc["unique"] = True
        elif isinstance(t, dict) and "relationships" in t:
            if doc.get("foreign_key") or prior.get("foreign_key"):
                continue
            rel = t.get("relationships") or {}
            target = _resolve_relationships_target(rel.get("to"))
            if not target:
                continue
            doc["foreign_key"] = {
                "entity": target,
                "field": rel.get("field") or "id",
            }


def _write_yaml(path: Path, doc: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(doc, f, sort_keys=False, default_flow_style=False, allow_unicode=True)
