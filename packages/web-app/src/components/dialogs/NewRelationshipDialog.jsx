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
import { GitBranch, AlertCircle, Link2, ArrowRightLeft } from "lucide-react";
import Modal from "./Modal";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { addRelationship } from "../../lib/yamlRoundTrip";
import { patchRelationship, addDiagramRelationship } from "../../design/yamlPatch";
import { relationCardinalityValue } from "../../design/relationshipEditor";

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

const CONCEPTUAL_RELATIONSHIP_TYPES = [
  { id: "", label: "General association" },
  { id: "ownership", label: "Ownership" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "dependency", label: "Dependency" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "reference", label: "Reference" },
  { id: "event", label: "Event / flow" },
];

function defaultRelName(fromEntity, toEntity) {
  const sanitize = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${sanitize(fromEntity)}_to_${sanitize(toEntity)}`.toLowerCase() || "new_relationship";
}

function endpointValue(entity, column, entityLevel) {
  if (entityLevel || !column) return { entity };
  return `${entity}.${column}`;
}

function endpointPatchValue(entity, column, entityLevel) {
  if (entityLevel || !column) return { entity };
  return { entity, field: column };
}

function optionValues(table) {
  return [
    table?.id,
    table?.name,
    table?.nodeId,
    table?._entityName,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

export default function NewRelationshipDialog() {
  const { closeModal, addToast, modalPayload } = useUiStore();
  const editMode = modalPayload?.mode === "edit";
  const editingRelationship = editMode ? (modalPayload?.relationship || null) : null;
  const modelKind = String(modalPayload?.modelKind || "").toLowerCase();
  const conceptualLevel = Boolean(modalPayload?.conceptualLevel) || modelKind === "conceptual";
  const logicalLevel = modelKind === "logical";
  const physicalLevel = modelKind === "physical" || (!conceptualLevel && !logicalLevel);
  const entityLevelEndpoints = conceptualLevel || logicalLevel;
  // Endpoint source: a drag on the canvas pre-fills from/to/columns and the
  // dialog is a one-pane confirmation. The toolbar / command-palette / right-
  // click paths send `tables:[{id,name,columns:[{name}]}]` in the payload and
  // leave endpoints empty — the user picks them with dropdowns here.
  const pickableTables = Array.isArray(modalPayload?.tables) ? modalPayload.tables : null;
  const tableOptions = pickableTables || [];
  const findTableOption = React.useCallback((entityId) => {
    const key = String(entityId || "").trim().toLowerCase();
    if (!key) return null;
    return tableOptions.find((table) => optionValues(table).includes(key)) || null;
  }, [tableOptions]);
  const canonicalEntity = React.useCallback((entityId) => {
    const hit = findTableOption(entityId);
    return String(hit?.id || hit?._entityName || hit?.name || entityId || "").trim();
  }, [findTableOption]);
  const defaultColumnForEntity = React.useCallback((entityId) => {
    const hit = findTableOption(entityId);
    const cols = (hit?.columns || []).filter(Boolean);
    return (
      cols.find((col) => col?.pk || col?.primary_key)?.name ||
      cols.find((col) => String(col?.name || "").toLowerCase() === "id")?.name ||
      cols[0]?.name ||
      ""
    );
  }, [findTableOption]);
  const initFromEntity = String(modalPayload?.fromEntity || "");
  const initFromColumn = entityLevelEndpoints ? String(modalPayload?.fromColumn || "") : String(modalPayload?.fromColumn || defaultColumnForEntity(initFromEntity));
  const initToEntity = String(modalPayload?.toEntity || "");
  const initToColumn = entityLevelEndpoints ? String(modalPayload?.toColumn || "") : String(modalPayload?.toColumn || defaultColumnForEntity(initToEntity));

  const [fromEntity, setFromEntity] = useState(initFromEntity);
  const [fromColumn, setFromColumn] = useState(initFromColumn);
  const [toEntity, setToEntity] = useState(initToEntity);
  const [toColumn, setToColumn] = useState(initToColumn);

  const [name, setName] = useState(() => String(modalPayload?.name || defaultRelName(initFromEntity, initToEntity)));
  const [cardinality, setCardinality] = useState(String(modalPayload?.cardinality || relationCardinalityValue(editingRelationship) || "many_to_one"));
  const [identifying, setIdentifying] = useState(!!modalPayload?.identifying);
  const [optional, setOptional] = useState(!!modalPayload?.optional);
  const [onDelete, setOnDelete] = useState(String(modalPayload?.onDelete || ""));
  const [description, setDescription] = useState(String(modalPayload?.description || editingRelationship?.description || ""));
  const [verb, setVerb] = useState(String(modalPayload?.verb || editingRelationship?.verb || ""));
  const [relationshipType, setRelationshipType] = useState(String(modalPayload?.relationshipType || editingRelationship?.relationshipType || ""));
  const [fromRole, setFromRole] = useState(String(modalPayload?.fromRole || editingRelationship?.fromRole || ""));
  const [toRole, setToRole] = useState(String(modalPayload?.toRole || editingRelationship?.toRole || ""));
  const [rationale, setRationale] = useState(String(modalPayload?.rationale || editingRelationship?.rationale || ""));
  const [sourceOfTruth, setSourceOfTruth] = useState(String(modalPayload?.sourceOfTruth || editingRelationship?.sourceOfTruth || ""));
  const [error, setError] = useState("");

  const handleSwapEndpoints = React.useCallback(() => {
    setFromEntity(toEntity);
    setFromColumn(toColumn);
    setToEntity(fromEntity);
    setToColumn(fromColumn);
  }, [fromColumn, fromEntity, toColumn, toEntity]);

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
    const hit = findTableOption(fromEntity);
    return (hit?.columns || []).map((c) => c.name).filter(Boolean);
  }, [findTableOption, fromEntity]);

  const toCols = React.useMemo(() => {
    const hit = findTableOption(toEntity);
    return (hit?.columns || []).map((c) => c.name).filter(Boolean);
  }, [findTableOption, toEntity]);

  const canSubmit = !!name.trim() && !!fromEntity && !!toEntity && (entityLevelEndpoints || (!!fromColumn && !!toColumn));

  // Phase 4.3 — inline endpoint validation. When the user opened the dialog
  // via toolbar/command-palette, pickableTables has the authoritative column
  // list for every diagram entity. Assert the chosen entity + column actually
  // exist before we write YAML; silent "no change produced" errors meant bad
  // rows slipped past. The drag-from-canvas path fills endpoints from the
  // gesture so we skip validation there.
  const validateEndpoint = React.useCallback((entityId, column, side) => {
    if (!pickableTables) return null;
    const hit = findTableOption(entityId);
    if (!hit) return `${side} entity "${entityId}" is not on this diagram.`;
    const cols = (hit.columns || []).map((c) => c.name).filter(Boolean);
    if (!entityLevelEndpoints && column && !cols.includes(column)) {
      return `${side} column "${column}" does not exist on ${hit.name || entityId}.`;
    }
    return null;
  }, [entityLevelEndpoints, findTableOption, pickableTables]);

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
    const nextFromEntity = canonicalEntity(fromEntity);
    const nextToEntity = canonicalEntity(toEntity);
    const targetName = name.trim() || editingRelationship?.name || defaultRelName(nextFromEntity, nextToEntity);
    // Detect diagram mode: when the active file is a .diagram.yaml, the FK
    // should land in the diagram's top-level `relationships:` block — not
    // injected into whichever referenced model file. Diagram YAML doesn't
    // contain the endpoint entities at all (they're composed from other
    // files), so addRelationship would fail the "entity exists" check.
    const activeName = String(s.activeFile?.name || "");
    const isDiagram = /\.diagram\.ya?ml$/i.test(activeName);

    if (editMode) {
      if (!editingRelationship) {
        setError("Missing relationship metadata for edit.");
        return;
      }
      if (editingRelationship?._origin === "field_fk") {
        setError("This relationship comes from a foreign-key field. Edit the column FK in the source model instead.");
        return;
      }
      const patch = {
        name: targetName,
        from: endpointPatchValue(nextFromEntity, fromColumn, entityLevelEndpoints),
        to: endpointPatchValue(nextToEntity, toColumn, entityLevelEndpoints),
        cardinality,
        identifying: conceptualLevel ? undefined : identifying,
        optional: conceptualLevel ? undefined : optional,
        on_delete: conceptualLevel ? undefined : (onDelete || undefined),
        description: description.trim() || undefined,
        verb: verb.trim() || undefined,
        relationship_type: relationshipType.trim() || undefined,
        from_role: logicalLevel ? (fromRole.trim() || undefined) : undefined,
        to_role: logicalLevel ? (toRole.trim() || undefined) : undefined,
        rationale: rationale.trim() || undefined,
        source_of_truth: sourceOfTruth.trim() || undefined,
        _match: {
          from: endpointPatchValue(
            canonicalEntity(editingRelationship?._fromEntityName || editingRelationship?.from?.table || ""),
            editingRelationship?.from?.col || "",
            !editingRelationship?.from?.col && !editingRelationship?.to?.col,
          ),
          to: endpointPatchValue(
            canonicalEntity(editingRelationship?._toEntityName || editingRelationship?.to?.table || ""),
            editingRelationship?.to?.col || "",
            !editingRelationship?.from?.col && !editingRelationship?.to?.col,
          ),
        },
      };
      const applyPatch = (content) => patchRelationship(content, editingRelationship.name, patch);

      if (editingRelationship?._origin === "model_relationship" && editingRelationship?._sourceFile) {
        s.mutateReferencedFile(editingRelationship._sourceFile, applyPatch)
          .then((result) => {
            if (!result?.changed) {
              setError("Could not update the relationship in its source YAML.");
              return;
            }
            addToast({
              type: "success",
              message: entityLevelEndpoints
                ? `Updated ${nextFromEntity} → ${nextToEntity}.`
                : `Updated ${nextFromEntity}.${fromColumn} → ${nextToEntity}.${toColumn}.`,
            });
            closeModal();
          })
          .catch((err) => {
            setError(err?.message || String(err));
          });
        return;
      }

      const next = applyPatch(s.activeFileContent);
      if (!next) {
        setError("Could not update the relationship in the active YAML.");
        return;
      }
      if (next === s.activeFileContent) {
        addToast({ type: "info", message: "No relationship changes to save." });
        closeModal();
        return;
      }
      s.updateContent(next);
      s.flushAutosave?.().catch(() => {});
      s.bumpModelGraphVersion?.();
      addToast({
        type: "success",
        message: entityLevelEndpoints
          ? `Updated ${nextFromEntity} → ${nextToEntity}.`
          : `Updated ${nextFromEntity}.${fromColumn} → ${nextToEntity}.${toColumn}.`,
      });
      closeModal();
      return;
    }

    if (isDiagram) {
      const next = addDiagramRelationship(s.activeFileContent, {
        name: targetName,
        from: endpointPatchValue(nextFromEntity, fromColumn, entityLevelEndpoints),
        to: endpointPatchValue(nextToEntity, toColumn, entityLevelEndpoints),
        cardinality,
        identifying: conceptualLevel ? undefined : identifying,
        label: "",
        description: description.trim() || undefined,
        verb: verb.trim() || undefined,
        relationship_type: relationshipType.trim() || undefined,
        from_role: logicalLevel ? (fromRole.trim() || undefined) : undefined,
        to_role: logicalLevel ? (toRole.trim() || undefined) : undefined,
        rationale: rationale.trim() || undefined,
        source_of_truth: sourceOfTruth.trim() || undefined,
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
      s.flushAutosave?.().catch(() => {});
      s.bumpModelGraphVersion?.();
      addToast({
        type: "success",
        message: entityLevelEndpoints
          ? `Linked ${nextFromEntity} → ${nextToEntity} (diagram).`
          : `Linked ${nextFromEntity}.${fromColumn} → ${nextToEntity}.${toColumn} (diagram).`,
      });
      closeModal();
      return;
    }

    // Model-file mode: fall through to the existing addRelationship path,
    // which writes into `relationships:` inside the model YAML itself.
    const from = endpointValue(nextFromEntity, fromColumn, entityLevelEndpoints);
    const to = endpointValue(nextToEntity, toColumn, entityLevelEndpoints);
    const { yaml: next, error: err } = addRelationship(
      s.activeFileContent,
      targetName,
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
    if (identifying || optional || onDelete || description.trim() || verb.trim() || relationshipType.trim() || fromRole.trim() || toRole.trim() || rationale.trim() || sourceOfTruth.trim() || conceptualLevel) {
      const patched = patchRelationship(yamlOut, targetName, {
        identifying: conceptualLevel ? undefined : (identifying ? true : undefined),
        optional: conceptualLevel ? undefined : (optional ? true : undefined),
        on_delete: conceptualLevel ? undefined : (onDelete || undefined),
        description: description.trim() || undefined,
        verb: verb.trim() || undefined,
        relationship_type: relationshipType.trim() || undefined,
        from_role: logicalLevel ? (fromRole.trim() || undefined) : undefined,
        to_role: logicalLevel ? (toRole.trim() || undefined) : undefined,
        rationale: rationale.trim() || undefined,
        source_of_truth: sourceOfTruth.trim() || undefined,
      });
      if (patched) yamlOut = patched;
    }

    s.updateContent(yamlOut);
    s.flushAutosave?.().catch(() => {});
    s.bumpModelGraphVersion?.();
    addToast({
      type: "success",
      message: entityLevelEndpoints
        ? `Linked ${nextFromEntity} → ${nextToEntity}.`
        : `Linked ${nextFromEntity}.${fromColumn} → ${nextToEntity}.${toColumn}.`,
    });
    closeModal();
  };

  // Defensive: if the dialog opens with no endpoints AND no picker tables,
  // we can't do anything — point the user back at the canvas.
  if ((!fromEntity || !toEntity) && !pickableTables) {
    return (
      <Modal
        icon={<GitBranch size={14} />}
        title={editMode ? "Edit relationship" : "New relationship"}
        size="md"
        onClose={closeModal}
        footer={<button type="button" className="panel-btn" onClick={closeModal}>Close</button>}
      >
        <div className="dlx-modal-alert">
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Missing endpoint(s). Drag from a relationship handle or column key to another card on the canvas to start again.</span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      icon={<GitBranch size={14} />}
      title={editMode ? "Edit relationship" : "New relationship"}
      subtitle={
        editMode
          ? "Update endpoints, cardinality, and options for this relationship."
          : conceptualLevel
            ? "Declare a business relationship between two concepts."
            : logicalLevel
              ? "Declare a platform-neutral logical relationship with roles, cardinality, and optionality."
              : "Declare a physical dbt/database relationship with FK tests and constraint intent."
      }
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
            {editMode ? "Save" : "Create"}
          </button>
        </>
      }
    >
      <form id="new-rel-form" onSubmit={handleSubmit} style={{ display: "contents" }}>
        {/* Endpoint picker (toolbar / command-palette entry) OR summary (drag). */}
        {pickableTables || editMode ? (
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
                    setFromColumn(entityLevelEndpoints ? "" : defaultColumnForEntity(e.target.value));
                  }}
                >
                  <option value="">Choose entity…</option>
                  {tableOptions.map((t) => {
                    const id = t?.id || t?.name;
                    const label = t?.name || t?.id;
                    return <option key={id} value={id}>{label}</option>;
                  })}
                </select>
                {!entityLevelEndpoints && (
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

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <button
                  type="button"
                  className="panel-btn"
                  onClick={handleSwapEndpoints}
                  title="Swap relationship direction"
                  disabled={!fromEntity || !toEntity}
                  style={{ padding: "6px 8px" }}
                >
                  <ArrowRightLeft size={12} />
                </button>
                <Link2 size={14} style={{ color: "var(--text-tertiary)" }} />
              </div>

              {/* To side */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.4 }}>To</span>
                <select
                  className="panel-input"
                  value={toEntity}
                  onChange={(e) => {
                    setToEntity(e.target.value);
                    setToColumn(entityLevelEndpoints ? "" : defaultColumnForEntity(e.target.value));
                  }}
                >
                  <option value="">Choose entity…</option>
                  {tableOptions.map((t) => {
                    const id = t?.id || t?.name;
                    const label = t?.name || t?.id;
                    return <option key={id} value={id}>{label}</option>;
                  })}
                </select>
                {!entityLevelEndpoints && (
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
            {!entityLevelEndpoints && <span style={{ color: "var(--text-tertiary)" }}>.{fromColumn}</span>}
            <Link2 size={12} style={{ margin: "0 4px", color: "var(--text-tertiary)" }} />
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{toEntity}</span>
            {!entityLevelEndpoints && <span style={{ color: "var(--text-tertiary)" }}>.{toColumn}</span>}
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

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="rel-description">Description</label>
          <textarea
            id="rel-description"
            className="panel-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={conceptualLevel ? "Explain the business relationship." : logicalLevel ? "Explain the business rule behind this relationship." : "Describe the physical FK/test/constraint intent."}
            rows={3}
          />
        </div>

        {logicalLevel && (
          <div className="dlx-modal-section">
            <label className="dlx-modal-field-label">Role names</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input
                className="panel-input"
                value={fromRole}
                onChange={(e) => setFromRole(e.target.value)}
                placeholder="from role, e.g. order customer"
              />
              <input
                className="panel-input"
                value={toRole}
                onChange={(e) => setToRole(e.target.value)}
                placeholder="to role, e.g. placed order"
              />
            </div>
          </div>
        )}

        {conceptualLevel && (
          <div className="dlx-modal-section">
            <label className="dlx-modal-field-label" htmlFor="rel-verb">Relationship verb</label>
            <input
              id="rel-verb"
              className="panel-input"
              value={verb}
              onChange={(e) => setVerb(e.target.value)}
              placeholder="places, owns, depends_on"
            />
          </div>
        )}

        {conceptualLevel && (
          <>
            <div className="dlx-modal-section">
              <label className="dlx-modal-field-label" htmlFor="rel-type">Relationship type</label>
              <select
                id="rel-type"
                className="panel-input"
                value={relationshipType}
                onChange={(e) => setRelationshipType(e.target.value)}
              >
                {CONCEPTUAL_RELATIONSHIP_TYPES.map((option) => (
                  <option key={option.id || "general"} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="dlx-modal-section">
              <label className="dlx-modal-field-label" htmlFor="rel-rationale">Business rationale</label>
              <textarea
                id="rel-rationale"
                className="panel-input"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Why does this relationship matter to the business?"
                rows={3}
              />
            </div>

            <div className="dlx-modal-section">
              <label className="dlx-modal-field-label" htmlFor="rel-source-of-truth">Source of truth</label>
              <input
                id="rel-source-of-truth"
                className="panel-input"
                value={sourceOfTruth}
                onChange={(e) => setSourceOfTruth(e.target.value)}
                placeholder="Policy admin system, billing platform, CRM..."
              />
            </div>
          </>
        )}

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label">Preview</label>
          <div
            style={{
              display: "grid",
              gap: 8,
              padding: "10px 12px",
              background: "var(--bg-2)",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                {fromEntity || "From entity"}{entityLevelEndpoints ? "" : `.${fromColumn || "column"}`}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{CARDINALITIES.find((c) => c.id === cardinality)?.sub || ""}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                {toEntity || "To entity"}{entityLevelEndpoints ? "" : `.${toColumn || "column"}`}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="status-pill tone-info">{CARDINALITIES.find((c) => c.id === cardinality)?.label || "Relationship"}</span>
              {!entityLevelEndpoints && identifying && <span className="status-pill tone-warning">Identifying</span>}
              {!entityLevelEndpoints && optional && <span className="status-pill tone-neutral">Optional</span>}
              {logicalLevel && fromRole && <span className="status-pill tone-neutral">{fromRole}</span>}
              {logicalLevel && toRole && <span className="status-pill tone-neutral">{toRole}</span>}
              {physicalLevel && onDelete && <span className="status-pill tone-neutral">ON DELETE {onDelete}</span>}
              {conceptualLevel && verb && <span className="status-pill tone-accent">{verb}</span>}
              {conceptualLevel && relationshipType && <span className="status-pill tone-info">{relationshipType.replace(/_/g, " ")}</span>}
              {conceptualLevel && sourceOfTruth && <span className="status-pill tone-neutral">{sourceOfTruth}</span>}
            </div>
          </div>
        </div>

        {!conceptualLevel && (
          <>
            {physicalLevel && (
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
            )}

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
