/* ColumnsView — right-panel COLUMNS tab.
   Edits a single column (selected via the column list) and offers flag
   toggles (PK / NOT NULL / UNIQUE) via StatusPill buttons. All edits
   round-trip through `patchField` → workspaceStore.updateContent, so the
   YAML tab, SQL preview, and canvas all update on the next frame.

   The caller is expected to pass:
     table        — adapted table entity (with .columns[])
     col          — the selected column (same object that lives in table.columns)
     setSelectedCol(name) — selection setter
     entityName   — the YAML entity name (used by patchField)
     onDirty()    — optional callback after a successful patch (for logging) */
import React from "react";
import { Key, Link2, AlertTriangle, Replace, Plus, Trash2 } from "lucide-react";
import yaml from "js-yaml";
import { PanelSection, StatusPill } from "../../components/panels/PanelFrame";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import { patchField, appendField, deleteField } from "../yamlPatch";
import { lintEntity } from "../../lib/dbtLint";

/* Parse the active YAML and run dbtLint for the currently-selected entity.
 * Memoised in the hook caller — each keystroke reparses, which is cheap
 * because the file is already in memory and js-yaml is lazy on large docs.
 * Returns a Map<columnName, LintFinding[]> for O(1) per-row lookup. */
function useEntityLintByColumn(entityName) {
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  return React.useMemo(() => {
    if (!entityName || !activeFileContent) return new Map();
    let doc;
    try { doc = yaml.load(activeFileContent); }
    catch (_err) { return new Map(); }
    if (!doc || typeof doc !== "object") return new Map();

    const entity = findEntityByName(doc, entityName);
    if (!entity) return new Map();

    const findings = lintEntity(entity, {
      filePath: activeFile?.fullPath || activeFile?.name || "",
    });
    const byCol = new Map();
    for (const f of findings) {
      const key = f.field || "";
      if (!key) continue;
      if (!byCol.has(key)) byCol.set(key, []);
      byCol.get(key).push(f);
    }
    return byCol;
  }, [entityName, activeFileContent, activeFile]);
}

/* Look up an entity by name across the three shapes our YAML ingestor
 * emits: DataLex (`entities[]`), dbt-shaped (`models[]` / `sources[].tables[]`),
 * and DataLex per-file kind docs. Returns the raw entity object so lint
 * rules see descriptions, tests, and types verbatim. */
function findEntityByName(doc, name) {
  if (!doc || !name) return null;
  if (Array.isArray(doc.entities)) {
    const hit = doc.entities.find((e) => e && e.name === name);
    if (hit) return hit;
  }
  if (Array.isArray(doc.models)) {
    const hit = doc.models.find((m) => m && m.name === name);
    if (hit) return hit;
  }
  if (Array.isArray(doc.sources)) {
    for (const src of doc.sources) {
      const hit = (src.tables || []).find((t) => t && t.name === name);
      if (hit) return hit;
    }
  }
  if ((doc.kind === "model" || doc.kind === "source") && doc.name === name) return doc;
  return null;
}

