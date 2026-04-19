import React from "react";
import { Trash2 } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { mutateModel, removeRelationship } from "../../lib/yamlRoundTrip";
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
  const { addToast, setSelection, clearSelection } = useUiStore();
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

  const handleRename = (next) => {
    const trimmed = String(next || "").trim();
    if (!trimmed || trimmed === rel.name) return;
    const existing = (model?.relationships || []).some((r) => r.name === trimmed);
    if (existing) {
      addToast?.({ type: "error", message: `Relationship "${trimmed}" already exists` });
      return;
    }
    apply((m) => {
      const target = (m.relationships || []).find((r) => r.name === rel.name);
      if (target) target.name = trimmed;
    });
    setSelection({ kind: "relationship", relId: trimmed });
  };

  const handleDelete = () => {
    if (readOnly) return;
    if (!window.confirm(`Delete relationship "${rel.name}"?`)) return;
    if (!activeFileContent) return;
    const result = removeRelationship(activeFileContent, rel.name);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    clearSelection();
    addToast?.({ type: "success", message: `Deleted relationship ${rel.name}` });
  };

  const entityOptions = (model?.entities || []).map((e) => ({ value: e.name, label: e.name }));

  return (
    <div className="flex flex-col">
      <InspectorSection title="Identity">
        <InspectorField label="Name">
          <TextInput
            value={rel.name || relId}
            onChange={handleRename}
            readOnly={readOnly}
          />
        </InspectorField>
        <InspectorField label="From">
          <SelectInput
            value={rel.from || ""}
            onChange={(v) => setRelField("from", v)}
            options={entityOptions}
            readOnly={readOnly}
          />
        </InspectorField>
        <InspectorField label="To">
          <SelectInput
            value={rel.to || ""}
            onChange={(v) => setRelField("to", v)}
            options={entityOptions}
            readOnly={readOnly}
          />
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
        <div className="px-3 py-3 border-t border-border-primary">
          <button
            onClick={handleDelete}
            className="dl-toolbar-btn dl-toolbar-btn--ghost-icon w-full justify-center text-accent-red"
            title="Delete this relationship"
          >
            <Trash2 size={14} />
            Delete relationship
          </button>
        </div>
      )}
    </div>
  );
}
