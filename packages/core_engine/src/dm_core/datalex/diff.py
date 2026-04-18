"""DataLex semantic diff with explicit rename tracking via `previous_name:`.

The existing `dm_core/diffing.py` module diffs v3 monolithic models. This module
operates on DataLexProject entities (layer-scoped) and produces a structured diff
dict of added / removed / renamed / changed objects.

Rename detection is explicit: if entity B in `new` has `previous_name: A` and no
entity named A exists in `new` but does in `old`, the diff records (A -> B) as a
rename, not a drop+add. Same rule applies to columns and indexes.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


def diff_entities(
    old: Dict[str, Dict[str, Any]],
    new: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """Compare two keyed entity dicts (key = '<layer>:<name>'). Returns a structured diff."""
    added: List[str] = []
    removed: List[str] = []
    renamed: List[Tuple[str, str]] = []
    changed: List[Dict[str, Any]] = []

    old_keys = set(old.keys())
    new_keys = set(new.keys())

    # First pass: detect explicit renames via previous_name.
    renames_new_to_old: Dict[str, str] = {}
    for key, ent in new.items():
        prev = ent.get("previous_name")
        if not prev:
            continue
        layer = ent.get("layer", key.split(":")[0] if ":" in key else "physical")
        old_key = f"{layer}:{prev}"
        if old_key in old and old_key not in new:
            renames_new_to_old[key] = old_key

    renamed_old_set = set(renames_new_to_old.values())
    renamed_new_set = set(renames_new_to_old.keys())

    for key in sorted(new_keys - old_keys - renamed_new_set):
        added.append(key)
    for key in sorted(old_keys - new_keys - renamed_old_set):
        removed.append(key)
    for new_key, old_key in sorted(renames_new_to_old.items()):
        renamed.append((old_key, new_key))

    # Compare entities present in both
    for key in sorted(old_keys & new_keys):
        ch = _entity_diff(old[key], new[key])
        if ch:
            changed.append({"entity": key, **ch})

    # For rename pairs, also diff bodies under the new name
    for new_key, old_key in renames_new_to_old.items():
        ch = _entity_diff(old[old_key], new[new_key])
        if ch:
            changed.append({"entity": new_key, "renamed_from": old_key, **ch})

    breaking = _breaking_from_diff(removed, changed)

    return {
        "added": added,
        "removed": removed,
        "renamed": renamed,
        "changed": changed,
        "breaking": breaking,
    }


def _entity_diff(old_ent: Dict[str, Any], new_ent: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    changes: Dict[str, Any] = {}

    # scalar fields
    for field in ("description", "owner", "domain", "subject_area", "schema", "database", "physical_name"):
        if old_ent.get(field) != new_ent.get(field):
            changes.setdefault("scalar", {})[field] = {
                "from": old_ent.get(field),
                "to": new_ent.get(field),
            }

    col_diff = _columns_diff(old_ent.get("columns", []) or [], new_ent.get("columns", []) or [])
    if col_diff:
        changes["columns"] = col_diff

    idx_diff = _indexes_diff(old_ent.get("indexes", []) or [], new_ent.get("indexes", []) or [])
    if idx_diff:
        changes["indexes"] = idx_diff

    return changes or None


def _columns_diff(old_cols: List[Dict[str, Any]], new_cols: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    old_by_name = {c["name"]: c for c in old_cols if c.get("name")}
    new_by_name = {c["name"]: c for c in new_cols if c.get("name")}

    rename_pairs: List[Tuple[str, str]] = []
    for name, c in new_by_name.items():
        prev = c.get("previous_name")
        if prev and prev in old_by_name and prev not in new_by_name:
            rename_pairs.append((prev, name))
    renamed_old = {p[0] for p in rename_pairs}
    renamed_new = {p[1] for p in rename_pairs}

    added = sorted(set(new_by_name) - set(old_by_name) - renamed_new)
    removed = sorted(set(old_by_name) - set(new_by_name) - renamed_old)

    changed: List[Dict[str, Any]] = []
    for name in sorted(set(old_by_name) & set(new_by_name)):
        ch = _column_scalar_diff(old_by_name[name], new_by_name[name])
        if ch:
            changed.append({"name": name, **ch})

    for old_name, new_name in rename_pairs:
        ch = _column_scalar_diff(old_by_name[old_name], new_by_name[new_name]) or {}
        changed.append({"name": new_name, "renamed_from": old_name, **ch})

    out: Dict[str, Any] = {}
    if added:
        out["added"] = added
    if removed:
        out["removed"] = removed
    if rename_pairs:
        out["renamed"] = [{"from": a, "to": b} for a, b in rename_pairs]
    if changed:
        out["changed"] = changed
    return out or None


def _column_scalar_diff(old: Dict[str, Any], new: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    out: Dict[str, Any] = {}
    for field in ("type", "nullable", "primary_key", "unique", "default", "sensitivity", "description"):
        if old.get(field) != new.get(field):
            out[field] = {"from": old.get(field), "to": new.get(field)}
    if (old.get("references") or None) != (new.get("references") or None):
        out["references"] = {"from": old.get("references"), "to": new.get("references")}
    return out or None


def _indexes_diff(old_idx: List[Dict[str, Any]], new_idx: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    old_by_name = {i["name"]: i for i in old_idx if i.get("name")}
    new_by_name = {i["name"]: i for i in new_idx if i.get("name")}

    rename_pairs: List[Tuple[str, str]] = []
    for name, i in new_by_name.items():
        prev = i.get("previous_name")
        if prev and prev in old_by_name and prev not in new_by_name:
            rename_pairs.append((prev, name))
    renamed_old = {p[0] for p in rename_pairs}
    renamed_new = {p[1] for p in rename_pairs}

    added = sorted(set(new_by_name) - set(old_by_name) - renamed_new)
    removed = sorted(set(old_by_name) - set(new_by_name) - renamed_old)

    out: Dict[str, Any] = {}
    if added:
        out["added"] = added
    if removed:
        out["removed"] = removed
    if rename_pairs:
        out["renamed"] = [{"from": a, "to": b} for a, b in rename_pairs]
    return out or None


def _breaking_from_diff(removed: List[str], changed: List[Dict[str, Any]]) -> List[str]:
    """Flag changes that break consumers. First pass heuristics — extended in Phase B."""
    breaking: List[str] = []
    for key in removed:
        breaking.append(f"Entity removed: {key}")
    for ch in changed:
        ent = ch.get("entity")
        cols = ch.get("columns") or {}
        for rem in cols.get("removed", []):
            breaking.append(f"Column removed: {ent}.{rem}")
        for c in cols.get("changed", []):
            t = c.get("type")
            if t and t.get("from") and t.get("to") and t["from"] != t["to"]:
                breaking.append(f"Column type changed: {ent}.{c['name']} ({t['from']} -> {t['to']})")
            nn = c.get("nullable")
            if nn and nn.get("from") is True and nn.get("to") is False:
                breaking.append(f"Column became NOT NULL without a migration: {ent}.{c['name']}")
        idx = ch.get("indexes") or {}
        for rem in idx.get("removed", []):
            breaking.append(f"Index removed: {ent}.{rem}")
    return breaking
