/* New Relationship — opened by the design canvas when the user drags
 * from one column's key dot to another column's key dot. Captures a
 * relationship name, cardinality, identifying/optional flags, and the
 * ON DELETE behaviour, then writes via `addRelationship` in
 * `yamlRoundTrip.js` (which goes through `updateContent` and therefore
 * lands in the history stack).
 *
 * The `{from, to}` endpoints are fixed by the drag gesture; the dialog
 * lets users pick _what kind_ of relationship it is rather than which
 * columns. That keeps it fast — one dialog, enter-to-submit.
 */
import React, { useState } from "react";
import { GitBranch, AlertCircle, Link2 } from "lucide-react";
import Modal from "./Modal";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { addRelationship } from "../../lib/yamlRoundTrip";
import { patchRelationship, addDiagramRelationship } from "../../design/yamlPatch";

const CARDINALITIES = [
  { id: "one_to_one",   label: "One-to-one",   sub: "1 : 1" },
  { id: "one_to_many",  label: "One-to-many",  sub: "1 : N" },
  { id: "many_to_one",  label: "Many-to-one",  sub: "N : 1" },
  { id: "many_to_many", label: "Many-to-many", sub: "N : M" },
];

const ON_DELETE = [
  { id: "",          label: "NO ACTION (default)" },
  { id: "CASCADE",   label: "CASCADE" },
  { id: "RESTRICT",  label: "RESTRICT" },
  { id: "SET NULL",  label: "SET NULL" },
  { id: "SET DEFAULT", label: "SET DEFAULT" },
];

