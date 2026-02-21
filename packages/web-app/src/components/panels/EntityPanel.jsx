import React from "react";
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
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import {
  updateEntityMeta,
  updateEntityTags,
  updateFieldProperty,
  addField,
  removeField,
  removeEntity,
  renameField,
  renameEntity,
} from "../../lib/yamlRoundTrip";

export default function EntityPanel() {
  const { selectedEntity, selectedEntityId, clearSelection, model } = useDiagramStore();
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();

  if (!selectedEntity) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-xs p-4">
        Select an entity in the diagram to view properties
      </div>
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
  const entityFieldMap = new Map(
    (model?.entities || []).map((entity) => [
      entity.name,
      new Map((entity.fields || []).map((f) => [f.name, f])),
    ])
  );

  const applyMutation = (mutatorFn, ...args) => {
    const result = mutatorFn(activeFileContent, ...args);
    if (!result.error) updateContent(result.yaml);
  };

  const handleRenameEntity = () => {
    const next = window.prompt("New table name (logical entity name)", selectedEntityId || "");
    if (next == null) return;
    const trimmed = String(next).trim();
    if (!trimmed) {
      addToast?.({ type: "error", message: "Table name cannot be empty." });
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
    addToast?.({ type: "success", message: `Renamed table to ${trimmed}.` });
  };

  const handleDeleteEntity = () => {
    if (!selectedEntityId) return;
    const ok = window.confirm(`Delete table ${selectedEntityId}? This will remove its relationships and indexes.`);
    if (!ok) return;
    const result = removeEntity(activeFileContent, selectedEntityId);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    clearSelection();
    addToast?.({ type: "success", message: `Deleted table ${selectedEntityId}.` });
  };

  const handleRenameField = (oldName) => {
    const next = window.prompt("New column name", oldName || "");
    if (next == null) return;
    const trimmed = String(next).trim();
    if (!trimmed) {
      addToast?.({ type: "error", message: "Column name cannot be empty." });
      return;
    }
    const result = renameField(activeFileContent, selectedEntityId, oldName, trimmed);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    if (result.yaml === activeFileContent) {
      addToast?.({ type: "info", message: "No changes applied (name may already exist)." });
      return;
    }
    updateContent(result.yaml);
    addToast?.({ type: "success", message: `Renamed column ${oldName} -> ${trimmed}.` });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-primary bg-bg-secondary/50">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary truncate">{selectedEntity.name}</h3>
          <span className="text-[10px] text-text-muted uppercase tracking-wider">
            {selectedEntity.type || "table"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {canEdit && (
            <button
              onClick={handleRenameEntity}
              className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
              title="Rename table"
            >
              <Pencil size={14} />
            </button>
          )}
          {canEdit && (
            <button
              onClick={handleDeleteEntity}
              className="p-1 rounded-md hover:bg-red-50 text-text-muted hover:text-red-600 transition-colors"
              title="Delete table"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={clearSelection}
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Table Summary */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
            <FileText size={10} />
            Table Summary
          </label>
          {canEdit ? (
            <textarea
              value={selectedEntity.description || ""}
              onChange={(e) => applyMutation(updateEntityMeta, selectedEntityId, "description", e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue resize-none"
              rows={2}
              placeholder="Business summary of this table..."
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
              placeholder="What business domain/use-case this table serves..."
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

        {/* v2 Entity Properties */}
        {(selectedEntity.schema || selectedEntity.database || selectedEntity.sla) && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <Database size={10} />
              Properties
            </label>
            <div className="space-y-1 text-[11px]">
              {selectedEntity.schema && (
                <div className="flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-primary rounded-md">
                  <span className="text-text-muted">Schema</span>
                  <span className="ml-auto text-text-primary font-mono">{selectedEntity.schema}</span>
                </div>
              )}
              {selectedEntity.database && (
                <div className="flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-primary rounded-md">
                  <span className="text-text-muted">Database</span>
                  <span className="ml-auto text-text-primary font-mono">{selectedEntity.database}</span>
                </div>
              )}
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
                Add Column
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
                            title="Rename column"
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
                        placeholder={canEdit ? "Column business logic..." : ""}
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
                          className="p-0.5 rounded hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors"
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
                    className={`flex items-center gap-2 px-2 py-1.5 border rounded-md text-[11px] ${
                      isCrossModel
                        ? "bg-indigo-50 border-indigo-200"
                        : "bg-bg-primary border-border-primary"
                    }`}
                  >
                    <span className="text-text-primary font-medium">{rel.name}</span>
                    <span className="text-text-muted">
                      {rel.from} → {rel.to}
                    </span>
                    {isCrossModel && (
                      <span className="px-1 py-0 rounded text-[8px] font-semibold bg-indigo-100 text-indigo-600">
                        CROSS-MODEL
                      </span>
                    )}
                    {pkToFk && (
                      <span className="px-1 py-0 rounded text-[8px] font-semibold bg-cyan-100 text-cyan-700">
                        PK→FK
                      </span>
                    )}
                    {fkToPk && (
                      <span className="px-1 py-0 rounded text-[8px] font-semibold bg-purple-100 text-purple-700">
                        FK→PK
                      </span>
                    )}
                    {isSelf && (
                      <span className="px-1 py-0 rounded text-[8px] font-semibold bg-amber-100 text-amber-700">
                        SELF
                      </span>
                    )}
                    <span className={`ml-auto px-1.5 py-0 rounded text-[9px] font-semibold ${
                      rel.cardinality === "one_to_one" ? "bg-green-50 text-green-700" :
                      rel.cardinality === "one_to_many" ? "bg-blue-50 text-blue-700" :
                      rel.cardinality === "many_to_one" ? "bg-purple-50 text-purple-700" :
                      "bg-orange-50 text-orange-700"
                    }`}>
                      {cardinalityLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Indexes */}
        {(model?.indexes || []).filter((idx) => idx.entity === selectedEntityId).length > 0 && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <ListOrdered size={10} />
              Indexes ({(model?.indexes || []).filter((idx) => idx.entity === selectedEntityId).length})
            </label>
            <div className="space-y-1">
              {(model?.indexes || []).filter((idx) => idx.entity === selectedEntityId).map((idx) => (
                <div
                  key={idx.name}
                  className="flex items-center gap-2 px-2 py-1.5 bg-bg-primary border border-border-primary rounded-md text-[11px]"
                >
                  <code className="text-text-primary font-mono">{idx.name}</code>
                  <span className="text-text-muted">{(idx.fields || []).join(", ")}</span>
                  {idx.unique && (
                    <span className="ml-auto px-1.5 py-0 rounded text-[9px] font-semibold bg-cyan-50 text-cyan-700">UNIQUE</span>
                  )}
                  {idx.type && idx.type !== "btree" && (
                    <span className="px-1.5 py-0 rounded text-[9px] font-semibold bg-slate-100 text-slate-600">{idx.type}</span>
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
                  <div key={key} className="flex items-center gap-2 px-2 py-1 bg-red-50 border border-red-200 rounded-md text-[11px]">
                    <code className="text-text-secondary">{key.split(".")[1]}</code>
                    <span className="ml-auto text-red-600 font-semibold">{value}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
