"""Documentation generator for DuckCodeModeling models.

Generates:
- Static HTML data dictionary site (single-page, self-contained)
- Markdown export for GitHub wiki / Confluence
- Auto-changelog from model diffs
"""

import html
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dm_core.canonical import compile_model
from dm_core.loader import load_yaml_model


def _esc(text: str) -> str:
    """HTML-escape a string."""
    return html.escape(str(text)) if text else ""


def _field_badges_html(field: Dict[str, Any]) -> str:
    """Generate HTML badge spans for field properties."""
    badges = []
    if field.get("primary_key"):
        badges.append('<span class="badge badge-pk">PK</span>')
    if field.get("unique"):
        badges.append('<span class="badge badge-uq">UQ</span>')
    if field.get("foreign_key"):
        badges.append('<span class="badge badge-fk">FK</span>')
    if field.get("nullable") is False:
        badges.append('<span class="badge badge-nn">NOT NULL</span>')
    if field.get("computed"):
        badges.append('<span class="badge badge-comp">COMPUTED</span>')
    if field.get("deprecated"):
        badges.append('<span class="badge badge-dep">DEPRECATED</span>')
    if field.get("sensitivity"):
        badges.append(f'<span class="badge badge-sens">{_esc(field["sensitivity"]).upper()}</span>')
    if field.get("default") is not None:
        badges.append(f'<span class="badge badge-def">DEFAULT: {_esc(str(field["default"]))}</span>')
    if field.get("check"):
        badges.append(f'<span class="badge badge-chk">CHECK</span>')
    return " ".join(badges)


def _entity_type_class(entity_type: str) -> str:
    """CSS class for entity type."""
    return {
        "table": "type-table",
        "view": "type-view",
        "materialized_view": "type-mv",
        "external_table": "type-ext",
        "snapshot": "type-snap",
    }.get(entity_type, "type-table")


# ---------------------------------------------------------------------------
# HTML Generation
# ---------------------------------------------------------------------------

