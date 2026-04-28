"""Project-wide markdown docs export.

Walks a DataLex project tree and writes:

  <out>/<domain>/<model-stem>.md      — per-model data dictionary
  <out>/<domain>/README.md             — per-domain summary with mermaid ERD
  <out>/README.md                      — top-level index over all domains

Models are recognized from two YAML shapes:

  1. *.model.yaml           — top-level `model:` + `entities:`
  2. *.diagram.yaml         — `kind: diagram` + `entities:` (jaffle-shop layout)

Doc-block references (`description_ref: { doc: <name> }`) are resolved
against any `.md` file in the project tree using the existing
`dbt.doc_blocks.DocBlockIndex`, so MD output shows the *rendered* docs
prose rather than the bare jinja reference.

Mermaid ER snippets are emitted in the per-domain README so the docs
render visually on GitHub without any external service.

This module is the single source of truth — the CLI subcommand
(`datalex docs export`), the api-server endpoint (`POST /api/docs/export`),
and the MCP server tool (`docs.export`) all call `export_docs()`.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

import yaml

from datalex_core.dbt.doc_blocks import DocBlockIndex


# ---------------------------------------------------------------------------
# Walking the project
# ---------------------------------------------------------------------------

@dataclass
class WalkedModel:
    """One YAML file that the walker recognized as a DataLex model."""
    path: Path                    # absolute path on disk
    rel_path: Path                # path relative to project root
    data: Dict[str, Any]          # parsed YAML
    kind: str                     # "model" or "diagram"
    domain: str                   # logical grouping for output
    name: str                     # human-readable name
    layer: Optional[str] = None   # conceptual / logical / physical (diagrams only)


def _safe_load(path: Path) -> Optional[Dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except (OSError, yaml.YAMLError):
        return None
    return data if isinstance(data, dict) else None


def _classify(path: Path, data: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    """Return ("model" | "diagram", name) or None if not a recognized shape."""
    name = path.stem
    # `*.model.yaml` shape — top-level `model:` block AND `entities:`
    if isinstance(data.get("model"), dict) and isinstance(data.get("entities"), list):
        return ("model", str(data["model"].get("name") or name))
    # `*.diagram.yaml` shape — `kind: diagram` AND `entities:`
    kind = str(data.get("kind") or "").strip().lower()
    if kind == "diagram" and isinstance(data.get("entities"), list):
        return ("diagram", str(data.get("name") or data.get("title") or name))
    return None


def _domain_for(path: Path, data: Dict[str, Any], root: Path) -> str:
    """Pick the domain bucket for this model.

    Order of preference:
      1. Explicit `model.domain` (model files) or `domain` (diagram files).
      2. First path segment relative to `root` that isn't a known layer name.
      3. Literal "uncategorized" as the last resort.
    """
    explicit = (
        (data.get("model") or {}).get("domain")
        if isinstance(data.get("model"), dict)
        else data.get("domain")
    )
    if explicit:
        return str(explicit).strip()

    rel = path.relative_to(root)
    layer_names = {"conceptual", "logical", "physical", "generated", "imported", "data_types"}
    for part in rel.parts[:-1]:
        if part.lower() not in layer_names and part.lower() not in {"datalex", "."}:
            return part
    return "uncategorized"


def _layer_for(data: Dict[str, Any], path: Path) -> Optional[str]:
    layer = data.get("layer")
    if isinstance(layer, str) and layer.strip():
        return layer.strip().lower()
    # Fall back to a directory hint.
    for part in path.parts:
        p = part.lower()
        if p in {"conceptual", "logical", "physical"}:
            return p
    return None


def walk_project(root: Path) -> Iterator[WalkedModel]:
    """Yield every recognized DataLex model file under `root`."""
    root = root.resolve()
    skip_suffixes = {".data_type.yaml"}
    for yaml_path in sorted(root.rglob("*.yaml")):
        if any(str(yaml_path).endswith(s) for s in skip_suffixes):
            continue
        data = _safe_load(yaml_path)
        if data is None:
            continue
        cls = _classify(yaml_path, data)
        if cls is None:
            continue
        kind, name = cls
        yield WalkedModel(
            path=yaml_path,
            rel_path=yaml_path.relative_to(root),
            data=data,
            kind=kind,
            domain=_domain_for(yaml_path, data, root),
            name=name,
            layer=_layer_for(data, yaml_path),
        )


# ---------------------------------------------------------------------------
# Description resolution
# ---------------------------------------------------------------------------

def _resolve_description(value: Any, ref: Any, idx: DocBlockIndex) -> str:
    """Render a description string. Prefers `description_ref.doc` over `description`."""
    if isinstance(ref, dict) and ref.get("doc"):
        rendered = idx.resolve(str(ref["doc"]))
        if rendered:
            return rendered.strip()
    if isinstance(value, str):
        return value.strip()
    return ""


# ---------------------------------------------------------------------------
# Mermaid ER diagram
# ---------------------------------------------------------------------------

_MERMAID_ID = re.compile(r"[^A-Za-z0-9_]+")


def _mermaid_id(name: str) -> str:
    """Turn an entity name into a valid mermaid identifier."""
    cleaned = _MERMAID_ID.sub("_", name.strip())
    return cleaned or "Entity"


def _mermaid_type(field_type: Any) -> str:
    raw = str(field_type or "string").strip()
    return _MERMAID_ID.sub("_", raw) or "string"


def render_mermaid_erd(models: Iterable[WalkedModel]) -> str:
    """Render a single mermaid `erDiagram` block covering the given models.

    For each entity, emits the entity block with up to 8 fields; key fields
    (primary_key=True) are tagged `PK`, foreign keys `FK`. Relationships are
    inferred from `foreign_key` annotations on fields and emit one
    `LEFT ||--o{ RIGHT : ref` line each.
    """
    lines: List[str] = ["```mermaid", "erDiagram"]
    seen_entities: Dict[str, List[str]] = {}
    relationships: List[Tuple[str, str, str]] = []

    for m in models:
        entities = m.data.get("entities") or []
        for ent in entities:
            if not isinstance(ent, dict):
                continue
            ent_name = str(ent.get("name") or "").strip()
            if not ent_name:
                continue
            ent_id = _mermaid_id(ent_name)
            field_lines: List[str] = []
            for fld in (ent.get("fields") or [])[:8]:
                if not isinstance(fld, dict):
                    continue
                fname = str(fld.get("name") or "").strip()
                if not fname:
                    continue
                ftype = _mermaid_type(fld.get("type"))
                tags = []
                if fld.get("primary_key"):
                    tags.append("PK")
                fk = fld.get("foreign_key")
                if isinstance(fk, dict) and fk.get("entity"):
                    tags.append("FK")
                    target_id = _mermaid_id(str(fk["entity"]))
                    relationships.append((ent_id, target_id, fname))
                tag_str = (" " + ",".join(tags)) if tags else ""
                field_lines.append(f"        {ftype} {fname}{tag_str}")
            # Conceptual diagrams have no fields — keep the entity but skip
            # the placeholder field row so users don't see fake `string id PK`.
            seen_entities[ent_id] = field_lines

    # Entity blocks. If a conceptual entity has no fields, emit just the
    # bare entity name — mermaid renders it as a labeled box.
    for ent_id, field_lines in seen_entities.items():
        if not field_lines:
            lines.append(f"    {ent_id}")
            continue
        lines.append(f"    {ent_id} {{")
        lines.extend(field_lines)
        lines.append("    }")

    # Relationship lines (deduped, drop dangling targets)
    seen_rels = set()
    for left, right, label in relationships:
        if right not in seen_entities:
            continue
        key = (left, right, label)
        if key in seen_rels:
            continue
        seen_rels.add(key)
        lines.append(f"    {right} ||--o{{ {left} : \"{label}\"")

    lines.append("```")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------

def _format_field_row(fld: Dict[str, Any], idx: DocBlockIndex) -> str:
    name = str(fld.get("name") or "").strip()
    ftype = str(fld.get("type") or "string").strip()
    flags: List[str] = []
    if fld.get("primary_key"):
        flags.append("PK")
    fk = fld.get("foreign_key")
    if isinstance(fk, dict) and fk.get("entity"):
        target_field = fk.get("field") or "?"
        flags.append(f"FK→{fk['entity']}.{target_field}")
    if fld.get("unique"):
        flags.append("unique")
    if fld.get("nullable") is False:
        flags.append("not-null")
    desc = _resolve_description(fld.get("description"), fld.get("description_ref"), idx)
    desc_inline = desc.replace("\n", " ").replace("|", "\\|") if desc else ""
    return f"| `{name}` | `{ftype}` | {' '.join(flags) or '—'} | {desc_inline} |"


def render_model_md(model: WalkedModel, idx: DocBlockIndex) -> str:
    """Render a single-model data-dictionary MD page."""
    data = model.data
    meta = data.get("model", {}) if isinstance(data.get("model"), dict) else data
    lines: List[str] = []
    title = data.get("title") or meta.get("name") or model.name
    lines.append(f"# {title}")
    lines.append("")

    # Header chips
    chips: List[str] = []
    if meta.get("version"):
        chips.append(f"**Version:** `{meta['version']}`")
    if model.layer:
        chips.append(f"**Layer:** `{model.layer}`")
    chips.append(f"**Domain:** `{model.domain}`")
    if isinstance(meta.get("owners"), list) and meta["owners"]:
        chips.append("**Owners:** " + ", ".join(f"`{o}`" for o in meta["owners"]))
    if chips:
        lines.append(" · ".join(chips))
        lines.append("")

    # Top-level description (resolved through doc-block index if needed)
    desc = _resolve_description(meta.get("description"), meta.get("description_ref"), idx)
    if desc:
        lines.append(desc)
        lines.append("")

    entities = data.get("entities") or []
    if not entities:
        lines.append("> _No entities defined in this file._")
        lines.append("")
        return "\n".join(lines)

    # Per-entity sections
    for ent in entities:
        if not isinstance(ent, dict):
            continue
        ent_name = str(ent.get("name") or "").strip() or "Unnamed"
        ent_type = str(ent.get("type") or "entity").strip()
        lines.append(f"## {ent_name}")
        lines.append("")
        lines.append(f"_Type: `{ent_type}`_")
        ent_desc = _resolve_description(ent.get("description"), ent.get("description_ref"), idx)
        if ent_desc:
            lines.append("")
            lines.append(ent_desc)
        lines.append("")
        fields = ent.get("fields") or []
        if fields:
            lines.append("| Field | Type | Flags | Description |")
            lines.append("|---|---|---|---|")
            for fld in fields:
                if isinstance(fld, dict):
                    lines.append(_format_field_row(fld, idx))
            lines.append("")

    # Relationships section if any
    rels = data.get("relationships") or []
    if rels:
        lines.append("## Relationships")
        lines.append("")
        lines.append("| From | To | Cardinality |")
        lines.append("|---|---|---|")
        for r in rels:
            if not isinstance(r, dict):
                continue
            lines.append(
                f"| `{r.get('from','?')}` | `{r.get('to','?')}` | `{r.get('cardinality','?')}` |"
            )
        lines.append("")

    # Footer: source path
    lines.append("---")
    lines.append(f"_Source: [`{model.rel_path}`](../{model.rel_path.as_posix()})_")
    lines.append("")
    return "\n".join(lines)


def render_domain_readme(
    domain: str,
    models: List[WalkedModel],
    idx: DocBlockIndex,
) -> str:
    """Render a per-domain README summarising the models + a mermaid ERD."""
    lines: List[str] = []
    lines.append(f"# `{domain}` domain")
    lines.append("")
    lines.append(
        f"This folder collects all DataLex artifacts for the `{domain}` domain — "
        f"{len(models)} model file(s) across {len({m.layer for m in models if m.layer})} layer(s)."
    )
    lines.append("")

    # Owners — union across models
    owners: List[str] = []
    for m in models:
        meta = m.data.get("model") if isinstance(m.data.get("model"), dict) else {}
        for o in (meta.get("owners") or []):
            if o not in owners:
                owners.append(str(o))
    if owners:
        lines.append("**Owners:** " + ", ".join(f"`{o}`" for o in owners))
        lines.append("")

    # Quick stats
    n_entities = sum(len(m.data.get("entities") or []) for m in models)
    n_rels = sum(len(m.data.get("relationships") or []) for m in models)
    lines.append("| Models | Entities | Relationships |")
    lines.append("|---|---|---|")
    lines.append(f"| {len(models)} | {n_entities} | {n_rels} |")
    lines.append("")

    # Mermaid ERD
    lines.append("## Entity-relationship diagram")
    lines.append("")
    lines.append(render_mermaid_erd(models))
    lines.append("")

    # Models index
    lines.append("## Models")
    lines.append("")
    by_layer: Dict[str, List[WalkedModel]] = {}
    for m in models:
        by_layer.setdefault(m.layer or "uncategorized", []).append(m)
    for layer in sorted(by_layer):
        lines.append(f"### `{layer}`")
        lines.append("")
        lines.append("| File | Name | Entities |")
        lines.append("|---|---|---|")
        for m in by_layer[layer]:
            md_link = f"./{m.path.stem}.md"
            n = len(m.data.get("entities") or [])
            lines.append(f"| [`{m.rel_path}`]({md_link}) | {m.name} | {n} |")
        lines.append("")

    return "\n".join(lines)


def render_root_readme(domains: Dict[str, List[WalkedModel]]) -> str:
    """Top-level index over all domains."""
    lines: List[str] = ["# Project documentation", ""]
    lines.append("Generated by `datalex docs export`. Each domain folder contains a")
    lines.append("`README.md` with a mermaid ER diagram and per-model data dictionaries.")
    lines.append("")
    lines.append("| Domain | Models | Entities |")
    lines.append("|---|---|---|")
    for domain in sorted(domains):
        models = domains[domain]
        n_ent = sum(len(m.data.get("entities") or []) for m in models)
        lines.append(f"| [`{domain}`](./{domain}/README.md) | {len(models)} | {n_ent} |")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

@dataclass
class ExportSummary:
    project_root: str
    out_dir: str
    domains: Dict[str, int] = field(default_factory=dict)  # domain → model count
    files_written: List[str] = field(default_factory=list)
    skipped: int = 0

    def to_json(self) -> Dict[str, Any]:
        return {
            "project_root": self.project_root,
            "out_dir": self.out_dir,
            "domains": self.domains,
            "files_written": self.files_written,
            "skipped": self.skipped,
        }


def export_docs(project_root: Path, out_dir: Path) -> ExportSummary:
    """Walk `project_root`, write MD docs into `out_dir`, return a summary."""
    project_root = project_root.resolve()
    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # Build the doc-block index once. The indexer walks the project for
    # `.md` files (dbt convention) so every `description_ref` resolves.
    idx = DocBlockIndex.build(project_root)

    summary = ExportSummary(project_root=str(project_root), out_dir=str(out_dir))
    by_domain: Dict[str, List[WalkedModel]] = {}
    for m in walk_project(project_root):
        by_domain.setdefault(m.domain, []).append(m)

    for domain, models in by_domain.items():
        domain_dir = out_dir / domain
        domain_dir.mkdir(parents=True, exist_ok=True)

        # Per-model MD files
        for m in models:
            md = render_model_md(m, idx)
            target = domain_dir / f"{m.path.stem}.md"
            target.write_text(md, encoding="utf-8")
            summary.files_written.append(str(target.relative_to(out_dir)))

        # Per-domain README
        readme = render_domain_readme(domain, models, idx)
        readme_path = domain_dir / "README.md"
        readme_path.write_text(readme, encoding="utf-8")
        summary.files_written.append(str(readme_path.relative_to(out_dir)))
        summary.domains[domain] = len(models)

    # Top-level index
    if by_domain:
        root_readme = render_root_readme(by_domain)
        (out_dir / "README.md").write_text(root_readme, encoding="utf-8")
        summary.files_written.append("README.md")

    return summary
