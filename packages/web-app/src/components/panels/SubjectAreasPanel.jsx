import React, { useMemo, useState } from "react";
import { Map as MapIcon, Filter, CheckSquare, Square, Compass } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { bulkAssignSubjectArea } from "../../lib/yamlRoundTrip";
import { PanelFrame, PanelSection, PanelEmpty } from "./PanelFrame";

const UNASSIGNED_SUBJECT_AREA_FILTER = "__unassigned_subject_area__";

function areaSummary(entities, subjectAreas) {
  const map = new Map();
  for (const entity of entities) {
    const key = entity.subject_area || "(unassigned)";
    map.set(key, (map.get(key) || 0) + 1);
  }
  for (const area of subjectAreas) {
    if (!map.has(area.name)) map.set(area.name, 0);
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export default function SubjectAreasPanel() {
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { model, activeSchemaFilter, setActiveSchemaFilter, requestLayoutRefresh } = useDiagramStore();
  const { addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();

  const entities = Array.isArray(model?.entities) ? model.entities : [];
  const subjectAreas = Array.isArray(model?.subject_areas) ? model.subject_areas : [];
  const summaries = useMemo(() => areaSummary(entities, subjectAreas), [entities, subjectAreas]);
  const [selectedNames, setSelectedNames] = useState([]);
  const [targetArea, setTargetArea] = useState("");

  if (!model) {
    return (
      <PanelFrame icon={<Compass size={14} />} eyebrow="Organisation" title="Subject Areas">
        <PanelEmpty
          icon={Compass}
          title="No model open"
          description="Open a model to explore and assign subject areas."
        />
      </PanelFrame>
    );
  }

  const toggleEntity = (entityName) => {
    setSelectedNames((current) => current.includes(entityName) ? current.filter((name) => name !== entityName) : [...current, entityName]);
  };

  const applyBulk = () => {
    if (selectedNames.length === 0) {
      addToast?.({ type: "error", message: "Select at least one entity." });
      return;
    }
    const result = bulkAssignSubjectArea(activeFileContent, selectedNames, targetArea);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    requestLayoutRefresh();
    addToast?.({ type: "success", message: `Updated subject area for ${selectedNames.length} entities.` });
    setSelectedNames([]);
  };

  return (
    <PanelFrame
      icon={<Compass size={14} />}
      eyebrow="Organisation"
      title="Subject Areas"
      subtitle={`${summaries.length} areas · ${entities.length} entities`}
    >
      <PanelSection title="Explorer" icon={<MapIcon size={11} />}>
        <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {summaries.map((item) => (
            <button
              key={item.name}
              onClick={() => {
                const filterValue = item.name === "(unassigned)" ? UNASSIGNED_SUBJECT_AREA_FILTER : item.name;
                setActiveSchemaFilter(activeSchemaFilter === filterValue ? null : filterValue);
              }}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                (item.name === "(unassigned)"
                  ? activeSchemaFilter === UNASSIGNED_SUBJECT_AREA_FILTER
                  : activeSchemaFilter === item.name)
                  ? "border-accent-blue bg-accent-blue/10"
                  : "border-border-primary hover:bg-bg-hover"
              }`}
            >
              <div className="text-[11px] font-semibold text-text-primary truncate">{item.name}</div>
              <div className="text-[10px] text-text-muted mt-1">{item.count} entities</div>
            </button>
          ))}
        </div>
        <div className="text-[11px] text-text-muted flex items-center gap-1.5">
          <Filter size={11} />
          {activeSchemaFilter
            ? `Diagram filtered to ${activeSchemaFilter === UNASSIGNED_SUBJECT_AREA_FILTER ? "unassigned entities" : activeSchemaFilter}`
            : "Diagram not filtered by subject area"}
        </div>
        </div>
      </PanelSection>

      <PanelSection title="Bulk Assign" icon={<CheckSquare size={11} />}>
        <div className="space-y-3">
        <input
          value={targetArea}
          onChange={(e) => setTargetArea(e.target.value)}
          list="subject-area-bulk-options"
          placeholder="Target subject area"
          className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
          disabled={!canEdit}
        />
        <datalist id="subject-area-bulk-options">
          {subjectAreas.map((area) => <option key={area.name} value={area.name} />)}
        </datalist>
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedNames(entities.map((entity) => entity.name))} className="px-2 py-1 rounded-md text-[11px] border border-border-primary text-text-secondary hover:bg-bg-hover transition-colors" type="button">
            Select All
          </button>
          <button onClick={() => setSelectedNames(entities.filter((entity) => !entity.subject_area).map((entity) => entity.name))} className="px-2 py-1 rounded-md text-[11px] border border-border-primary text-text-secondary hover:bg-bg-hover transition-colors" type="button">
            Select Unassigned
          </button>
          <button onClick={() => setSelectedNames([])} className="px-2 py-1 rounded-md text-[11px] border border-border-primary text-text-secondary hover:bg-bg-hover transition-colors" type="button">
            Clear
          </button>
        </div>
        <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border-primary divide-y divide-border-primary">
          {entities.map((entity) => {
            const checked = selectedNames.includes(entity.name);
            return (
              <button
                key={entity.name}
                onClick={() => toggleEntity(entity.name)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover transition-colors"
                type="button"
              >
                {checked ? <CheckSquare size={14} className="text-accent-blue shrink-0" /> : <Square size={14} className="text-text-muted shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-text-primary truncate">{entity.name}</div>
                  <div className="text-[10px] text-text-muted truncate">{entity.subject_area || "Unassigned"}</div>
                </div>
              </button>
            );
          })}
        </div>
        <button
          onClick={applyBulk}
          disabled={!canEdit || selectedNames.length === 0}
          className="w-full px-3 py-2 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Apply To Selected ({selectedNames.length})
        </button>
        </div>
      </PanelSection>
    </PanelFrame>
  );
}