_CSS = """
:root {
  --bg: #f8fafc; --surface: #ffffff; --border: #e2e8f0;
  --text: #1e293b; --text-muted: #64748b; --text-light: #94a3b8;
  --accent: #3b82f6; --accent-light: #dbeafe;
  --green: #22c55e; --yellow: #eab308; --red: #ef4444; --purple: #8b5cf6;
  --cyan: #06b6d4; --orange: #f97316; --indigo: #6366f1;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 20px 0; position: sticky; top: 0; z-index: 100; }
header .container { display: flex; align-items: center; justify-content: space-between; }
header h1 { font-size: 20px; font-weight: 700; }
header h1 span { color: var(--accent); }
.header-meta { font-size: 12px; color: var(--text-muted); }

.search-box { margin: 20px 0; }
.search-box input { width: 100%; padding: 10px 16px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; background: var(--surface); outline: none; }
.search-box input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }

.stats-bar { display: flex; gap: 16px; margin: 16px 0; flex-wrap: wrap; }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 20px; text-align: center; min-width: 120px; }
.stat-value { font-size: 24px; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

nav.toc { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
nav.toc h2 { font-size: 14px; margin-bottom: 8px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
nav.toc ul { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
nav.toc li a { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 500; background: var(--bg); border: 1px solid var(--border); }
nav.toc li a:hover { background: var(--accent-light); border-color: var(--accent); text-decoration: none; }

.entity-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin: 20px 0; overflow: hidden; }
.entity-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; }
.entity-header h2 { font-size: 18px; font-weight: 600; }
.entity-type { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
.type-table { background: #dbeafe; color: #1d4ed8; }
.type-view { background: #dcfce7; color: #15803d; }
.type-mv { background: #f3e8ff; color: #7c3aed; }
.type-ext { background: #ffedd5; color: #c2410c; }
.type-snap { background: #fecdd3; color: #be123c; }
.entity-meta { padding: 12px 20px; display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.entity-meta span { display: flex; align-items: center; gap: 4px; }
.entity-desc { padding: 12px 20px; font-size: 14px; color: var(--text-muted); border-bottom: 1px solid var(--border); }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 8px 12px; background: var(--bg); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
td { padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
tr:hover td { background: #f1f5f9; }
tr.deprecated td { opacity: 0.6; text-decoration: line-through; }
.field-name { font-family: 'SF Mono', Monaco, Consolas, monospace; font-weight: 500; font-size: 13px; }
.field-type { font-family: 'SF Mono', Monaco, Consolas, monospace; color: var(--purple); font-size: 12px; }

.badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; margin-right: 3px; }
.badge-pk { background: #fef3c7; color: #92400e; }
.badge-uq { background: #cffafe; color: #0e7490; }
.badge-fk { background: #dbeafe; color: #1d4ed8; }
.badge-nn { background: #fecdd3; color: #9f1239; }
.badge-comp { background: #dcfce7; color: #15803d; }
.badge-dep { background: #fecdd3; color: #be123c; }
.badge-sens { background: #fef3c7; color: #92400e; }
.badge-def { background: #e0e7ff; color: #4338ca; }
.badge-chk { background: #ffedd5; color: #c2410c; }
.badge-idx { background: #f3e8ff; color: #7c3aed; }
.badge-tag { background: var(--bg); color: var(--text-muted); border: 1px solid var(--border); }

.section { margin: 20px 0; }
.section h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); }
.section h3 { font-size: 14px; font-weight: 600; margin: 12px 0 8px; }

.rel-card { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; margin: 4px 0; font-size: 13px; }
.rel-card .rel-name { font-weight: 600; }
.rel-card .rel-arrow { color: var(--text-light); }
.rel-card code { font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; color: var(--purple); }
.rel-card .cardinality { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 3px; }
.card-1to1 { background: #dcfce7; color: #15803d; }
.card-1toN { background: #dbeafe; color: #1d4ed8; }
.card-Nto1 { background: #f3e8ff; color: #7c3aed; }
.card-NtoN { background: #ffedd5; color: #c2410c; }

.glossary-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin: 8px 0; }
.glossary-card h4 { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.glossary-card p { font-size: 13px; color: var(--text-muted); }
.glossary-card .gl-meta { font-size: 11px; color: var(--text-light); margin-top: 4px; }

.index-row { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; margin: 4px 0; font-size: 13px; }
.index-row code { font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; }

footer { margin: 40px 0 20px; padding: 20px 0; border-top: 1px solid var(--border); text-align: center; font-size: 12px; color: var(--text-light); }

.hidden { display: none !important; }

@media (max-width: 768px) {
  .stats-bar { flex-direction: column; }
  .entity-meta { flex-direction: column; gap: 4px; }
}
"""

_JS = """
function filterEntities() {
  const q = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('.entity-card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.classList.toggle('hidden', q && !text.includes(q));
  });
  document.querySelectorAll('.glossary-card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.classList.toggle('hidden', q && !text.includes(q));
  });
  document.querySelectorAll('nav.toc li').forEach(li => {
    const text = li.textContent.toLowerCase();
    li.classList.toggle('hidden', q && !text.includes(q));
  });
}
"""


