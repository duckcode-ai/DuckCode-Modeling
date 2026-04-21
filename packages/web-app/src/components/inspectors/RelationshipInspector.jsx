import React from "react";
import { Trash2 } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { mutateModel } from "../../lib/yamlRoundTrip";
import {
  InspectorField,
  InspectorSection,
  TextInput,
  SelectInput,
  CheckboxInput,
} from "./InspectorField";

const CARDINALITY_OPTIONS = [
  { value: "one_to_one", label: "One to one" },
  { value: "one_to_many", label: "One to many" },
  { value: "many_to_one", label: "Many to one" },
  { value: "many_to_many", label: "Many to many" },
];

export default function RelationshipInspector({ relId }) {
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { model, edges } = useDiagramStore();
  const { addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
  const readOnly = !canEdit;

  const rel =
    (model?.relationships || []).find((r) => r.name === relId) ||
    (edges || []).find((e) => e.id === relId)?.data?.relationship ||
    null;

  if (!rel) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="t-caption text-text-muted">Relationship not found.</p>
      </div>
    );
  }

  const apply = (mutatorFn) => {
    if (!activeFileContent || readOnly) return;
    const result = mutateModel(activeFileContent, mutatorFn);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
  };

  const setRelField = (key, value) =>
    apply((m) => {
      const target = (m.relationships || []).find((r) => r.name === rel.name);
      if (!target) return;
      if (value === undefined || value === null || value === "") delete target[key];
      else target[key] = value;
    });

  return (
    <div className="flex flex-col">
      <InspectorSection title="Identity">
        <InspectorField label="Name">
          <TextInput value={rel.name || relId} readOnly={true} />
        </InspectorField>
        <InspectorField label="From">
          <TextInput value={rel.from || ""} readOnly={true} />
        </InspectorField>
        <InspectorField label="To">
          <TextInput value={rel.to || ""} readOnly={true} />
        </InspectorField>
      </InspectorSection>

      <InspectorSection title="Cardinality">
        <InspectorField label="Cardinality">
          <SelectInput
            value={rel.cardinality || "one_to_many"}
            onChange={(v) => setRelField("cardinality", v)}
            options={CARDINALITY_OPTIONS}
            readOnly={readOnly}
          />
        </InspectorField>
        <CheckboxInput
          checked={!!rel.source_optional}
          onChange={(v) => setRelField("source_optional", v || undefined)}
          label="Source optional"
          readOnly={readOnly}
        />
        <CheckboxInput
          checked={!!rel.target_optional}
          onChange={(v) => setRelField("target_optional", v || undefined)}
          label="Target optional"
          readOnly={readOnly}
        />
      </InspectorSection>

      {!readOnly && (
        <InspectorSection title="Danger zone">
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={() => {
                const relName = rel.name || relId;
                if (window.confirm(`Delete relationship "${relName}"?`)) {
                  // Canvas edge ids are "rel-<name>"; the shared handler
                  // strips that prefix, so either form works here.
                  window.dispatchEvent(
                    new CustomEvent("dl:relationship:delete", { detail: { id: relName } })
                  );
                }
              }}
              className="panel-btn danger"
              style={{ width: "100%", justifyContent: "center" }}
            >
              <Trash2 size={12} />
              Delete relationship
            </button>
          </div>
        </InspectorSection>
      )}
    </div>
  );
}
