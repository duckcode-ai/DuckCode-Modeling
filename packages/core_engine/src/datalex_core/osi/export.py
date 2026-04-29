"""OSI 0.1.1 bundle exporter (Python).

Walks a DataLex project directory, parses every .yml/.yaml file under
the model path, and emits an Open Semantic Interchange bundle. Mirrors
packages/api-server/ai/osi/osi-export.js — the JS HTTP endpoint and the
Python MCP / CLI surface produce the same JSON for the same input.

Visibility gate: entities and relationships marked `visibility: internal`
are skipped from the export. `shared` (default) and `public` are
included. This is the lever Phase 2a relies on so internal-only concepts
don't leak to AI agents.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import yaml

OSI_SPEC_VERSION = "0.1.1"
_DEFAULT_DIALECT = "ANSI_SQL"


def _is_visible(entity: Dict[str, Any]) -> bool:
    v = str((entity or {}).get("visibility") or "").strip().lower()
    if not v:
        return True
    return v in ("shared", "public")


def _to_osi_name(value: Any, fallback: str = "unnamed") -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        return fallback
    return cleaned.replace(" ", "_")


def _ai_context(
    description: Optional[str] = None,
    terms: Optional[Iterable[Any]] = None,
    verb: Optional[str] = None,
    instructions: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    syns = [str(t) for t in (terms or []) if t]
    inst = instructions or verb or description
    if not syns and not inst:
        return None
    out: Dict[str, Any] = {}
    if inst:
        out["instructions"] = str(inst)
    if syns:
        out["synonyms"] = syns
    return out


def _build_field(field: Dict[str, Any]) -> Dict[str, Any]:
    name = _to_osi_name(field.get("name"))
    out: Dict[str, Any] = {
        "name": name,
        "expression": {
            "dialects": [{"dialect": _DEFAULT_DIALECT, "expression": name}]
        },
    }
    if field.get("description"):
        out["description"] = str(field["description"])
    return out


def _build_dataset(entity: Dict[str, Any], file_hint: str = "") -> Dict[str, Any]:
    name = _to_osi_name(entity.get("name"))
    explicit_source = (
        entity.get("source")
        or entity.get("materialization")
        or entity.get("dbt_ref")
        or (entity.get("physical") or {}).get("source")
    )
    if explicit_source:
        source = str(explicit_source)
    elif file_hint:
        stem = file_hint
        for suffix in (".yml", ".yaml"):
            if stem.lower().endswith(suffix):
                stem = stem[: -len(suffix)]
        source = f"datalex:{stem}#{name}"
    else:
        source = f"datalex:conceptual#{name}"

    fields = [_build_field(f) for f in (entity.get("fields") or []) if f and f.get("name")]
    out: Dict[str, Any] = {"name": name, "source": source}
    if fields:
        out["fields"] = fields
    if entity.get("description"):
        out["description"] = str(entity["description"])
    ai = _ai_context(description=entity.get("description"), terms=entity.get("terms"))
    if ai:
        out["ai_context"] = ai
    candidate_keys = entity.get("candidate_keys") or []
    if candidate_keys:
        out["primary_key"] = [str(k) for k in candidate_keys[0]]
        if len(candidate_keys) > 1:
            out["unique_keys"] = [[str(k) for k in ck] for ck in candidate_keys[1:]]
    else:
        pk_fields = [str(f["name"]) for f in (entity.get("fields") or []) if f and f.get("primary_key")]
        if pk_fields:
            out["primary_key"] = pk_fields
    return out


def _endpoint_name(value: Any) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        return value.split(".")[0]
    if isinstance(value, dict):
        for k in ("entity", "dataset", "name"):
            if value.get(k):
                return str(value[k])
    return ""


def _endpoint_columns(value: Any) -> List[str]:
    if not value:
        return ["id"]
    if isinstance(value, str):
        parts = value.split(".")
        return [".".join(parts[1:])] if len(parts) > 1 else ["id"]
    if isinstance(value, dict):
        if value.get("field"):
            return [str(value["field"])]
        if value.get("column"):
            return [str(value["column"])]
    return ["id"]


def _build_relationship(rel: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(rel, dict):
        return None
    if not _is_visible(rel):
        return None
    from_name = _endpoint_name(rel.get("from"))
    to_name = _endpoint_name(rel.get("to"))
    if not from_name or not to_name:
        return None
    out: Dict[str, Any] = {
        "name": _to_osi_name(rel.get("name") or f"{from_name}_to_{to_name}"),
        "from": from_name,
        "to": to_name,
        "from_columns": _endpoint_columns(rel.get("from")),
        "to_columns": _endpoint_columns(rel.get("to")),
    }
    verb = rel.get("verb")
    instructions_text = (
        f"{from_name} {str(verb).replace('_', ' ')} {to_name}." if verb else None
    )
    ai = _ai_context(verb=instructions_text, description=rel.get("description"))
    if ai:
        out["ai_context"] = ai
    return out


def _build_metric(metric: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not metric or not metric.get("name"):
        return None
    expr = (
        metric.get("expression")
        or metric.get("expr")
        or (
            f"{metric.get('aggregation')}({metric.get('column')})"
            if metric.get("aggregation") and metric.get("column")
            else "/* TODO: define expression */"
        )
    )
    out: Dict[str, Any] = {
        "name": _to_osi_name(metric["name"]),
        "expression": {"dialects": [{"dialect": _DEFAULT_DIALECT, "expression": str(expr)}]},
    }
    if metric.get("description"):
        out["description"] = str(metric["description"])
    return out


def export_osi_bundle(
    project_name: str = "datalex_project",
    yaml_docs: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """Build an OSI bundle from a list of (path, content) docs.

    Each yaml_doc is a dict with `path` and `content` keys, mirroring
    the JS API. Use export_osi_bundle_for_dir() to build the list
    automatically from a project directory.
    """
    docs = yaml_docs or []
    semantic_models: List[Dict[str, Any]] = []
    for doc in docs:
        if not doc or not doc.get("content"):
            continue
        try:
            parsed = yaml.safe_load(doc["content"])
        except yaml.YAMLError:
            continue
        if not isinstance(parsed, dict):
            continue
        meta = parsed.get("model") if isinstance(parsed.get("model"), dict) else parsed
        path_hint = doc.get("path") or ""
        base_name = _to_osi_name(
            parsed.get("name")
            or (meta or {}).get("name")
            or path_hint.replace(".yaml", "").replace(".yml", "").rsplit("/", 1)[-1]
            or "model"
        )
        description = parsed.get("description") or (meta or {}).get("description") or ""

        entities = [e for e in (parsed.get("entities") or []) if isinstance(e, dict) and _is_visible(e)]
        datasets = [_build_dataset(e, path_hint) for e in entities]
        if not datasets:
            continue
        relationships = [_build_relationship(r) for r in (parsed.get("relationships") or [])]
        relationships = [r for r in relationships if r]
        metrics = [_build_metric(m) for m in (parsed.get("metrics") or [])]
        metrics = [m for m in metrics if m]

        sm: Dict[str, Any] = {"name": base_name, "datasets": datasets}
        if description:
            sm["description"] = str(description)
        ai = _ai_context(description=description)
        if ai:
            sm["ai_context"] = ai
        if relationships:
            sm["relationships"] = relationships
        if metrics:
            sm["metrics"] = metrics
        sm["custom_extensions"] = [
            {
                "vendor_name": "COMMON",
                "data": json.dumps({"datalex_project": project_name, "datalex_version": "1.7.0-pre"}),
            }
        ]
        semantic_models.append(sm)

    bundle: Dict[str, Any] = {
        "version": OSI_SPEC_VERSION,
        "semantic_model": semantic_models,
    }
    if semantic_models:
        bundle["dialects"] = [_DEFAULT_DIALECT]
        bundle["vendors"] = ["COMMON", "DBT"]
    return bundle


def export_osi_bundle_for_dir(project_dir: Path, project_name: Optional[str] = None) -> Dict[str, Any]:
    """Walk a project directory and build the OSI bundle from every YAML file."""
    root = Path(project_dir)
    docs: List[Dict[str, str]] = []
    if root.is_dir():
        for yaml_path in sorted(root.rglob("*.y*ml")):
            # Skip hidden / vendored directories the same way the JS walker does.
            if any(part.startswith(".") for part in yaml_path.relative_to(root).parts):
                continue
            if "node_modules" in yaml_path.parts:
                continue
            try:
                content = yaml_path.read_text(encoding="utf-8")
            except OSError:
                continue
            docs.append({"path": str(yaml_path.relative_to(root)), "content": content})
    return export_osi_bundle(project_name or root.name or "datalex_project", docs)


def validate_osi_bundle(bundle: Dict[str, Any]) -> List[Dict[str, str]]:
    """Lightweight validator. Mirrors the JS validateOsiBundle()."""
    issues: List[Dict[str, str]] = []
    if not isinstance(bundle, dict):
        return [{"path": "/", "message": "bundle must be an object"}]
    if bundle.get("version") != OSI_SPEC_VERSION:
        issues.append({"path": "/version", "message": f"version must be {OSI_SPEC_VERSION!r}"})
    sms = bundle.get("semantic_model")
    if not isinstance(sms, list):
        issues.append({"path": "/semantic_model", "message": "semantic_model must be an array"})
        return issues
    for i, sm in enumerate(sms):
        base = f"/semantic_model/{i}"
        if not sm.get("name"):
            issues.append({"path": f"{base}/name", "message": "name is required"})
        datasets = sm.get("datasets") or []
        if not datasets:
            issues.append({"path": f"{base}/datasets", "message": "at least one dataset is required"})
        for j, ds in enumerate(datasets):
            ds_base = f"{base}/datasets/{j}"
            if not ds.get("name"):
                issues.append({"path": f"{ds_base}/name", "message": "dataset name is required"})
            if not ds.get("source"):
                issues.append({"path": f"{ds_base}/source", "message": "dataset source is required"})
            for k, f in enumerate(ds.get("fields") or []):
                if not f.get("name"):
                    issues.append({"path": f"{ds_base}/fields/{k}/name", "message": "field name is required"})
                if not f.get("expression"):
                    issues.append({"path": f"{ds_base}/fields/{k}/expression", "message": "field expression is required"})
        for k, rel in enumerate(sm.get("relationships") or []):
            r_base = f"{base}/relationships/{k}"
            for required_key in ("name", "from", "to"):
                if not rel.get(required_key):
                    issues.append({"path": f"{r_base}/{required_key}", "message": f"{required_key} is required"})
            for cols_key in ("from_columns", "to_columns"):
                cols = rel.get(cols_key) or []
                if not cols:
                    issues.append({"path": f"{r_base}/{cols_key}", "message": f"{cols_key} must be a non-empty array"})
    return issues
