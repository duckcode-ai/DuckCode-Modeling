import React from "react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import useDiagramStore from "../../stores/diagramStore";
import {
  updateEntityMeta,
  setEntityScalarProperty,
} from "../../lib/yamlRoundTrip";
import { OBJECT_TYPE_DISPLAY_ORDER, getObjectTypeMeta } from "../../lib/objectTypeMeta";
import {
  InspectorField,
  InspectorSection,
  TextInput,
  SelectInput,
  TextareaInput,
} from "./InspectorField";
import { ChevronRight, Trash2 } from "lucide-react";

/**
 * Edits the top-level properties of a single entity. The column grid at the
 * bottom is click-to-select; editing a column's properties happens in
 * ColumnInspector once the user clicks a row.
 */
export default function EntityInspector({ entity }) {
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { setSelection } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
  const { getSchemaOptions } = useDiagramStore();

  const readOnly = !canEdit;

  const apply = (mutator, ...args) => {
    if (!activeFileContent || readOnly) return;
    const result = mutator(activeFileContent, ...args);
    if (!result.error) updateContent(result.yaml);
  };

  const setMeta = (key, value) => apply(updateEntityMeta, entity.name, key, value);
  const setScalar = (key, value) => apply(setEntityScalarProperty, entity.name, key, value);

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
          <TextInput value={entity.name} readOnly={true} />
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
      </InspectorSection>

      {!readOnly && (
        <InspectorSection title="Danger zone">
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete entity "${entity.name}"? This removes it from the YAML and any diagrams/relationships that reference it.`
                  )
                ) {
                  window.dispatchEvent(
                    new CustomEvent("dl:entity:delete", { detail: { name: entity.name } })
                  );
                }
              }}
              className="panel-btn danger"
              style={{ width: "100%", justifyContent: "center" }}
            >
              <Trash2 size={12} />
              Delete entity
            </button>
          </div>
        </InspectorSection>
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
