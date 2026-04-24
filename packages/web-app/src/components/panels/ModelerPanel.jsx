import React, { useEffect, useMemo, useState } from "react";
import { Boxes, ArrowRightLeft, Shapes, Layers3, Wand2, Plus, Info, KeyRound, Database } from "lucide-react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { addEntityWithOptions, addRelationship } from "../../lib/yamlRoundTrip";
import { addDiagramRelationship, addInlineDiagramEntity } from "../../design/yamlPatch";
import { PanelFrame, PanelSection, PanelEmpty } from "./PanelFrame";

const VIEW_MODES = [
  { id: "conceptual", label: "Conceptual", description: "Business concepts and high-level relationships." },
  { id: "logical", label: "Logical", description: "Keys, inheritance, and reusable business structure." },
  { id: "physical", label: "Physical", description: "Warehouse objects, constraints, and platform details." },
];

const ENTITY_TYPES = {
  concept: { label: "Concept", family: "Conceptual", description: "Business concept with a lean starter shape." },
  logical_entity: { label: "Logical Entity", family: "Logical", description: "Normalized business entity with candidate keys." },
  table: { label: "Table", family: "Physical", description: "General relational table." },
  view: { label: "View", family: "Physical", description: "Derived read model." },
  materialized_view: { label: "Materialized View", family: "Physical", description: "Persisted derived object." },
  fact_table: { label: "Fact", family: "Dimensional", description: "Event or transaction fact with declared grain." },
  dimension_table: { label: "Dimension", family: "Dimensional", description: "Descriptive dimension with key metadata." },
  bridge_table: { label: "Bridge", family: "Dimensional", description: "Many-to-many bridge structure." },
  hub: { label: "Hub", family: "Data Vault", description: "Business-key anchor entity." },
  link: { label: "Link", family: "Data Vault", description: "Associative vault structure between hubs." },
  satellite: { label: "Satellite", family: "Data Vault", description: "Descriptive history attached to a hub or link." },
};

const CARDINALITY_OPTIONS = [
  { value: "one_to_one", label: "1:1" },
  { value: "one_to_many", label: "1:N" },
  { value: "many_to_one", label: "N:1" },
  { value: "many_to_many", label: "N:N" },
];

function defaultEntityType(viewMode, modelKind) {
  if (viewMode === "conceptual" || modelKind === "conceptual") return "concept";
  if (viewMode === "logical" || modelKind === "logical") return "logical_entity";
  return "table";
}

function allowedTypes(viewMode) {
  if (viewMode === "conceptual") return ["concept"];
  if (viewMode === "logical") return ["logical_entity", "fact_table", "dimension_table", "bridge_table", "hub", "link", "satellite"];
  return ["table", "view", "materialized_view", "fact_table", "dimension_table", "bridge_table", "hub", "link", "satellite"];
}