function defaultRelName(fromEntity, toEntity) {
  const sanitize = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${sanitize(fromEntity)}_to_${sanitize(toEntity)}`.toLowerCase() || "new_relationship";
}

export default function NewRelationshipDialog() {
  const { closeModal, addToast, modalPayload } = useUiStore();
  const conceptualLevel = Boolean(modalPayload?.conceptualLevel) || String(modalPayload?.modelKind || "").toLowerCase() === "conceptual";
  // Endpoint source: a drag on the canvas pre-fills from/to/columns and the
  // dialog is a one-pane confirmation. The toolbar / command-palette / right-
  // click paths send `tables:[{id,name,columns:[{name}]}]` in the payload and
  // leave endpoints empty — the user picks them with dropdowns here.
  const pickableTables = Array.isArray(modalPayload?.tables) ? modalPayload.tables : null;
  const initFromEntity = String(modalPayload?.fromEntity || "");
  const initFromColumn = conceptualLevel ? "" : String(modalPayload?.fromColumn || (initFromEntity ? "id" : ""));
  const initToEntity = String(modalPayload?.toEntity || "");
  const initToColumn = conceptualLevel ? "" : String(modalPayload?.toColumn || (initToEntity ? "id" : ""));

  const [fromEntity, setFromEntity] = useState(initFromEntity);
  const [fromColumn, setFromColumn] = useState(initFromColumn);
  const [toEntity, setToEntity] = useState(initToEntity);
  const [toColumn, setToColumn] = useState(initToColumn);

  const [name, setName] = useState(() => defaultRelName(initFromEntity, initToEntity));
  const [cardinality, setCardinality] = useState("many_to_one");
  const [identifying, setIdentifying] = useState(false);
  const [optional, setOptional] = useState(false);
  const [onDelete, setOnDelete] = useState("");
  const [verb, setVerb] = useState(String(modalPayload?.verb || ""));
  const [description, setDescription] = useState(String(modalPayload?.description || ""));
  const [error, setError] = useState("");

  // When the user picks entities in picker mode, refresh the default name.
  React.useEffect(() => {
    if (pickableTables && fromEntity && toEntity) {
      setName((prev) => {
        const isDefault =
          !prev || prev === defaultRelName(initFromEntity, initToEntity);
        return isDefault ? defaultRelName(fromEntity, toEntity) : prev;
      });
    }
  }, [fromEntity, toEntity, pickableTables, initFromEntity, initToEntity]);

  const fromCols = React.useMemo(() => {
    const hit = (pickableTables || []).find(
      (t) => (t?.id || t?.name || "").toLowerCase() === fromEntity.toLowerCase()
    );
    return (hit?.columns || []).map((c) => c.name).filter(Boolean);
  }, [pickableTables, fromEntity]);

  const toCols = React.useMemo(() => {
    const hit = (pickableTables || []).find(
      (t) => (t?.id || t?.name || "").toLowerCase() === toEntity.toLowerCase()
    );
    return (hit?.columns || []).map((c) => c.name).filter(Boolean);
  }, [pickableTables, toEntity]);

  const canSubmit = !!name.trim() && !!fromEntity && !!toEntity && (conceptualLevel || (!!fromColumn && !!toColumn));

  // Phase 4.3 — inline endpoint validation. When the user opened the dialog
  // via toolbar/command-palette, pickableTables has the authoritative column
  // list for every diagram entity. Assert the chosen entity + column actually
  // exist before we write YAML; silent "no change produced" errors meant bad
  // rows slipped past. The drag-from-canvas path fills endpoints from the
  // gesture so we skip validation there.
  const validateEndpoint = React.useCallback((entityId, column, side) => {
    if (!pickableTables) return null;
    const hit = pickableTables.find(
      (t) => (t?.id || t?.name || "").toLowerCase() === String(entityId || "").toLowerCase(),
    );
    if (!hit) return `${side} entity "${entityId}" is not on this diagram.`;
    const cols = (hit.columns || []).map((c) => c.name).filter(Boolean);
    if (!conceptualLevel && column && !cols.includes(column)) {
      return `${side} column "${column}" does not exist on ${hit.name || entityId}.`;
    }
    return null;
  }, [conceptualLevel, pickableTables]);

  const endpointError = React.useMemo(() => {
    if (!fromEntity || !toEntity) return "";
    return (
      validateEndpoint(fromEntity, fromColumn, "From") ||
      validateEndpoint(toEntity, toColumn, "To") ||
      ""
    );
  }, [fromEntity, toEntity, fromColumn, toColumn, validateEndpoint]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (endpointError) { setError(endpointError); return; }
    setError("");

    const s = useWorkspaceStore.getState();
    // Detect diagram mode: when the active file is a .diagram.yaml, the FK
    // should land in the diagram's top-level `relationships:` block — not
    // injected into whichever referenced model file. Diagram YAML doesn't
    // contain the endpoint entities at all (they're composed from other
    // files), so addRelationship would fail the "entity exists" check.
    const activeName = String(s.activeFile?.name || "");
    const isDiagram = /\.diagram\.ya?ml$/i.test(activeName);

    if (isDiagram) {
      const next = addDiagramRelationship(s.activeFileContent, {
        name: name.trim(),
        from: conceptualLevel ? { entity: fromEntity } : { entity: fromEntity, field: fromColumn },
        to: conceptualLevel ? { entity: toEntity } : { entity: toEntity, field: toColumn },
        cardinality,
        identifying: conceptualLevel ? undefined : identifying,
        optional: conceptualLevel ? undefined : optional,
        on_delete: conceptualLevel ? undefined : (onDelete || undefined),
        verb: conceptualLevel ? (verb.trim() || undefined) : undefined,
        description: description.trim() || undefined,
        label: "",
      });
      if (!next) {
        setError("Could not write to diagram YAML — check the file is a valid .diagram.yaml.");
        return;
      }
      if (next === s.activeFileContent) {
        setError("That relationship already exists on this diagram.");
        return;
      }
      s.updateContent(next);
      addToast({
        type: "success",
        message: conceptualLevel
          ? `Linked ${fromEntity} → ${toEntity} (conceptual).`
          : `Linked ${fromEntity}.${fromColumn} → ${toEntity}.${toColumn} (diagram).`,
      });
      closeModal();
      return;
    }

    // Model-file mode: fall through to the existing addRelationship path,
    // which writes into `relationships:` inside the model YAML itself.
    const from = conceptualLevel ? { entity: fromEntity } : `${fromEntity}.${fromColumn}`;
    const to = conceptualLevel ? { entity: toEntity } : `${toEntity}.${toColumn}`;
    const { yaml: next, error: err } = addRelationship(
      s.activeFileContent,
      name.trim(),
      from,
      to,
      cardinality,
    );
    if (err) { setError(err); return; }
    if (next === s.activeFileContent) {
      setError("No change produced — check that both entities exist.");
      return;
    }

    // Optional extras: identifying/optional/on_delete. We patch them into
    // the just-written relationship via the narrow patchRelationship
    // helper rather than expanding addRelationship's signature.
    let yamlOut = next;
    if (identifying || optional || onDelete || verb.trim() || description.trim()) {
      const patched = patchRelationship(yamlOut, name.trim(), {
        identifying: conceptualLevel ? undefined : (identifying ? true : undefined),
        optional: conceptualLevel ? undefined : (optional ? true : undefined),
        on_delete: conceptualLevel ? undefined : (onDelete || undefined),
        verb: conceptualLevel ? (verb.trim() || undefined) : undefined,
        description: description.trim() || undefined,
      });
      if (patched) yamlOut = patched;
    }

    s.updateContent(yamlOut);
    addToast({
      type: "success",
      message: conceptualLevel
        ? `Linked ${fromEntity} → ${toEntity}.`
        : `Linked ${fromEntity}.${fromColumn} → ${toEntity}.${toColumn}.`,
    });
    closeModal();
  };

  // Defensive: if the dialog opens with no endpoints AND no picker tables,
  // we can't do anything — point the user back at the canvas.
  if ((!fromEntity || !toEntity) && !pickableTables) {
    return (
      <Modal
        icon={<GitBranch size={14} />}
          title="New relationship"
          size="md"
          onClose={closeModal}
          footer={<button type="button" className="panel-btn" onClick={closeModal}>Close</button>}
      >
        <div className="dlx-modal-alert">
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            {conceptualLevel
              ? "Missing concept endpoints. Drag from one concept card to another or use Add Relationship again."
              : "Missing endpoint(s). Drag between two column keys on the canvas to start again."}
          </span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      icon={<GitBranch size={14} />}
      title={conceptualLevel ? "New conceptual relationship" : "New relationship"}
      subtitle={conceptualLevel ? "Define a business relationship between two concepts." : "Declare a foreign-key edge between two entities. Writes to model YAML."}
      size="md"
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal}>Cancel</button>
          <button
            type="submit"
            form="new-rel-form"
            className="panel-btn primary"
            disabled={!canSubmit || !!endpointError}
          >
            Create
          </button>
        </>
      }
    >
      <form id="new-rel-form" onSubmit={handleSubmit} style={{ display: "contents" }}>
        {/* Endpoint picker (toolbar / command-palette entry) OR summary (drag). */}
        {pickableTables ? (
          <div className="dlx-modal-section" style={{ marginBottom: 14 }}>
            <label className="dlx-modal-field-label">Endpoints</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "end" }}>
              {/* From side */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.4 }}>From</span>
                <select
                  className="panel-input"
                  value={fromEntity}
                  onChange={(e) => {
                    setFromEntity(e.target.value);
                    // Reset column to a sensible default whenever entity changes.
                    const hit = pickableTables.find(
                      (t) => (t?.id || t?.name || "").toLowerCase() === e.target.value.toLowerCase()
                    );
                    const cols = (hit?.columns || []).map((c) => c.name).filter(Boolean);
                    setFromColumn(cols.includes("id") ? "id" : (cols[0] || ""));
                  }}
                >
                  <option value="">Choose entity…</option>
                  {pickableTables.map((t) => {
                    const id = t?.id || t?.name;
                    const label = t?.name || t?.id;
                    return <option key={id} value={id}>{label}</option>;
                  })}
                </select>
                {!conceptualLevel && (
                  <select
                    className="panel-input"
                    value={fromColumn}
                    onChange={(e) => setFromColumn(e.target.value)}
                    disabled={!fromEntity || fromCols.length === 0}
                  >
                    <option value="">Choose column…</option>
                    {fromCols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </div>

              <Link2 size={14} style={{ color: "var(--text-tertiary)", marginBottom: 10 }} />

              {/* To side */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.4 }}>To</span>
                <select
                  className="panel-input"
                  value={toEntity}
                  onChange={(e) => {
                    setToEntity(e.target.value);
                    const hit = pickableTables.find(
                      (t) => (t?.id || t?.name || "").toLowerCase() === e.target.value.toLowerCase()
                    );
                    const cols = (hit?.columns || []).map((c) => c.name).filter(Boolean);
                    setToColumn(cols.includes("id") ? "id" : (cols[0] || ""));
                  }}
                >
                  <option value="">Choose entity…</option>
                  {pickableTables.map((t) => {
                    const id = t?.id || t?.name;
                    const label = t?.name || t?.id;
                    return <option key={id} value={id}>{label}</option>;
                  })}
                </select>
                {!conceptualLevel && (
                  <select
                    className="panel-input"
                    value={toColumn}
                    onChange={(e) => setToColumn(e.target.value)}
                    disabled={!toEntity || toCols.length === 0}
                  >
                    <option value="">Choose column…</option>
                    {toCols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              background: "var(--bg-2)",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              marginBottom: 14,
              fontSize: 12,
              fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)",
            }}
          >
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{fromEntity}</span>
            {!conceptualLevel && <span style={{ color: "var(--text-tertiary)" }}>.{fromColumn}</span>}
            <Link2 size={12} style={{ margin: "0 4px", color: "var(--text-tertiary)" }} />
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{toEntity}</span>
            {!conceptualLevel && <span style={{ color: "var(--text-tertiary)" }}>.{toColumn}</span>}
          </div>
        )}

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="rel-name">Name</label>
          <input
            id="rel-name"
            className="panel-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="fk_orders_customers"
            autoFocus
          />
        </div>

        {conceptualLevel && (
          <>
            <div className="dlx-modal-section">
              <label className="dlx-modal-field-label" htmlFor="rel-verb">Business verb</label>
              <input
                id="rel-verb"
                className="panel-input"
                value={verb}
                onChange={(e) => setVerb(e.target.value)}
                placeholder="places, owns, produces, depends on…"
              />
            </div>

            <div className="dlx-modal-section">
              <label className="dlx-modal-field-label" htmlFor="rel-description">Relationship meaning</label>
              <textarea
                id="rel-description"
                className="panel-input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short explanation of what this business relationship means."
                style={{ resize: "vertical" }}
              />
            </div>
          </>
        )}

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label">Cardinality</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {CARDINALITIES.map((c) => {
              const active = cardinality === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCardinality(c.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${active ? "var(--accent)" : "var(--border-default)"}`,
                    background: active ? "var(--accent-dim)" : "var(--bg-1)",
                    color: "var(--text-primary)",
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    transition: "all 120ms var(--ease)",
                  }}
                >
                  <span>{c.label}</span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{c.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {!conceptualLevel && (
          <>
            <div className="dlx-modal-section">
              <label className="dlx-modal-field-label" htmlFor="rel-ondelete">ON DELETE</label>
              <select
                id="rel-ondelete"
                className="panel-input"
                value={onDelete}
                onChange={(e) => setOnDelete(e.target.value)}
              >
                {ON_DELETE.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>

            <div className="dlx-modal-section">
              <label className="dlx-check" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={identifying} onChange={(e) => setIdentifying(e.target.checked)} />
                <span style={{ fontSize: 12 }}>Identifying
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                    FK is part of the child's primary key.
                  </span>
                </span>
              </label>
              <label className="dlx-check" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 8 }}>
                <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} />
                <span style={{ fontSize: 12 }}>Optional
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                    Child row may exist without a parent (nullable FK).
                  </span>
                </span>
              </label>
            </div>
          </>
        )}

        {(error || endpointError) && (
          <div className="dlx-modal-alert">
            <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{error || endpointError}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
