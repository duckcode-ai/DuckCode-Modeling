"""dbt YAML emitter.

Given a loaded DataLexProject, emits:
  * sources/<source_name>.yml         — one file per `kind: source`
  * models/_schema.yml                — schema.yml for every `kind: model`

Output is dbt v2 format and includes:
  * contracts (`config.contract.enforced: true` with `data_type` per column)
  * column-level constraints (primary_key / unique / not_null / foreign_key / check)
  * tests (unique / not_null / accepted_values / relationships / custom)
  * freshness (at source level and per-table)
  * meta round-trip via `meta.datalex.*` so reimports never clobber user intent

The dict payloads returned by `build_sources_yaml` / `build_models_yaml` are plain,
serialization-ready dicts — callers choose how to write them (single file, per-file,
etc.) via `write_dbt_yaml`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from dm_core.datalex.project import DataLexProject


# ------------------------ build payloads ------------------------


def build_sources_yaml(project: DataLexProject) -> Dict[str, Dict[str, Any]]:
    """Return { relative_path: source_doc } for every `kind: source` file.

    We split by source name so dbt's `source(name, table)` reference stays stable
    and edit-friendly: sources/<name>.yml.
    """
    out: Dict[str, Dict[str, Any]] = {}
    for src in project.sources.values():
        doc = _source_to_dict(src)
        out[f"sources/{src['name']}.yml"] = {"version": 2, "sources": [doc]}
    return out


def build_models_yaml(project: DataLexProject) -> Dict[str, Dict[str, Any]]:
    """Return { relative_path: models_doc } for every `kind: model` file.

    We collect all models into a single `models/_schema.yml` so dbt can `dbt parse`
    them in one read. Power users can split later; keeping everything in one file
    is the dbt community's default and prevents discovery surprises.
    """
    models = [_model_to_dict(m) for m in project.models.values()]
    if not models:
        return {}
    return {"models/_schema.yml": {"version": 2, "models": models}}


# ------------------------ writing ------------------------


@dataclass
class EmitReport:
    files: List[str] = field(default_factory=list)
    sources: int = 0
    models: int = 0

    def summary(self) -> str:
        lines = ["dbt emission complete:"]
        lines.append(f"  source files: {self.sources}")
        lines.append(f"  model files:  {self.models}")
        for f in self.files:
            lines.append(f"    - {f}")
        return "\n".join(lines)


def emit_dbt(
    project: DataLexProject,
    out_dir: str,
    include_sources: bool = True,
    include_models: bool = True,
) -> EmitReport:
    """Render a DataLexProject into a dbt-parseable YAML tree under out_dir."""
    report = EmitReport()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    if include_sources:
        for rel, payload in build_sources_yaml(project).items():
            target = out / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            _write_yaml(target, payload)
            report.files.append(str(target))
            report.sources += 1

    if include_models:
        for rel, payload in build_models_yaml(project).items():
            target = out / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            _write_yaml(target, payload)
            report.files.append(str(target))
            report.models += 1

    return report


def _write_yaml(path: Path, doc: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(
            doc,
            f,
            sort_keys=False,
            default_flow_style=False,
            allow_unicode=True,
            width=120,
        )


# ------------------------ translators ------------------------


def _source_to_dict(src: Dict[str, Any]) -> Dict[str, Any]:
    doc: Dict[str, Any] = {"name": src["name"]}
    _copy_if_set(doc, src, ("description", "database", "schema", "loader", "loaded_at_field"))
    if src.get("freshness"):
        doc["freshness"] = _translate_freshness(src["freshness"])

    tables_out: List[Dict[str, Any]] = []
    for tbl in src.get("tables", []) or []:
        tables_out.append(_source_table_to_dict(tbl))
    doc["tables"] = tables_out

    meta = _build_meta(src, extra={"kind": "source"})
    if meta:
        doc["meta"] = meta

    return doc


def _source_table_to_dict(tbl: Dict[str, Any]) -> Dict[str, Any]:
    doc: Dict[str, Any] = {"name": tbl["name"]}
    _copy_if_set(doc, tbl, ("description", "identifier", "loaded_at_field"))
    if tbl.get("freshness"):
        doc["freshness"] = _translate_freshness(tbl["freshness"])
    cols_out: List[Dict[str, Any]] = []
    for c in tbl.get("columns", []) or []:
        cols_out.append(_source_column_to_dict(c))
    if cols_out:
        doc["columns"] = cols_out
    meta = _build_meta(tbl)
    if meta:
        doc["meta"] = meta
    return doc


def _source_column_to_dict(col: Dict[str, Any]) -> Dict[str, Any]:
    doc: Dict[str, Any] = {"name": col["name"]}
    _copy_if_set(doc, col, ("description",))
    # sources pass `type` through dbt-side as data_type so contract works downstream
    if col.get("type"):
        doc["data_type"] = col["type"]
    if col.get("tests"):
        doc["tests"] = list(col["tests"])
    meta = _build_meta(col, extra=_sensitivity_meta(col))
    if meta:
        doc["meta"] = meta
    return doc


def _model_to_dict(m: Dict[str, Any]) -> Dict[str, Any]:
    doc: Dict[str, Any] = {"name": m["name"]}
    _copy_if_set(doc, m, ("description",))

    config = _model_config(m)
    if config:
        doc["config"] = config

    cols_out: List[Dict[str, Any]] = []
    contract_enforced = bool((m.get("contract") or {}).get("enforced"))
    for c in m.get("columns", []) or []:
        cols_out.append(_model_column_to_dict(c, contract_enforced=contract_enforced))
    if cols_out:
        doc["columns"] = cols_out

    meta = _build_meta(
        m,
        extra={
            "kind": "model",
            **(
                {"depends_on": [_ref_to_string(r) for r in m["depends_on"]]}
                if m.get("depends_on")
                else {}
            ),
            **({"derived_sql": m["derived_sql"]} if m.get("derived_sql") else {}),
            **({"sql_path": m["sql_path"]} if m.get("sql_path") else {}),
            **({"owner": m["owner"]} if m.get("owner") else {}),
            **({"domain": m["domain"]} if m.get("domain") else {}),
        },
    )
    if meta:
        doc["meta"] = meta

    if m.get("tags"):
        doc.setdefault("config", {})["tags"] = list(m["tags"])

    return doc


def _model_config(m: Dict[str, Any]) -> Dict[str, Any]:
    cfg: Dict[str, Any] = {}
    if m.get("materialization"):
        cfg["materialized"] = m["materialization"]
    if m.get("database"):
        cfg["database"] = m["database"]
    if m.get("schema"):
        cfg["schema"] = m["schema"]
    contract = m.get("contract") or {}
    if contract.get("enforced") is not None:
        cfg["contract"] = {"enforced": bool(contract["enforced"])}
    return cfg


def _model_column_to_dict(col: Dict[str, Any], contract_enforced: bool) -> Dict[str, Any]:
    doc: Dict[str, Any] = {"name": col["name"]}
    _copy_if_set(doc, col, ("description",))

    # Contract enforcement requires data_type; always emit it if present.
    if col.get("type"):
        doc["data_type"] = col["type"]
    elif contract_enforced:
        # dbt parse will fail without data_type on contract-enforced models.
        # Surface this as a YAML-visible TODO rather than silently dropping it.
        doc["data_type"] = "UNSPECIFIED"

    constraints = _translate_constraints(col)
    if constraints:
        doc["constraints"] = constraints

    if col.get("tests"):
        doc["tests"] = list(col["tests"])

    meta = _build_meta(col, extra=_sensitivity_meta(col))
    if meta:
        doc["meta"] = meta
    return doc


def _translate_constraints(col: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert DataLex column constraint rules to dbt constraint entries.

    Pulls from both shorthand fields (primary_key / unique / nullable) and the
    explicit `constraints:` array. Deduplicates by (type, expression) so the
    same intent declared both ways doesn't produce duplicate entries.
    """
    out: List[Dict[str, Any]] = []
    seen: set = set()

    def _add(entry: Dict[str, Any]) -> None:
        key = (entry.get("type"), entry.get("expression"))
        if key not in seen:
            seen.add(key)
            out.append(entry)

    if col.get("primary_key"):
        _add({"type": "primary_key"})
    if col.get("unique"):
        _add({"type": "unique"})
    if col.get("nullable") is False and not col.get("primary_key"):
        _add({"type": "not_null"})

    ref = col.get("references")
    if ref and ref.get("entity") and ref.get("column"):
        _add({"type": "foreign_key", "expression": f"{ref['entity']}({ref['column']})"})

    for c in col.get("constraints", []) or []:
        ctype = c.get("type")
        if ctype in ("primary_key", "unique", "not_null"):
            _add({"type": ctype})
        elif ctype == "check" and c.get("expression"):
            _add({"type": "check", "expression": c["expression"]})
        elif ctype == "foreign_key" and c.get("expression"):
            _add({"type": "foreign_key", "expression": c["expression"]})
    return out


