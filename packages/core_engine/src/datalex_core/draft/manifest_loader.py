"""Load and condense a dbt `target/manifest.json` for AI prompt consumption.

A real dbt manifest is often >10MB. The model only needs a tiny relevant
slice: model names, descriptions, columns, ref()/source() edges, and the
basic test annotations that imply constraints. This module produces a
compact JSON dict the prompt can fit comfortably.
"""

from __future__ import annotations

import fnmatch
import json
import subprocess
from pathlib import Path
from typing import Any


def load_manifest(dbt_project_root: Path) -> dict[str, Any]:
    manifest_path = dbt_project_root / "target" / "manifest.json"
    if not manifest_path.exists():
        project_yml = dbt_project_root / "dbt_project.yml"
        if not project_yml.exists():
            raise FileNotFoundError(
                f"No target/manifest.json or dbt_project.yml at {dbt_project_root}. "
                "Pass --dbt to a real dbt project root."
            )
        subprocess.run(
            ["dbt", "parse"],
            cwd=dbt_project_root,
            check=True,
            capture_output=True,
        )
    with manifest_path.open("r") as fh:
        return json.load(fh)


def _flatten_tests(nodes: dict[str, Any]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for node in nodes.values():
        if node.get("resource_type") != "test":
            continue
        column = node.get("column_name")
        attached_to = _attached_model_name(node)
        if not (column and attached_to):
            continue
        test_name = node.get("test_metadata", {}).get("name") or node.get("name", "")
        out.setdefault(f"{attached_to}::{column}", []).append(test_name)
    return out


def _attached_model_name(node: dict[str, Any]) -> str | None:
    attached = node.get("attached_node")
    if attached:
        return attached.split(".")[-1]
    refs = node.get("refs") or []
    if refs and isinstance(refs[0], dict):
        return refs[0].get("name")
    if refs and isinstance(refs[0], list) and refs[0]:
        return refs[0][0]
    return None


def condense_manifest(
    manifest: dict[str, Any],
    *,
    include_glob: str | None = None,
) -> dict[str, Any]:
    nodes = manifest.get("nodes", {})
    sources = manifest.get("sources", {})
    test_index = _flatten_tests(nodes)

    models: list[dict[str, Any]] = []
    for unique_id, node in nodes.items():
        if node.get("resource_type") != "model":
            continue
        name = node.get("name", "")
        if include_glob and not fnmatch.fnmatch(name, include_glob):
            continue
        columns = []
        for col_name, col in (node.get("columns") or {}).items():
            constraints = test_index.get(f"{name}::{col_name}", [])
            columns.append(
                {
                    "name": col_name,
                    "type": col.get("data_type") or _infer_type(col),
                    "description": col.get("description", ""),
                    "constraints": sorted(set(constraints)),
                }
            )
        refs = []
        for ref in node.get("refs") or []:
            ref_name = ref.get("name") if isinstance(ref, dict) else (
                ref[0] if isinstance(ref, list) and ref else None
            )
            if ref_name:
                refs.append(ref_name)
        models.append(
            {
                "name": name,
                "description": node.get("description", ""),
                "schema": node.get("schema", ""),
                "materialization": (node.get("config") or {}).get("materialized", ""),
                "tags": node.get("tags") or [],
                "meta": _slim_meta(node.get("meta") or {}),
                "columns": columns,
                "refs": sorted(set(refs)),
            }
        )

    src_list: list[dict[str, Any]] = []
    for src in sources.values():
        src_list.append(
            {
                "name": f"{src.get('source_name')}.{src.get('name')}",
                "description": src.get("description", ""),
                "columns": [
                    {
                        "name": col_name,
                        "type": col.get("data_type", ""),
                        "description": col.get("description", ""),
                    }
                    for col_name, col in (src.get("columns") or {}).items()
                ],
            }
        )

    return {
        "project": manifest.get("metadata", {}).get("project_name", ""),
        "dialect": manifest.get("metadata", {}).get("adapter_type", ""),
        "models": sorted(models, key=lambda m: m["name"]),
        "sources": sorted(src_list, key=lambda s: s["name"]),
    }


def _infer_type(col: dict[str, Any]) -> str:
    return col.get("meta", {}).get("type", "")


def _slim_meta(meta: dict[str, Any]) -> dict[str, Any]:
    keep = {"datalex", "owner", "domain", "subject_area", "pii", "stability"}
    return {k: v for k, v in meta.items() if k in keep}
