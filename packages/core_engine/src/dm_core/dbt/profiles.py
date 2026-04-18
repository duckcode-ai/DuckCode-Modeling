"""Parse dbt profiles.yml to pick a warehouse connection for sync.

A dbt project has a `profile:` key in `dbt_project.yml`; that name indexes into
a `profiles.yml` (either in the project dir or `~/.dbt/profiles.yml`). Each
profile has a default `target:` and a map of named targets to connection
config. This module flattens that into a simple `(dialect, config)` tuple that
`dm_core.dbt.warehouse.introspect_table()` can consume.

We deliberately do NOT import dbt itself. Users who only want to *try* DataLex
shouldn't need to install dbt just to read their manifest.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import yaml


class ProfileError(RuntimeError):
    """Raised when a profile is missing, malformed, or lacks a usable target."""


@dataclass
class ProfileTarget:
    """Resolved target: what `warehouse.introspect_table()` needs."""

    profile_name: str
    target_name: str
    dialect: str
    config: Dict[str, Any]
    database: Optional[str]
    schema: Optional[str]


def find_profiles_yml(
    dbt_project_dir: Optional[str] = None,
    explicit_path: Optional[str] = None,
) -> Path:
    """Locate profiles.yml using dbt's own precedence:

      1. --profiles-dir / `explicit_path` (if provided)
      2. DBT_PROFILES_DIR env var
      3. `<dbt_project_dir>/profiles.yml`
      4. `~/.dbt/profiles.yml`
    """
    if explicit_path:
        p = Path(explicit_path).expanduser()
        if p.is_dir():
            p = p / "profiles.yml"
        if not p.exists():
            raise ProfileError(f"profiles.yml not found at: {p}")
        return p

    env_dir = os.environ.get("DBT_PROFILES_DIR")
    if env_dir:
        p = Path(env_dir).expanduser() / "profiles.yml"
        if p.exists():
            return p

    if dbt_project_dir:
        p = Path(dbt_project_dir) / "profiles.yml"
        if p.exists():
            return p

    home = Path.home() / ".dbt" / "profiles.yml"
    if home.exists():
        return home

    raise ProfileError(
        "Could not find profiles.yml. Looked in: "
        "--profiles-dir, $DBT_PROFILES_DIR, <project>/profiles.yml, ~/.dbt/profiles.yml"
    )


def read_dbt_project_profile_name(dbt_project_dir: str) -> str:
    """Return the `profile:` key from dbt_project.yml."""
    p = Path(dbt_project_dir) / "dbt_project.yml"
    if not p.exists():
        raise ProfileError(f"dbt_project.yml not found in {dbt_project_dir}")
    with p.open("r", encoding="utf-8") as f:
        proj = yaml.safe_load(f) or {}
    name = proj.get("profile")
    if not name:
        raise ProfileError(f"dbt_project.yml at {p} is missing a `profile:` key")
    return str(name)


def resolve_target(
    profiles_yml: Path,
    profile_name: str,
    target_override: Optional[str] = None,
    base_dir: Optional[Path] = None,
) -> ProfileTarget:
    """Load profiles.yml, pick the named profile, and flatten the chosen target.

    `base_dir` anchors relative paths (e.g. DuckDB `path:`) — typically the dbt
    project directory. Defaults to the profiles.yml parent.
    """
    with profiles_yml.open("r", encoding="utf-8") as f:
        doc = yaml.safe_load(f) or {}

    profile = doc.get(profile_name)
    if not isinstance(profile, dict):
        raise ProfileError(
            f"profile '{profile_name}' not found in {profiles_yml}. "
            f"Available: {sorted(k for k in doc.keys() if k != 'config')}"
        )

    outputs = profile.get("outputs") or {}
    target_name = target_override or profile.get("target")
    if not target_name:
        raise ProfileError(
            f"profile '{profile_name}' has no default `target:` and no --profile override"
        )

    target = outputs.get(target_name)
    if not isinstance(target, dict):
        raise ProfileError(
            f"target '{target_name}' not found in profile '{profile_name}'. "
            f"Available: {sorted(outputs.keys())}"
        )

    dialect = str(target.get("type", "")).lower()
    if not dialect:
        raise ProfileError(
            f"target '{target_name}' in profile '{profile_name}' is missing `type:`"
        )

    config = dict(target)
    anchor = base_dir or profiles_yml.parent
    if dialect == "duckdb":
        raw_path = config.get("path") or config.get("database")
        if raw_path:
            rp = Path(str(raw_path)).expanduser()
            if not rp.is_absolute():
                rp = (anchor / rp).resolve()
            config["path"] = str(rp)

    return ProfileTarget(
        profile_name=profile_name,
        target_name=target_name,
        dialect=dialect,
        config=config,
        database=config.get("database") or config.get("dbname") or config.get("catalog"),
        schema=config.get("schema") or config.get("dataset"),
    )


def resolve_for_dbt_project(
    dbt_project_dir: str,
    profiles_dir: Optional[str] = None,
    target_override: Optional[str] = None,
) -> ProfileTarget:
    """High-level: given a dbt project dir, resolve its active target.

    Reads `dbt_project.yml` to find the profile name, then consults
    `profiles.yml` to flatten the target.
    """
    profile_name = read_dbt_project_profile_name(dbt_project_dir)
    path = find_profiles_yml(dbt_project_dir=dbt_project_dir, explicit_path=profiles_dir)
    return resolve_target(
        path,
        profile_name,
        target_override=target_override,
        base_dir=Path(dbt_project_dir).resolve(),
    )


def as_introspect_args(
    target: ProfileTarget,
    database: Optional[str] = None,
    schema: Optional[str] = None,
    table: Optional[str] = None,
) -> Tuple[str, Dict[str, Any], str, str, str]:
    """Pack a resolved target + (db, schema, table) into the positional args
    accepted by `warehouse.introspect_table()`. Falls back to the target's
    default database/schema when a caller doesn't pass overrides."""
    db = database or target.database or ""
    sc = schema or target.schema or ""
    tb = table or ""
    return target.dialect, target.config, db, sc, tb