export default function ColumnsView({ table, col, setSelectedCol, entityName, onDirty }) {
  const lintByColumn = useEntityLintByColumn(entityName);
  const selectedFindings = (col?.name && lintByColumn.get(col.name)) || [];
  const openModal = useUiStore((s) => s.openModal);

  const handleBulkRename = React.useCallback(() => {
    if (!entityName || !col?.name) return;
    openModal("bulkRenameColumn", { entity: entityName, oldField: col.name });
  }, [openModal, entityName, col?.name]);

  const applyPatch = React.useCallback((patch) => {
    const s = useWorkspaceStore.getState();
    const next = patchField(s.activeFileContent, entityName, col?.name, patch);
    if (next != null) {
      s.updateContent(next);
      if (onDirty) onDirty();
      // Inspector edits arrive via field blur — the user has already
      // "committed" the change by tabbing away, so collapse the 800ms
      // debounce window and persist immediately. Code-view typing still
      // goes through the debounced path.
      s.flushAutosave?.().catch(() => {});
    }
  }, [col?.name, entityName, onDirty]);

  /* Add a new column. We invent a non-colliding placeholder name
   * ("new_column", "new_column_2", …) so the user lands on an editable row
   * immediately and can rename via the Name input. Type defaults to
   * "string" — the importer treats "unknown" as a warning, so seeding a
   * real type avoids inheriting that yellow-border state. */
  const handleAddColumn = React.useCallback(() => {
    if (!entityName) return;
    const existing = new Set(
      (table?.columns || []).map((c) => String(c.name || "").toLowerCase())
    );
    let base = "new_column";
    let name = base;
    let n = 2;
    while (existing.has(name.toLowerCase())) {
      name = `${base}_${n++}`;
    }
    const s = useWorkspaceStore.getState();
    const next = appendField(s.activeFileContent, entityName, { name, type: "string" });
    if (next != null) {
      s.updateContent(next);
      if (setSelectedCol) setSelectedCol(name);
      if (onDirty) onDirty();
    }
  }, [entityName, table?.columns, setSelectedCol, onDirty]);

  /* Delete the currently-selected column, with confirmation. After the
   * write lands we move selection to a sibling so the panel doesn't flash
   * the empty state unless this was the last column. */
  const handleDeleteColumn = React.useCallback(() => {
    if (!entityName || !col?.name) return;
    if (!window.confirm(`Delete column “${col.name}” from “${entityName}”?`)) return;
    const s = useWorkspaceStore.getState();
    const next = deleteField(s.activeFileContent, entityName, col.name);
    if (next != null) {
      s.updateContent(next);
      if (setSelectedCol) {
        const siblings = (table?.columns || []).filter((c) => c.name !== col.name);
        setSelectedCol(siblings[0]?.name || null);
      }
      if (onDirty) onDirty();
    }
  }, [entityName, col?.name, table?.columns, setSelectedCol, onDirty]);

  if (!col) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: "var(--text-tertiary)" }}>
        <div style={{ marginBottom: 10 }}>This table has no columns yet.</div>
        {entityName && (
          <button
            type="button"
            className="panel-btn"
            onClick={handleAddColumn}
            title="Append a new column to this entity"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}
          >
            <Plus size={11} />
            Add column
          </button>
        )}
      </div>
    );
  }

  const flag = (label, on, onClick, tone = "neutral") => (
    <StatusPill
      key={label}
      tone={on ? tone : "neutral"}
      onClick={onClick}
      style={{
        cursor: onClick ? "pointer" : "default",
        opacity: on ? 1 : 0.55,
        userSelect: "none",
      }}
      role={onClick ? "button" : undefined}
      aria-pressed={onClick ? on : undefined}
      title={onClick ? `Toggle ${label}` : label}
    >
      {label}
    </StatusPill>
  );

  return (
    <>
      {selectedFindings.length > 0 && (
        <PanelSection title="dbt lint" count={selectedFindings.length}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 2px" }}>
            {selectedFindings.map((f, i) => (
              <div
                key={`sel-lint-${i}`}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: "var(--text-secondary)",
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-default)",
                  borderLeft: "2px solid var(--cat-billing, #f5b544)",
                  borderRadius: 4,
                }}
                title={f.code}
              >
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2, color: "var(--cat-billing, #f5b544)" }} />
                <span>{f.message}</span>
              </div>
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Selected column">
        <div className="inspector-inline-form">
          <label>Name</label>
          <input
            key={`name-${col.name}`}
            className="panel-input"
            defaultValue={col.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== col.name) applyPatch({ name: v });
            }}
          />

          <label>Type</label>
          {(() => {
            // Treat "unknown" (what the dbt importer writes when manifest has
            // no data_type) and empty as "needs attention" — prefill an empty
            // editable input with a suggestive placeholder so the user sees
            // exactly what to fix. Saving an empty string via blur is a
            // no-op (patchField only fires when the new value differs).
            const raw = String(col.type || "");
            const isUnknown = !raw || raw.toLowerCase() === "unknown";
            return (
              <input
                key={`type-${col.name}`}
                className="panel-input"
                defaultValue={isUnknown ? "" : raw}
                placeholder={isUnknown ? "e.g. varchar(255) — run `dbt compile` or set inline" : ""}
                list="datalex-types"
                style={isUnknown ? { borderColor: "var(--cat-billing, #f5b544)" } : undefined}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== col.type) applyPatch({ type: v });
                }}
              />
            );
          })()}
          <datalist id="datalex-types">
            <option value="string" /><option value="integer" /><option value="bigint" />
            <option value="boolean" /><option value="float" /><option value="decimal" />
            <option value="date" /><option value="timestamp" /><option value="timestamptz" />
            <option value="json" /><option value="jsonb" /><option value="text" />
            <option value="uuid" /><option value="varchar(255)" />
          </datalist>

          <label>Default</label>
          <input
            key={`default-${col.name}`}
            className="panel-input"
            placeholder="NULL"
            defaultValue={col.default || ""}
            onBlur={(e) => applyPatch({ default: e.target.value })}
          />

          <label>Comment</label>
          <input
            key={`desc-${col.name}`}
            className="panel-input"
            placeholder="—"
            defaultValue={col.description || ""}
            onBlur={(e) => applyPatch({ description: e.target.value })}
          />

          <label>Check</label>
          <input
            key={`check-${col.name}`}
            className="panel-input"
            placeholder="e.g. length(name) > 0"
            defaultValue={col.check || ""}
            onBlur={(e) => applyPatch({ check: e.target.value })}
          />

          <label>Flags</label>
          <div className="panel-btn-row" style={{ gap: 6, flexWrap: "wrap" }}>
            {flag("PK",       !!col.pk,       () => applyPatch({ primary_key: !col.pk }),           "warning")}
            {flag("NOT NULL", !!col.nn,       () => applyPatch({ nullable: col.nn ? undefined : false }), "accent")}
            {flag("UNIQUE",   !!col.unique,   () => applyPatch({ unique: !col.unique }),            "info")}
            {flag("GENERATED",!!col.generated,() => applyPatch({ generated: !col.generated }),      "info")}
            {flag("FK",       !!col.fk,       undefined,                                            "success")}
          </div>

          <label>Refactor</label>
          <div className="panel-btn-row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="panel-btn"
              onClick={handleBulkRename}
              title="Rename this column across every YAML file in the workspace (FKs, relationships, indexes, metrics, keys)."
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}
            >
              <Replace size={11} />
              Rename across project…
            </button>
            <button
              type="button"
              className="panel-btn danger"
              onClick={handleDeleteColumn}
              title={`Delete column “${col.name}” from this entity.`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}
            >
              <Trash2 size={11} />
              Delete column
            </button>
          </div>
        </div>
      </PanelSection>

      <PanelSection
        title="All columns"
        count={table.columns.length}
        action={
          <button
            type="button"
            className="panel-btn"
            onClick={handleAddColumn}
            title="Append a new column to this entity"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}
          >
            <Plus size={11} />
            Add
          </button>
        }
      >
        <table className="panel-table" role="grid" aria-label="Columns">
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>Name</th>
              <th>Type</th>
              <th style={{ width: 60, textAlign: "right" }}>Flags</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((c) => {
              const active = c.name === col.name;
              const rowFindings = lintByColumn.get(c.name) || [];
              const findingSummary = rowFindings.length > 0
                ? rowFindings.map((f) => f.message).join("\n")
                : "";
              return (
                <tr
                  key={c.name}
                  onClick={() => setSelectedCol(c.name)}
                  style={{
                    cursor: "pointer",
                    outline: active ? "1px solid var(--accent)" : "none",
                    outlineOffset: -1,
                  }}
                >
                  <td>
                    {c.pk ? <Key size={11} color="var(--pk, #f5b544)" />
                      : c.fk ? <Link2 size={11} color="var(--fk, #f59e0b)" />
                      : <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: "var(--text-muted)" }} />}
                  </td>
                  <td style={{ fontWeight: active ? 600 : 400 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {c.name}
                      {rowFindings.length > 0 && (
                        <span
                          title={findingSummary}
                          aria-label={`${rowFindings.length} dbt lint finding${rowFindings.length === 1 ? "" : "s"}`}
                          style={{ display: "inline-flex", alignItems: "center", lineHeight: 0 }}
                        >
                          <AlertTriangle size={10} color="var(--cat-billing, #f5b544)" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    {(() => {
                      const raw = String(c.type || "");
                      const isUnknown = !raw || raw.toLowerCase() === "unknown";
                      return isUnknown
                        ? <span style={{ color: "var(--text-muted, #94a3b8)", fontStyle: "italic" }} title="Type not set">—</span>
                        : c.type;
                    })()}
                  </td>
                  <td style={{ textAlign: "right", color: "var(--text-tertiary)", fontSize: 10 }}>
                    {[c.pk && "PK", c.nn && "NN", c.unique && "UQ", c.fk && "FK"].filter(Boolean).join(" ") || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </PanelSection>
    </>
  );
}
