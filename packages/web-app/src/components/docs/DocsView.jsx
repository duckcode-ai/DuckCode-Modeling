/* DocsView — top-level "readable docs" view of the active YAML model.
 *
 * Mounted as the `docs` workspace view-mode (alongside Diagram, Table,
 * Views, Enums). Full-width surface, not a side-panel widget.
 *
 * Responsibilities:
 *   1. Render the active file as readable docs: header chips, model
 *      description, mermaid ER diagram, per-entity sections with field
 *      tables.
 *   2. Surface dbt readiness chips per entity — "3 missing descriptions",
 *      "missing not-null tests", etc. — sourced from /api/dbt/review.
 *   3. Inline editing — click any description to edit; saves dispatch a
 *      yamlPatch op + updateContent so the same change shows up in the
 *      Code editor and any AI agent that reads activeFileContent.
 *   4. AI assistance — every empty description gets a "Suggest with AI"
 *      button that opens the existing AI assistant with a focused
 *      prompt prefilled. Uses the same surface as Cmd+K → Ask AI; no
 *      new infra.
 *
 * No file is ever written to disk by this view. YAML stays the single
 * source of truth.
 */
import React, { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import { Sparkles, FileText, AlertTriangle } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import {
  setModelDescription,
  setEntityDescription,
  patchField,
} from "../../design/yamlPatch";
import { fetchDbtReadinessReview, runDbtReadinessReview } from "../../lib/api";
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

function ReadinessChip({ status, count, label }) {
  const tone =
    status === "red" ? { bg: "rgba(239,68,68,0.16)", color: "#fca5a5", border: "rgba(239,68,68,0.4)" }
    : status === "yellow" ? { bg: "rgba(234,179,8,0.16)", color: "#fde68a", border: "rgba(234,179,8,0.4)" }
    : { bg: "rgba(34,197,94,0.14)", color: "#86efac", border: "rgba(34,197,94,0.35)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.color,
        border: `1px solid ${tone.border}`,
        fontSize: 11,
        fontWeight: 600,
      }}
      title={`${count} ${label} from the readiness gate`}
    >
      {count} {label}
    </span>
  );
}

