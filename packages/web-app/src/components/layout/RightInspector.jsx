import React, { useEffect } from "react";
import { PanelRightClose, Info } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useDiagramStore from "../../stores/diagramStore";
import EntityInspector from "../inspectors/EntityInspector";
import ColumnInspector from "../inspectors/ColumnInspector";
import RelationshipInspector from "../inspectors/RelationshipInspector";
import EnumInspector from "../inspectors/EnumInspector";
import { getObjectTypeMeta } from "../../lib/objectTypeMeta";

/**
 * Luna-style Right Inspector. Reads uiStore.selection and renders the
 * appropriate inspector form. When nothing is selected it falls back to the
 * currently-selected entity from diagramStore so the old click-to-edit flow
 * keeps working during the transition.
 *
 * Inspectors edit YAML directly through yamlRoundTrip mutators — no modal.
 */
export default function RightInspector() {
  const { selection, setSelection, rightPanelOpen, toggleRightPanel } = useUiStore();
  const { selectedEntityId, selectedEntity, model } = useDiagramStore();

  // Sync legacy selectedEntityId → unified selection when nothing specific is picked.
  useEffect(() => {
    if (!selection.kind && selectedEntityId) {
      setSelection({ kind: "entity", entityName: selectedEntityId });
    }
  }, [selectedEntityId, selection.kind, setSelection]);

  if (!rightPanelOpen) return null;

  const activeEntity =
    (selection.kind === "entity" || selection.kind === "column") && selection.entityName
      ? (model?.entities || []).find((e) => e.name === selection.entityName) || null
      : selectedEntity || null;

  const meta = activeEntity ? getObjectTypeMeta(activeEntity.type || "table") : null;

  let title = "Inspector";
  let subtitle = "Nothing selected";
  if (selection.kind === "column" && selection.fieldName) {
    title = selection.fieldName;
    subtitle = `Column · ${selection.entityName}`;
  } else if (selection.kind === "relationship" && selection.relId) {
    title = selection.relId;
    subtitle = "Relationship";
  } else if (selection.kind === "enum" && selection.enumName) {
    title = selection.enumName;
    subtitle = "Enum";
  } else if (activeEntity) {
    title = activeEntity.name;
    subtitle = meta?.label || "Entity";
  }

  return (
    <div className="h-full flex flex-col bg-bg-surface border-l border-border-primary min-w-[260px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-border-primary bg-bg-secondary shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {meta ? (
            <meta.icon size={14} strokeWidth={1.75} style={{ color: meta.color }} className="shrink-0" />
          ) : (
            <Info size={14} className="text-text-muted shrink-0" />
          )}
          <div className="flex flex-col min-w-0">
            <span className="t-label text-text-primary truncate leading-tight">{title}</span>
            <span className="t-caption text-text-muted truncate leading-tight">{subtitle}</span>
          </div>
        </div>
        <button
          onClick={toggleRightPanel}
          className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
          title="Close inspector"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {selection.kind === "column" && selection.entityName && selection.fieldName ? (
          <ColumnInspector entityName={selection.entityName} fieldName={selection.fieldName} />
        ) : selection.kind === "relationship" && selection.relId ? (
          <RelationshipInspector relId={selection.relId} />
        ) : selection.kind === "enum" && selection.enumName ? (
          <EnumInspector enumName={selection.enumName} />
        ) : activeEntity ? (
          <EntityInspector entity={activeEntity} />
        ) : (
          <InspectorEmpty />
        )}
      </div>
    </div>
  );
}

function InspectorEmpty() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10">
      <Info size={24} className="text-text-muted mb-3" />
      <p className="t-label text-text-secondary">Nothing selected</p>
      <p className="t-caption text-text-muted mt-1 max-w-[220px]">
        Click an entity or column to edit its properties here without leaving the canvas.
      </p>
    </div>
  );
}
