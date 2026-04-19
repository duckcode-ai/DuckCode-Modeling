import React from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useDiagramStore from "../../stores/diagramStore";
import useAuthStore from "../../stores/authStore";
import { updateFieldProperty, removeField, renameField } from "../../lib/yamlRoundTrip";
import {
  InspectorField,
  InspectorSection,
  TextInput,
  SelectInput,
  CheckboxInput,
  TextareaInput,
} from "./InspectorField";

const TYPE_OPTIONS = [
  "string",
  "integer",
  "bigint",
  "smallint",
  "decimal",
  "float",
  "double",
  "boolean",
  "date",
  "time",
  "timestamp",
  "timestamptz",
  "json",
  "uuid",
  "bytes",
].map((t) => ({ value: t, label: t }));

export default function ColumnInspector({ entityName, fieldName }) {
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { model } = useDiagramStore();
  const { setSelection, addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
  const readOnly = !canEdit;

  const entity = (model?.entities || []).find((e) => e.name === entityName);
  const field = (entity?.fields || []).find((f) => f.name === fieldName);

  if (!field) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="t-caption text-text-muted">Column not found.</p>
        <button
          onClick={() => setSelection({ kind: "entity", entityName })}
          className="mt-3 dl-toolbar-btn dl-toolbar-btn--ghost-icon px-3"
        >
          Back to entity
        </button>
      </div>
    );
  }

  const apply = (mutator, ...args) => {
    if (!activeFileContent || readOnly) return;
    const result = mutator(activeFileContent, ...args);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
  };

  const setProp = (key, value) => apply(updateFieldProperty, entityName, fieldName, key, value);

  const handleRename = (next) => {
    const trimmed = String(next || "").trim();
    if (!trimmed || trimmed === fieldName) return;
    const result = renameField(activeFileContent, entityName, fieldName, trimmed);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    setSelection({ kind: "column", entityName, fieldName: trimmed });
  };

  const handleDelete = () => {
    if (readOnly) return;
    if (!window.confirm(`Delete column ${fieldName}?`)) return;
    apply(removeField, entityName, fieldName);
    setSelection({ kind: "entity", entityName });
  };

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-border-primary flex items-center gap-2">
        <button
          onClick={() => setSelection({ kind: "entity", entityName })}
          className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
          title="Back to entity"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="t-caption text-text-muted truncate">{entityName}</span>
      </div>

      <InspectorSection title="Identity">
        <InspectorField label="Name">
          <TextInput
            value={field.name}
            onChange={handleRename}
            readOnly={readOnly}
          />
        </InspectorField>
        <InspectorField label="Type">
          <SelectInput
            value={field.type || "string"}
            onChange={(v) => setProp("type", v)}
            options={TYPE_OPTIONS}
            readOnly={readOnly}
          />
        </InspectorField>
        <InspectorField label="Description">
          <TextareaInput
            value={field.description || ""}
            onChange={(v) => setProp("description", v)}
            readOnly={readOnly}
          />
        </InspectorField>
      </InspectorSection>

      <InspectorSection title="Constraints">
        <CheckboxInput
          checked={field.primary_key}
          onChange={(v) => setProp("primary_key", v || undefined)}
          label="Primary key"
          readOnly={readOnly}
        />
        <CheckboxInput
          checked={field.nullable ?? true}
          onChange={(v) => setProp("nullable", v)}
          label="Nullable"
          readOnly={readOnly}
        />
        <CheckboxInput
          checked={field.unique}
          onChange={(v) => setProp("unique", v || undefined)}
          label="Unique"
          readOnly={readOnly}
        />
        <InspectorField label="Default">
          <TextInput
            value={field.default ?? ""}
            onChange={(v) => setProp("default", v || undefined)}
            readOnly={readOnly}
            placeholder="optional default expression"
          />
        </InspectorField>
      </InspectorSection>

      {!readOnly && (
        <div className="px-3 py-3 border-t border-border-primary">
          <button
            onClick={handleDelete}
            className="dl-toolbar-btn dl-toolbar-btn--ghost-icon w-full justify-center text-accent-red"
            title="Delete this column"
          >
            <Trash2 size={14} />
            Delete column
          </button>
        </div>
      )}
    </div>
  );
}
