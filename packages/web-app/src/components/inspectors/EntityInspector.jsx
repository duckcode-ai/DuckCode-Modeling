import React from "react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import useDiagramStore from "../../stores/diagramStore";
import {
  updateEntityMeta,
  setEntityScalarProperty,
  renameEntity,
  removeEntity,
  addField,
  parseYamlSafe,
} from "../../lib/yamlRoundTrip";
import { OBJECT_TYPE_DISPLAY_ORDER, getObjectTypeMeta } from "../../lib/objectTypeMeta";
import {
  InspectorField,
  InspectorSection,
  TextInput,
  SelectInput,
  TextareaInput,
} from "./InspectorField";
import { ChevronRight, Plus, Trash2 } from "lucide-react";

/**
 * Edits the top-level properties of a single entity. The column grid at the
 * bottom is click-to-select; editing a column's properties happens in
 * ColumnInspector once the user clicks a row.
 */
export default function EntityInspector({ entity }) {
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { setSelection, addToast, clearSelection } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
  const { getSchemaOptions, selectEntity } = useDiagramStore();

  const readOnly = !canEdit;

  const apply = (mutator, ...args) => {
    if (!activeFileContent || readOnly) return null;
    const result = mutator(activeFileContent, ...args);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return null;
    }
    updateContent(result.yaml);
    return result;
  };

  const setMeta = (key, value) => apply(updateEntityMeta, entity.name, key, value);
  const setScalar = (key, value) => apply(setEntityScalarProperty, entity.name, key, value);

  const handleRename = (next) => {
    const trimmed = String(next || "").trim();
    if (!trimmed || trimmed === entity.name) return;
    const result = apply(renameEntity, entity.name, trimmed);
    if (result) {
      selectEntity?.(trimmed);
      setSelection({ kind: "entity", entityName: trimmed });
    }
  };

  const handleDelete = () => {
    if (readOnly) return;
    if (!window.confirm(`Delete entity "${entity.name}"? This also removes related relationships.`)) return;
    const result = apply(removeEntity, entity.name);
    if (result) {
      clearSelection();
      addToast?.({ type: "success", message: `Deleted ${entity.name}` });
    }
  };

  const handleAddColumn = () => {
    if (readOnly) return;
    const before = new Set((entity.fields || []).map((f) => f.name));
    const result = apply(addField, entity.name);
    if (!result) return;
    const parsed = parseYamlSafe(result.yaml);
    const nextEntity = (parsed.doc?.entities || []).find((e) => e.name === entity.name);
    const added = (nextEntity?.fields || []).map((f) => f.name).find((n) => !before.has(n));
    if (added) setSelection({ kind: "column", entityName: entity.name, fieldName: added });
  };

  const typeOptions = OBJECT_TYPE_DISPLAY_ORDER.map((kind) => {
    const meta = getObjectTypeMeta(kind);
    return { value: kind, label: meta.label };
  });

  const schemaOptions = [
    { value: "", label: "(default)" },
    ...getSchemaOptions().map((s) => ({ value: s.name, label: s.name })),
  ];

  const fields = entity.fields || [];

  return (
    <div className="flex flex-col">
      <InspectorSection title="Identity">
        <InspectorField label="Name">
          <TextInput
            value={entity.name}
            onChange={handleRename}
            readOnly={readOnly}
          />
        </InspectorField>
        <InspectorField label="Type">
          <SelectInput
            value={entity.type || "table"}
            onChange={(v) => setMeta("type", v)}
            options={typeOptions}
            readOnly={readOnly}
          />
        </InspectorField>
        <InspectorField label="Subject area">
          <SelectInput
            value={entity.subject_area || ""}
            onChange={(v) => setScalar("subject_area", v)}
            options={schemaOptions}
            readOnly={readOnly}
          />
        </InspectorField>
        <InspectorField label="Description">
          <TextareaInput
            value={entity.description || ""}
            onChange={(v) => setMeta("description", v)}
            readOnly={readOnly}
          />
        </InspectorField>
      </InspectorSection>

      <InspectorSection title="Ownership">
        <InspectorField label="Owner">
          <TextInput
            value={entity.owner || ""}
            onChange={(v) => setScalar("owner", v)}
            readOnly={readOnly}
            placeholder="team or email"
          />
        </InspectorField>
        <InspectorField label="Schema">
          <TextInput
            value={entity.schema || ""}
            onChange={(v) => setScalar("schema", v)}
            readOnly={readOnly}
            placeholder="optional database schema"
          />
        </InspectorField>
      </InspectorSection>

      <InspectorSection title={`Columns (${fields.length})`}>
        {fields.length === 0 ? (
          <div className="px-3 py-2 t-caption text-text-muted">No columns yet.</div>
        ) : (
          <div>
            {fields.map((field) => (
              <ColumnRow
                key={field.name}
                entityName={entity.name}
                field={field}
                onSelect={() =>
                  setSelection({ kind: "column", entityName: entity.name, fieldName: field.name })
                }
              />
            ))}
          </div>
        )}
        {!readOnly && (
          <div className="px-3 py-2">
            <button
              onClick={handleAddColumn}
              className="dl-toolbar-btn dl-toolbar-btn--ghost-icon w-full justify-center"
              title="Add a new column"
            >
              <Plus size={13} />
              Add column
            </button>
          </div>
        )}
      </InspectorSection>

      {!readOnly && (
        <div className="px-3 py-3 border-t border-border-primary">
          <button
            onClick={handleDelete}
            className="dl-toolbar-btn dl-toolbar-btn--ghost-icon w-full justify-center text-accent-red"
            title="Delete this entity"
          >
            <Trash2 size={14} />
            Delete entity
          </button>
        </div>
      )}
    </div>
  );
}

function ColumnRow({ field, onSelect }) {
  return (
    <div
      onClick={onSelect}
      className="dl-tree-row"
      title={field.description || field.name}
    >
      <span className="truncate flex-1 text-text-primary">{field.name}</span>
      <span className="t-caption text-text-muted shrink-0">{field.type || "string"}</span>
      {field.primary_key && (
        <span className="dl-chip dl-chip--accent shrink-0" style={{ height: 16, padding: "0 6px", fontSize: 10 }}>
          PK
        </span>
      )}
      <ChevronRight size={12} className="text-text-muted shrink-0" />
    </div>
  );
}
