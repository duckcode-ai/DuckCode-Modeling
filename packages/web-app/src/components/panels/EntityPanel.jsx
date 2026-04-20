import React, { useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Pencil,
  Key,
  Tag,
  FileText,
  ArrowRightLeft,
  Shield,
  Database,
  User,
  Clock,
  ListOrdered,
  Box,
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { PanelFrame, PanelEmpty, StatusPill, PanelCard } from "./PanelFrame";
import {
  updateEntityMeta,
  updateEntityTags,
  updateFieldProperty,
  addField,
  removeField,
  removeEntity,
  renameField,
  renameEntity,
  setEntityScalarProperty,
  setEntityListProperty,
  setEntityKeySets,
  addIndex,
  removeIndex,
} from "../../lib/yamlRoundTrip";

function NameModal({ title, value, onChange, onClose, onSubmit, confirmLabel = "Save" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[360px] max-w-[92vw] rounded-xl border border-border-primary bg-bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="p-4 space-y-3"
        >
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors">
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[380px] max-w-[92vw] rounded-xl border border-border-primary bg-bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-text-secondary">{message}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover transition-colors">
              Cancel
            </button>
            <button type="button" onClick={onConfirm} className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function listText(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function keySetText(value) {
  return Array.isArray(value)
    ? value.map((keySet) => (Array.isArray(keySet) ? keySet.join(", ") : "")).filter(Boolean).join("\n")
    : "";
}

function defaultIndexName(entityName, fieldsText) {
  const normalizedEntity = String(entityName || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const firstField = String(fieldsText || "")
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)[0] || "idx";
  return `${normalizedEntity || "entity"}_${firstField.toLowerCase()}_idx`;
}

export default function EntityPanel() {
  const { selectedEntity, selectedEntityId, clearSelection, model, modelingViewMode } = useDiagramStore();
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
  const [renameEntityOpen, setRenameEntityOpen] = useState(false);
  const [renameEntityValue, setRenameEntityValue] = useState("");
  const [deleteEntityOpen, setDeleteEntityOpen] = useState(false);
  const [renameFieldState, setRenameFieldState] = useState({ open: false, oldName: "", nextName: "" });
  const [newIndexName, setNewIndexName] = useState("");
  const [newIndexFields, setNewIndexFields] = useState("");
  const [newIndexType, setNewIndexType] = useState("btree");
  const [newIndexUnique, setNewIndexUnique] = useState(false);

  if (!selectedEntity) {
    return (
      <PanelFrame icon={<Box size={14} />} eyebrow="Inspector" title="Entity">
        <PanelEmpty
          icon={Box}
          title="No entity selected"
          description="Select an entity in the diagram to view and edit its properties."
        />
      </PanelFrame>
    );
  }

  const classifications = model?.governance?.classification || {};
  const rawModelOwners = model?.model?.owners;
  const modelOwners = Array.isArray(rawModelOwners)
    ? rawModelOwners
    : (typeof rawModelOwners === "string" && rawModelOwners.trim() ? [rawModelOwners] : []);
  const fallbackOwner = modelOwners.map((o) => String(o || "").trim()).filter(Boolean).join(", ");
  const localEntityNames = new Set((model?.entities || []).map((e) => e.name));
  const relationships = (model?.relationships || []).filter((r) => {
    const fromEntity = r.from?.split(".")[0];
    const toEntity = r.to?.split(".")[0];
    return fromEntity === selectedEntityId || toEntity === selectedEntityId;
  });
  const selectedEntityIndexes = (model?.indexes || []).filter((idx) => idx.entity === selectedEntityId);
  const entityFieldMap = new Map(
    (model?.entities || []).map((entity) => [
      entity.name,
      new Map((entity.fields || []).map((f) => [f.name, f])),
    ])
  );
  const entityType = selectedEntity.type || "table";
  const showModelingMetadata =
    modelingViewMode !== "physical" ||
    Boolean(selectedEntity.derived_from || selectedEntity.mapped_from) ||
    ((Array.isArray(selectedEntity.templates) && selectedEntity.templates.length > 0) || Boolean(selectedEntity.template)) ||
    (Array.isArray(selectedEntity.candidate_keys) && selectedEntity.candidate_keys.length > 0) ||
    Boolean(selectedEntity.subtype_of) ||
    (Array.isArray(selectedEntity.subtypes) && selectedEntity.subtypes.length > 0);
  const showPhysicalMetadata =
    modelingViewMode === "physical" ||
    Boolean(
      selectedEntity.schema ||
      selectedEntity.database ||
      (Array.isArray(selectedEntity.partition_by) && selectedEntity.partition_by.length > 0) ||
      (Array.isArray(selectedEntity.cluster_by) && selectedEntity.cluster_by.length > 0) ||
      selectedEntity.distribution ||
      selectedEntity.storage ||
      selectedEntity.sla
    );

  const applyMutation = (mutatorFn, ...args) => {
    const result = mutatorFn(activeFileContent, ...args);
    if (!result.error) updateContent(result.yaml);
  };

  const setScalar = (key, value) => applyMutation(setEntityScalarProperty, selectedEntityId, key, value);
  const setList = (key, value) => applyMutation(setEntityListProperty, selectedEntityId, key, value);
  const setKeySets = (key, value) => applyMutation(setEntityKeySets, selectedEntityId, key, value);

  const handleRenameEntity = () => {
    setRenameEntityValue(String(selectedEntityId || "").trim());
    setRenameEntityOpen(true);
  };

  const submitRenameEntity = () => {
    const trimmed = String(renameEntityValue || "").trim();
    if (!trimmed) {
      addToast?.({ type: "error", message: "Entity name cannot be empty." });
      return;
    }
    const result = renameEntity(activeFileContent, selectedEntityId, trimmed);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    if (result.yaml === activeFileContent) {
      addToast?.({ type: "info", message: "No changes applied (name may already exist)." });
      return;
    }
    updateContent(result.yaml);
    // Keep selection on the renamed entity
    useDiagramStore.getState().selectEntity(trimmed);
    addToast?.({ type: "success", message: `Renamed entity to ${trimmed}.` });
    setRenameEntityOpen(false);
  };

  const handleDeleteEntity = () => {
    if (!selectedEntityId) return;
    setDeleteEntityOpen(true);
  };

  const confirmDeleteEntity = () => {
    const result = removeEntity(activeFileContent, selectedEntityId);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    clearSelection();
    addToast?.({ type: "success", message: `Deleted entity ${selectedEntityId}.` });
    setDeleteEntityOpen(false);
  };

  const handleRenameField = (oldName) => {
    setRenameFieldState({ open: true, oldName, nextName: oldName || "" });
  };

  const submitRenameField = () => {
    const trimmed = String(renameFieldState.nextName || "").trim();
    if (!trimmed) {
      addToast?.({ type: "error", message: "Field name cannot be empty." });
      return;
    }
    const result = renameField(activeFileContent, selectedEntityId, renameFieldState.oldName, trimmed);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    if (result.yaml === activeFileContent) {
      addToast?.({ type: "info", message: "No changes applied (name may already exist)." });
      return;
    }
    updateContent(result.yaml);
    addToast?.({ type: "success", message: `Renamed field ${renameFieldState.oldName} -> ${trimmed}.` });
    setRenameFieldState({ open: false, oldName: "", nextName: "" });
  };

  const handleAddIndex = () => {
    const proposedName = String(newIndexName || "").trim() || defaultIndexName(selectedEntityId, newIndexFields);
    const result = addIndex(activeFileContent, proposedName, selectedEntityId, newIndexFields, newIndexUnique, newIndexType);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    if (result.yaml === activeFileContent) {
      addToast?.({ type: "error", message: "Index name and at least one field are required." });
      return;
    }
    updateContent(result.yaml);
    setNewIndexName("");
    setNewIndexFields("");
    setNewIndexType("btree");
    setNewIndexUnique(false);
    addToast?.({ type: "success", message: `Added index ${proposedName}.` });
  };

  const handleRemoveIndex = (indexName) => {
    const result = removeIndex(activeFileContent, indexName);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    addToast?.({ type: "success", message: `Removed index ${indexName}.` });
  };

  /* Entity-type pill tone: maps table/view/etc. to a semantic tone so
     the inspector header reads consistently across themes. */
  const entityTypeTone =
    entityType === "view" ? "success" :
    entityType === "materialized_view" ? "accent" :
    entityType === "external_table" ? "warning" :
    entityType === "snapshot" ? "neutral" :
    "info";

  const headerActions = (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {canEdit && (
        <button
          onClick={handleRenameEntity}
          title="Rename entity"
          style={{
            width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderRadius: 6, background: "transparent", border: "1px solid var(--border-default)",
            color: "var(--text-secondary)", cursor: "pointer",
          }}
        >
          <Pencil size={12} />
        </button>
      )}
      {canEdit && (
        <button
          onClick={handleDeleteEntity}
          title="Delete entity"
          style={{
            width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderRadius: 6, background: "transparent", border: "1px solid var(--border-default)",
            color: "#ef4444", cursor: "pointer",
          }}
        >
          <Trash2 size={12} />
        </button>
      )}
      <button
        onClick={clearSelection}
        title="Close"
        style={{
          width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
          borderRadius: 6, background: "transparent", border: "1px solid var(--border-default)",
          color: "var(--text-secondary)", cursor: "pointer",
        }}
      >
        <X size={12} />
      </button>
    </div>
  );

  return (
    <>
      <PanelFrame
        icon={<Box size={14} />}
        eyebrow="Inspector"
        title={selectedEntity.name}
        status={<StatusPill tone={entityTypeTone}>{entityType}</StatusPill>}
        actions={headerActions}
      >
      {/* Content */}
      <div className="flex flex-col" style={{ gap: 12 }}>
        {/* Entity Summary */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
            <FileText size={10} />
            Entity Summary
          </label>
          {canEdit ? (
            <textarea
              value={selectedEntity.description || ""}
              onChange={(e) => applyMutation(updateEntityMeta, selectedEntityId, "description", e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue resize-none"
              rows={2}
              placeholder="Business summary of this entity..."
            />
          ) : (
            <p className="text-xs text-text-secondary px-2 py-1.5 bg-bg-primary border border-border-primary rounded-md min-h-[40px]">
              {selectedEntity.description || <span className="text-text-muted italic">No description</span>}
            </p>
          )}
        </div>

        {/* Business Context */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
            <Database size={10} />
            Business Context
          </label>
          {canEdit ? (
            <textarea
              value={selectedEntity.subject_area || ""}
              onChange={(e) => applyMutation(updateEntityMeta, selectedEntityId, "subject_area", e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue resize-none"
              rows={2}
              placeholder="What business domain or use-case this entity serves..."
            />
          ) : (
            <p className="text-xs text-text-secondary px-2 py-1.5 bg-bg-primary border border-border-primary rounded-md min-h-[40px]">
              {selectedEntity.subject_area || <span className="text-text-muted italic">No context</span>}
            </p>
          )}
        </div>

        {/* Owner */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
            <User size={10} />
            Owner
          </label>
          {canEdit ? (
            <input
              value={selectedEntity.owner || ""}
              onChange={(e) => applyMutation(updateEntityMeta, selectedEntityId, "owner", e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
              placeholder={fallbackOwner || "team@company.com"}
            />
          ) : (
            <p className="text-xs text-text-secondary px-2 py-1.5 bg-bg-primary border border-border-primary rounded-md">
              {selectedEntity.owner || fallbackOwner || <span className="text-text-muted italic">No owner</span>}
            </p>
          )}
          {fallbackOwner && !selectedEntity.owner && (
            <div className="text-[10px] text-text-muted mt-1">
              Using model owner fallback: <strong>{fallbackOwner}</strong>
            </div>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
            <Tag size={10} />
            Tags (comma separated)
          </label>
          {canEdit ? (
            <input
              value={(selectedEntity.tags || []).join(", ")}
              onChange={(e) => applyMutation(updateEntityTags, selectedEntityId, e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
              placeholder="PII, GOLD, ..."
            />
          ) : (
            <div className="flex flex-wrap gap-1">
              {(selectedEntity.tags || []).length > 0
                ? (selectedEntity.tags || []).map((t) => (
                    <span key={t} className="px-1.5 py-0.5 rounded bg-bg-secondary border border-border-primary text-[10px] text-text-secondary">{t}</span>
                  ))
                : <span className="text-xs text-text-muted italic">No tags</span>}
            </div>
          )}
        </div>

        {showModelingMetadata && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <Key size={10} />
              Modeling Metadata
            </label>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={selectedEntity.derived_from || ""}
                  onChange={canEdit ? (e) => setScalar("derived_from", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="derived_from"
                />
                <input
                  value={selectedEntity.mapped_from || ""}
                  onChange={canEdit ? (e) => setScalar("mapped_from", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="mapped_from"
                />
              </div>
              <input
                value={listText([...(selectedEntity.templates || []), ...(selectedEntity.template ? [selectedEntity.template] : [])])}
                onChange={canEdit ? (e) => setList("templates", e.target.value) : undefined}
                readOnly={!canEdit}
                className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                placeholder="templates (comma separated)"
              />
              {(modelingViewMode === "logical" ||
                (Array.isArray(selectedEntity.candidate_keys) && selectedEntity.candidate_keys.length > 0) ||
                selectedEntity.subtype_of ||
                (Array.isArray(selectedEntity.subtypes) && selectedEntity.subtypes.length > 0)) && (
                <>
                  <textarea
                    value={keySetText(selectedEntity.candidate_keys)}
                    onChange={canEdit ? (e) => setKeySets("candidate_keys", e.target.value) : undefined}
                    readOnly={!canEdit}
                    className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue resize-none"
                    rows={3}
                    placeholder={"candidate_keys\none key set per line\ncustomer_id\ncustomer_code, source_system"}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={selectedEntity.subtype_of || ""}
                      onChange={canEdit ? (e) => setScalar("subtype_of", e.target.value) : undefined}
                      readOnly={!canEdit}
                      className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                      placeholder="subtype_of"
                    />
                    <input
                      value={listText(selectedEntity.subtypes)}
                      onChange={canEdit ? (e) => setList("subtypes", e.target.value) : undefined}
                      readOnly={!canEdit}
                      className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                      placeholder="subtypes (comma separated)"
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {(entityType === "fact_table" ||
          entityType === "dimension_table" ||
          (Array.isArray(selectedEntity.grain) && selectedEntity.grain.length > 0) ||
          (Array.isArray(selectedEntity.dimension_refs) && selectedEntity.dimension_refs.length > 0)) && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <Database size={10} />
              Dimensional Modeling
            </label>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={listText(selectedEntity.grain)}
                  onChange={canEdit ? (e) => setList("grain", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="grain fields"
                />
                <input
                  value={listText(selectedEntity.dimension_refs)}
                  onChange={canEdit ? (e) => setList("dimension_refs", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="dimension refs"
                />
              </div>
              {entityType === "dimension_table" && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={selectedEntity.natural_key || ""}
                    onChange={canEdit ? (e) => setScalar("natural_key", e.target.value) : undefined}
                    readOnly={!canEdit}
                    className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                    placeholder="natural_key"
                  />
                  <input
                    value={selectedEntity.surrogate_key || ""}
                    onChange={canEdit ? (e) => setScalar("surrogate_key", e.target.value) : undefined}
                    readOnly={!canEdit}
                    className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                    placeholder="surrogate_key"
                  />
                  <input
                    type="number"
                    min="0"
                    value={selectedEntity.scd_type ?? ""}
                    onChange={canEdit ? (e) => setScalar("scd_type", e.target.value === "" ? null : Number(e.target.value)) : undefined}
                    readOnly={!canEdit}
                    className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                    placeholder="scd_type"
                  />
                  <label className="flex items-center gap-2 rounded-md border border-border-primary bg-bg-primary px-2 py-1.5 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedEntity.conformed)}
                      onChange={canEdit ? (e) => applyMutation(updateEntityMeta, selectedEntityId, "conformed", e.target.checked) : undefined}
                      readOnly={!canEdit}
                    />
                    Conformed dimension
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {(["hub", "link", "satellite"].includes(entityType) ||
          (Array.isArray(selectedEntity.business_keys) && selectedEntity.business_keys.length > 0) ||
          (Array.isArray(selectedEntity.link_refs) && selectedEntity.link_refs.length > 0) ||
          selectedEntity.parent_entity) && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <Database size={10} />
              Data Vault
            </label>
            <div className="space-y-2">
              {(entityType === "hub" || (Array.isArray(selectedEntity.business_keys) && selectedEntity.business_keys.length > 0)) && (
                <textarea
                  value={keySetText(selectedEntity.business_keys)}
                  onChange={canEdit ? (e) => setKeySets("business_keys", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue resize-none"
                  rows={3}
                  placeholder={"business_keys\none key set per line"}
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                {(entityType === "link" || (Array.isArray(selectedEntity.link_refs) && selectedEntity.link_refs.length > 0)) && (
                  <input
                    value={listText(selectedEntity.link_refs)}
                    onChange={canEdit ? (e) => setList("link_refs", e.target.value) : undefined}
                    readOnly={!canEdit}
                    className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                    placeholder="link refs"
                  />
                )}
                {(entityType === "satellite" || selectedEntity.parent_entity) && (
                  <input
                    value={selectedEntity.parent_entity || ""}
                    onChange={canEdit ? (e) => setScalar("parent_entity", e.target.value) : undefined}
                    readOnly={!canEdit}
                    className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                    placeholder="parent_entity"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={selectedEntity.hash_key || ""}
                  onChange={canEdit ? (e) => setScalar("hash_key", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="hash_key"
                />
                <input
                  value={listText(selectedEntity.hash_diff_fields)}
                  onChange={canEdit ? (e) => setList("hash_diff_fields", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="hash diff fields"
                />
                <input
                  value={selectedEntity.load_timestamp_field || ""}
                  onChange={canEdit ? (e) => setScalar("load_timestamp_field", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="load_timestamp_field"
                />
                <input
                  value={selectedEntity.record_source_field || ""}
                  onChange={canEdit ? (e) => setScalar("record_source_field", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="record_source_field"
                />
              </div>
            </div>
          </div>
        )}

        {/* Physical Options */}
        {showPhysicalMetadata && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <Database size={10} />
              Physical Options
            </label>
            <div className="space-y-2 text-[11px]">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={selectedEntity.schema || ""}
                  onChange={canEdit ? (e) => setScalar("schema", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue font-mono"
                  placeholder="schema"
                />
                <input
                  value={selectedEntity.database || ""}
                  onChange={canEdit ? (e) => setScalar("database", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue font-mono"
                  placeholder="database"
                />
                <input
                  value={listText(selectedEntity.partition_by)}
                  onChange={canEdit ? (e) => setList("partition_by", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="partition_by"
                />
                <input
                  value={listText(selectedEntity.cluster_by)}
                  onChange={canEdit ? (e) => setList("cluster_by", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="cluster_by"
                />
                <input
                  value={selectedEntity.distribution || ""}
                  onChange={canEdit ? (e) => setScalar("distribution", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="distribution"
                />
                <input
                  value={selectedEntity.storage || ""}
                  onChange={canEdit ? (e) => setScalar("storage", e.target.value) : undefined}
                  readOnly={!canEdit}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  placeholder="storage"
                />
              </div>
              {selectedEntity.sla && (
                <div className="flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-primary rounded-md">
                  <Clock size={10} className="text-text-muted shrink-0" />
                  <span className="text-text-muted">SLA</span>
                  <span className="ml-auto text-text-primary">
                    {selectedEntity.sla.freshness && `Freshness: ${selectedEntity.sla.freshness}`}
                    {selectedEntity.sla.freshness && selectedEntity.sla.quality_score != null && " · "}
                    {selectedEntity.sla.quality_score != null && `Quality: ${selectedEntity.sla.quality_score}%`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Fields */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1">
              <Key size={10} />
              Fields ({(selectedEntity.fields || []).length})
            </label>
            {canEdit && (
              <button
                onClick={() => applyMutation(addField, selectedEntityId)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-accent-blue hover:bg-accent-blue/10 transition-colors"
              >
                <Plus size={10} />
                Add Field
              </button>
            )}
          </div>

          <div className="border border-border-primary rounded-md overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-bg-secondary/50">
                  <th className="text-left px-2 py-1 text-text-muted font-medium">Name</th>
                  <th className="text-left px-2 py-1 text-text-muted font-medium">Type</th>
                  <th className="text-left px-2 py-1 text-text-muted font-medium">Logic / Description</th>
                  <th className="text-center px-1 py-1 text-text-muted font-medium">PK</th>
                  <th className="text-center px-1 py-1 text-text-muted font-medium">UQ</th>
                  <th className="text-center px-1 py-1 text-text-muted font-medium">NN</th>
                  <th className="px-1 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {(selectedEntity.fields || []).map((field) => (
                  <tr key={field.name} className="border-t border-border-primary/50 hover:bg-bg-hover/30">
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <code className="text-text-primary font-mono">{field.name}</code>
                        {canEdit && (
                          <button
                            onClick={() => handleRenameField(field.name)}
                            className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                            title="Rename field"
                          >
                            <Pencil size={10} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={field.type || ""}
                        onChange={canEdit ? (e) => applyMutation(updateFieldProperty, selectedEntityId, field.name, "type", e.target.value) : undefined}
                        readOnly={!canEdit}
                        className="w-full bg-transparent border-b border-transparent hover:border-border-primary focus:border-accent-blue text-text-secondary font-mono outline-none text-[11px] py-0.5 disabled:cursor-default"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={field.description || ""}
                        onChange={canEdit ? (e) => applyMutation(updateFieldProperty, selectedEntityId, field.name, "description", e.target.value) : undefined}
                        readOnly={!canEdit}
                        className="w-full bg-transparent border-b border-transparent hover:border-border-primary focus:border-accent-blue text-text-secondary outline-none text-[11px] py-0.5"
                        placeholder={canEdit ? "Field business logic..." : ""}
                      />
                    </td>
                    <td className="text-center px-1 py-1">
                      <input
                        type="checkbox"
                        checked={Boolean(field.primary_key)}
                        onChange={canEdit ? (e) => applyMutation(updateFieldProperty, selectedEntityId, field.name, "primary_key", e.target.checked) : undefined}
                        readOnly={!canEdit}
                        className="w-3 h-3 rounded accent-yellow-500"
                      />
                    </td>
                    <td className="text-center px-1 py-1">
                      <input
                        type="checkbox"
                        checked={Boolean(field.unique)}
                        onChange={canEdit ? (e) => applyMutation(updateFieldProperty, selectedEntityId, field.name, "unique", e.target.checked) : undefined}
                        readOnly={!canEdit}
                        className="w-3 h-3 rounded accent-cyan-500"
                      />
                    </td>
                    <td className="text-center px-1 py-1">
                      <input
                        type="checkbox"
                        checked={field.nullable === false}
                        onChange={canEdit ? (e) => applyMutation(updateFieldProperty, selectedEntityId, field.name, "nullable", !e.target.checked) : undefined}
                        readOnly={!canEdit}
                        className="w-3 h-3 rounded accent-red-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      {canEdit && (
                        <button
                          onClick={() => applyMutation(removeField, selectedEntityId, field.name)}
                          title="Remove field"
                          style={{
                            padding: 2, borderRadius: 4,
                            background: "transparent", border: "none",
                            color: "#ef4444", cursor: "pointer",
                          }}
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Relationships */}
        {relationships.length > 0 && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <ArrowRightLeft size={10} />
              Relationships ({relationships.length})
            </label>
            <div className="space-y-1">
              {relationships.map((rel) => {
                const fromEntity = rel.from?.split(".")[0] || "";
                const fromField = rel.from?.split(".")[1] || "";
                const toEntity = rel.to?.split(".")[0] || "";
                const toField = rel.to?.split(".")[1] || "";
                const isCrossModel =
                  (fromEntity && !localEntityNames.has(fromEntity)) ||
                  (toEntity && !localEntityNames.has(toEntity));
                const isSelf = fromEntity && toEntity && fromEntity === toEntity;
                const fromFieldMeta = entityFieldMap.get(fromEntity)?.get(fromField) || {};
                const toFieldMeta = entityFieldMap.get(toEntity)?.get(toField) || {};
                const pkToFk = Boolean(fromFieldMeta.primary_key && toFieldMeta.foreign_key);
                const fkToPk = Boolean(fromFieldMeta.foreign_key && toFieldMeta.primary_key);
                const cardinalityLabel =
                  rel.cardinality === "one_to_one" ? "1:1" :
                  rel.cardinality === "one_to_many" ? "1:N" :
                  rel.cardinality === "many_to_one" ? "N:1" :
                  rel.cardinality === "many_to_many" ? "N:N" :
                  (rel.cardinality || "");
                return (
                  <div
                    key={rel.name}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                      padding: "6px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      background: isCrossModel ? "var(--cat-product-soft)" : "var(--bg-1)",
                      border: `1px solid ${isCrossModel ? "var(--cat-product)" : "var(--border-default)"}`,
                    }}
                  >
                    <span style={{ color: "var(--text-primary)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                      {rel.name}
                    </span>
                    <span style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                      {rel.from} → {rel.to}
                    </span>
                    {isCrossModel && <StatusPill tone="accent">CROSS-MODEL</StatusPill>}
                    {pkToFk && <StatusPill tone="info">PK→FK</StatusPill>}
                    {fkToPk && <StatusPill tone="accent">FK→PK</StatusPill>}
                    {isSelf && <StatusPill tone="warning">SELF</StatusPill>}
                    <StatusPill
                      tone={
                        rel.cardinality === "one_to_one" ? "success" :
                        rel.cardinality === "one_to_many" ? "info" :
                        rel.cardinality === "many_to_one" ? "accent" :
                        "warning"
                      }
                      style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}
                    >
                      {cardinalityLabel}
                    </StatusPill>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Indexes */}
        {(showPhysicalMetadata || selectedEntityIndexes.length > 0) && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <ListOrdered size={10} />
              Indexes ({selectedEntityIndexes.length})
            </label>
            <div className="space-y-2">
              {canEdit && (
                <div className="rounded-md border border-border-primary bg-bg-primary p-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={newIndexName}
                      onChange={(e) => setNewIndexName(e.target.value)}
                      className="w-full bg-bg-surface border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                      placeholder="index name (optional)"
                    />
                    <input
                      value={newIndexFields}
                      onChange={(e) => setNewIndexFields(e.target.value)}
                      className="w-full bg-bg-surface border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                      placeholder="fields: customer_id, order_date"
                    />
                    <select
                      value={newIndexType}
                      onChange={(e) => setNewIndexType(e.target.value)}
                      className="w-full bg-bg-surface border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue"
                    >
                      <option value="btree">btree</option>
                      <option value="hash">hash</option>
                      <option value="bitmap">bitmap</option>
                      <option value="gin">gin</option>
                    </select>
                    <label className="flex items-center gap-2 rounded-md border border-border-primary bg-bg-surface px-2 py-1.5 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={newIndexUnique}
                        onChange={(e) => setNewIndexUnique(e.target.checked)}
                      />
                      Unique
                    </label>
                  </div>
                  <button
                    onClick={handleAddIndex}
                    className="w-full px-3 py-2 rounded-md text-xs font-medium border border-border-primary text-text-secondary hover:bg-bg-hover transition-colors"
                  >
                    Add Index
                  </button>
                </div>
              )}
              {selectedEntityIndexes.map((idx) => (
                <div
                  key={idx.name}
                  className="flex items-center gap-2 px-2 py-1.5 bg-bg-primary border border-border-primary rounded-md text-[11px]"
                >
                  <code className="text-text-primary font-mono">{idx.name}</code>
                  <span className="text-text-muted">{(idx.fields || []).join(", ")}</span>
                  {idx.unique && <StatusPill tone="info">UNIQUE</StatusPill>}
                  {idx.type && idx.type !== "btree" && (
                    <StatusPill tone="neutral">{idx.type}</StatusPill>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => handleRemoveIndex(idx.name)}
                      title="Remove index"
                      style={{
                        marginLeft: "auto", padding: 2, borderRadius: 4,
                        background: "transparent", border: "none",
                        color: "#ef4444", cursor: "pointer",
                      }}
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Governance */}
        {Object.keys(classifications).some((k) => k.startsWith(`${selectedEntityId}.`)) && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <Shield size={10} />
              Governance
            </label>
            <div className="space-y-1">
              {Object.entries(classifications)
                .filter(([k]) => k.startsWith(`${selectedEntityId}.`))
                .map(([key, value]) => (
                  <div
                    key={key}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      background: "rgba(239, 68, 68, 0.08)",
                      border: "1px solid rgba(239, 68, 68, 0.35)",
                    }}
                  >
                    <code style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                      {key.split(".")[1]}
                    </code>
                    <span style={{ marginLeft: "auto", color: "#ef4444", fontWeight: 600 }}>
                      {value}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
      </PanelFrame>
      {renameEntityOpen && (
        <NameModal
          title="Rename Entity"
          value={renameEntityValue}
          onChange={setRenameEntityValue}
          onClose={() => setRenameEntityOpen(false)}
          onSubmit={submitRenameEntity}
        />
      )}
      {renameFieldState.open && (
        <NameModal
          title="Rename Field"
          value={renameFieldState.nextName}
          onChange={(value) => setRenameFieldState((state) => ({ ...state, nextName: value }))}
          onClose={() => setRenameFieldState({ open: false, oldName: "", nextName: "" })}
          onSubmit={submitRenameField}
        />
      )}
      {deleteEntityOpen && (
        <ConfirmModal
          title="Delete Entity"
          message={`Delete entity ${selectedEntityId}? This will remove its relationships and indexes.`}
          onClose={() => setDeleteEntityOpen(false)}
          onConfirm={confirmDeleteEntity}
        />
      )}
    </>
  );
}
