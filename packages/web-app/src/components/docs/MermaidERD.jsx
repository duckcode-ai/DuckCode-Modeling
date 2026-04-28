/* MermaidERD — render a mermaid `erDiagram` block from parsed YAML entities.
 *
 * Builds the mermaid source string client-side from the entity list (same
 * shape produced by the docs_export Python module on the backend), then
 * hands it to mermaid.js for SVG rendering. Re-renders whenever `entities`
 * changes — so AI-driven YAML mutations show up live without a page reload.
 */
import React, { useEffect, useMemo, useRef } from "react";
import mermaid from "mermaid";

let _mermaidInitialized = false;
function ensureMermaidInitialized() {
  if (_mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
    er: { useMaxWidth: true },
  });
  _mermaidInitialized = true;
}

const MERMAID_ID = /[^A-Za-z0-9_]+/g;
function mermaidId(name) {
  const cleaned = String(name || "").replace(MERMAID_ID, "_");
  return cleaned || "Entity";
}
function mermaidType(t) {
  return String(t || "string").replace(MERMAID_ID, "_") || "string";
}

function buildSource(entities) {
  if (!Array.isArray(entities) || entities.length === 0) return null;

  const lines = ["erDiagram"];
  const seen = new Set();
  const relationships = [];

  for (const ent of entities) {
    if (!ent || typeof ent !== "object") continue;
    const name = String(ent.name || "").trim();
    if (!name) continue;
    const id = mermaidId(name);
    if (seen.has(id)) continue;
    seen.add(id);

    const fields = Array.isArray(ent.fields) ? ent.fields.slice(0, 8) : [];
    const fieldLines = [];
    for (const fld of fields) {
      if (!fld || typeof fld !== "object") continue;
      const fname = String(fld.name || "").trim();
      if (!fname) continue;
      const tags = [];
      if (fld.primary_key) tags.push("PK");
      if (fld.foreign_key && fld.foreign_key.entity) {
        tags.push("FK");
        relationships.push({
          left: id,
          right: mermaidId(fld.foreign_key.entity),
          label: fname,
        });
      }
      const tagStr = tags.length ? " " + tags.join(",") : "";
      fieldLines.push(`        ${mermaidType(fld.type)} ${fname}${tagStr}`);
    }

    if (fieldLines.length) {
      lines.push(`    ${id} {`);
      lines.push(...fieldLines);
      lines.push("    }");
    } else {
      // Conceptual entity with no fields — render as a bare box.
      lines.push(`    ${id}`);
    }
  }

  const seenRels = new Set();
  for (const rel of relationships) {
    if (!seen.has(rel.right)) continue;
    const key = `${rel.left}|${rel.right}|${rel.label}`;
    if (seenRels.has(key)) continue;
    seenRels.add(key);
    lines.push(`    ${rel.right} ||--o{ ${rel.left} : "${rel.label}"`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

export default function MermaidERD({ entities }) {
  const ref = useRef(null);
  const source = useMemo(() => buildSource(entities), [entities]);

  useEffect(() => {
    if (!ref.current) return;
    if (!source) {
      ref.current.innerHTML = "";
      return;
    }
    ensureMermaidInitialized();
    let cancelled = false;
    const id = `dlx-erd-${Math.random().toString(36).slice(2, 10)}`;
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
      })
      .catch((err) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = `<pre style="color:var(--text-tertiary);font-size:11px;white-space:pre-wrap;">Mermaid render failed:\n${String(err?.message || err)}</pre>`;
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (!source) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontStyle: "italic" }}>
        No entities to draw.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        padding: 14,
        overflowX: "auto",
      }}
    />
  );
}
