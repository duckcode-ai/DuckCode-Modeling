/* shareBundle.js — generate a self-contained HTML bundle of a DataLex
 * diagram for read-only sharing (drop on S3, email, pin in Slack).
 *
 * Approach: render a *semantic* HTML document — not a pixel-perfect clone
 * of the live Canvas. That trades some visual fidelity (entity cards are
 * arranged in a responsive grid rather than at their canvas coordinates)
 * for zero JS dependencies, tiny file size, and reliable rendering across
 * browsers, email clients, and dark/light system themes.
 *
 * A future v0.5.x revision can add a "preserve canvas layout" option that
 * freezes x/y coordinates and inlines the Relationships SVG. For v0.5.0
 * we ship the simpler path — legend, grouped entity cards, and a plain
 * relationships table — which is what stakeholders actually want when
 * reviewing a design.
 *
 * Inputs come straight from the Shell's adapted schema so the bundle
 * mirrors whatever the author sees. No network calls inside the bundle.
 */

const ESC_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]));

function renderEntityCard(table) {
  const cols = Array.isArray(table.columns) ? table.columns : [];
  const rows = cols.map((c) => {
    const isPk = !!c.pk;
    const isFk = !!c.fk;
    const keyMark = isPk ? "PK" : isFk ? "FK" : "";
    const flags = [];
    if (c.nn) flags.push("NN");
    if (c.unique && !isPk) flags.push("UQ");
    if (c.check) flags.push("CK");
    if (c.default) flags.push("DF");
    if (c.generated) flags.push("GN");
    return `
      <tr class="col ${isPk ? "col-pk" : ""} ${isFk ? "col-fk" : ""}">
        <td class="col-key">${esc(keyMark)}</td>
        <td class="col-name">${esc(c.name)}</td>
        <td class="col-type">${esc(c.type || "—")}</td>
        <td class="col-flags">${flags.map((f) => `<span class="flag flag-${f.toLowerCase()}">${f}</span>`).join("")}</td>
      </tr>`;
  }).join("");

  const subject = table.subject_area || table.subject || "";
  return `
    <article class="entity cat-${esc(table.cat || "entity")}" id="entity-${esc(table.id || table.name)}">
      <header>
        <h3>${esc(table.name)}</h3>
        ${table.schema ? `<span class="schema">${esc(table.schema)}</span>` : ""}
        ${subject ? `<span class="domain">${esc(subject)}</span>` : ""}
      </header>
      <table class="columns">
        <tbody>${rows || '<tr><td colspan="4" class="empty">no columns</td></tr>'}</tbody>
      </table>
      ${typeof table.rowCount === "number" ? `<footer>${cols.length} cols · ${table.rowCount} rows</footer>` : `<footer>${cols.length} cols</footer>`}
    </article>`;
}

