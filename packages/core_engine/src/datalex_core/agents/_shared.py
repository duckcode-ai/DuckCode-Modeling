"""Shared helpers for the conceptualizer / canonicalizer agents.

These pull rows out of an `import_manifest` ImportResult or a list of
DataLex YAML docs and normalize them into a flat, agent-friendly view.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple


_STAGING_RE = re.compile(r"^stg_|^staging_|/staging/|^src_|^raw_")


@dataclass
class StagingColumn:
    model: str
    name: str
    description: str = ""
    data_type: str = ""
    foreign_key: Optional[Tuple[str, str]] = None  # (target_entity, target_column)
    primary_key: bool = False
    sensitivity: str = ""


@dataclass
class StagingModel:
    name: str
    domain: str = ""
    description: str = ""
    columns: List[StagingColumn] = field(default_factory=list)


def is_staging_name(name: str) -> bool:
    """Return True if a model name looks like a staging-layer model.

    Heuristics: `stg_`/`src_`/`raw_` prefixes, or `/staging/` in path.
    Caller can pass either the bare model name or a full file path.
    """
    return bool(_STAGING_RE.search(str(name or "").lower()))


def collect_staging_models(models: Dict[str, Dict[str, Any]]) -> List[StagingModel]:
    """Convert a `models` dict (uid → DataLex model doc) into staging rows."""
    out: List[StagingModel] = []
    for name, doc in (models or {}).items():
        if not is_staging_name(name):
            continue
        sm = StagingModel(
            name=str(name),
            domain=str(doc.get("domain") or doc.get("meta", {}).get("domain") or ""),
            description=str(doc.get("description") or ""),
        )
        for col in doc.get("columns") or []:
            if not isinstance(col, dict):
                continue
            fk = None
            ref = col.get("foreign_key") or col.get("references")
            if isinstance(ref, dict):
                target = str(ref.get("entity") or ref.get("table") or "")
                target_col = str(ref.get("field") or ref.get("column") or "id")
                if target:
                    fk = (target, target_col)
            sm.columns.append(
                StagingColumn(
                    model=name,
                    name=str(col.get("name") or ""),
                    description=str(col.get("description") or ""),
                    data_type=str(col.get("type") or col.get("data_type") or ""),
                    foreign_key=fk,
                    primary_key=bool(col.get("primary_key") or col.get("is_primary_key")),
                    sensitivity=str(col.get("sensitivity") or ""),
                )
            )
        out.append(sm)
    return out


def strip_staging_prefix(name: str) -> str:
    """`stg_orders` → `orders`. Used to derive conceptual entity names."""
    s = str(name or "")
    for prefix in ("stg_", "staging_", "src_", "raw_"):
        if s.lower().startswith(prefix):
            return s[len(prefix):]
    return s


# Words that look plural to the heuristic but are actually singular —
# common false positives in dbt model names.
_SINGULAR_STOPLIST = {"status", "address", "series", "species", "metrics", "analytics"}


def singularize(noun: str) -> str:
    """Heuristic singular: `customers` → `customer`, `addresses` → `address`.

    Conservative — leaves words in the stoplist alone.
    """
    s = str(noun or "")
    if not s:
        return s
    lower = s.lower()
    if lower in _SINGULAR_STOPLIST:
        return s
    if lower.endswith("ies") and len(lower) > 3:
        return s[:-3] + "y"
    if lower.endswith("ses") and len(lower) > 3:
        return s[:-2]
    if lower.endswith("s") and not lower.endswith("ss") and not lower.endswith("us") and len(lower) > 2:
        return s[:-1]
    return s


def canonical_entity_token(model_name: str) -> str:
    """Pull the noun from a staging model name.

    `stg_segment_events` → `events` → `event`
    `stg_orders` → `orders` → `order`
    `stg_shopify_orders` → `orders` → `order`
    """
    bare = strip_staging_prefix(model_name)
    parts = [p for p in re.split(r"[_\W]+", str(bare)) if p]
    if not parts:
        return bare
    last = parts[-1]
    return last


def pascal_case(token: str) -> str:
    parts = re.split(r"[^A-Za-z0-9]+", str(token or ""))
    return "".join(p[:1].upper() + p[1:] for p in parts if p)
