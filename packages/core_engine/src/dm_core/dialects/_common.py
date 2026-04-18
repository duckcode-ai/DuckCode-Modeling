"""Helpers shared by dialect plugins."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from dm_core.datalex.types import LogicalType


def physical_override(column: Dict[str, Any], dialect: str) -> Optional[str]:
    """Return the per-dialect physical type override for a column, or None."""
    physical = column.get("physical") or {}
    entry = physical.get(dialect)
    if isinstance(entry, dict):
        return entry.get("type")
    return None


def physical_raw_ddl(column: Dict[str, Any], dialect: str) -> Optional[str]:
    physical = column.get("physical") or {}
    entry = physical.get(dialect)
    if isinstance(entry, dict):
        return entry.get("raw_ddl")
    return None


def qualified_table_name(entity: Dict[str, Any], quote, dialect: str) -> str:
    physical = entity.get("physical_name") or entity.get("name")
    parts: List[str] = []
    for key in ("database", "schema"):
        val = entity.get(key)
        if val:
            parts.append(str(val))
    parts.append(str(physical))
    return ".".join(quote(p) for p in parts)


def primary_key_columns(entity: Dict[str, Any]) -> List[str]:
    pks: List[str] = []
    for col in entity.get("columns", []) or []:
        if col.get("primary_key"):
            pks.append(col["name"])
        else:
            for c in col.get("constraints") or []:
                if c.get("type") == "primary_key":
                    pks.append(col["name"])
                    break
    return pks