function renderRelationships(relationships, tables) {
  if (!Array.isArray(relationships) || relationships.length === 0) {
    return '<p class="empty-hint">No relationships defined.</p>';
  }
  const tableById = new Map((tables || []).map((t) => [t.id || t.name, t]));
  const rows = relationships.map((r) => {
    const fromId = r.from?.table || r.fromTable;
    const toId   = r.to?.table || r.toTable;
    const fromCol = r.from?.column || r.fromColumn || "";
    const toCol   = r.to?.column || r.toColumn || "";
    const fromName = tableById.get(fromId)?.name || fromId || "—";
    const toName   = tableById.get(toId)?.name || toId || "—";
    const card = r.cardinality || `${r.from_cardinality || ""}→${r.to_cardinality || ""}`;
    return `
      <tr>
        <td><a href="#entity-${esc(fromId)}">${esc(fromName)}</a>${fromCol ? `<span class="col-ref">.${esc(fromCol)}</span>` : ""}</td>
        <td class="card">${esc(card)}</td>
        <td><a href="#entity-${esc(toId)}">${esc(toName)}</a>${toCol ? `<span class="col-ref">.${esc(toCol)}</span>` : ""}</td>
        <td class="label">${esc(r.label || r.name || "")}</td>
      </tr>`;
  }).join("");
  return `
    <table class="rel-table">
      <thead>
        <tr><th>From</th><th>Cardinality</th><th>To</th><th>Label</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSubjectAreas(subjectAreas, tables) {
  const areas = Array.isArray(subjectAreas) ? subjectAreas.filter((a) => a && a.name) : [];
  if (areas.length === 0) {
    // No declared domains — render a single ungrouped entity list.
    return `
      <section class="area area-default">
        <div class="area-grid">${(tables || []).map(renderEntityCard).join("")}</div>
      </section>`;
  }
  const ungrouped = (tables || []).filter((t) => !t.subject_area);
  const blocks = areas.map((area) => {
    const subset = (tables || []).filter((t) => t.subject_area === area.name);
    if (subset.length === 0) return "";
    const swatch = area.color ? `<span class="area-swatch" style="background:${esc(area.color)}"></span>` : "";
    return `
      <section class="area">
        <h2>${swatch}${esc(area.name)} <small>${subset.length}</small></h2>
        ${area.description ? `<p class="area-desc">${esc(area.description)}</p>` : ""}
        <div class="area-grid">${subset.map(renderEntityCard).join("")}</div>
      </section>`;
  }).join("");
  const ungroupedBlock = ungrouped.length ? `
    <section class="area area-unassigned">
      <h2>Unassigned <small>${ungrouped.length}</small></h2>
      <div class="area-grid">${ungrouped.map(renderEntityCard).join("")}</div>
    </section>` : "";
  return blocks + ungroupedBlock;
}

// Self-contained stylesheet. Honors prefers-color-scheme so the bundle
// looks right in dark-mode browsers without any toggle logic.
const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #fff;
    --bg-2: #f9fafb;
    --text: #0f172a;
    --muted: #64748b;
    --border: #e2e8f0;
    --accent: #2563eb;
    --pk: #d97706;
    --fk: #0891b2;
    --nn: #dc2626;
    --hint-bg: #eff6ff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0f17;
      --bg-2: #121824;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --border: #1f2937;
      --accent: #60a5fa;
      --pk: #fbbf24;
      --fk: #22d3ee;
      --nn: #f87171;
      --hint-bg: #1e293b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 32px 40px 96px;
    max-width: 1400px;
    margin: 0 auto;
  }
  header.doc-head {
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 28px;
  }
  header.doc-head h1 { margin: 0 0 4px; font-size: 24px; }
  header.doc-head .meta {
    color: var(--muted);
    font-size: 12px;
    font-family: ui-monospace, Menlo, monospace;
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  header.doc-head .desc {
    margin-top: 10px;
    color: var(--text);
    max-width: 80ch;
  }
  h2 { font-size: 16px; margin: 28px 0 12px; display: flex; align-items: center; gap: 8px; }
  h2 small { color: var(--muted); font-weight: 400; font-size: 12px; }
  .area-swatch {
    display: inline-block; width: 10px; height: 10px;
    border-radius: 3px; border: 1px solid var(--border);
  }
  .area-desc { color: var(--muted); margin: -4px 0 12px; max-width: 80ch; }
  .area-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }
  .entity {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-2);
    overflow: hidden;
    page-break-inside: avoid;
  }
  .entity header {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 8px;
    flex-wrap: wrap;
  }
  .entity header h3 { margin: 0; font-size: 13px; flex: 1; }
  .entity header .schema,
  .entity header .domain {
    font-size: 10px;
    color: var(--muted);
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--hint-bg);
    font-family: ui-monospace, Menlo, monospace;
  }
  table.columns {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .col td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .col:last-child td { border-bottom: none; }
  .col-key {
    width: 30px;
    color: var(--muted);
    font-weight: 600;
    font-size: 9px;
    font-family: ui-monospace, Menlo, monospace;
  }
  .col-pk .col-key { color: var(--pk); }
  .col-fk .col-key { color: var(--fk); }
  .col-name { font-family: ui-monospace, Menlo, monospace; }
  .col-type {
    text-align: right;
    color: var(--muted);
    font-size: 10px;
    font-family: ui-monospace, Menlo, monospace;
  }
  .col-flags { width: 40px; text-align: right; white-space: nowrap; }
  .flag {
    display: inline-block;
    padding: 0 4px;
    margin-left: 2px;
    border-radius: 2px;
    background: var(--hint-bg);
    color: var(--muted);
    font-size: 9px;
    font-weight: 600;
  }
  .flag-nn { color: var(--nn); }
  .entity footer {
    padding: 6px 12px;
    font-size: 10px;
    color: var(--muted);
    background: var(--bg);
    border-top: 1px solid var(--border);
    font-family: ui-monospace, Menlo, monospace;
  }
  .rel-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .rel-table th, .rel-table td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .rel-table tr:last-child td { border-bottom: none; }
  .rel-table th { background: var(--bg-2); font-size: 11px; color: var(--muted); font-weight: 600; }
  .rel-table a { color: var(--accent); text-decoration: none; }
  .rel-table a:hover { text-decoration: underline; }
  .rel-table .card { font-family: ui-monospace, Menlo, monospace; color: var(--muted); }
  .rel-table .col-ref { color: var(--muted); font-family: ui-monospace, Menlo, monospace; }
  .rel-table .label { color: var(--muted); font-style: italic; }
  .empty-hint, .empty {
    color: var(--muted);
    padding: 16px;
    text-align: center;
    font-size: 12px;
  }
  .legend {
    display: flex; gap: 16px; flex-wrap: wrap;
    padding: 12px 16px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 24px;
    font-size: 11px;
    color: var(--muted);
  }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .legend-key { font-weight: 600; font-family: ui-monospace, Menlo, monospace; }
  .legend-key.pk { color: var(--pk); }
  .legend-key.fk { color: var(--fk); }
  .legend-key.nn { color: var(--nn); }
  .footer-credit {
    margin-top: 64px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
    text-align: center;
  }
  .footer-credit a { color: var(--muted); }
  @media print {
    body { padding: 0.5in; }
    .entity { break-inside: avoid; }
  }
`;

/**
 * Generate a self-contained HTML string for the given schema snapshot.
 *
 * @param {Object} opts
 * @param {string} opts.title        Diagram title (e.g. "Subscriptions")
 * @param {string} [opts.description] Optional prose blurb shown under the title
 * @param {string} [opts.projectName]
 * @param {string} [opts.ref]         Optional git ref (branch or snapshot tag) for provenance
 * @param {Array}  opts.tables
 * @param {Array}  opts.relationships
 * @param {Array}  [opts.subjectAreas]
 * @returns {string} Standalone HTML document (utf-8, no external assets)
 */
export function generateShareBundleHtml({
  title,
  description,
  projectName,
  ref,
  tables,
  relationships,
  subjectAreas,
}) {
  const safeTitle = String(title || projectName || "DataLex diagram");
  const tCount = Array.isArray(tables) ? tables.length : 0;
  const rCount = Array.isArray(relationships) ? relationships.length : 0;
  const generated = new Date().toISOString();

  const legend = `
    <div class="legend">
      <span class="legend-item"><span class="legend-key pk">PK</span> Primary key</span>
      <span class="legend-item"><span class="legend-key fk">FK</span> Foreign key</span>
      <span class="legend-item"><span class="legend-key nn">NN</span> NOT NULL</span>
      <span class="legend-item"><span class="legend-key">UQ</span> Unique</span>
      <span class="legend-item"><span class="legend-key">CK</span> Check</span>
      <span class="legend-item"><span class="legend-key">DF</span> Default</span>
      <span class="legend-item"><span class="legend-key">GN</span> Generated</span>
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(safeTitle)} · DataLex</title>
  <meta name="generator" content="DataLex share bundle" />
  <style>${STYLE}</style>
</head>
<body>
  <header class="doc-head">
    <h1>${esc(safeTitle)}</h1>
    ${description ? `<p class="desc">${esc(description)}</p>` : ""}
    <div class="meta">
      ${projectName ? `<span>project · <strong>${esc(projectName)}</strong></span>` : ""}
      ${ref ? `<span>ref · <strong>${esc(ref)}</strong></span>` : ""}
      <span>${tCount} entit${tCount === 1 ? "y" : "ies"}</span>
      <span>${rCount} relationship${rCount === 1 ? "" : "s"}</span>
      <span>generated · ${esc(generated)}</span>
    </div>
  </header>

  ${legend}

  <h2>Entities</h2>
  ${renderSubjectAreas(subjectAreas, tables)}

  <h2>Relationships</h2>
  ${renderRelationships(relationships, tables)}

  <div class="footer-credit">
    Rendered by <a href="https://github.com/duckcode-ai/DataLex">DataLex</a> · This file is self-contained — no network required.
  </div>
</body>
</html>`;
}

/**
 * Trigger a browser download for the generated HTML bundle.
 * Works without a server round-trip, using a Blob + object URL.
 */
export function downloadShareBundle(html, filename = "diagram.html") {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so Safari finishes its download handoff first.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
