"""Project health diagnostics for ``dm doctor``.

Checks:
  - Schema files exist and are valid JSON
  - Policy schema exists and is valid JSON
  - Model files are discoverable and parse as YAML
  - Policy packs are discoverable and parse as YAML
  - Python dependencies are importable
  - CLI entry point is executable
"""

import importlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml


class DiagnosticResult:
    """Single diagnostic check result."""

    __slots__ = ("name", "status", "message")

    def __init__(self, name: str, status: str, message: str = "") -> None:
        self.name = name
        self.status = status  # "ok", "warn", "error"
        self.message = message

    def to_dict(self) -> Dict[str, str]:
        return {"name": self.name, "status": self.status, "message": self.message}


def _check_file_exists(path: Path, label: str) -> DiagnosticResult:
    if path.exists():
        return DiagnosticResult(label, "ok", str(path))
    return DiagnosticResult(label, "error", f"Not found: {path}")


def _check_json_file(path: Path, label: str) -> DiagnosticResult:
    if not path.exists():
        return DiagnosticResult(label, "error", f"Not found: {path}")
    try:
        with path.open("r", encoding="utf-8") as f:
            json.load(f)
        return DiagnosticResult(label, "ok", str(path))
    except (json.JSONDecodeError, OSError) as exc:
        return DiagnosticResult(label, "error", f"Invalid JSON: {exc}")


def _check_yaml_file(path: Path, label: str) -> DiagnosticResult:
    if not path.exists():
        return DiagnosticResult(label, "error", f"Not found: {path}")
    try:
        with path.open("r", encoding="utf-8") as f:
            yaml.safe_load(f)
        return DiagnosticResult(label, "ok", str(path))
    except (yaml.YAMLError, OSError) as exc:
        return DiagnosticResult(label, "error", f"Invalid YAML: {exc}")


def _check_importable(module_name: str) -> DiagnosticResult:
    try:
        importlib.import_module(module_name)
        return DiagnosticResult(f"import {module_name}", "ok")
    except ImportError as exc:
        return DiagnosticResult(f"import {module_name}", "error", str(exc))


def _find_files(root: Path, pattern: str) -> List[Path]:
    return sorted(root.glob(pattern))


def run_diagnostics(project_dir: str) -> List[DiagnosticResult]:
    """Run all project diagnostics and return results."""
    root = Path(project_dir).resolve()
    results: List[DiagnosticResult] = []

    # 1. Project directory
    if root.is_dir():
        results.append(DiagnosticResult("project_directory", "ok", str(root)))
    else:
        results.append(DiagnosticResult("project_directory", "error", f"Not a directory: {root}"))
        return results

    # 2. Schema files
    model_schema = root / "schemas" / "model.schema.json"
    policy_schema = root / "schemas" / "policy.schema.json"
    results.append(_check_json_file(model_schema, "model_schema"))
    results.append(_check_json_file(policy_schema, "policy_schema"))

    # 3. Model files
    model_files = _find_files(root, "**/*.model.yaml")
    model_files = [f for f in model_files if ".git" not in str(f) and "node_modules" not in str(f)]
    if model_files:
        results.append(DiagnosticResult("model_files", "ok", f"Found {len(model_files)} model file(s)"))
        for mf in model_files:
            results.append(_check_yaml_file(mf, f"model:{mf.relative_to(root)}"))
    else:
        results.append(DiagnosticResult("model_files", "warn", "No *.model.yaml files found"))

    # 4. Policy packs
    policy_files = _find_files(root / "policies", "*.policy.yaml")
    if not policy_files:
        policy_files = _find_files(root, "**/*.policy.yaml")
        policy_files = [f for f in policy_files if ".git" not in str(f) and "node_modules" not in str(f)]
    if policy_files:
        results.append(DiagnosticResult("policy_packs", "ok", f"Found {len(policy_files)} policy pack(s)"))
        for pf in policy_files:
            results.append(_check_yaml_file(pf, f"policy:{pf.relative_to(root)}"))
    else:
        results.append(DiagnosticResult("policy_packs", "warn", "No *.policy.yaml files found"))

    # 5. Python dependencies
    for mod in ["yaml", "jsonschema"]:
        results.append(_check_importable(mod))

    # 6. dm_core importable
    results.append(_check_importable("dm_core"))

    # 7. CLI entry point
    dm_path = root / "dm"
    if dm_path.exists():
        results.append(DiagnosticResult("cli_entrypoint", "ok", str(dm_path)))
        if os.access(str(dm_path), os.X_OK):
            results.append(DiagnosticResult("cli_executable", "ok"))
        else:
            results.append(DiagnosticResult("cli_executable", "warn", "dm is not executable (chmod +x dm)"))
    else:
        results.append(DiagnosticResult("cli_entrypoint", "warn", "dm script not found at project root"))

    # 8. requirements.txt
    req_path = root / "requirements.txt"
    results.append(_check_file_exists(req_path, "requirements_txt"))

    return results


def format_diagnostics(results: List[DiagnosticResult]) -> str:
    """Format diagnostic results as a human-readable string."""
    lines: List[str] = []
    lines.append("DataLex Doctor")
    lines.append("=" * 40)

    ok_count = sum(1 for r in results if r.status == "ok")
    warn_count = sum(1 for r in results if r.status == "warn")
    error_count = sum(1 for r in results if r.status == "error")

    for r in results:
        icon = {"ok": "\u2713", "warn": "!", "error": "\u2717"}.get(r.status, "?")
        msg = f"  [{icon}] {r.name}"
        if r.message:
            msg += f" — {r.message}"
        lines.append(msg)

    lines.append("")
    lines.append(f"Summary: {ok_count} ok, {warn_count} warnings, {error_count} errors")

    if error_count > 0:
        lines.append("Status: UNHEALTHY")
    elif warn_count > 0:
        lines.append("Status: OK (with warnings)")
    else:
        lines.append("Status: HEALTHY")

    return "\n".join(lines)


def diagnostics_as_json(results: List[DiagnosticResult]) -> Dict[str, Any]:
    """Return diagnostics as a JSON-serializable dict."""
    ok_count = sum(1 for r in results if r.status == "ok")
    warn_count = sum(1 for r in results if r.status == "warn")
    error_count = sum(1 for r in results if r.status == "error")
    return {
        "checks": [r.to_dict() for r in results],
        "summary": {"ok": ok_count, "warn": warn_count, "error": error_count},
        "healthy": error_count == 0,
    }