def _translate_freshness(f: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k in ("warn_after", "error_after"):
        if f.get(k):
            out[k] = {"count": f[k]["count"], "period": f[k]["period"]}
    if f.get("filter"):
        out["filter"] = f["filter"]
    return out


def _build_meta(
    obj: Dict[str, Any],
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Merge the object's declared `meta` with governance round-trip keys under
    `meta.datalex.*`. User-declared keys win — we never overwrite."""
    out: Dict[str, Any] = {}
    # start with any user-declared meta
    user_meta = obj.get("meta") or {}
    if isinstance(user_meta, dict):
        out.update({k: v for k, v in user_meta.items() if k != "datalex"})

    datalex_meta: Dict[str, Any] = {}
    # Preserve existing meta.datalex if present (idempotent re-emits).
    if isinstance(user_meta.get("datalex"), dict):
        datalex_meta.update(user_meta["datalex"])
    if extra:
        for k, v in extra.items():
            datalex_meta.setdefault(k, v)
    if datalex_meta:
        out["datalex"] = datalex_meta
    return out


def _sensitivity_meta(obj: Dict[str, Any]) -> Dict[str, Any]:
    extra: Dict[str, Any] = {}
    if obj.get("sensitivity"):
        extra["sensitivity"] = obj["sensitivity"]
    if obj.get("tags"):
        extra["tags"] = list(obj["tags"])
    if obj.get("terms"):
        extra["terms"] = list(obj["terms"])
    return extra


def _copy_if_set(dst: Dict[str, Any], src: Dict[str, Any], keys: Tuple[str, ...]) -> None:
    for k in keys:
        v = src.get(k)
        if v is not None and v != "":
            dst[k] = v


def _ref_to_string(dep: Dict[str, Any]) -> str:
    if "ref" in dep:
        return f"ref:{dep['ref']}"
    if "source" in dep:
        s = dep["source"]
        return f"source:{s.get('source')}.{s.get('name')}"
    return str(dep)
