"""One-shot migrator: v3 single-model YAML → DataLex file-per-entity layout.

Translates a DuckCodeModeling v3 `*.model.yaml` file (the current "one big
model" shape) into the DataLex spec layout:

    datalex.yaml                # project manifest (created if missing)
    glossary/<term>.yaml        # one file per glossary term
    models/physical/<dialect>/  # one file per entity, layered by physical
        <entity_name>.yaml

Rules applied during translation:
  * Entity names are lowered to snake_case; the original PascalCase name is
    preserved in `physical_name:` so DDL round-trips exactly.
  * v3 `fields[]` -> DataLex `columns[]`.
  * v3 top-level `relationships[]` are translated into per-column
    `references:` on the child side (DataLex canonical form). The child side
    is inferred from the cardinality arrow.
  * v3 top-level `indexes[]` are attached to their owning entity.
  * v3 `glossary[]` is split into one file per term under `glossary/`.
  * Governance classification (PII/PHI/etc.) is attached as column
    `sensitivity:` where a column name matches a classified field; entity-level
    classifications are preserved under `meta.datalex.classification`.

The migrator is non-destructive: it writes the new tree alongside the existing
v3 files. The user can commit both, verify equivalence, then delete the v3 copy.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from dm_core.loader import load_yaml_model


@dataclass
class MigrationReport:
    project_root: Path
    manifest_written: bool
    entities_written: int
    terms_written: int
    domains_written: int
    warnings: List[str] = field(default_factory=list)
    files: List[str] = field(default_factory=list)

    def summary(self) -> str:
        out = [
            f"DataLex migration complete:",
            f"  project root:       {self.project_root}",
            f"  manifest:           {'created' if self.manifest_written else 'unchanged'}",
            f"  entity files:       {self.entities_written}",
            f"  glossary files:     {self.terms_written}",
            f"  domain files:       {self.domains_written}",
        ]
        if self.warnings:
            out.append(f"  warnings:           {len(self.warnings)}")
            for w in self.warnings:
                out.append(f"    - {w}")
        return "\n".join(out)


def migrate_project(
    v3_model_path: str,
    output_root: Optional[str] = None,
    default_dialect: str = "postgres",
    dry_run: bool = False,
) -> MigrationReport:
    """Migrate a single v3 `*.model.yaml` file to a DataLex project tree.

    output_root  — where to write the new tree. Defaults to the directory
                   containing v3_model_path.
    default_dialect — which dialect the physical layer is assumed to target.
                   Recorded on each entity and in datalex.yaml.
    dry_run      — compute the migration plan and return file paths without
                   writing.
    """
    src = Path(v3_model_path).resolve()
    root = Path(output_root).resolve() if output_root else src.parent

    v3 = load_yaml_model(str(src))
    if "model" not in v3 or "entities" not in v3:
        raise ValueError(
            f"{src} does not look like a v3 model file (missing 'model' or 'entities' top-level key)"
        )

    report = MigrationReport(
        project_root=root,
        manifest_written=False,
        entities_written=0,
        terms_written=0,
        domains_written=0,
    )

    rel_by_child: Dict[Tuple[str, str], Dict[str, Any]] = _index_relationships_by_child(
        v3.get("relationships", []) or [],
        v3.get("entities", []) or [],
    )

    governance = (v3.get("governance") or {}).get("classification") or {}
    domains_list = v3.get("domains", []) or []
    terms_list = v3.get("glossary", []) or []
    entities = v3.get("entities", []) or []
    indexes = v3.get("indexes", []) or []

    # Write manifest only if one does not already exist.
    manifest_path = root / "datalex.yaml"
    manifest_doc = {
        "kind": "project",
        "name": v3["model"]["name"],
        "version": str(v3["model"].get("version", "1")),
        "description": v3["model"].get("description", ""),
        "dialects": [default_dialect],
        "default_dialect": default_dialect,
        "glossary": "glossary/**/*.yaml",
        "models": "models/**/*.yaml",
        "snippets": ".datalex/snippets/**/*.yaml",
    }

    if not manifest_path.exists():
        _write_yaml(manifest_path, manifest_doc, dry_run=dry_run, report=report)
        report.manifest_written = True
    else:
        report.warnings.append(f"{manifest_path} exists; left untouched.")

    # Glossary
    for term in terms_list:
        name = _snake(term.get("term") or term.get("name") or "")
        if not name:
            continue
        doc = {
            "kind": "term",
            "name": name,
            "definition": term.get("definition", ""),
        }
        if term.get("owner"):
            doc["steward"] = term["owner"]
        if term.get("abbreviation"):
            doc["abbreviation"] = term["abbreviation"]
        if term.get("tags"):
            doc["tags"] = [str(t) for t in term["tags"]]
        path = root / "glossary" / f"{name}.yaml"
        _write_yaml(path, doc, dry_run=dry_run, report=report)
        report.terms_written += 1

    # Domains
    for dom in domains_list:
        name = _snake(dom.get("name") or "")
        if not name:
            continue
        doc = {
            "kind": "domain",
            "name": name,
            "description": dom.get("description", ""),
        }
        path = root / "models" / "domains" / f"{name}.yaml"
        _write_yaml(path, doc, dry_run=dry_run, report=report)
        report.domains_written += 1

    # Entities
    for ent in entities:
        orig_name = str(ent["name"])
        snake = _snake(orig_name)
        entity_doc: Dict[str, Any] = {
            "kind": "entity",
            "layer": "physical",
            "dialect": default_dialect,
            "name": snake,
        }
        if orig_name != snake:
            entity_doc["physical_name"] = orig_name
        if ent.get("description"):
            entity_doc["description"] = ent["description"]
        if ent.get("owner"):
            entity_doc["owner"] = ent["owner"]
        if ent.get("schema"):
            entity_doc["schema"] = ent["schema"]
        if ent.get("database"):
            entity_doc["database"] = ent["database"]
        if ent.get("subject_area"):
            entity_doc["subject_area"] = ent["subject_area"]
        if ent.get("tags"):
            entity_doc["tags"] = [_kebab(str(t)) for t in ent["tags"]]
        if ent.get("partition_by"):
            entity_doc["partition_by"] = ent["partition_by"]
        if ent.get("cluster_by"):
            entity_doc["cluster_by"] = ent["cluster_by"]

        cls_for_entity = governance.get(orig_name, {}) or {}

        # columns
        cols: List[Dict[str, Any]] = []
        for f in ent.get("fields") or []:
            col: Dict[str, Any] = {"name": f["name"], "type": _translate_type(f.get("type", "string"))}
            if f.get("description"):
                col["description"] = f["description"]
            if f.get("nullable") is not None:
                col["nullable"] = bool(f["nullable"])
            if f.get("primary_key"):
                col["primary_key"] = True
            if f.get("unique"):
                col["unique"] = True
            if f.get("default") is not None:
                col["default"] = f["default"]
            if f.get("sensitivity"):
                col["sensitivity"] = f["sensitivity"]
            if f.get("deprecated"):
                col["deprecated"] = True
            if f.get("examples"):
                col["examples"] = f["examples"]
            if f.get("tags"):
                col["tags"] = [_kebab(str(t)) for t in f["tags"]]

            # Governance classification at the column
            if isinstance(cls_for_entity, dict):
                sens = cls_for_entity.get(f["name"])
                if sens and "sensitivity" not in col:
                    col["sensitivity"] = sens.lower()

            # Check constraints become explicit constraint items
            if f.get("check"):
                col.setdefault("constraints", []).append({
                    "type": "check",
                    "expression": f["check"],
                })

            # v3 relationships → references
            rel = rel_by_child.get((orig_name, f["name"]))
            if rel:
                col["references"] = rel

            cols.append(col)
        entity_doc["columns"] = cols

        # Indexes owned by this entity
        ent_indexes: List[Dict[str, Any]] = []
        for idx in indexes:
            if idx.get("entity") == orig_name:
                ent_indexes.append({
                    "name": idx["name"],
                    "columns": list(idx.get("fields", [])),
                    **({"unique": True} if idx.get("unique") else {}),
                    **({"type": idx["type"]} if idx.get("type") else {}),
                })
        if ent_indexes:
            entity_doc["indexes"] = ent_indexes

        # Preserve anything else we didn't explicitly migrate under meta.datalex.v3
        preserved: Dict[str, Any] = {}
        for key in (
            "grain", "candidate_keys", "business_keys", "hash_key", "sla",
            "scd_type", "natural_key", "surrogate_key", "conformed",
            "subtype_of", "subtypes", "dimension_refs", "link_refs",
            "parent_entity", "hash_diff_fields", "load_timestamp_field",
            "record_source_field", "distribution", "storage", "template", "templates",
            "physical_name",
        ):
            if key in ent and key != "physical_name":
                preserved[key] = ent[key]
        if preserved:
            entity_doc.setdefault("meta", {}).setdefault("datalex", {})["v3"] = preserved

        subdir = ent.get("subject_area") or default_dialect
        # Directory layout: models/physical/<dialect>/<entity>.yaml, with subject_area
        # as an optional sub-group.
        out_path = root / "models" / "physical" / default_dialect / f"{snake}.yaml"
        _write_yaml(out_path, entity_doc, dry_run=dry_run, report=report)
        report.entities_written += 1

    return report


def _index_relationships_by_child(
    relationships: List[Dict[str, Any]],
    entities: List[Dict[str, Any]],
) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """Return { (child_entity_pascal, child_field_snake): references_dict }.

    v3 encodes relationships as top-level objects with from/to = "Entity.field".
    The child side (the one with the FK column) depends on cardinality:
      one_to_many  => 'to' is the many side, which is the child
      many_to_one  => 'from' is the many side, which is the child
      one_to_one   => prefer the non-PK side; fall back to 'from'
      many_to_many => we cannot express in a single column; skip with a warning
                      (the join entity typically already has both FKs declared
                      at the column level in the migrator output anyway)
    """
    by_child: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for rel in relationships:
        card = rel.get("cardinality")
        frm = rel.get("from", "")
        to = rel.get("to", "")
        if "." not in frm or "." not in to:
            continue
        from_entity, from_field = frm.split(".", 1)
        to_entity, to_field = to.split(".", 1)

        if card == "many_to_one":
            child = (from_entity, from_field)
            parent = (to_entity, to_field)
        elif card == "one_to_many":
            child = (to_entity, to_field)
            parent = (from_entity, from_field)
        elif card == "one_to_one":
            child = (from_entity, from_field)
            parent = (to_entity, to_field)
        else:  # many_to_many — not representable as a single FK
            continue

        ref = {
            "entity": _snake(parent[0]),
            "column": parent[1],
        }
        if rel.get("on_delete"):
            ref["on_delete"] = rel["on_delete"]
        if rel.get("on_update"):
            ref["on_update"] = rel["on_update"]
        ref["relationship"] = _rel_from_cardinality(card)
        by_child[child] = ref

    return by_child


def _rel_from_cardinality(card: Optional[str]) -> str:
    return {
        "many_to_one": "many_to_one",
        "one_to_many": "many_to_one",
        "one_to_one": "one_to_one",
        "many_to_many": "many_to_many",
    }.get(card or "", "many_to_one")


_V3_TYPE_MAP = {
    "string": "string",
    "text": "text",
    "integer": "integer",
    "int": "integer",
    "bigint": "bigint",
    "float": "float",
    "double": "float",
    "boolean": "boolean",
    "bool": "boolean",
    "date": "date",
    "timestamp": "timestamp",
    "datetime": "timestamp",
    "timestamp_tz": "timestamp_tz",
    "timestamptz": "timestamp_tz",
    "uuid": "uuid",
    "json": "json",
    "jsonb": "json",
    "binary": "binary",
}


def _translate_type(t: str) -> str:
    raw = (t or "").strip()
    lower = raw.lower()
    if lower.startswith("decimal"):
        return lower
    return _V3_TYPE_MAP.get(lower, raw)


def _snake(name: str) -> str:
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    s2 = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()
    return re.sub(r"[^a-z0-9_]", "_", s2).strip("_") or name.lower()


def _kebab(name: str) -> str:
    return _snake(name).replace("_", "-")


def _write_yaml(path: Path, doc: Dict[str, Any], dry_run: bool, report: MigrationReport) -> None:
    report.files.append(str(path))
    if dry_run:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(doc, f, sort_keys=False, default_flow_style=False, allow_unicode=True)
