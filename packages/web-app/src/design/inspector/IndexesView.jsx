/* IndexesView — right-panel INDEXES tab.
   Lists the indexes declared in the YAML for the selected table, with an
   inline "Add index" form that commits via `addIndex`. Existing rows can
   be deleted with a trash button (`removeIndex`). Field selection uses a
   multi-select built from the table's columns.

   Also surfaces an implicit pk-index row for the primary key (read-only
   — PK indexes live on the entity itself, not in `doc.indexes`). */
import React from "react";
import { Plus, Trash2, Hash } from "lucide-react";
import { PanelSection, PanelEmpty, StatusPill } from "../../components/panels/PanelFrame";
import useWorkspaceStore from "../../stores/workspaceStore";
import { addIndex, removeIndex } from "../../lib/yamlRoundTrip";

export default function IndexesView({ table, indexes }) {
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [selectedFields, setSelectedFields] = React.useState([]);
  const [unique, setUnique] = React.useState(false);
  const [type, setType] = React.useState("btree");

  const tableId = String(table?.id || table?.name || "").toLowerCase();

  const mine = React.useMemo(() => {
    const list = Array.isArray(indexes) ? indexes : [];
    return list.filter((ix) => String(ix?.entity || "").toLowerCase() === tableId);
  }, [indexes, tableId]);

  const pkCols = (table?.columns || []).filter((c) => c.pk).map((c) => c.name);
  const implicitPk = pkCols.length
    ? [{ name: `${table.name}_pkey`, entity: table.name, fields: pkCols, unique: true, type: "btree", _implicit: true }]
    : [];

  const rows = [...implicitPk, ...mine];

  const resetForm = () => {
    setAdding(false);
    setName("");
    setSelectedFields([]);
    setUnique(false);
    setType("btree");
  };

  const handleAdd = () => {
    const clean = name.trim();
    if (!clean || !selectedFields.length) return;
    const s = useWorkspaceStore.getState();
    const result = addIndex(s.activeFileContent, clean, table.name, selectedFields, unique, type);
    if (result?.yaml && !result.error) {
      s.updateContent(result.yaml);
      resetForm();
    }
  };

  const handleRemove = (ixName) => {
    if (!window.confirm(`Drop index “${ixName}”?`)) return;
    const s = useWorkspaceStore.getState();
    const result = removeIndex(s.activeFileContent, ixName);
    if (result?.yaml && !result.error) s.updateContent(result.yaml);
  };

  const toggleField = (fieldName) => {
    setSelectedFields((cur) =>
      cur.includes(fieldName) ? cur.filter((f) => f !== fieldName) : [...cur, fieldName]
    );
  };

  return (
    <PanelSection
      title="Indexes"
      count={rows.length}
      action={
        !adding && (
          <button className="panel-btn primary" onClick={() => setAdding(true)} title="Add index">
            <Plus size={12} /> Add
          </button>
        )
      }
    >
      {adding && (
        <div className="inspector-inline-form" style={{ marginBottom: 10 }}>
          <label>Name</label>
          <input
            className="panel-input"
            placeholder={`${table.name}_idx`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          <label>Fields</label>
          <div className="panel-btn-row" style={{ flexWrap: "wrap" }}>
            {(table.columns || []).map((c) => {
              const on = selectedFields.includes(c.name);
              return (
                <StatusPill
                  key={c.name}
                  tone={on ? "accent" : "neutral"}
                  onClick={() => toggleField(c.name)}
                  role="button"
                  aria-pressed={on}
                  style={{ cursor: "pointer", opacity: on ? 1 : 0.65 }}
                >
                  {c.name}
                </StatusPill>
              );
            })}
          </div>

          <label>Type</label>
          <select className="panel-select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="btree">btree</option>
            <option value="hash">hash</option>
            <option value="gin">gin</option>
            <option value="gist">gist</option>
            <option value="brin">brin</option>
          </select>

          <label>Unique</label>
          <div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
              <span>Unique index</span>
            </label>
          </div>

          <div className="full" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button className="panel-btn" onClick={resetForm}>Cancel</button>
            <button
              className="panel-btn primary"
              onClick={handleAdd}
              disabled={!name.trim() || !selectedFields.length}
            >
              Add index
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 && !adding && (
        <PanelEmpty
          icon={Hash}
          title="No indexes"
          description="Add an index to speed up filter / join / sort queries on this table."
        />
      )}

      {rows.length > 0 && (
        <table className="panel-table" role="grid" aria-label="Indexes">
          <thead>
            <tr>
              <th>Name</th>
              <th>Fields</th>
              <th style={{ width: 70 }}>Type</th>
              <th style={{ width: 60 }}>Unique</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ix) => (
              <tr key={ix.name}>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{ix.name}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                  {(ix.fields || []).join(", ")}
                </td>
                <td>{ix.type || "btree"}</td>
                <td>{ix.unique ? "✓" : "—"}</td>
                <td style={{ textAlign: "right" }}>
                  {!ix._implicit && (
                    <button
                      className="panel-btn danger"
                      style={{ padding: "2px 6px" }}
                      onClick={() => handleRemove(ix.name)}
                      title="Drop index"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PanelSection>
  );
}
