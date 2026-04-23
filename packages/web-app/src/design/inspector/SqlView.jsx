/* SqlView — right-panel SQL tab.
   Renders a live CREATE-TABLE preview of the selected entity by parsing
   the current YAML doc, finding the matching entity, and piping it through
   the shared generator in `lib/ddl.js` + `highlightSql`. Because the
   preview pulls from `workspaceStore.activeFileContent` on every render,
   any column / index / relationship edit updates the SQL on the next
   frame — there's no commit step.

   Header action: copy to clipboard. A small "Export…" link routes to the
   full ExportDdlDialog for a server-side, dialect-aware export. */
import React from "react";
import yaml from "js-yaml";
import { Copy, FileCode2 } from "lucide-react";
import { PanelSection } from "../../components/panels/PanelFrame";
import useWorkspaceStore from "../../stores/workspaceStore";
import { generateEntityDDL, generateSchemaDDL, highlightSql } from "../../lib/ddl";

export default function SqlView({ table, schema, isDiagramFile = false, onExport }) {
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const [copied, setCopied] = React.useState(false);

  /* Parse the YAML doc once per content change, then look up the entity
     whose name matches the selection. Anything that goes wrong (parse
     failure, entity missing) falls back to the flattened `table` we were
     given — so the preview is always populated. */
  const { sql, html } = React.useMemo(() => {
    if (isDiagramFile) {
      const source = generateSchemaDDL(schema);
      return { sql: source, html: highlightSql(source) };
    }
    if (!table) return { sql: "", html: "" };
    let entity = null;
    let relationships = [];
    let indexes = [];
    try {
      const doc = yaml.load(activeFileContent);
      if (doc && typeof doc === "object") {
        const target = String(table.name || "").toLowerCase();
        entity = (doc.entities || []).find(
          (e) => String(e.name || "").toLowerCase() === target
        ) || null;
        relationships = Array.isArray(doc.relationships) ? doc.relationships : [];
        indexes = Array.isArray(doc.indexes) ? doc.indexes : [];
      }
    } catch (_e) { /* fall back to flat table */ }

    // Fallback: adapter-flattened shape if the entity isn't in the YAML
    // (happens for the demo schema).
    const entityForDdl = entity || {
      name: table.name,
      schema: table.schema,
      type: "table",
      description: table.description,
      fields: table.columns || [],
    };

    const source = generateEntityDDL(entityForDdl, {
      includeIndexes: true,
      indexes,
      relationships,
    });
    return { sql: source, html: highlightSql(source) };
  }, [table, schema, isDiagramFile, activeFileContent]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (_e) { /* clipboard blocked — ignore */ }
  };

  if (!table && !isDiagramFile) return null;

  return (
    <PanelSection
      title={isDiagramFile ? "Diagram SQL script" : "CREATE statement"}
      action={
        <div className="panel-btn-row">
          <button className="panel-btn" onClick={handleCopy} title="Copy SQL">
            <Copy size={12} /> {copied ? "Copied" : "Copy"}
          </button>
          {!isDiagramFile && onExport && (
            <button className="panel-btn" onClick={onExport} title="Open full export dialog">
              <FileCode2 size={12} /> Export…
            </button>
          )}
        </div>
      }
    >
      <pre className="inspector-sql-pre">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 6 }}>
        {isDiagramFile
          ? "Script is composed client-side from the models and relationships currently on the canvas."
          : <>Preview is client-side + dialect-agnostic. Use <strong>Export…</strong> for production-grade DDL.</>}
      </div>
    </PanelSection>
  );
}
