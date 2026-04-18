"""`dbt sync` orchestrator — the adoption-shaped one-command flow.

Given a dbt project directory, sync pulls:
  1. `target/manifest.json` (dbt compiles it with `dbt parse`; we just read it)
  2. The warehouse columns for every source + model, via the active profile

And merges them into a DataLex project tree:
  * user-authored fields (descriptions, tags, sensitivity, tests, etc.) are
    preserved — manifest round-trip semantics from phase B
  * `data_type` on every column comes from the warehouse when we can reach it,
    otherwise from the manifest, otherwise left blank
  * on re-sync, the `meta.datalex.dbt.unique_id` stable key means we never
    duplicate entities

The flow is offline-safe: if the warehouse is unreachable (or the table hasn't
been built yet), we degrade to manifest-only columns and annotate a warning.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dm_core.dbt.manifest import import_manifest, write_import_result
from dm_core.dbt.profiles import (
    ProfileError,
    ProfileTarget,
    resolve_for_dbt_project,
)
from dm_core.dbt.warehouse import (
    WarehouseColumn,
    WarehouseError,
    introspect_table,
)


# ------------------------ report ------------------------


@dataclass
class TableSyncRecord:
    unique_id: str
    kind: str  # 'source' | 'model'
    database: Optional[str]
    schema: Optional[str]
    table: str
    warehouse_reachable: bool
    columns_from_warehouse: int = 0
    columns_from_manifest: int = 0
    error: Optional[str] = None


@dataclass
class SyncReport:
    dbt_project: str
    datalex_root: str
    profile_name: Optional[str] = None
    target_name: Optional[str] = None
    dialect: Optional[str] = None
    tables: List[TableSyncRecord] = field(default_factory=list)
    files_written: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def summary(self) -> str:
        reached = sum(1 for t in self.tables if t.warehouse_reachable)
        lines = [
            "dbt sync complete",
            f"  dbt project: {self.dbt_project}",
            f"  DataLex out: {self.datalex_root}",
            f"  profile:     {self.profile_name} / {self.target_name} ({self.dialect})",
            f"  tables:      {len(self.tables)} "
            f"({reached} from warehouse, {len(self.tables) - reached} manifest-only)",
            f"  files:       {len(self.files_written)} written",
        ]
        if self.warnings:
            lines.append("  warnings:")
            for w in self.warnings:
                lines.append(f"    - {w}")
        return "\n".join(lines)


# ------------------------ public entry point ------------------------


def sync_dbt_project(
    dbt_project_dir: str,
    datalex_root: str,
    *,
    profiles_dir: Optional[str] = None,
    target_override: Optional[str] = None,
    skip_warehouse: bool = False,
    manifest_path: Optional[str] = None,
) -> SyncReport:
    """Run the full sync: manifest -> DataLex, enriched by live warehouse types.

    Args:
        dbt_project_dir: Directory containing `dbt_project.yml` and
            `target/manifest.json`.
        datalex_root: Where to write the DataLex source/model YAML tree.
        profiles_dir: Override for profiles.yml search (default: dbt's rules).
        target_override: Pick a non-default target from the profile.
        skip_warehouse: Skip live introspection; rely on manifest `data_type`.
        manifest_path: Override `<dbt_project>/target/manifest.json`.
    """
    dbt_dir = Path(dbt_project_dir)
    out_root = Path(datalex_root)
    manifest = Path(manifest_path) if manifest_path else dbt_dir / "target" / "manifest.json"

    if not manifest.exists():
        raise FileNotFoundError(
            f"manifest.json not found at {manifest}. "
            f"Run `dbt parse` (or `dbt compile`) in the dbt project first."
        )

    report = SyncReport(dbt_project=str(dbt_dir), datalex_root=str(out_root))

    # Step 1: parse manifest (merge-preserving re-import)
    imported = import_manifest(str(manifest), existing_project_root=str(out_root))

    # Step 2: resolve warehouse target (optional)
    target: Optional[ProfileTarget] = None
    if not skip_warehouse:
        try:
            target = resolve_for_dbt_project(
                str(dbt_dir),
                profiles_dir=profiles_dir,
                target_override=target_override,
            )
            report.profile_name = target.profile_name
            report.target_name = target.target_name
            report.dialect = target.dialect
        except ProfileError as e:
            report.warnings.append(f"profile lookup failed — manifest-only sync: {e}")

    # Step 3: introspect each source/model and enrich columns
    for source_doc in imported.sources.values():
        for table_doc in source_doc.get("tables", []) or []:
            rec = _enrich_table(
                table_doc,
                database=source_doc.get("database"),
                schema=source_doc.get("schema"),
                target=target,
                kind="source",
            )
            report.tables.append(rec)

    for model_doc in imported.models.values():
        rec = _enrich_table(
            model_doc,
            database=model_doc.get("database"),
            schema=model_doc.get("schema"),
            target=target,
            kind="model",
        )
        report.tables.append(rec)

    # Step 4: write the DataLex tree
    report.files_written = write_import_result(imported, str(out_root))

    return report


# ------------------------ per-table enrichment ------------------------


def _enrich_table(
    table_doc: Dict[str, Any],
    *,
    database: Optional[str],
    schema: Optional[str],
    target: Optional[ProfileTarget],
    kind: str,
) -> TableSyncRecord:
    uid = (
        (table_doc.get("meta") or {})
        .get("datalex", {})
        .get("dbt", {})
        .get("unique_id", "")
    )
    table_name = table_doc.get("identifier") or table_doc.get("name") or ""

    rec = TableSyncRecord(
        unique_id=uid,
        kind=kind,
        database=database,
        schema=schema,
        table=table_name,
        warehouse_reachable=False,
    )

    manifest_cols = list(table_doc.get("columns") or [])
    rec.columns_from_manifest = sum(1 for c in manifest_cols if c.get("type"))

    if target is None or not schema or not table_name:
        return rec

    db = database or target.database or ""
    try:
        wh_cols = introspect_table(
            dialect=target.dialect,
            config=target.config,
            database=db,
            schema=schema,
            table=table_name,
        )
    except WarehouseError as e:
        rec.error = str(e)
        return rec
    except Exception as e:
        rec.error = f"{type(e).__name__}: {e}"
        return rec

    rec.warehouse_reachable = True
    merged = _merge_warehouse_into_columns(manifest_cols, wh_cols)
    if merged:
        table_doc["columns"] = merged
    rec.columns_from_warehouse = len(wh_cols)
    return rec


def _merge_warehouse_into_columns(
    manifest_cols: List[Dict[str, Any]],
    wh_cols: List[WarehouseColumn],
) -> List[Dict[str, Any]]:
    """Warehouse = authoritative for type + nullability + order.
    Manifest/prior DataLex doc = authoritative for everything else
    (description, sensitivity, tags, tests, constraints, etc.)."""
    by_name = {c.get("name"): dict(c) for c in manifest_cols if c.get("name")}
    out: List[Dict[str, Any]] = []
    for wh in wh_cols:
        existing = by_name.pop(wh.name, {"name": wh.name})
        existing["type"] = wh.data_type
        if wh.nullable is False:
            existing["nullable"] = False
        elif "nullable" in existing and existing["nullable"] is True:
            existing.pop("nullable")
        if wh.description and "description" not in existing:
            existing["description"] = wh.description
        out.append(existing)

    # Any manifest-only columns (e.g. view not yet materialized) keep their
    # place at the end so we don't drop user-authored metadata.
    for leftover in by_name.values():
        out.append(leftover)
    return out


# ------------------------ lightweight JSON view ------------------------


def report_to_json(report: SyncReport) -> str:
    return json.dumps(
        {
            "dbt_project": report.dbt_project,
            "datalex_root": report.datalex_root,
            "profile_name": report.profile_name,
            "target_name": report.target_name,
            "dialect": report.dialect,
            "tables": [
                {
                    "unique_id": t.unique_id,
                    "kind": t.kind,
                    "database": t.database,
                    "schema": t.schema,
                    "table": t.table,
                    "warehouse_reachable": t.warehouse_reachable,
                    "columns_from_warehouse": t.columns_from_warehouse,
                    "columns_from_manifest": t.columns_from_manifest,
                    "error": t.error,
                }
                for t in report.tables
            ],
            "files_written": report.files_written,
            "warnings": report.warnings,
        },
        indent=2,
    )
