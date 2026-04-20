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
import { Key, Link2 } from "lucide-react";
import { PanelSection, StatusPill } from "../../components/panels/PanelFrame";
import useWorkspaceStore from "../../stores/workspaceStore";
import { patchField } from "../yamlPatch";

export default function ColumnsView({ table, col, setSelectedCol, entityName, onDirty }) {
  const applyPatch = React.useCallback((patch) => {
    const s = useWorkspaceStore.getState();
    const next = patchField(s.activeFileContent, entityName, col?.name, patch);
    if (next != null) {
      s.updateContent(next);
      if (onDirty) onDirty();
    }
  }, [col?.name, entityName, onDirty]);

  if (!col) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: "var(--text-tertiary)" }}>
        This table has no columns yet.
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
          <input
            key={`type-${col.name}`}
            className="panel-input"
            defaultValue={col.type}
            list="datalex-types"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== col.type) applyPatch({ type: v });
            }}
          />
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
        </div>
      </PanelSection>

      <PanelSection title="All columns" count={table.columns.length}>
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
                  <td style={{ fontWeight: active ? 600 : 400 }}>{c.name}</td>
                  <td style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{c.type}</td>
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