def generate_html_docs(
    model: Dict[str, Any],
    title: Optional[str] = None,
) -> str:
    """Generate a self-contained HTML data dictionary from a model."""
    meta = model.get("model", {})
    model_name = meta.get("name", "unknown")
    model_version = meta.get("version", "")
    model_domain = meta.get("domain", "")
    model_desc = meta.get("description", "")
    model_state = meta.get("state", "")
    owners = meta.get("owners", [])

    entities = model.get("entities", [])
    relationships = model.get("relationships", [])
    indexes = model.get("indexes", [])
    metrics = model.get("metrics", [])
    glossary = model.get("glossary", [])
    rules = model.get("rules", [])
    governance = model.get("governance", {})
    classifications = governance.get("classification", {})

    page_title = title or f"{model_name} — Data Dictionary"

    # Stats
    total_fields = sum(len(e.get("fields", [])) for e in entities)
    total_rels = len(relationships)
    total_indexes = len(indexes)
    total_metrics = len(metrics)
    total_glossary = len(glossary)

    # Build index of entity fields for cross-referencing
    entity_fields = {}
    for e in entities:
        entity_fields[e.get("name", "")] = {f.get("name", "") for f in e.get("fields", [])}

    # Index by entity
    indexes_by_entity: Dict[str, List[Dict]] = {}
    for idx in indexes:
        ent = idx.get("entity", "")
        indexes_by_entity.setdefault(ent, []).append(idx)

    indexed_fields: Dict[str, set] = {}
    for idx in indexes:
        ent = idx.get("entity", "")
        indexed_fields.setdefault(ent, set())
        for f in idx.get("fields", []):
            indexed_fields[ent].add(f)

    # Relationships by entity
    rels_by_entity: Dict[str, List[Dict]] = {}
    for rel in relationships:
        from_ent = (rel.get("from", "") or "").split(".")[0]
        to_ent = (rel.get("to", "") or "").split(".")[0]
        rels_by_entity.setdefault(from_ent, []).append(rel)
        if to_ent != from_ent:
            rels_by_entity.setdefault(to_ent, []).append(rel)

    parts = []
    parts.append(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{_esc(page_title)}</title>
<style>{_CSS}</style>
</head>
<body>
<header>
<div class="container">
  <h1><span>DuckCodeModeling</span> Data Dictionary</h1>
  <div class="header-meta">
    {_esc(model_name)} v{_esc(model_version)} &middot; {_esc(model_domain)} &middot; {_esc(model_state)}
    &middot; Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}
  </div>
</div>
</header>

<div class="container">
""")

    # Model description
    if model_desc:
        parts.append(f'<p style="margin:16px 0;font-size:15px;color:var(--text-muted)">{_esc(model_desc)}</p>')

    # Search
    parts.append("""
<div class="search-box">
  <input type="text" id="search" placeholder="Search entities, fields, tags, glossary..." oninput="filterEntities()">
</div>
""")

    # Stats bar
    parts.append(f"""
<div class="stats-bar">
  <div class="stat"><div class="stat-value">{len(entities)}</div><div class="stat-label">Entities</div></div>
  <div class="stat"><div class="stat-value">{total_fields}</div><div class="stat-label">Fields</div></div>
  <div class="stat"><div class="stat-value">{total_rels}</div><div class="stat-label">Relationships</div></div>
  <div class="stat"><div class="stat-value">{total_indexes}</div><div class="stat-label">Indexes</div></div>
  <div class="stat"><div class="stat-value">{total_metrics}</div><div class="stat-label">Metrics</div></div>
  <div class="stat"><div class="stat-value">{total_glossary}</div><div class="stat-label">Glossary Terms</div></div>
</div>
""")

    # TOC
    parts.append('<nav class="toc"><h2>Entities</h2><ul>')
    for e in entities:
        ename = _esc(e.get("name", ""))
        etype = e.get("type", "table")
        parts.append(f'<li><a href="#entity-{ename}"><span class="entity-type {_entity_type_class(etype)}">{_esc(etype)}</span> {ename}</a></li>')
    parts.append("</ul></nav>")

    # Entity cards
    for e in entities:
        ename = e.get("name", "")
        etype = e.get("type", "table")
        edesc = e.get("description", "")
        etags = e.get("tags", [])
        eschema = e.get("schema", "")
        edb = e.get("database", "")
        esubject = e.get("subject_area", "")
        eowner = e.get("owner", "")
        esla = e.get("sla", {})
        fields = e.get("fields", [])
        ent_indexes = indexes_by_entity.get(ename, [])
        ent_rels = rels_by_entity.get(ename, [])
        ent_indexed = indexed_fields.get(ename, set())

        parts.append(f'<div class="entity-card" id="entity-{_esc(ename)}">')

        # Header
        parts.append(f"""
