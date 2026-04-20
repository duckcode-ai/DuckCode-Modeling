/* RelationsView — right-panel RELATIONS tab.
   Two modes:
     1. When a relationship is the current selection (`rel` prop set), render
        the full inspector — endpoints, cardinality, ON DELETE / ON UPDATE
        segmented action pickers, options, edit / delete actions.
     2. When a table is the current selection (`table` prop set), list every
        relationship touching that table as a compact card with a jump-to
        action.
   Both modes read the authoritative list from `relationships` (passed by
   RightPanel — comes from the schema adapter).

   ON DELETE / ON UPDATE changes write back through patchRelationship.
   Delete uses window.confirm + deleteRelationship. The inline edit form
   commits by calling patchRelationship with {name, from, to, cardinality}. */
import React from "react";
import { Trash2, Pencil, ArrowRight, Plus, X as XIcon } from "lucide-react";
import { PanelSection, PanelCard, StatusPill, PanelEmpty } from "../../components/panels/PanelFrame";
import { NOTATION } from "../notation";
import useWorkspaceStore from "../../stores/workspaceStore";
import { patchRelationship } from "../yamlPatch";
import { deleteRelationship } from "../../lib/yamlRoundTrip";

const ACTIONS = NOTATION.onDeleteActions;

const CARDINALITY_OPTIONS = [
  { value: "one_to_one",   label: "1 : 1" },
  { value: "one_to_many",  label: "1 : N" },
  { value: "many_to_one",  label: "N : 1" },
  { value: "many_to_many", label: "N : M" },
];

function relKindLabel(rel) {
  return NOTATION.kind(rel.from, rel.to);
}

function ActionPicker({ label, value, onChange }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--text-tertiary)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div className="inspector-action-picker">
        {ACTIONS.map((a) => (
          <button
            key={a.k}
            type="button"
            className={String(value || "NO ACTION").toUpperCase() === a.k ? "active" : ""}
            onClick={() => onChange(a.k)}
            title={a.desc}
          >
            <span className="swatch" style={{ background: a.color }} />{a.k}
          </button>
        ))}
      </div>
    </div>
  );
}