export default function ModelerPanel() {
  const { activeFile, activeFileContent, updateContent, createNewFile } = useWorkspaceStore();
  const {
    model,
    selectedEntity,
    selectEntity,
    modelingViewMode,
    setModelingViewMode,
    requestLayoutRefresh,
  } = useDiagramStore();
  const { addToast, openModal } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();

  const modelKind = model?.model?.layer || model?.model?.kind || "physical";
  const entities = Array.isArray(model?.entities) ? model.entities : [];
  const subjectAreas = Array.isArray(model?.subject_areas) ? model.subject_areas : [];
  const entityOptions = useMemo(() => allowedTypes(modelingViewMode), [modelingViewMode]);

  const [entityType, setEntityType] = useState(defaultEntityType(modelingViewMode, modelKind));
  const [entityName, setEntityName] = useState("");
  const [entitySubjectArea, setEntitySubjectArea] = useState("");

  const [relationshipName, setRelationshipName] = useState("");
  const [fromEntity, setFromEntity] = useState("");
  const [fromField, setFromField] = useState("");
  const [toEntity, setToEntity] = useState("");
  const [toField, setToField] = useState("");
  const [cardinality, setCardinality] = useState("one_to_many");
  const [targetDomain, setTargetDomain] = useState("core");
  const [targetModelName, setTargetModelName] = useState("");
  const [materialization, setMaterialization] = useState("view");
  const [logicSql, setLogicSql] = useState("select *\nfrom source_model");

  useEffect(() => {
    const nextType = defaultEntityType(modelingViewMode, modelKind);
    setEntityType((current) => (allowedTypes(modelingViewMode).includes(current) ? current : nextType));
  }, [modelingViewMode, modelKind]);

  useEffect(() => {
    if (!entities.some((entity) => entity.name === fromEntity)) {
      setFromEntity(entities[0]?.name || "");
    }
    if (!entities.some((entity) => entity.name === toEntity)) {
      setToEntity(entities[1]?.name || entities[0]?.name || "");
    }
  }, [entities, fromEntity, toEntity]);

  const fromEntityFields = entities.find((entity) => entity.name === fromEntity)?.fields || [];
  const toEntityFields = entities.find((entity) => entity.name === toEntity)?.fields || [];

  useEffect(() => {
    if (!targetModelName && entities[0]?.name) {
      setTargetModelName(String(entities[0].name).trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"));
    }
  }, [entities, targetModelName]);

  useEffect(() => {
    if (!fromEntityFields.some((field) => field.name === fromField)) {
      setFromField(fromEntityFields[0]?.name || "");
    }
  }, [fromEntityFields, fromField]);

  useEffect(() => {
    if (!toEntityFields.some((field) => field.name === toField)) {
      setToField(toEntityFields[0]?.name || "");
    }
  }, [toEntityFields, toField]);

  if (!model) {
    return (
      <PanelFrame icon={<Wand2 size={14} />} eyebrow="Workspace" title="Modeler">
        <PanelEmpty
          icon={Wand2}
          title="No model open"
          description="Open a model to use the modeler workspace."
        />
      </PanelFrame>
    );
  }

  const activeIsDiagram = /\.diagram\.ya?ml$/i.test(activeFile?.name || activeFile?.path || "");

  if (modelKind === "conceptual") {
    const relationshipCount = Array.isArray(model?.relationships) ? model.relationships.length : 0;
    return (
      <PanelFrame
        icon={<Wand2 size={14} />}
        eyebrow="Conceptual Studio"
        title="Business Model"
        subtitle={`${entities.length} ${entities.length === 1 ? "concept" : "concepts"} · ${relationshipCount} relationships`}
      >
        <PanelSection title="Process" icon={<Layers3 size={11} />}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {[
              ["1", "Define", "Capture business concepts, owners, domains, and definitions."],
              ["2", "Relate", "Connect concepts with business verbs and cardinality."],
              ["3", "Promote", "Use the logical layer for attributes, keys, and type intent."],
            ].map(([n, title, text]) => (
              <div key={n} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: 10, background: "var(--bg-1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>
                  <span style={{ width: 18, height: 18, borderRadius: 999, display: "inline-grid", placeItems: "center", background: "rgba(22,163,74,0.14)", color: "#22c55e", fontFamily: "var(--font-mono)" }}>{n}</span>
                  {title}
                </div>
                <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.4, color: "var(--text-tertiary)" }}>{text}</div>
              </div>
            ))}
          </div>
        </PanelSection>

        <PanelSection title="Actions" icon={<Plus size={11} />}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="panel-btn primary"
              disabled={!canEdit}
              onClick={() => openModal("newConcept")}
            >
              <Plus size={12} /> Add Concept
            </button>
            <button
              className="panel-btn"
              disabled={!canEdit || entities.length < 2}
              onClick={() => openModal("newRelationship", {
                modelKind: "conceptual",
                conceptualLevel: true,
                tables: entities.map((entity) => ({ id: entity.name, name: entity.name, columns: [] })),
                fromEntity: entities[0]?.name || "",
                toEntity: entities[1]?.name || "",
              })}
            >
              <ArrowRightLeft size={12} /> Add Relationship
            </button>
            {!activeIsDiagram && (
              <button
                className="panel-btn"
                disabled={!canEdit}
                onClick={() => openModal("newFile")}
              >
                <Boxes size={12} /> New Layer Asset
              </button>
            )}
          </div>
        </PanelSection>

        <PanelSection title="Selected Concept" icon={<Info size={11} />}>
          {selectedEntity ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              {[
                ["Name", selectedEntity.logical_name || selectedEntity.name],
                ["Domain", selectedEntity.domain || selectedEntity.subject_area || "unassigned"],
                ["Owner", selectedEntity.owner || "unassigned"],
                ["Tags", (selectedEntity.tags || []).join(", ") || "none"],
              ].map(([label, value]) => (
                <div key={label} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-1)", minWidth: 0 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>{label}</div>
                  <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
                </div>
              ))}
              <div style={{ gridColumn: "1 / -1", border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-1)" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>Definition</div>
                <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.45, color: "var(--text-secondary)" }}>
                  {selectedEntity.description || "No business definition yet. Open Details to add one."}
                </div>
              </div>
            </div>
          ) : (
            <PanelEmpty icon={Boxes} title="No concept selected" description="Select a concept on the canvas to inspect its business details here." />
          )}
        </PanelSection>

        <PanelSection title="Concept Inventory" icon={<Boxes size={11} />}>
          {entities.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {entities.map((entity) => (
                <button
                  key={entity.name}
                  type="button"
                  onClick={() => selectEntity(entity.name)}
                  style={{
                    textAlign: "left",
                    border: `1px solid ${selectedEntity?.name === entity.name ? "#22c55e" : "var(--border-default)"}`,
                    borderRadius: 8,
                    padding: 10,
                    background: selectedEntity?.name === entity.name ? "rgba(22,163,74,0.10)" : "var(--bg-1)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{entity.logical_name || entity.name}</div>
                  <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-tertiary)" }}>{entity.domain || entity.subject_area || "No domain"}</div>
                </button>
              ))}
            </div>
          ) : (
            <PanelEmpty icon={Boxes} title="No concepts" description="Use Add Concept to start the conceptual model." />
          )}
        </PanelSection>
      </PanelFrame>
    );
  }

  const handleCreateEntity = () => {
    if (!entityName.trim()) {
      addToast?.({ type: "error", message: "Entity name is required." });
      return;
    }
    if (activeIsDiagram) {
      const cleanName = entityName.trim();
      const result = addInlineDiagramEntity(activeFileContent, {
        name: cleanName,
        type: entityType,
        domain: entitySubjectArea.trim() || model?.model?.domain || "core",
        subject_area: entitySubjectArea.trim(),
        fields: [{
          name: "id",
          type: "identifier",
          primary_key: true,
          nullable: false,
        }],
        candidate_keys: [["id"]],
        x: 120 + entities.length * 32,
        y: 120 + entities.length * 24,
        width: 320,
      });
      if (!result) {
        addToast?.({ type: "error", message: "Could not add this entity to the active diagram." });
        return;
      }
      if (result === activeFileContent) {
        addToast?.({ type: "info", message: `${cleanName} already exists in this diagram.` });
        return;
      }
      updateContent(result);
      requestLayoutRefresh();
      setEntityName("");
      addToast?.({ type: "success", message: `Added ${ENTITY_TYPES[entityType]?.label || entityType} to the diagram.` });
      return;
    }
    const result = addEntityWithOptions(activeFileContent, {
      name: entityName.trim(),
      type: entityType,
      subjectArea: entitySubjectArea.trim(),
    });
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    requestLayoutRefresh();
    setEntityName("");
    addToast?.({ type: "success", message: `Added ${ENTITY_TYPES[entityType]?.label || entityType}.` });
  };

  const handleCreateRelationship = () => {
    if (!fromEntity || !fromField || !toEntity || !toField) {
      addToast?.({ type: "error", message: "Choose both relationship endpoints." });
      return;
    }
    const proposedName = relationshipName.trim() || `${fromEntity}_${toEntity}`.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    if (activeIsDiagram) {
      const next = addDiagramRelationship(activeFileContent, {
        name: proposedName,
        from: { entity: fromEntity, field: fromField },
        to: { entity: toEntity, field: toField },
        cardinality,
      });
      if (!next) {
        addToast?.({ type: "error", message: "Could not add relationship to the active diagram." });
        return;
      }
      if (next === activeFileContent) {
        addToast?.({ type: "info", message: "That relationship already exists on this diagram." });
        return;
      }
      updateContent(next);
      requestLayoutRefresh();
      setRelationshipName("");
      addToast?.({ type: "success", message: `Added diagram relationship ${proposedName}.` });
      return;
    }
    const result = addRelationship(activeFileContent, proposedName, `${fromEntity}.${fromField}`, `${toEntity}.${toField}`, cardinality);
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    requestLayoutRefresh();
    setRelationshipName("");
    addToast?.({ type: "success", message: `Added relationship ${proposedName}.` });
  };

  const generateDbtFromLogical = async () => {
    const modelSlug = String(targetModelName || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    const domainSlug = String(targetDomain || "core").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "core";
    if (!modelSlug) {
      addToast?.({ type: "error", message: "Target dbt model name is required." });
      return;
    }
    const selected = selectedEntity || entities[0];
    const fields = Array.isArray(selected?.fields) ? selected.fields : [];
    const columns = fields.map((field) => {
      const col = {
        name: String(field.name || ""),
        description: String(field.description || ""),
      };
      if (field.type) col.data_type = String(field.type);
      const tests = [];
      if (field.primary_key || field.pk) {
        tests.push("not_null", "unique");
      } else if (field.nullable === false) {
        tests.push("not_null");
      }
      if (field.unique) tests.push("unique");
      if (field.foreign_key?.entity || field.foreign_key?.table || field.fk) {
        const target = field.foreign_key || {};
        const entity = target.entity || target.table || String(field.fk || "").split(".")[0];
        const refField = target.field || target.column || String(field.fk || "").split(".")[1] || "id";
        tests.push({ relationships: { to: `ref('${entity}')`, field: refField } });
      }
      if (tests.length) col.tests = tests;
      return col;
    }).filter((column) => column.name);
    const schemaDoc = {
      version: 2,
      models: [{
        name: modelSlug,
        description: selected?.description || `Generated from DataLex logical diagram ${activeFile?.name || ""}`.trim(),
        config: { materialized: materialization },
        columns,
      }],
    };
    const sqlText = [
      `{{ config(materialized='${materialization}') }}`,
      "",
      logicSql.trim() || "select *\nfrom source_model",
      "",
    ].join("\n");
    const base = `DataLex/Generated/dbt/${domainSlug}`;
    try {
      await createNewFile(`${base}/${modelSlug}.sql`, sqlText);
      await createNewFile(`${base}/${modelSlug}.yml`, yaml.dump(schemaDoc, { lineWidth: 120, noRefs: true, sortKeys: false }));
      addToast?.({ type: "success", message: `Generated dbt SQL/YAML under ${base}.` });
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Could not generate dbt files." });
    }
  };

  return (
    <PanelFrame
      icon={<Wand2 size={14} />}
      eyebrow="Workspace"
      title="Modeler"
      subtitle={`${entities.length} ${entities.length === 1 ? "entity" : "entities"} · ${modelKind}`}
    >
      <PanelSection title="Model Views" icon={<Layers3 size={11} />}>
        <div className="grid grid-cols-3 gap-2">
          {VIEW_MODES.map((view) => (
            <button
              key={view.id}
              onClick={() => setModelingViewMode(view.id)}
              className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                modelingViewMode === view.id
                  ? "border-accent-blue bg-accent-blue/10 text-text-primary"
                  : "border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover"
              }`}
            >
              <div className="text-[11px] font-semibold">{view.label}</div>
              <div className="text-[10px] text-text-muted mt-1 leading-snug">{view.description}</div>
            </button>
          ))}
        </div>
        <div className="text-[11px] text-text-muted mt-2">
          Model kind: <span className="font-medium text-text-secondary">{modelKind}</span>
        </div>
      </PanelSection>

      {modelKind === "logical" && (
        <PanelSection title="Logical Readiness" icon={<KeyRound size={11} />}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
              Entities: {entities.length}
            </div>
            <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
              Candidate keys: {entities.reduce((n, e) => n + (Array.isArray(e.candidate_keys) ? e.candidate_keys.length : 0), 0)}
            </div>
            <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
              Business keys: {entities.reduce((n, e) => n + (Array.isArray(e.business_keys) ? e.business_keys.length : 0), 0)}
            </div>
            <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
              Subtypes: {entities.filter((e) => e.subtype_of).length}
            </div>
          </div>
        </PanelSection>
      )}

      {modelKind === "logical" && (
        <PanelSection title="Generate dbt Model" icon={<Database size={11} />}>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <input
                value={targetDomain}
                onChange={(e) => setTargetDomain(e.target.value)}
                placeholder="domain"
                className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
                disabled={!canEdit}
              />
              <input
                value={targetModelName}
                onChange={(e) => setTargetModelName(e.target.value)}
                placeholder="dbt_model_name"
                className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
                disabled={!canEdit}
              />
              <select
                value={materialization}
                onChange={(e) => setMaterialization(e.target.value)}
                className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
                disabled={!canEdit}
              >
                <option value="view">view</option>
                <option value="table">table</option>
                <option value="incremental">incremental</option>
              </select>
            </div>
            <textarea
              value={logicSql}
              onChange={(e) => setLogicSql(e.target.value)}
              rows={5}
              placeholder="select ..."
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue font-mono"
              disabled={!canEdit}
            />
            <button
              onClick={generateDbtFromLogical}
              disabled={!canEdit || !targetModelName.trim()}
              className="w-full px-3 py-2 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Generate dbt SQL/YAML
            </button>
            <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
              Output path: DataLex/Generated/dbt/{targetDomain || "core"}/{targetModelName || "model"}.sql and .yml
            </div>
          </div>
        </PanelSection>
      )}

      {modelKind === "physical" && (
        <PanelSection title="Physical Readiness" icon={<Database size={11} />}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
              Tables: {entities.length}
            </div>
            <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
              Columns: {entities.reduce((n, e) => n + ((e.fields || []).length), 0)}
            </div>
            <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
              Constraints: {(model?.relationships || []).length}
            </div>
          </div>
        </PanelSection>
      )}

      {modelKind === "physical" && activeIsDiagram && (
        <PanelSection title="dbt-first Physical Flow" icon={<Database size={11} />}>
          <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
            Drag dbt model or source YAML from Explorer onto the canvas, then add physical relationships and constraints in this diagram.
          </div>
        </PanelSection>
      )}

      <PanelSection title="Palette" icon={<Shapes size={11} />}>
        <div className="grid grid-cols-2 gap-2">
          {entityOptions.map((type) => (
            <button
              key={type}
              onClick={() => setEntityType(type)}
              className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                entityType === type
                  ? "border-accent-blue bg-accent-blue/10"
                  : "border-border-primary hover:bg-bg-hover"
              }`}
            >
              <div className="text-[11px] font-semibold text-text-primary">{ENTITY_TYPES[type]?.label || type}</div>
              <div className="text-[10px] text-text-muted">{ENTITY_TYPES[type]?.family}</div>
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Quick Create" icon={<Boxes size={11} />}>
        <div className="space-y-2">
          <input
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            placeholder="Entity name"
            className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
            disabled={!canEdit}
          />
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
            disabled={!canEdit}
          >
            {entityOptions.map((type) => (
              <option key={type} value={type}>{ENTITY_TYPES[type]?.label || type}</option>
            ))}
          </select>
          <input
            value={entitySubjectArea}
            onChange={(e) => setEntitySubjectArea(e.target.value)}
            list="subject-area-options"
            placeholder="Subject area (optional)"
            className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
            disabled={!canEdit}
          />
          <datalist id="subject-area-options">
            {subjectAreas.map((area) => (
              <option key={area.name} value={area.name} />
            ))}
          </datalist>
          <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
            {ENTITY_TYPES[entityType]?.description}
          </div>
          <button
            onClick={handleCreateEntity}
            disabled={!canEdit}
            className="w-full px-3 py-2 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Add {ENTITY_TYPES[entityType]?.label || entityType}
          </button>
        </div>
      </PanelSection>

      <PanelSection title="Relationship Tool" icon={<ArrowRightLeft size={11} />}>
        <div className="space-y-2">
          <input
            value={relationshipName}
            onChange={(e) => setRelationshipName(e.target.value)}
            placeholder="Relationship name (optional)"
            className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
            disabled={!canEdit}
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={fromEntity} onChange={(e) => setFromEntity(e.target.value)} className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
              {entities.map((entity) => <option key={entity.name} value={entity.name}>{entity.name}</option>)}
            </select>
            <select value={fromField} onChange={(e) => setFromField(e.target.value)} className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
              {fromEntityFields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
            </select>
            <select value={toEntity} onChange={(e) => setToEntity(e.target.value)} className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
              {entities.map((entity) => <option key={entity.name} value={entity.name}>{entity.name}</option>)}
            </select>
            <select value={toField} onChange={(e) => setToField(e.target.value)} className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
              {toEntityFields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
            </select>
          </div>
          <select
            value={cardinality}
            onChange={(e) => setCardinality(e.target.value)}
            className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
            disabled={!canEdit}
          >
            {CARDINALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            onClick={handleCreateRelationship}
            disabled={!canEdit || entities.length < 2}
            className="w-full px-3 py-2 rounded-md text-xs font-medium border border-border-primary text-text-secondary hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create Relationship
          </button>
        </div>
      </PanelSection>
    </PanelFrame>
  );
}
