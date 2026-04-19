import React, { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { updateEnum, removeEnum } from "../../lib/yamlRoundTrip";
import {
  InspectorField,
  InspectorSection,
  TextInput,
  TextareaInput,
} from "./InspectorField";

export default function EnumInspector({ enumName }) {
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { model } = useDiagramStore();
  const { addToast, clearSelection } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const readOnly = !canEditFn();

  const enumDef = (model?.enums || []).find((e) => e.name === enumName) || null;
  const [newValue, setNewValue] = useState("");

  if (!enumDef) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="t-caption text-text-muted">Enum not found.</p>
      </div>
    );
  }

  const apply = (mutator) => {
    if (!activeFileContent || readOnly) return;
    const result = mutator(activeFileContent);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
  };

  const setField = (key, value) =>
    apply((yaml) => updateEnum(yaml, enumDef.name, { [key]: value }));

  const values = Array.isArray(enumDef.values) ? enumDef.values : [];

  const addValue = () => {
    const v = newValue.trim();
    if (!v || values.includes(v)) return;
    apply((yaml) => updateEnum(yaml, enumDef.name, { values: [...values, v] }));
    setNewValue("");
  };

  const removeValue = (v) => {
    apply((yaml) => updateEnum(yaml, enumDef.name, { values: values.filter((x) => x !== v) }));
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete enum "${enumDef.name}"?`)) return;
    apply((yaml) => removeEnum(yaml, enumDef.name));
    clearSelection();
  };

  return (
    <div className="flex flex-col">
      <InspectorSection title="Identity">
        <InspectorField label="Name">
          <TextInput
            value={enumDef.name}
            onChange={(v) => setField("name", v)}
            readOnly={readOnly}
          />
        </InspectorField>
        <InspectorField label="Description">
          <TextareaInput
            value={enumDef.description || ""}
            onChange={(v) => setField("description", v)}
            readOnly={readOnly}
          />
        </InspectorField>
      </InspectorSection>

      <InspectorSection title={`Values (${values.length})`}>
        <div className="px-3 flex flex-col gap-1">
          {values.length === 0 && (
            <div className="t-caption text-text-muted py-1">No values yet.</div>
          )}
          {values.map((v) => (
            <div
              key={v}
              className="flex items-center gap-2 h-7 px-2 rounded-md bg-bg-primary border border-border-primary"
            >
              <span className="flex-1 text-sm font-mono text-text-primary truncate">{v}</span>
              {!readOnly && (
                <button
                  onClick={() => removeValue(v)}
                  className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-status-error"
                  title="Remove value"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="flex items-center gap-1 mt-1">
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addValue();
                  }
                }}
                placeholder="Add value…"
                className="flex-1 h-7 px-2 rounded-md border border-border-primary bg-bg-primary text-sm text-text-primary outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/20"
              />
              <button
                onClick={addValue}
                disabled={!newValue.trim()}
                className="h-7 px-2 rounded-md border border-border-primary text-text-secondary hover:bg-bg-hover disabled:opacity-40 flex items-center gap-1"
              >
                <Plus size={12} />
                <span className="text-xs">Add</span>
              </button>
            </div>
          )}
        </div>
      </InspectorSection>

      {!readOnly && (
        <div className="px-3 py-3 border-t border-border-primary">
          <button
            onClick={handleDelete}
            className="w-full h-8 rounded-md border border-status-error/40 text-status-error hover:bg-status-error/10 flex items-center justify-center gap-2 text-sm"
          >
            <Trash2 size={13} />
            Delete enum
          </button>
        </div>
      )}
    </div>
  );
}
