import React, { useEffect, useMemo, useState } from "react";
import { Boxes, ArrowRightLeft, Shapes, Layers3, Wand2, Sparkles, MousePointerClick, PencilLine } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { addEntityWithOptions, addRelationship } from "../../lib/yamlRoundTrip";
import { transformActiveModel } from "../../lib/api";
import { PanelFrame, PanelSection, PanelEmpty, PanelCard, StatusPill } from "./PanelFrame";

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

function sanitizePathSegment(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || fallback;
}

function layeredModelPath({ layer, domain, fileName, dialect }) {
  const safeLayer = sanitizePathSegment(layer, "logical");
  const safeDomain = sanitizePathSegment(domain, "shared");
  const safeName = sanitizePathSegment(fileName, "untitled");
  if (safeLayer === "physical") {
    return `models/physical/${sanitizePathSegment(dialect, "postgres")}/${safeDomain}/${safeName}.model.yaml`;
  }
  return `models/${safeLayer}/${safeDomain}/${safeName}.model.yaml`;
}

export default function ModelerPanel() {
  const { activeFile, activeFileContent, updateContent, createNewFile } = useWorkspaceStore();
  const {
    model,
    modelingViewMode,
    setModelingViewMode,
    requestLayoutRefresh,
  } = useDiagramStore();
  const { addToast, setRightPanelOpen, setRightPanelTab } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();

  const modelKind = model?.model?.kind || "physical";
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
  const [promoting, setPromoting] = useState(false);

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
  const conceptualMode = modelingViewMode === "conceptual" || modelKind === "conceptual";
  const selectedEntity = entities.find((entity) => entity.name === fromEntity) || entities[0] || null;
  const panelTitle = conceptualMode ? "Concept Studio" : "Modeler";
  const panelSubtitle = conceptualMode
    ? `${entities.length} ${entities.length === 1 ? "concept" : "concepts"} · business-first`
    : `${entities.length} ${entities.length === 1 ? "entity" : "entities"} · ${modelKind}`;

  const focusConceptDetails = React.useCallback(() => {
    setRightPanelOpen(true);
    setRightPanelTab("DETAILS");
  }, [setRightPanelOpen, setRightPanelTab]);

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

  const handleCreateEntity = () => {
    if (!entityName.trim()) {
      addToast?.({ type: "error", message: "Entity name is required." });
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
    if (!fromEntity || !toEntity || (!conceptualMode && (!fromField || !toField))) {
      addToast?.({ type: "error", message: "Choose both relationship endpoints." });
      return;
    }
    const proposedName = relationshipName.trim() || `${fromEntity}_${toEntity}`.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const result = addRelationship(
      activeFileContent,
      proposedName,
      conceptualMode ? { entity: fromEntity } : `${fromEntity}.${fromField}`,
      conceptualMode ? { entity: toEntity } : `${toEntity}.${toField}`,
      cardinality,
    );
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    requestLayoutRefresh();
    setRelationshipName("");
    addToast?.({ type: "success", message: `Added relationship ${proposedName}.` });
  };

  const handlePromote = async (targetLayer) => {
    if (!activeFileContent) {
      addToast?.({ type: "error", message: "Open a model file first." });
      return;
    }
    const transform =
      modelKind === "conceptual" && targetLayer === "logical"
        ? "conceptual-to-logical"
        : modelKind === "logical" && targetLayer === "physical"
          ? "logical-to-physical"
          : modelKind === "conceptual" && targetLayer === "physical"
            ? "conceptual-to-physical"
            : "";
    if (!transform) {
      addToast?.({ type: "info", message: `No promotion path from ${modelKind} to ${targetLayer}.` });
      return;
    }
    setPromoting(true);
    try {
      const response = await transformActiveModel({
        modelContent: activeFileContent,
        modelPath: activeFile?.fullPath || "",
        transform,
      });
      const targetPath = layeredModelPath({
        layer: targetLayer,
        domain: model?.model?.domain || model?.domain || "shared",
        dialect: targetLayer === "physical" ? "postgres" : undefined,
        fileName: `${model?.model?.name || model?.name || "untitled"}_${targetLayer}`,
      });
      await createNewFile(targetPath, response?.transformedYaml || "");
      addToast?.({ type: "success", message: `Created ${targetLayer} model at ${targetPath}.` });
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || String(err) });
    } finally {
      setPromoting(false);
    }
  };

  return (
    <PanelFrame
      icon={<Wand2 size={14} />}
      eyebrow="Workspace"
      title={panelTitle}
      subtitle={panelSubtitle}
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

      {conceptualMode && (
        <PanelSection
          title="Start Here"
          icon={<Sparkles size={11} />}
          description="Conceptual modeling should feel like business architecture, not table design. Use this flow to create boxes, connect them, and then fill in meaning on the right."
        >
          <div className="grid gap-2 md:grid-cols-3">
            <PanelCard
              tone="accent"
              dense
              icon={<Boxes size={12} />}
              eyebrow="Step 1"
              title="Add Concept Box"
              subtitle="Create a new business concept on the canvas."
            >
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="accent">Name</StatusPill>
                <StatusPill tone="neutral">Type</StatusPill>
                <StatusPill tone="neutral">Subject area</StatusPill>
              </div>
            </PanelCard>
            <PanelCard
              tone="info"
              dense
              icon={<ArrowRightLeft size={12} />}
              eyebrow="Step 2"
              title="Create Relationship"
              subtitle="Draw the business link and set the relationship meaning."
            >
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="info">Verb</StatusPill>
                <StatusPill tone="neutral">Type</StatusPill>
                <StatusPill tone="neutral">1:1 / 1:N</StatusPill>
              </div>
            </PanelCard>
            <PanelCard
              tone="success"
              dense
              icon={<PencilLine size={12} />}
              eyebrow="Step 3"
              title="Edit Meaning"
              subtitle="Select a concept and complete the business metadata."
              actions={
                <button
                  onClick={focusConceptDetails}
                  className="px-2 py-1 rounded-md text-[10px] font-medium border border-border-primary text-text-secondary hover:bg-bg-hover transition-colors"
                >
                  Open Details
                </button>
              }
            >
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="success">Owner</StatusPill>
                <StatusPill tone="neutral">Description</StatusPill>
                <StatusPill tone="neutral">Terms</StatusPill>
              </div>
            </PanelCard>
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

      <PanelSection
        title={conceptualMode ? "Add Concept Box" : "Quick Create"}
        icon={<Boxes size={11} />}
        description={conceptualMode ? "This creates a new concept box on the canvas. Keep it lightweight here, then enrich description, owner, and glossary terms in the right-side Details panel." : undefined}
      >
        <div className="space-y-2">
          {conceptualMode && (
            <PanelCard
              tone="accent"
              dense
              icon={<MousePointerClick size={12} />}
              title="What happens next"
              subtitle="A new concept box appears on the canvas immediately after you click Create concept box."
            >
              Start with the concept name and subject area. Use the right-side Details panel for richer business meaning after the box exists.
            </PanelCard>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                {conceptualMode ? "Concept name" : "Entity name"}
              </span>
              <input
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                placeholder={conceptualMode ? "Customer" : "Entity name"}
                className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
                disabled={!canEdit}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                {conceptualMode ? "Concept type" : "Entity type"}
              </span>
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
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
              Subject area
            </span>
            <input
              value={entitySubjectArea}
              onChange={(e) => setEntitySubjectArea(e.target.value)}
              list="subject-area-options"
              placeholder="Customer, Orders, Billing…"
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
              disabled={!canEdit}
            />
          </label>
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
            {conceptualMode ? "Create concept box" : `Add ${ENTITY_TYPES[entityType]?.label || entityType}`}
          </button>
        </div>
      </PanelSection>

      <PanelSection
        title={conceptualMode ? "Connect Concepts" : "Relationship Tool"}
        icon={<ArrowRightLeft size={11} />}
        description={conceptualMode ? "This creates the arrow between two concept boxes. Use verb, type, and cardinality to make the business meaning explicit." : undefined}
      >
        <div className="space-y-2">
          {conceptualMode && (
            <PanelCard
              tone="info"
              dense
              icon={<ArrowRightLeft size={12} />}
              title="Relationship meaning"
              subtitle="Use relationship details for business language, not physical foreign keys."
            >
              Example: <span className="text-text-primary font-medium">Customer places Order</span> or <span className="text-text-primary font-medium">Policy produces Claim</span>.
            </PanelCard>
          )}
          <input
            value={relationshipName}
            onChange={(e) => setRelationshipName(e.target.value)}
            placeholder="Relationship name (optional)"
            className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue"
            disabled={!canEdit}
          />
          <div className={`grid gap-2 ${conceptualMode ? "md:grid-cols-3" : "grid-cols-2"}`}>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">From</span>
              <select value={fromEntity} onChange={(e) => setFromEntity(e.target.value)} className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
                {entities.map((entity) => <option key={entity.name} value={entity.name}>{entity.name}</option>)}
              </select>
            </label>
            {!conceptualMode && (
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">From field</span>
                <select value={fromField} onChange={(e) => setFromField(e.target.value)} className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
                  {fromEntityFields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
                </select>
              </label>
            )}
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">To</span>
              <select value={toEntity} onChange={(e) => setToEntity(e.target.value)} className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
                {entities.map((entity) => <option key={entity.name} value={entity.name}>{entity.name}</option>)}
              </select>
            </label>
            {!conceptualMode && (
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">To field</span>
                <select value={toField} onChange={(e) => setToField(e.target.value)} className="bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-blue" disabled={!canEdit}>
                  {toEntityFields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
                </select>
              </label>
            )}
            {conceptualMode && selectedEntity && (
              <PanelCard
                dense
                tone="neutral"
                title="Selected concept"
                subtitle={`${selectedEntity.name}${selectedEntity.subject_area ? ` · ${selectedEntity.subject_area}` : ""}`}
              >
                Choose both endpoints here, then open the right-side Relationships tab to enrich verb, rationale, and source of truth.
              </PanelCard>
            )}
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
            {conceptualMode ? "Create relationship arrow" : "Create Relationship"}
          </button>
        </div>
      </PanelSection>

      <PanelSection title="Promote" icon={<Wand2 size={11} />}>
        <div className="space-y-2">
          <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
            Promote conceptual models into logical structures, then into physical warehouse-ready models with preserved lineage.
          </div>
          {modelKind === "conceptual" && (
            <>
              <button
                onClick={() => handlePromote("logical")}
                disabled={!canEdit || promoting}
                className="w-full px-3 py-2 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {promoting ? "Promoting…" : "Promote to Logical"}
              </button>
              <button
                onClick={() => handlePromote("physical")}
                disabled={!canEdit || promoting}
                className="w-full px-3 py-2 rounded-md text-xs font-medium border border-border-primary text-text-secondary hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Promote to Physical
              </button>
            </>
          )}
          {modelKind === "logical" && (
            <button
              onClick={() => handlePromote("physical")}
              disabled={!canEdit || promoting}
              className="w-full px-3 py-2 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {promoting ? "Promoting…" : "Promote to Physical"}
            </button>
          )}
          {modelKind === "physical" && (
            <div className="rounded-lg bg-bg-primary border border-border-primary px-2 py-2 text-[10px] text-text-muted leading-snug">
              Physical models are the terminal forward-engineering layer.
            </div>
          )}
        </div>
      </PanelSection>
    </PanelFrame>
  );
}
