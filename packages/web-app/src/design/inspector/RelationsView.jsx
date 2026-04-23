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
import useUiStore from "../../stores/uiStore";
import { patchRelationship } from "../yamlPatch";
import { deleteRelationship } from "../../lib/yamlRoundTrip";
import { getTableRelationships } from "./relationsModel";
import { relationCardinalityValue, openRelationshipEditor } from "../relationshipEditor";

const ACTIONS = NOTATION.onDeleteActions;

const CARDINALITY_OPTIONS = [
  { value: "one_to_one",   label: "1 : 1" },
  { value: "one_to_many",  label: "1 : N" },
  { value: "many_to_one",  label: "N : 1" },
  { value: "many_to_many", label: "N : M" },
];

function endpointLabel(endpoint, fallbackEntity) {
  const entity = fallbackEntity || endpoint?.table || endpoint?.entity || "—";
  return endpoint?.col ? `${entity}.${endpoint.col}` : entity;
}

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

/* Single-relationship inspector (selection is a relationship) */
function RelationshipInspector({ rel, tables }) {
  const openModal = useUiStore((s) => s.openModal);
  const kind = relKindLabel(rel);
  const conceptual = !rel?.from?.col && !rel?.to?.col;

  const applyPatch = (patch) => {
    const s = useWorkspaceStore.getState();
    const next = patchRelationship(s.activeFileContent, rel.name, patch);
    if (next != null) {
      s.updateContent(next);
      s.flushAutosave?.().catch(() => {});
    }
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete relationship “${rel.name}”?`)) return;
    const s = useWorkspaceStore.getState();
    const result = deleteRelationship(s.activeFileContent, rel.name);
    if (result?.yaml && !result.error) {
      s.updateContent(result.yaml);
      s.flushAutosave?.().catch(() => {});
    }
  };

  return (
    <>
      <PanelSection
        title={rel.name}
        action={
          <div className="panel-btn-row">
            <button
              className="panel-btn"
              onClick={() => openRelationshipEditor(openModal, rel, tables)}
              title="Edit relationship"
            >
              <Pencil size={12} /> Edit
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
            <div style={{ fontSize: 12, fontWeight: 600 }}>{rel._fromEntityName || rel.from.table}</div>
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              {endpointLabel(rel.from, rel._fromEntityName)}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
              {NOTATION.cardinalityLabel(rel.from.min, rel.from.max)}
            </div>
          </div>
          <ArrowRight size={14} color="var(--text-tertiary)" />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{rel._toEntityName || rel.to.table}</div>
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              {endpointLabel(rel.to, rel._toEntityName)}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
              {NOTATION.cardinalityLabel(rel.to.min, rel.to.max)}
            </div>
          </div>
        </div>
        {(rel.description || rel.verb || conceptual) && (
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-secondary)" }}>
            {rel.verb && <div><strong>Verb:</strong> {rel.verb}</div>}
            {rel.description && <div style={{ marginTop: rel.verb ? 4 : 0 }}>{rel.description}</div>}
            {conceptual && !rel.description && !rel.verb && (
              <div>Conceptual relationship between business concepts.</div>
            )}
          </div>
        )}
      </PanelSection>

      {!conceptual && (
        <>
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
      )}
    </>
  );
}

/* Table-level relationships list */
function TableRelationships({ table, relationships, onSelect, tables }) {
  const openModal = useUiStore((s) => s.openModal);
  const mine = React.useMemo(
    () => getTableRelationships(table, relationships),
    [table, relationships]
  );

  // Opens NewRelationshipDialog with the current table's id/column pre-filled
  // on the `from` side and a picker populated from the full diagram.
  const handleAdd = () => {
    const entityList = Array.isArray(tables) ? tables : [];
    const firstColName = (table.columns || [])[0]?.name || "";
    openModal("newRelationship", {
      fromEntity: table.name || table.id,
      fromColumn: firstColName,
      toEntity: "",
      toColumn: "",
      tables: entityList.map((t) => ({
        id: t.name || t.id,
        name: t.name || t.id,
        columns: (t.columns || []).map((c) => ({ name: c.name })),
      })),
    });
  };

  if (!mine.length) {
    return (
      <PanelSection
        title="Relationships"
        action={
          <button className="panel-btn primary" onClick={handleAdd} title="Add a relationship from this table">
            <Plus size={12} /> Add
          </button>
        }
      >
        <PanelEmpty
          icon={Plus}
          title="No relationships"
          description="FK columns on this table will appear here once declared. Click Add to create one now."
        />
      </PanelSection>
    );
  }

  return (
    <PanelSection
      title="Incoming & outgoing"
      count={mine.length}
      action={
        <button className="panel-btn" onClick={handleAdd} title="Add a relationship from this table">
          <Plus size={12} /> Add
        </button>
      }
    >
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
              {endpointLabel(r.from, r._fromEntityName)} → {endpointLabel(r.to, r._toEntityName)}
            </div>
          </PanelCard>
        ))}
      </div>
    </PanelSection>
  );
}

export default function RelationsView({ table, rel, relationships, onSelect, tables }) {
  if (rel) return <RelationshipInspector rel={rel} tables={tables} />;
  if (table) return <TableRelationships table={table} relationships={relationships} onSelect={onSelect} tables={tables} />;
  return (
    <PanelEmpty
      icon={XIcon}
      title="No relationship selected"
      description="Pick a table or a relationship to inspect its referential rules."
    />
  );
}
