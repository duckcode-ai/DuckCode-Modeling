/* DocsView — readable rendering of the active YAML model file.
 *
 * Reads `activeFileContent` from the workspace store, parses it client-side
 * with js-yaml, and renders a rich layout: header chips (layer / domain /
 * owners), inline-editable top-level description, mermaid ER diagram, then
 * one section per entity with an inline-editable description and a fields
 * table where each row's description is also click-to-edit.
 *
 * Edits dispatch through `yamlPatch` helpers (`setModelDescription`,
 * `setEntityDescription`, `patchField`) and call `updateContent()`. The
 * same store-driven re-render path means AI agents that mutate YAML
 * (Conceptualizer, AI fixes) are reflected here automatically.
 *
 * No file is ever written to disk by this view — YAML stays the only
 * source of truth.
 */
import React, { useMemo } from "react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import {
  setModelDescription,
  setEntityDescription,
  patchField,
} from "../../design/yamlPatch";
import EditableDescription from "./EditableDescription";
import MermaidERD from "./MermaidERD";

function flagsCellFor(field) {
  const flags = [];
  if (field.primary_key) flags.push("PK");
  if (field.foreign_key && field.foreign_key.entity) {
    const target = field.foreign_key.field || "?";
    flags.push(`FK→${field.foreign_key.entity}.${target}`);
  }
  if (field.unique) flags.push("unique");
  if (field.nullable === false) flags.push("not-null");
  return flags.length ? flags.join(" ") : "—";
}

function parseYaml(text) {
  try {
    const doc = yaml.load(text);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch {
    return null;
  }
}

export default function DocsView() {
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const updateContent = useWorkspaceStore((s) => s.updateContent);

  const doc = useMemo(() => parseYaml(activeFileContent || ""), [activeFileContent]);

  if (!activeFile) {
    return (
      <div style={{ padding: 24, color: "var(--text-tertiary)", fontSize: 13 }}>
        No file open. Click a YAML model file in the explorer to see its docs.
      </div>
    );
  }

  if (!doc) {
    return (
      <div style={{ padding: 24, color: "var(--text-tertiary)", fontSize: 13 }}>
        Unable to parse this file as YAML. Switch to <strong>Code</strong> view to fix the syntax.
      </div>
    );
  }

  const meta = (doc.model && typeof doc.model === "object") ? doc.model : doc;
  const title = doc.title || meta.title || meta.name || activeFile.name;
  const layer = doc.layer || meta.layer || null;
  const domain = meta.domain || doc.domain || null;
  const owners = Array.isArray(meta.owners) ? meta.owners : [];
  const entities = Array.isArray(doc.entities) ? doc.entities : [];
  const relationships = Array.isArray(doc.relationships) ? doc.relationships : [];

  // -------- patch dispatchers (write to YAML through workspace store) --------
  const writeIfChanged = (next) => {
    if (next && next !== activeFileContent) {
      updateContent(next);
    }
  };

  const handleModelDescription = (text) => {
    writeIfChanged(setModelDescription(activeFileContent || "", text));
  };
  const handleEntityDescription = (entityName) => (text) => {
    writeIfChanged(setEntityDescription(activeFileContent || "", entityName, text));
  };
  const handleFieldDescription = (entityName, fieldName) => (text) => {
    writeIfChanged(patchField(activeFileContent || "", entityName, fieldName, { description: text }));
  };

  return (
    <div
      className="datalex-docs-view"
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "20px 24px 32px",
        fontSize: 13.5,
        lineHeight: 1.6,
        color: "var(--text-primary)",
      }}
    >
      {/* Header */}
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {title}
        </h1>
        <div
          style={{
            marginTop: 6,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          {layer && <span><strong>Layer:</strong> <code>{layer}</code></span>}
          {domain && <span><strong>Domain:</strong> <code>{domain}</code></span>}
          {meta.version && <span><strong>Version:</strong> <code>{meta.version}</code></span>}
          {owners.length > 0 && (
            <span><strong>Owners:</strong> {owners.map((o) => <code key={o} style={{ marginLeft: 4 }}>{o}</code>)}</span>
          )}
        </div>
      </header>

      {/* Top-level description */}
      <section style={{ marginBottom: 22 }}>
        <EditableDescription
          value={meta.description || ""}
          placeholder="Add a short summary of what this model represents."
          onSave={handleModelDescription}
          ariaLabel="model description"
        />
      </section>

      {/* Mermaid ERD */}
      {entities.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>
            Entity-relationship diagram
          </h2>
          <MermaidERD entities={entities} />
        </section>
      )}

      {/* Per-entity sections */}
      {entities.map((ent, idx) => {
        if (!ent || typeof ent !== "object") return null;
        const entName = String(ent.name || `Entity ${idx + 1}`);
        const fields = Array.isArray(ent.fields) ? ent.fields : [];
        return (
          <section
            key={entName + idx}
            style={{
              marginBottom: 24,
              padding: "14px 16px",
              borderRadius: 10,
              border: "1px solid var(--border-default)",
              background: "var(--bg-1)",
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{entName}</h3>
              <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                <code>{ent.type || "entity"}</code>
              </span>
            </header>

            <EditableDescription
              value={ent.description || ""}
              placeholder={`Describe the ${entName} entity.`}
              onSave={handleEntityDescription(entName)}
              ariaLabel={`${entName} description`}
            />

            {fields.length > 0 && (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  marginTop: 12,
                  fontSize: 12.5,
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-secondary)" }}>
                    <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)", width: "22%" }}>Field</th>
                    <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)", width: "16%" }}>Type</th>
                    <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)", width: "18%" }}>Flags</th>
                    <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((fld, fIdx) => {
                    if (!fld || typeof fld !== "object") return null;
                    const fname = String(fld.name || "");
                    if (!fname) return null;
                    return (
                      <tr key={fname + fIdx} style={{ verticalAlign: "top" }}>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>
                          <code>{fname}</code>
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>
                          <code>{String(fld.type || "string")}</code>
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)", color: "var(--text-secondary)" }}>
                          {flagsCellFor(fld)}
                        </td>
                        <td style={{ padding: "2px 8px", borderBottom: "1px solid var(--border-default)" }}>
                          <EditableDescription
                            value={fld.description || ""}
                            placeholder="Add a description"
                            onSave={handleFieldDescription(entName, fname)}
                            multiline={false}
                            ariaLabel={`${entName}.${fname} description`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      {/* Relationships table (read-only for now) */}
      {relationships.length > 0 && (
        <section style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>
            Relationships
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-secondary)" }}>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>From</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>To</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>Cardinality</th>
              </tr>
            </thead>
            <tbody>
              {relationships.map((r, idx) => (
                <tr key={(r?.name || idx) + ""}>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}><code>{r?.from || "?"}</code></td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}><code>{r?.to || "?"}</code></td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}><code>{r?.cardinality || "?"}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