<div class="entity-header">
  <span class="entity-type {_entity_type_class(etype)}">{_esc(etype)}</span>
  <h2>{_esc(ename)}</h2>
  <span style="margin-left:auto;font-size:12px;color:var(--text-light)">{len(fields)} fields</span>
</div>
""")

        # Meta row
        meta_parts = []
        if eschema:
            meta_parts.append(f"<span>Schema: <strong>{_esc(eschema)}</strong></span>")
        if edb:
            meta_parts.append(f"<span>Database: <strong>{_esc(edb)}</strong></span>")
        if esubject:
            meta_parts.append(f"<span>Subject Area: <strong>{_esc(esubject)}</strong></span>")
        if eowner:
            meta_parts.append(f"<span>Owner: <strong>{_esc(eowner)}</strong></span>")
        if esla:
            sla_parts = []
            if esla.get("freshness"):
                sla_parts.append(f"Freshness: {_esc(str(esla['freshness']))}")
            if esla.get("quality_score") is not None:
                sla_parts.append(f"Quality: {esla['quality_score']}%")
            if sla_parts:
                meta_parts.append(f"<span>SLA: <strong>{' · '.join(sla_parts)}</strong></span>")
        for tag in etags:
            meta_parts.append(f'<span class="badge badge-tag">{_esc(str(tag))}</span>')
        if meta_parts:
            parts.append(f'<div class="entity-meta">{"".join(meta_parts)}</div>')

        # Description
        if edesc:
            parts.append(f'<div class="entity-desc">{_esc(edesc)}</div>')

        # Fields table
        parts.append("""<table>
<thead><tr><th>Field</th><th>Type</th><th>Badges</th><th>Description</th></tr></thead>
<tbody>""")
        for field in fields:
            fname = field.get("name", "")
            ftype = field.get("type", "")
            fdesc = field.get("description", "")
            is_dep = field.get("deprecated", False)
            badges = _field_badges_html(field)
            if fname in ent_indexed:
                badges += ' <span class="badge badge-idx">IDX</span>'
            cls_key = f"{ename}.{fname}"
            if cls_key in classifications:
                badges += f' <span class="badge badge-sens">{_esc(classifications[cls_key])}</span>'
            row_class = ' class="deprecated"' if is_dep else ""
            dep_msg = ""
            if is_dep and field.get("deprecated_message"):
                dep_msg = f' <em style="color:var(--red);font-size:11px">({_esc(field["deprecated_message"])})</em>'
            parts.append(f"""<tr{row_class}>
  <td class="field-name">{_esc(fname)}</td>
  <td class="field-type">{_esc(ftype)}</td>
  <td>{badges}</td>
  <td>{_esc(fdesc)}{dep_msg}</td>