export default function DocsView() {
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const updateContent = useWorkspaceStore((s) => s.updateContent);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const openModal = useUiStore((s) => s.openModal);

  const doc = useMemo(() => parseYaml(activeFileContent || ""), [activeFileContent]);

  // -------- readiness review (per file) --------
  const [reviewByPath, setReviewByPath] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");

  // Cheap cache pull on mount + project change.
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    fetchDbtReadinessReview(activeProjectId)
      .then((res) => {
        if (cancelled) return;
        setReviewByPath(res?.byPath || {});
      })
      .catch(() => { /* cached review may not exist yet — that's fine */ });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  const runReview = async () => {
    if (!activeProjectId) return;
    setReviewing(true);
    setReviewError("");
    try {
      const res = await runDbtReadinessReview({ projectId: activeProjectId, scope: "all" });
      setReviewByPath(res?.byPath || {});
    } catch (err) {
      setReviewError(err?.message || String(err));
    } finally {
      setReviewing(false);
    }
  };

  if (!activeFile) {
    return (
      <div className="shell-view" style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 14 }}>
        <FileText size={28} style={{ opacity: 0.5, marginBottom: 10 }} />
        <div style={{ fontSize: 16, marginBottom: 6, color: "var(--text-secondary)" }}>No file open</div>
        <div>Click any YAML file in the Explorer to see its readable docs view here.</div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="shell-view" style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 14 }}>
        <AlertTriangle size={22} style={{ color: "var(--warn, #f59e0b)" }} />
        <div style={{ marginTop: 10 }}>
          Could not parse <code>{activeFile.path || activeFile.name}</code> as YAML. Switch to{" "}
          <strong>Diagram</strong> or open it in the right panel's YAML tab to fix the syntax.
        </div>
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

  // Pull this file's readiness summary out of the cached review.
  const fileReview = (() => {
    const path = activeFile.path || activeFile.fullPath;
    if (!path || !reviewByPath) return null;
    return reviewByPath[path] || reviewByPath[path.replace(/^\/+/, "")] || null;
  })();

  // -------- patch dispatchers --------
  const writeIfChanged = (next) => {
    if (next && next !== activeFileContent) updateContent(next);
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

  // -------- AI suggestion launcher --------
  const askAiToSuggest = (kind, target) => {
    const filePath = activeFile.path || activeFile.fullPath || activeFile.name;
    let initialMessage = "";
    if (kind === "model") {
      initialMessage = `For the dbt + DataLex model at \`${filePath}\` (domain: ${domain || "?"}, layer: ${layer || "?"}), suggest a 1-2 sentence description that explains what business concept this model represents. Reply with ONLY the description text — no preamble, no quotes.`;
    } else if (kind === "entity") {
      initialMessage = `For the entity \`${target}\` in \`${filePath}\` (domain: ${domain || "?"}, layer: ${layer || "?"}), suggest a 1-2 sentence description grounded in dbt + business modeling conventions. Reply with ONLY the description text.`;
    } else if (kind === "field") {
      initialMessage = `For the field \`${target.field}\` on entity \`${target.entity}\` in \`${filePath}\`, suggest a one-line description. Reply with ONLY the description text.`;
    }
    openModal("askAi", { initialMessage });
  };

  const renderEntityReadiness = (entityName) => {
    if (!fileReview || !Array.isArray(fileReview.findings)) return null;
    // The readiness review's `findings` are file-scoped; filter by entity if present.
    const matched = fileReview.findings.filter((f) => {
      if (!f) return false;
      const path = String(f.path || "");
      return path.includes(entityName) || (f.entity && f.entity === entityName);
    });
    if (matched.length === 0) return null;
    const errors = matched.filter((f) => f.severity === "error" || f.severity === "high").length;
    const warnings = matched.filter((f) => f.severity === "warning" || f.severity === "medium").length;
    return (
      <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
        {errors > 0 && <ReadinessChip status="red" count={errors} label="errors" />}
        {warnings > 0 && <ReadinessChip status="yellow" count={warnings} label="warnings" />}
      </div>
    );
  };

  return (
    <div
      className="shell-view"
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "24px 32px 40px",
        fontSize: 13.5,
        lineHeight: 1.6,
        color: "var(--text-primary)",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Header */}
        <header style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>
              {title}
            </h1>
            {fileReview && fileReview.status && (
              <ReadinessChip
                status={fileReview.status}
                count={fileReview.score ?? 0}
                label={`/100 readiness · ${(fileReview.counts?.total ?? 0)} findings`}
              />
            )}
            <button
              type="button"
              onClick={runReview}
              disabled={reviewing || !activeProjectId}
              title="Run the dbt readiness gate over this project"
              style={{
                marginLeft: "auto",
                padding: "5px 11px",
                borderRadius: 6,
                border: "1px solid var(--border-default)",
                background: "var(--bg-2)",
                color: "var(--text-secondary)",
                fontSize: 11.5,
                fontWeight: 600,
                cursor: reviewing || !activeProjectId ? "not-allowed" : "pointer",
              }}
            >
              {reviewing ? "Running readiness…" : "Run readiness check"}
            </button>
          </div>
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
            <span><strong>Source:</strong> <code>{activeFile.path || activeFile.name}</code></span>
          </div>
          {reviewError && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-tertiary)" }}>
              Readiness check failed: {reviewError}
            </div>
          )}
        </header>

        {/* Model description */}
        <section style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <EditableDescription
              value={meta.description || ""}
              placeholder="Add a short summary of what this model represents."
              onSave={handleModelDescription}
              ariaLabel="model description"
            />
            {!meta.description && (
              <button
                type="button"
                onClick={() => askAiToSuggest("model")}
                title="Ask the AI assistant to suggest a description"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 9px",
                  borderRadius: 6,
                  border: "1px solid var(--accent, #3b82f6)",
                  background: "rgba(59,130,246,0.12)",
                  color: "var(--accent, #3b82f6)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Sparkles size={11} /> Suggest with AI
              </button>
            )}
          </div>
        </section>

        {/* Mermaid ERD */}
        {entities.length > 0 && (
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
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
                marginBottom: 22,
                padding: "14px 18px 16px",
                borderRadius: 10,
                border: "1px solid var(--border-default)",
                background: "var(--bg-1)",
              }}
            >
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{entName}</h3>
                  <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                    <code>{ent.type || "entity"}</code>
                  </span>
                  {renderEntityReadiness(entName)}
                </div>
              </header>

              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <EditableDescription
                  value={ent.description || ""}
                  placeholder={`Describe the ${entName} entity.`}
                  onSave={handleEntityDescription(entName)}
                  ariaLabel={`${entName} description`}
                />
                {!ent.description && (
                  <button
                    type="button"
                    onClick={() => askAiToSuggest("entity", entName)}
                    title="Ask the AI assistant to suggest a description for this entity"
                    style={{
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 9px",
                      borderRadius: 6,
                      border: "1px solid var(--accent, #3b82f6)",
                      background: "rgba(59,130,246,0.12)",
                      color: "var(--accent, #3b82f6)",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      marginTop: 6,
                    }}
                  >
                    <Sparkles size={11} /> AI
                  </button>
                )}
              </div>

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
                      <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)", width: "20%" }}>Field</th>
                      <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)", width: "14%" }}>Type</th>
                      <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)", width: "20%" }}>Flags</th>
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
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <EditableDescription
                                  value={fld.description || ""}
                                  placeholder="Add a description"
                                  onSave={handleFieldDescription(entName, fname)}
                                  multiline={false}
                                  ariaLabel={`${entName}.${fname} description`}
                                />
                              </div>
                              {!fld.description && (
                                <button
                                  type="button"
                                  onClick={() => askAiToSuggest("field", { entity: entName, field: fname })}
                                  title="Ask AI to suggest a description for this field"
                                  style={{
                                    flexShrink: 0,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    border: "1px solid var(--accent, #3b82f6)",
                                    background: "rgba(59,130,246,0.12)",
                                    color: "var(--accent, #3b82f6)",
                                    fontSize: 10.5,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                  }}
                                >
                                  <Sparkles size={9} /> AI
                                </button>
                              )}
                            </div>
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
            <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
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
    </div>
  );
}
