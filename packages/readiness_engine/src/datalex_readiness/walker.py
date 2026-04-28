"""Project structure + YAML walker + dbt artifact presence detection.

Mirrors the JS helpers in `packages/api-server/index.js`:
  - loadProjectStructure
  - walkYamlFiles
  - loadDbtArtifactPresence
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

DATALEX_PROJECT_CONFIG = ".dm-project.json"


def _normalize_subpath(value: Any, fallback: str = "") -> str:
    text = str(value or "").strip().replace("\\", "/")
    text = text.strip("/")
    if not text or text == ".":
        return fallback
    return text


def _is_path_inside(parent: Path, child: Path) -> bool:
    try:
        parent_r = parent.resolve()
        child_r = child.resolve()
        return str(child_r) == str(parent_r) or str(child_r).startswith(str(parent_r) + os.sep)
    except Exception:
        return False


def load_project_structure(project_path: str) -> Dict[str, Any]:
    abs_path = Path(project_path).resolve()
    config_path = abs_path / DATALEX_PROJECT_CONFIG

    project_config: Optional[Dict[str, Any]] = None
    if config_path.exists():
        try:
            raw = config_path.read_text(encoding="utf-8")
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                project_config = parsed
        except Exception:
            project_config = None

    configured = _normalize_subpath((project_config or {}).get("modelsDir"), "")
    candidate = (abs_path / configured).resolve() if configured else abs_path
    model_path = candidate if _is_path_inside(abs_path, candidate) else abs_path

    return {"projectConfig": project_config, "modelPath": str(model_path)}


def to_posix_path(value: Any) -> str:
    return str(value or "").replace("\\", "/")


def walk_yaml_files(directory: str) -> List[Dict[str, Any]]:
    """Recursively list YAML files, sorted, skipping dotdirs and node_modules."""
    base = Path(directory)
    results: List[Dict[str, Any]] = []
    if not base.exists() or not base.is_dir():
        return results

    def _walk(d: Path) -> None:
        try:
            entries = sorted(d.iterdir(), key=lambda e: e.name)
        except OSError:
            return
        for entry in entries:
            if entry.is_dir():
                if entry.name.startswith(".") or entry.name == "node_modules":
                    continue
                _walk(entry)
            elif entry.is_file() and entry.name.lower().endswith((".yaml", ".yml")):
                stats = entry.stat()
                results.append(
                    {
                        "name": entry.name,
                        "path": to_posix_path(str(entry.relative_to(base))),
                        "fullPath": str(entry),
                        "size": stats.st_size,
                        "modifiedAt": datetime.fromtimestamp(stats.st_mtime, tz=timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z"),
                    }
                )

    _walk(base)
    return results


def _read_json_artifact(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists() or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_dbt_artifact_presence(project_path: str) -> Dict[str, bool]:
    target = Path(project_path) / "target"
    return {
        "manifest": bool(_read_json_artifact(target / "manifest.json")),
        "catalog": bool(_read_json_artifact(target / "catalog.json")),
        "semanticManifest": bool(_read_json_artifact(target / "semantic_manifest.json")),
        "runResults": bool(_read_json_artifact(target / "run_results.json")),
    }
