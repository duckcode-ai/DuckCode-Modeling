"""dbt mesh interface standards.

The first release treats an Interface as governed metadata on a dbt/DataLex
model, not as a separate artifact. Canonical DataLex files use top-level
``interface:``; dbt YAML round-trips the same object under
``meta.datalex.interface``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import yaml

from datalex_core.datalex.project import DataLexProject
from datalex_core.issues import Issue


STATUS = {"draft", "active", "deprecated"}
STABILITY = {"internal", "shared", "contracted"}
SKIP_DIRS = {".git", ".venv", "venv", "env", "target", "dbt_packages", "logs", "node_modules"}


def mesh_issues(project: DataLexProject, strict: bool = False) -> List[Issue]:
    """Return mesh interface standards issues for a loaded project.

    The project loader only reads DataLex ``kind: model`` files. This checker also
    scans dbt YAML under the project root so plain dbt repos can opt into
    ``meta.datalex.interface`` without a migration step.
    """

    issues: List[Issue] = []
    seen_names: set[str] = set()

    for name, model in sorted(project.models.items()):
        path = project.file_of.get(("model", name), str(project.root))
        _check_model(model, path, strict, issues)
        seen_names.add(name)

    for model, path in _iter_dbt_schema_models(project.root):
        name = str(model.get("name") or "")
        if name in seen_names:
            continue
        _check_model(model, path, strict, issues)
        seen_names.add(name)

    return issues


def mesh_report(project: DataLexProject, strict: bool = False) -> Dict[str, Any]:
    issues = mesh_issues(project, strict=strict)
    by_severity: Dict[str, int] = {"error": 0, "warn": 0, "info": 0}
    for issue in issues:
        by_severity[issue.severity] = by_severity.get(issue.severity, 0) + 1
    return {
        "root": str(project.root),
        "strict": strict,
        "issues": [issue.__dict__ for issue in issues],
        "summary": by_severity,
    }


def interface_metadata(model: Dict[str, Any]) -> Dict[str, Any]:
    """Extract DataLex interface metadata from canonical or dbt model shape."""

    direct = model.get("interface")
    if isinstance(direct, dict):
        return direct
    meta = model.get("meta") or {}
    if not isinstance(meta, dict):
        return {}
    dlx = meta.get("datalex") or {}
    if not isinstance(dlx, dict):
        return {}
    interface = dlx.get("interface") or {}
    return interface if isinstance(interface, dict) else {}


def interface_enabled(model: Dict[str, Any]) -> bool:
    interface = interface_metadata(model)
    if interface.get("enabled") is True:
        return True
    return str(interface.get("stability") or "").lower() in {"shared", "contracted"}


def _check_model(
    model: Dict[str, Any],
    path: str,
    strict: bool,
    issues: List[Issue],
) -> None:
    interface = interface_metadata(model)
    if not interface_enabled(model):
        return

    name = str(model.get("name") or "(unnamed)")
    tags = _list(model.get("tags") or (model.get("config") or {}).get("tags"))
    if interface.get("layer") == "presentation" or {"presentation", "reporting"} & set(tags):
        _add(
            issues,
            interface,
            strict,
            "MESH_INTERFACE_PRESENTATION_LAYER",
            f"Model '{name}' is tagged as presentation/reporting and cannot be a shared Interface.",
            path,
            blocking=True,
        )

    owner = interface.get("owner") or model.get("owner")
    domain = interface.get("domain") or model.get("domain")
    description = interface.get("description") or model.get("description")
    freshness = interface.get("freshness") or model.get("freshness")
    unique_key = interface.get("unique_key")
    status = interface.get("status")
    stability = interface.get("stability")

    required = (
        ("MESH_INTERFACE_MISSING_OWNER", owner, "owner"),
        ("MESH_INTERFACE_MISSING_DOMAIN", domain, "domain"),
        ("MESH_INTERFACE_MISSING_VERSION", interface.get("version"), "version"),
        ("MESH_INTERFACE_MISSING_DESCRIPTION", description, "description"),
        ("MESH_INTERFACE_MISSING_UNIQUE_KEY", unique_key, "unique_key"),
        ("MESH_INTERFACE_MISSING_FRESHNESS", freshness, "freshness"),
        ("MESH_INTERFACE_MISSING_STATUS", status, "status"),
        ("MESH_INTERFACE_MISSING_STABILITY", stability, "stability"),
    )
    for code, value, label in required:
        if _blank(value):
            _add(
                issues,
                interface,
                strict,
                code,
                f"Interface model '{name}' is missing required {label}.",
                path,
                blocking=True,
            )

    if status and status not in STATUS:
        _add(
            issues,
            interface,
            strict,
            "MESH_INTERFACE_INVALID_STATUS",
            f"Interface model '{name}' has invalid status '{status}'. Use draft, active, or deprecated.",
            path,
            blocking=True,
            force_error=True,
        )
    if stability and stability not in STABILITY:
        _add(
            issues,
            interface,
            strict,
            "MESH_INTERFACE_INVALID_STABILITY",
            f"Interface model '{name}' has invalid stability '{stability}'. Use internal, shared, or contracted.",
            path,
            blocking=True,
            force_error=True,
        )

    materialization = _materialization(model)
    if not materialization:
        _add(
            issues,
            interface,
            strict,
            "MESH_INTERFACE_MISSING_MATERIALIZATION",
            f"Interface model '{name}' should declare a dbt materialization.",
            path,
            blocking=True,
        )
    elif materialization == "ephemeral":
        _add(
            issues,
            interface,
            strict,
            "MESH_INTERFACE_EPHEMERAL",
            f"Interface model '{name}' is ephemeral; shared Interfaces must produce a stable relation.",
            path,
            blocking=True,
        )

    if not bool((model.get("contract") or {}).get("enforced")):
        _add(
            issues,
            interface,
            strict,
            "MESH_INTERFACE_CONTRACT_NOT_ENFORCED",
            f"Interface model '{name}' should enable a dbt model contract.",
            path,
            blocking=stability == "contracted",
        )

    columns = _columns(model)
    column_names = {str(c.get("name")) for c in columns if c.get("name")}
    key_columns = _unique_key_columns(unique_key)
    missing_key_cols = [c for c in key_columns if c not in column_names]
    if missing_key_cols:
        _add(
            issues,
            interface,
            strict,
            "MESH_INTERFACE_UNIQUE_KEY_NOT_FOUND",
            f"Interface model '{name}' unique_key references missing column(s): {', '.join(missing_key_cols)}.",
            path,
            blocking=True,
        )

    for column in columns:
        cname = str(column.get("name") or "")
        if not cname:
            continue
        if _blank(column.get("description")):
            _add(
                issues,
                interface,
                strict,
                "MESH_INTERFACE_COLUMN_DESCRIPTION_MISSING",
                f"Interface model '{name}' column '{cname}' is missing a description.",
                path,
                blocking=stability in {"shared", "contracted"},
            )
        if cname in key_columns and not (_has_test(column, "not_null") and _has_test(column, "unique")):
            _add(
                issues,
                interface,
                strict,
                "MESH_INTERFACE_UNIQUE_KEY_TESTS_MISSING",
                f"Interface model '{name}' unique key column '{cname}' should have unique and not_null tests.",
                path,
                blocking=stability in {"shared", "contracted"},
            )
        if cname.endswith("_id") and cname not in key_columns and not _has_relationship_test(column):
            _add(
                issues,
                interface,
                strict,
                "MESH_INTERFACE_RELATIONSHIP_TEST_MISSING",
                f"Interface model '{name}' foreign-key-like column '{cname}' should have a relationships test.",
                path,
                blocking=stability == "contracted",
            )


def _iter_dbt_schema_models(root: Path) -> Iterable[Tuple[Dict[str, Any], str]]:
    for path in sorted(_yaml_files(root)):
        try:
            with path.open("r", encoding="utf-8") as f:
                doc = yaml.safe_load(f)
        except Exception:
            continue
        if not isinstance(doc, dict) or not isinstance(doc.get("models"), list):
            continue
        for model in doc.get("models") or []:
            if not isinstance(model, dict):
                continue
            yield _normalise_dbt_model(model), str(path)


def _yaml_files(root: Path) -> Iterable[Path]:
    for suffix in ("*.yml", "*.yaml"):
        for path in root.rglob(suffix):
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            yield path


def _normalise_dbt_model(model: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(model)
    cfg = out.get("config") or {}
    if isinstance(cfg, dict):
        if cfg.get("materialized") and not out.get("materialization"):
            out["materialization"] = cfg.get("materialized")
        if isinstance(cfg.get("contract"), dict) and not out.get("contract"):
            out["contract"] = cfg.get("contract")
        if cfg.get("tags") and not out.get("tags"):
            out["tags"] = cfg.get("tags")
    meta = out.get("meta") or {}
    if isinstance(meta, dict):
        dlx = meta.get("datalex") or {}
        if isinstance(dlx, dict):
            if dlx.get("owner") and not out.get("owner"):
                out["owner"] = dlx.get("owner")
            if dlx.get("domain") and not out.get("domain"):
                out["domain"] = dlx.get("domain")
    return out


def _materialization(model: Dict[str, Any]) -> str:
    direct = model.get("materialization")
    if direct:
        return str(direct)
    cfg = model.get("config") or {}
    return str(cfg.get("materialized") or "") if isinstance(cfg, dict) else ""


def _columns(model: Dict[str, Any]) -> List[Dict[str, Any]]:
    cols = model.get("columns") or []
    if isinstance(cols, dict):
        return [c for c in cols.values() if isinstance(c, dict)]
    return [c for c in cols if isinstance(c, dict)]


def _unique_key_columns(unique_key: Any) -> List[str]:
    if isinstance(unique_key, str):
        return [unique_key] if unique_key else []
    if isinstance(unique_key, list):
        return [str(c) for c in unique_key if c]
    return []


def _has_test(column: Dict[str, Any], test_name: str) -> bool:
    for test in column.get("tests") or []:
        if test == test_name:
            return True
        if isinstance(test, dict) and test_name in test:
            return True
    for constraint in column.get("constraints") or []:
        if isinstance(constraint, dict) and constraint.get("type") == test_name:
            return True
    return False


def _has_relationship_test(column: Dict[str, Any]) -> bool:
    for test in column.get("tests") or []:
        if isinstance(test, dict) and "relationships" in test:
            return True
    for constraint in column.get("constraints") or []:
        if isinstance(constraint, dict) and constraint.get("type") == "foreign_key":
            return True
    return False


def _add(
    issues: List[Issue],
    interface: Dict[str, Any],
    strict: bool,
    code: str,
    message: str,
    path: str,
    *,
    blocking: bool,
    force_error: bool = False,
) -> None:
    if _is_exempt(interface, code):
        issues.append(Issue("info", code, f"Exempted: {message}", path))
        return
    severity = "error" if force_error or (strict and blocking) else "warn"
    issues.append(Issue(severity, code, message, path))


def _is_exempt(interface: Dict[str, Any], code: str) -> bool:
    for item in interface.get("exemptions") or []:
        if isinstance(item, dict) and item.get("code") == code and str(item.get("reason") or "").strip():
            return True
    return False


def _blank(value: Any) -> bool:
    return value in (None, "", [], {})


def _list(value: Optional[Any]) -> List[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str):
        return [value]
    return []