</tr>""")
        parts.append("</tbody></table>")

        # Entity indexes
        if ent_indexes:
            parts.append(f'<div style="padding:12px 20px"><h3 style="font-size:13px;color:var(--text-muted);margin-bottom:8px">Indexes ({len(ent_indexes)})</h3>')
            for idx in ent_indexes:
                unique_badge = ' <span class="badge badge-uq">UNIQUE</span>' if idx.get("unique") else ""
                type_badge = f' <span class="badge badge-tag">{_esc(idx.get("type", ""))}</span>' if idx.get("type") and idx.get("type") != "btree" else ""
                parts.append(f'<div class="index-row"><code>{_esc(idx.get("name", ""))}</code> <span style="color:var(--text-light)">({", ".join(_esc(f) for f in idx.get("fields", []))})</span>{unique_badge}{type_badge}</div>')
            parts.append("</div>")

        # Entity relationships
        if ent_rels:
            parts.append(f'<div style="padding:12px 20px"><h3 style="font-size:13px;color:var(--text-muted);margin-bottom:8px">Relationships ({len(ent_rels)})</h3>')
            seen = set()
            for rel in ent_rels:
                rname = rel.get("name", "")
                if rname in seen:
                    continue
                seen.add(rname)
                card = rel.get("cardinality", "one_to_many")
                card_class = {"one_to_one": "card-1to1", "one_to_many": "card-1toN", "many_to_one": "card-Nto1", "many_to_many": "card-NtoN"}.get(card, "card-1toN")
                from_ref = _esc(rel.get("from", ""))
                to_ref = _esc(rel.get("to", ""))
                rdesc = rel.get("description", "")
                parts.append(f'<div class="rel-card"><span class="rel-name">{_esc(rname)}</span> <code>{from_ref}</code> <span class="rel-arrow">→</span> <code>{to_ref}</code> <span class="cardinality {card_class}">{_esc(card.replace("_", ":"))}</span></div>')
                if rdesc:
                    parts.append(f'<div style="padding:0 12px 4px;font-size:12px;color:var(--text-light)">{_esc(rdesc)}</div>')
            parts.append("</div>")

        parts.append("</div>")  # entity-card

    # Relationships section
    if relationships:
        parts.append('<div class="section" id="relationships"><h2>All Relationships</h2>')
        for rel in relationships:
            rname = rel.get("name", "")
            card = rel.get("cardinality", "one_to_many")
            card_class = {"one_to_one": "card-1to1", "one_to_many": "card-1toN", "many_to_one": "card-Nto1", "many_to_many": "card-NtoN"}.get(card, "card-1toN")
            parts.append(f'<div class="rel-card"><span class="rel-name">{_esc(rname)}</span> <code>{_esc(rel.get("from", ""))}</code> <span class="rel-arrow">→</span> <code>{_esc(rel.get("to", ""))}</code> <span class="cardinality {card_class}">{_esc(card.replace("_", ":"))}</span></div>')
        parts.append("</div>")

    # Metrics section
    if metrics:
        parts.append('<div class="section" id="metrics"><h2>Metric Contracts</h2><table>')
        parts.append("<thead><tr><th>Metric</th><th>Entity</th><th>Aggregation</th><th>Grain</th><th>Dimensions</th><th>Description</th></tr></thead><tbody>")
        for metric in metrics:
            mname = metric.get("name", "")
            mentity = metric.get("entity", "")
            magg = metric.get("aggregation", "")
            mgrain = ", ".join(metric.get("grain", []))
            mdims = ", ".join(metric.get("dimensions", []))
            mdesc = metric.get("description", "")
            if metric.get("deprecated"):
                dep_msg = f" ({metric.get('deprecated_message', 'deprecated')})"
                mdesc = (mdesc + dep_msg).strip()
            parts.append(
                "<tr>"
                f"<td><code>{_esc(mname)}</code></td>"
                f"<td><code>{_esc(mentity)}</code></td>"
                f"<td>{_esc(magg)}</td>"
                f"<td>{_esc(mgrain)}</td>"
                f"<td>{_esc(mdims)}</td>"
                f"<td>{_esc(mdesc)}</td>"
                "</tr>"
            )
        parts.append("</tbody></table></div>")

    # Glossary section
    if glossary:
        parts.append('<div class="section" id="glossary"><h2>Business Glossary</h2>')
        for term in glossary:
            tname = term.get("term", "")
            tabbr = term.get("abbreviation", "")
            tdef = term.get("definition", "")
            towner = term.get("owner", "")
            tfields = term.get("related_fields", [])
            ttags = term.get("tags", [])
            parts.append(f'<div class="glossary-card">')
            abbr_str = f" ({_esc(tabbr)})" if tabbr else ""
            parts.append(f'<h4>{_esc(tname)}{abbr_str}</h4>')
            if tdef:
                parts.append(f'<p>{_esc(tdef)}</p>')
            meta_bits = []
            if towner:
                meta_bits.append(f"Owner: {_esc(towner)}")
            if tfields:
                meta_bits.append(f"Fields: {', '.join(_esc(f) for f in tfields)}")
            if ttags:
                meta_bits.append(f"Tags: {', '.join(_esc(str(t)) for t in ttags)}")
            if meta_bits:
                parts.append(f'<div class="gl-meta">{" · ".join(meta_bits)}</div>')
            parts.append("</div>")
        parts.append("</div>")

    # Governance section
    if classifications:
        parts.append('<div class="section" id="governance"><h2>Data Classification</h2><table>')
        parts.append("<thead><tr><th>Target</th><th>Classification</th></tr></thead><tbody>")
        for target, cls in sorted(classifications.items()):
            parts.append(f'<tr><td><code>{_esc(target)}</code></td><td><span class="badge badge-sens">{_esc(cls)}</span></td></tr>')
        parts.append("</tbody></table></div>")

    # Footer
    parts.append(f"""
