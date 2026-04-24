import React from "react";
import { Plus, Trash2, KeyRound, Boxes } from "lucide-react";
import { PanelSection, PanelEmpty, StatusPill } from "../../components/panels/PanelFrame";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import { patchField, appendField, deleteField } from "../yamlPatch";
import { setEntityScalarProperty, setEntityKeySets } from "../../lib/yamlRoundTrip";

function keySetText(value) {
  return Array.isArray(value)
    ? value.map((set) => (Array.isArray(set) ? set.join(", ") : "")).filter(Boolean).join("\n")
    : "";
}

export default function LogicalDetailsView({ table }) {
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const updateContent = useWorkspaceStore((s) => s.updateContent);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const addToast = useUiStore((s) => s.addToast);
  const isDiagramFile = /\.diagram\.ya?ml$/i.test(activeFile?.name || "");

  const apply = React.useCallback((mutate) => {
    const next = mutate(activeFileContent);
    if (!next || next === activeFileContent) return false;
    updateContent(next);
    return true;
  }, [activeFileContent, updateContent]);

  const applyFieldPatch = React.useCallback((fieldName, patch) => {
    apply((content) => patchField(content, table.name, fieldName, patch));
  }, [apply, table?.name]);

  const applyEntityScalar = React.useCallback((key, value) => {
    apply((content) => setEntityScalarProperty(content, table.name, key, value).yaml);
  }, [apply, table?.name]);

  const applyKeySets = React.useCallback((key, value) => {
    apply((content) => setEntityKeySets(content, table.name, key, value).yaml);
  }, [apply, table?.name]);

  const handleAddAttribute = React.useCallback(() => {
    const existing = new Set((table?.columns || []).map((column) => String(column.name || "").toLowerCase()));
    let name = "new_attribute";
    let index = 2;
    while (existing.has(name.toLowerCase())) {
      name = `new_attribute_${index++}`;
    }
    const next = appendField(activeFileContent, table.name, { name, type: "string", nullable: true });
    if (!next || next === activeFileContent) {
      addToast?.({ type: "error", message: "Could not add logical attribute." });
      return;
    }
    updateContent(next);
  }, [activeFileContent, addToast, table?.columns, table?.name, updateContent]);

  const handleDeleteAttribute = React.useCallback((fieldName) => {
    if (!window.confirm(`Delete attribute "${fieldName}" from "${table.name}"?`)) return;
    const next = deleteField(activeFileContent, table.name, fieldName);
    if (!next || next === activeFileContent) return;
    updateContent(next);
  }, [activeFileContent, table?.name, updateContent]);

  if (!table) {
    return (
      <PanelEmpty
        icon={Boxes}
        title="No logical entity selected"
        description="Select a logical entity on the canvas to edit its attributes, keys, and inheritance."
      />
    );
  }

  return (
    <>
      <PanelSection title="Logical Entity">
        <div className="inspector-inline-form">
          <label>Name</label>
          <input
            className="panel-input"
            value={table.logical_name || table.name || ""}
            onChange={(e) => applyEntityScalar("logical_name", e.target.value)}
            placeholder="Business-facing entity name"
          />

          <label>Description</label>
          <textarea
            className="panel-input"
            rows={3}
            value={table.description || ""}
            onChange={(e) => applyEntityScalar("description", e.target.value)}
            placeholder="What does this logical entity represent?"
          />

          <label>Subject Area</label>
          <input
            className="panel-input"
            value={table.subject_area || ""}
            onChange={(e) => applyEntityScalar("subject_area", e.target.value)}
            placeholder="Sales, Finance, Customer..."
          />

          <label>Subtype Of</label>
          <input
            className="panel-input"
            value={table.subtype_of || ""}
            onChange={(e) => applyEntityScalar("subtype_of", e.target.value)}
            placeholder="Optional parent logical entity"
          />
        </div>
      </PanelSection>

      <PanelSection title="Key Intent" icon={<KeyRound size={12} />}>
        <div className="inspector-inline-form">
          <label>Candidate Keys</label>
          <textarea
            className="panel-input"
            rows={3}
            value={keySetText(table.candidate_keys)}
            onChange={(e) => applyKeySets("candidate_keys", e.target.value)}
            placeholder={"account_id\naccount_code, source_system"}
          />

          <label>Business Keys</label>
          <textarea
            className="panel-input"
            rows={3}
            value={keySetText(table.business_keys)}
            onChange={(e) => applyKeySets("business_keys", e.target.value)}
            placeholder={"customer_number"}
          />

          <label>Flags</label>
          <div className="panel-btn-row" style={{ gap: 6, flexWrap: "wrap" }}>
            <StatusPill tone="info">{table.columns?.length || 0} attributes</StatusPill>
            <StatusPill tone="accent">{(table.candidate_keys || []).length} candidate key set(s)</StatusPill>
            {(table.business_keys || []).length > 0 && <StatusPill tone="success">{table.business_keys.length} business key set(s)</StatusPill>}
            {table.subtype_of && <StatusPill tone="warning">Subtype</StatusPill>}
            {isDiagramFile && <StatusPill tone="neutral">Diagram scoped</StatusPill>}
          </div>
        </div>
      </PanelSection>

      <PanelSection
        title="Attributes"
        count={table.columns?.length || 0}
        action={(
          <button type="button" className="panel-btn" onClick={handleAddAttribute} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <Plus size={11} />
            Add
          </button>
        )}
      >
        {(table.columns || []).length === 0 ? (
          <PanelEmpty
            icon={Boxes}
            title="No attributes yet"
            description="Start with a few platform-neutral attributes, then define candidate and business keys."
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {(table.columns || []).map((column) => (
              <div key={column.name} className="panel-card tone-neutral dense">
                <div className="panel-card-header">
                  <div className="panel-card-heading">
                    <div className="panel-card-title-col">
                      <div className="panel-card-title">{column.name}</div>
                      <div className="panel-card-subtitle">{column.type || "string"}</div>
                    </div>
                  </div>
                  <div className="panel-card-actions">
                    <button type="button" className="panel-btn danger" onClick={() => handleDeleteAttribute(column.name)}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
                <div className="panel-card-body">
                  <div className="inspector-inline-form">
                    <label>Name</label>
                    <input
                      className="panel-input"
                      value={column.name || ""}
                      onChange={(e) => applyFieldPatch(column.name, { name: e.target.value })}
                    />

                    <label>Logical type</label>
                    <input
                      className="panel-input"
                      value={column.type || ""}
                      onChange={(e) => applyFieldPatch(column.name, { type: e.target.value })}
                      placeholder="identifier, string, number, date..."
                    />

                    <label>Description</label>
                    <input
                      className="panel-input"
                      value={column.description || ""}
                      onChange={(e) => applyFieldPatch(column.name, { description: e.target.value })}
                      placeholder="What does this attribute mean?"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </PanelSection>
    </>
  );
}