function EditForm({ rel, onCommit, onCancel }) {
  const [name, setName] = React.useState(rel.name || "");
  const [from, setFrom] = React.useState(`${rel.from.table}.${rel.from.col}`);
  const [to, setTo]     = React.useState(`${rel.to.table}.${rel.to.col}`);
  const fromKind = rel.from.max === "N";
  const toKind = rel.to.max === "N";
  const initialCardinality =
    fromKind && toKind ? "many_to_many" :
    fromKind && !toKind ? "many_to_one" :
    !fromKind && toKind ? "one_to_many" :
    "one_to_one";
  const [cardinality, setCardinality] = React.useState(initialCardinality);

  return (
    <div className="inspector-inline-form">
      <label>Name</label>
      <input className="panel-input" value={name} onChange={(e) => setName(e.target.value)} />

      <label>From</label>
      <input className="panel-input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="table.column" />

      <label>To</label>
      <input className="panel-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="table.column" />

      <label>Cardinality</label>
      <select className="panel-select" value={cardinality} onChange={(e) => setCardinality(e.target.value)}>
        {CARDINALITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <div className="full" style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button className="panel-btn" onClick={onCancel}>Cancel</button>
        <button
          className="panel-btn primary"
          onClick={() => onCommit({
            name: name.trim() || rel.name,
            from: from.trim(),
            to: to.trim(),
            cardinality,
          })}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/* Single-relationship inspector (selection is a relationship) */
function RelationshipInspector({ rel }) {
  const [editing, setEditing] = React.useState(false);
  const kind = relKindLabel(rel);

  const applyPatch = (patch) => {
    const s = useWorkspaceStore.getState();
    const next = patchRelationship(s.activeFileContent, rel.name, patch);
    if (next != null) s.updateContent(next);
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete relationship “${rel.name}”?`)) return;
    const s = useWorkspaceStore.getState();
    const result = deleteRelationship(s.activeFileContent, rel.name);
    if (result?.yaml && !result.error) s.updateContent(result.yaml);
  };

  return (
    <>
      <PanelSection
        title={rel.name}
        action={
          <div className="panel-btn-row">
            <button className="panel-btn" onClick={() => setEditing((v) => !v)} title={editing ? "Cancel edit" : "Edit"}>
              <Pencil size={12} /> {editing ? "Cancel" : "Edit"}
            </button>
            <button className="panel-btn danger" onClick={handleDelete} title="Delete relationship">
              <Trash2 size={12} /> Delete
            </button>
          </div>
        }
      >
        <div className="panel-btn-row" style={{ marginBottom: 10 }}>
          <StatusPill tone="accent">{kind}</StatusPill>
          {rel.identifying && <StatusPill tone="warning">Identifying</StatusPill>}
          {rel.dashed && <StatusPill tone="neutral">Optional</StatusPill>}
        </div>

        {editing ? (
          <EditForm
            rel={rel}
            onCancel={() => setEditing(false)}
            onCommit={(patch) => { applyPatch(patch); setEditing(false); }}
          />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              background: "var(--bg-1)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{rel.from.table}</div>
              <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{rel.from.col}</div>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
                {NOTATION.cardinalityLabel(rel.from.min, rel.from.max)}
              </div>
            </div>
            <ArrowRight size={14} color="var(--text-tertiary)" />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{rel.to.table}</div>
              <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{rel.to.col}</div>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
                {NOTATION.cardinalityLabel(rel.to.min, rel.to.max)}
              </div>
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Referential actions">
        <div style={{ display: "grid", gap: 14 }}>
          <ActionPicker
            label="ON DELETE"
            value={rel.onDelete}
            onChange={(action) => applyPatch({ on_delete: action })}
          />
          <ActionPicker
            label="ON UPDATE"
            value={rel.onUpdate}
            onChange={(action) => applyPatch({ on_update: action })}
          />
        </div>
      </PanelSection>

      <PanelSection title="Options">
        <div className="panel-btn-row" style={{ flexWrap: "wrap" }}>
          <StatusPill
            tone={rel.identifying ? "warning" : "neutral"}
            onClick={() => applyPatch({ identifying: !rel.identifying })}
            role="button"
            aria-pressed={!!rel.identifying}
            style={{ cursor: "pointer", opacity: rel.identifying ? 1 : 0.6 }}
          >
            IDENTIFYING
          </StatusPill>
          <StatusPill
            tone={rel.dashed ? "info" : "neutral"}
            onClick={() => applyPatch({ optional: !rel.dashed })}
            role="button"
            aria-pressed={!!rel.dashed}
            style={{ cursor: "pointer", opacity: rel.dashed ? 1 : 0.6 }}
          >
            OPTIONAL
          </StatusPill>
        </div>
      </PanelSection>
    </>
  );
}

/* Table-level relationships list */
function TableRelationships({ table, relationships, onSelect }) {
  const mine = React.useMemo(() => {
    const id = String(table.id || table.name || "").toLowerCase();
    return (relationships || []).filter(
      (r) => r.from?.table === id || r.to?.table === id
    );
  }, [table, relationships]);

  if (!mine.length) {
    return (
      <PanelEmpty
        icon={Plus}
        title="No relationships"
        description="FK columns on this table will appear here once declared."
      />
    );
  }

  return (
    <PanelSection title="Incoming & outgoing" count={mine.length}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {mine.map((r) => (
          <PanelCard
            key={r.id || r.name}
            tone="neutral"
            dense
            onClick={() => onSelect && onSelect({ type: "rel", id: r.id })}
            style={{ cursor: onSelect ? "pointer" : "default" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{r.name}</span>
              <StatusPill tone="accent">{relKindLabel(r)}</StatusPill>
              {r.onDelete && <StatusPill tone="neutral">ON DELETE {r.onDelete}</StatusPill>}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
              {r.from.table}.{r.from.col} → {r.to.table}.{r.to.col}
            </div>
          </PanelCard>
        ))}
      </div>
    </PanelSection>
  );
}

export default function RelationsView({ table, rel, relationships, onSelect }) {
  if (rel) return <RelationshipInspector rel={rel} />;
  if (table) return <TableRelationships table={table} relationships={relationships} onSelect={onSelect} />;
  return (
    <PanelEmpty
      icon={XIcon}
      title="No relationship selected"
      description="Pick a table or a relationship to inspect its referential rules."
    />
  );
}