<footer>
  Generated by <strong>DuckCodeModeling</strong> &middot; {_esc(model_name)} v{_esc(model_version)}
  &middot; {datetime.now().strftime('%Y-%m-%d %H:%M')}
</footer>
</div>
<script>{_JS}</script>
</body>
</html>""")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Markdown Generation
# ---------------------------------------------------------------------------

def generate_markdown_docs(
    model: Dict[str, Any],
    title: Optional[str] = None,
) -> str:
    """Generate Markdown data dictionary from a model."""
    meta = model.get("model", {})
    model_name = meta.get("name", "unknown")
    model_version = meta.get("version", "")
    model_domain = meta.get("domain", "")
    model_desc = meta.get("description", "")
    owners = meta.get("owners", [])

    entities = model.get("entities", [])
    relationships = model.get("relationships", [])
    indexes = model.get("indexes", [])
    metrics = model.get("metrics", [])
    glossary = model.get("glossary", [])
    governance = model.get("governance", {})
    classifications = governance.get("classification", {})

    lines = []
    page_title = title or f"{model_name} — Data Dictionary"
    lines.append(f"# {page_title}")
    lines.append("")
    lines.append(f"**Model:** {model_name} v{model_version}  ")
    lines.append(f"**Domain:** {model_domain}  ")
    if owners:
        lines.append(f"**Owners:** {', '.join(owners)}  ")
    if model_desc:
        lines.append(f"**Description:** {model_desc}  ")
    lines.append("")

    # Stats
    total_fields = sum(len(e.get("fields", [])) for e in entities)
    lines.append(f"| Entities | Fields | Relationships | Indexes | Metrics | Glossary |")
    lines.append(f"|----------|--------|---------------|---------|---------|----------|")
    lines.append(f"| {len(entities)} | {total_fields} | {len(relationships)} | {len(indexes)} | {len(metrics)} | {len(glossary)} |")
    lines.append("")

    # TOC
    lines.append("## Table of Contents")
    lines.append("")
    for e in entities:
        ename = e.get("name", "")
        etype = e.get("type", "table")
        lines.append(f"- [{ename}](#{ename.lower()}) ({etype})")
    if relationships:
        lines.append("- [Relationships](#relationships)")
    if metrics:
        lines.append("- [Metric Contracts](#metric-contracts)")
    if glossary:
        lines.append("- [Glossary](#glossary)")
    if classifications:
        lines.append("- [Data Classification](#data-classification)")
    lines.append("")

    # Entities
    lines.append("---")
    lines.append("")

    indexes_by_entity: Dict[str, List[Dict]] = {}
    for idx in indexes:
        ent = idx.get("entity", "")
        indexes_by_entity.setdefault(ent, []).append(idx)

    for e in entities:
        ename = e.get("name", "")
        etype = e.get("type", "table")
        edesc = e.get("description", "")
        etags = e.get("tags", [])
        eschema = e.get("schema", "")
        eowner = e.get("owner", "")
        esubject = e.get("subject_area", "")
        fields = e.get("fields", [])

        lines.append(f"## {ename}")
        lines.append("")
        lines.append(f"**Type:** `{etype}`  ")
        if edesc:
            lines.append(f"**Description:** {edesc}  ")
        if eschema:
            lines.append(f"**Schema:** `{eschema}`  ")
        if esubject:
            lines.append(f"**Subject Area:** {esubject}  ")
        if eowner:
            lines.append(f"**Owner:** {eowner}  ")
        if etags:
            lines.append(f"**Tags:** {', '.join(f'`{t}`' for t in etags)}  ")
        lines.append("")

        # Fields table
        lines.append("| Field | Type | Nullable | PK | Description |")
        lines.append("|-------|------|----------|----|-------------|")
        for field in fields:
            fname = field.get("name", "")
            ftype = field.get("type", "")
            fnull = "Yes" if field.get("nullable", True) else "No"
            fpk = "Yes" if field.get("primary_key") else ""
            fdesc = field.get("description", "")
            extras = []
            if field.get("unique"):
                extras.append("UQ")
            if field.get("foreign_key"):
                extras.append("FK")
            if field.get("deprecated"):
                extras.append("DEPRECATED")
            if field.get("sensitivity"):
                extras.append(f"sensitivity:{field['sensitivity']}")
            extra_str = f" [{', '.join(extras)}]" if extras else ""
            lines.append(f"| `{fname}` | `{ftype}` | {fnull} | {fpk} | {fdesc}{extra_str} |")
        lines.append("")

        # Entity indexes
        ent_indexes = indexes_by_entity.get(ename, [])
        if ent_indexes:
            lines.append(f"**Indexes:**")
            lines.append("")
            for idx in ent_indexes:
                unique = " (UNIQUE)" if idx.get("unique") else ""
                lines.append(f"- `{idx.get('name', '')}` on ({', '.join(idx.get('fields', []))}){unique}")
            lines.append("")

    # Relationships
    if relationships:
        lines.append("---")
        lines.append("")
        lines.append("## Relationships")
        lines.append("")
        lines.append("| Name | From | To | Cardinality | Description |")
        lines.append("|------|------|----|-------------|-------------|")
        for rel in relationships:
            rname = rel.get("name", "")
            rfrom = rel.get("from", "")
            rto = rel.get("to", "")
            rcard = rel.get("cardinality", "")
            rdesc = rel.get("description", "")
            lines.append(f"| {rname} | `{rfrom}` | `{rto}` | {rcard} | {rdesc} |")
        lines.append("")

    # Metrics
    if metrics:
        lines.append("---")
        lines.append("")
        lines.append("## Metric Contracts")
        lines.append("")
        lines.append("| Metric | Entity | Aggregation | Grain | Dimensions | Description |")
        lines.append("|--------|--------|-------------|-------|------------|-------------|")
        for metric in metrics:
            mname = metric.get("name", "")
            mentity = metric.get("entity", "")
            magg = metric.get("aggregation", "")
            mgrain = ", ".join(metric.get("grain", []))
            mdims = ", ".join(metric.get("dimensions", []))
            mdesc = metric.get("description", "")
            if metric.get("deprecated"):
                dep_msg = metric.get("deprecated_message", "deprecated")
                mdesc = (mdesc + f" (DEPRECATED: {dep_msg})").strip()
            lines.append(f"| `{mname}` | `{mentity}` | {magg} | {mgrain} | {mdims} | {mdesc} |")
        lines.append("")

    # Glossary
    if glossary:
        lines.append("---")
        lines.append("")
        lines.append("## Glossary")
        lines.append("")
        for term in glossary:
            tname = term.get("term", "")
            tdef = term.get("definition", "")
            lines.append(f"### {tname}")
            if tdef:
                lines.append(f"{tdef}")
            tfields = term.get("related_fields", [])
            if tfields:
                lines.append(f"  Related fields: {', '.join(f'`{f}`' for f in tfields)}")
            lines.append("")

    # Classifications
    if classifications:
        lines.append("---")
        lines.append("")
        lines.append("## Data Classification")
        lines.append("")
        lines.append("| Target | Classification |")
        lines.append("|--------|----------------|")
        for target, cls in sorted(classifications.items()):
            lines.append(f"| `{target}` | {cls} |")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Changelog Generation
# ---------------------------------------------------------------------------

def generate_changelog(
    diff_result: Dict[str, Any],
    new_version: str = "",
    old_version: str = "",
) -> str:
    """Generate a Markdown changelog from a semantic diff result."""
    lines = []
    lines.append(f"# Changelog")
    if new_version or old_version:
        lines.append(f"**{old_version or '?'}** → **{new_version or '?'}**")
    lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")

    summary = diff_result.get("summary", {})
    lines.append("## Summary")
    lines.append(f"- Entities added: {summary.get('added_entities', 0)}")
    lines.append(f"- Entities removed: {summary.get('removed_entities', 0)}")
    lines.append(f"- Entities changed: {summary.get('changed_entities', 0)}")
    lines.append(f"- Relationships added: {summary.get('added_relationships', 0)}")
    lines.append(f"- Relationships removed: {summary.get('removed_relationships', 0)}")
    lines.append(f"- Indexes added: {summary.get('added_indexes', 0)}")
    lines.append(f"- Indexes removed: {summary.get('removed_indexes', 0)}")
    lines.append(f"- Metrics added: {summary.get('added_metrics', 0)}")
    lines.append(f"- Metrics removed: {summary.get('removed_metrics', 0)}")
    lines.append(f"- Metrics changed: {summary.get('changed_metrics', 0)}")
    has_breaking = diff_result.get("has_breaking_changes", False)
    lines.append(f"- Breaking changes: {'Yes' if has_breaking else 'None'}")
    lines.append("")

    added = diff_result.get("added_entities", [])
    if added:
        lines.append("## Added Entities")
        for e in added:
            lines.append(f"- `{e}`")
        lines.append("")

    removed = diff_result.get("removed_entities", [])
    if removed:
        lines.append("## Removed Entities")
        for e in removed:
            lines.append(f"- `{e}`")
        lines.append("")

    changed = diff_result.get("changed_entities", [])
    if changed:
        lines.append("## Changed Entities")
        for change in changed:
            ename = change.get("entity", "")
            lines.append(f"### {ename}")
            for f in change.get("added_fields", []):
                lines.append(f"- Added field: `{f}`")
            for f in change.get("removed_fields", []):
                lines.append(f"- Removed field: `{f}`")
            for tc in change.get("type_changes", []):
                lines.append(f"- Type changed: `{tc['field']}` ({tc['from_type']} → {tc['to_type']})")
            for nc in change.get("nullability_changes", []):
                lines.append(f"- Nullability changed: `{nc['field']}` ({nc['from_nullable']} → {nc['to_nullable']})")
            lines.append("")

    changed_metrics = diff_result.get("changed_metrics", [])
    if changed_metrics:
        lines.append("## Changed Metrics")
        for metric_change in changed_metrics:
            mname = metric_change.get("metric", "")
            changed_fields = metric_change.get("changed_fields", [])
            lines.append(f"- `{mname}`: {', '.join(changed_fields)}")
        lines.append("")

    breaking = diff_result.get("breaking_changes", [])
    if breaking:
        lines.append("## Breaking Changes")
        for bc in breaking:
            lines.append(f"- {bc}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# File writers
# ---------------------------------------------------------------------------

def write_html_docs(model: Dict[str, Any], output_path: str, title: Optional[str] = None) -> str:
    """Generate and write HTML docs to a file. Returns the output path."""
    content = generate_html_docs(model, title=title)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return str(path)


def write_markdown_docs(model: Dict[str, Any], output_path: str, title: Optional[str] = None) -> str:
    """Generate and write Markdown docs to a file. Returns the output path."""
    content = generate_markdown_docs(model, title=title)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return str(path)


def write_changelog(diff_result: Dict[str, Any], output_path: str, **kwargs) -> str:
    """Generate and write changelog to a file. Returns the output path."""
    content = generate_changelog(diff_result, **kwargs)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return str(path)
