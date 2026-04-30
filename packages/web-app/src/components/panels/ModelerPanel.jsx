import React, { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, ArrowRightLeft, Shapes, Layers3, Wand2, Plus, Info, KeyRound, Database, Braces, FileCode2, Plug, X as XIcon, Eye, EyeOff, BookOpen } from "lucide-react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { addEntityWithOptions, addRelationship } from "../../lib/yamlRoundTrip";
import {
  addDiagramRelationship,
  addInlineDiagramEntity,
  setEntityDescription,
  setEntityOwner,
  setEntityDomain,
  setEntitySubjectArea,
  setEntityTags,
  setEntityTerms,
  setEntityVisibility,
} from "../../design/yamlPatch";
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
  // EventStorming family — colors and vocabulary borrowed verbatim
  // from the Brandolini canon. Useful when the conceptual model needs
  // to capture *behavior* (events + commands + actors + policies)
  // alongside *structure* (concepts).
  event:     { label: "Event",     family: "EventStorming", description: "A domain event that happened (orange sticky). Past tense: \"Order Placed\"." },
  command:   { label: "Command",   family: "EventStorming", description: "An actor's intent before the event (blue sticky). Imperative: \"Place Order\"." },
  actor:     { label: "Actor",     family: "EventStorming", description: "A person, role, or external system that issues commands (yellow sticky)." },
  policy:    { label: "Policy",    family: "EventStorming", description: "A rule that reacts to events and may issue further commands (pink sticky)." },
  aggregate: { label: "Aggregate", family: "EventStorming", description: "A consistency boundary holding the state needed to handle commands (light-yellow sticky)." },
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
  // EventStorming shapes (event/command/actor/policy/aggregate) are
  // valid on the conceptual layer alongside `concept` — they describe
  // business behavior, not warehouse structure. Logical and physical
  // layers don't surface them to keep their dropdowns focused on data
  // shape.
  if (viewMode === "conceptual") {
    return ["concept", "event", "command", "actor", "policy", "aggregate"];
  }
  if (viewMode === "logical") return ["logical_entity", "fact_table", "dimension_table", "bridge_table", "hub", "link", "satellite"];
  return ["table", "view", "materialized_view", "fact_table", "dimension_table", "bridge_table", "hub", "link", "satellite"];
}

const VISIBILITY_OPTIONS = [
  { value: "internal", label: "Internal", hint: "Stays inside the team. Skipped from OSI export." },
  { value: "shared",   label: "Shared",   hint: "Visible across teams. Included in OSI export by default." },
  { value: "public",   label: "Public",   hint: "Anyone in the org. Always included in OSI export." },
];

/* InlineField — click-to-edit single-line text input for a Build-panel
   property card. Mirrors EditableDescription's commit-on-blur /
   Enter-to-save / Esc-to-cancel UX so concept editing in the Build
   panel feels like the docs view inline edits.

   Props:
     - value:    current value (string)
     - placeholder: shown when empty / not editing
     - onSave:   (next) => void; called when user commits a different value
     - readOnly: render the value but don't allow edits
*/
function InlineField({ value = "", placeholder = "Click to add", onSave, readOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, [editing]);
  const commit = () => {
    const trimmed = String(draft || "").trim();
    if (trimmed !== String(value || "").trim()) onSave?.(trimmed);
    setEditing(false);
  };
  const cancel = () => { setDraft(value || ""); setEditing(false); };

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        className="panel-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        style={{ width: "100%", fontSize: 12, padding: "3px 6px" }}
      />
    );
  }
  const display = String(value || "").trim();
  return (
    <button
      type="button"
      onClick={() => !readOnly && setEditing(true)}
      disabled={readOnly}
      title={readOnly ? "Read-only" : "Click to edit"}
      style={{
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "3px 0",
        cursor: readOnly ? "default" : "text",
        fontSize: 12,
        color: display ? "var(--text-primary)" : "var(--text-tertiary)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontStyle: display ? "normal" : "italic",
      }}
    >
      {display || placeholder}
    </button>
  );
}

/* InlineTextArea — multi-line click-to-edit for the Definition card. */
function InlineTextArea({ value = "", placeholder = "No business definition yet — click to add.", onSave, readOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, [editing]);
  const commit = () => {
    const trimmed = String(draft || "").trim();
    if (trimmed !== String(value || "").trim()) onSave?.(trimmed);
    setEditing(false);
  };
  const cancel = () => { setDraft(value || ""); setEditing(false); };

  if (editing) {
    return (
      <textarea
        ref={ref}
        className="panel-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        rows={3}
        style={{ width: "100%", fontSize: 12, padding: "6px 8px", lineHeight: 1.5, resize: "vertical" }}
      />
    );
  }
  const display = String(value || "").trim();
  return (
    <button
      type="button"
      onClick={() => !readOnly && setEditing(true)}
      disabled={readOnly}
      title={readOnly ? "Read-only" : "Click to edit (⌘/Ctrl+Enter to save)"}
      style={{
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "3px 0",
        cursor: readOnly ? "default" : "text",
        fontSize: 12,
        lineHeight: 1.45,
        color: display ? "var(--text-secondary)" : "var(--text-tertiary)",
        whiteSpace: "pre-wrap",
        fontStyle: display ? "normal" : "italic",
      }}
    >
      {display || placeholder}
    </button>
  );
}

/* TagsField — chip-style multi-value editor. Adds on Enter, removes on
   chip-X click. Empty string → field deleted from YAML. */
function TagsField({ value = [], onSave, readOnly = false }) {
  const [draft, setDraft] = useState("");
  const tags = Array.isArray(value) ? value : [];
  const addTag = (raw) => {
    const cleaned = String(raw || "").trim();
    if (!cleaned) return;
    if (tags.includes(cleaned)) { setDraft(""); return; }
    onSave?.([...tags, cleaned]);
    setDraft("");
  };
  const removeTag = (idx) => {
    const next = tags.filter((_, i) => i !== idx);
    onSave?.(next);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
      {tags.map((tag, idx) => (
        <span
          key={`${tag}-${idx}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "1px 6px",
            borderRadius: 999,
            background: "rgba(34,197,94,0.16)",
            color: "var(--text-primary)",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {tag}
          {!readOnly && (
            <button
              type="button"
              onClick={() => removeTag(idx)}
              title={`Remove ${tag}`}
              style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 0, lineHeight: 0 }}
            >
              <XIcon size={10} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(draft);
            } else if (e.key === "Backspace" && !draft && tags.length) {
              e.preventDefault();
              removeTag(tags.length - 1);
            }
          }}
          onBlur={() => addTag(draft)}
          placeholder={tags.length ? "Add tag…" : "tag, another-tag"}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--text-primary)",
            fontSize: 11,
            padding: "1px 2px",
            minWidth: 80,
            flex: 1,
          }}
        />
      )}
    </div>
  );
}

/* TermsField — like TagsField but every term is clickable. Clicking
   a term jumps the user to the Dictionary tab so they can read the
   glossary entry that matches. The Dictionary panel computes which
   entities reference each term, closing the loop both ways. */
function TermsField({ value = [], onSave, onJumpToTerm, readOnly = false }) {
  const [draft, setDraft] = useState("");
  const terms = Array.isArray(value) ? value : [];
  const addTerm = (raw) => {
    const cleaned = String(raw || "").trim();
    if (!cleaned) return;
    if (terms.includes(cleaned)) { setDraft(""); return; }
    onSave?.([...terms, cleaned]);
    setDraft("");
  };
  const removeTerm = (idx) => {
    const next = terms.filter((_, i) => i !== idx);
    onSave?.(next);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
      {terms.map((term, idx) => (
        <span
          key={`${term}-${idx}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "1px 4px 1px 7px",
            borderRadius: 999,
            background: "rgba(168,85,247,0.16)",
            border: "1px solid rgba(168,85,247,0.4)",
            color: "var(--text-primary)",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <button
            type="button"
            onClick={() => onJumpToTerm?.(term)}
            title={`Open the glossary entry for ${term}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "inherit",
              fontSize: "inherit",
              fontWeight: "inherit",
            }}
          >
            <BookOpen size={10} />
            {term}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => removeTerm(idx)}
              title={`Remove ${term}`}
              style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 0, lineHeight: 0 }}
            >
              <XIcon size={10} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTerm(draft);
            } else if (e.key === "Backspace" && !draft && terms.length) {
              e.preventDefault();
              removeTerm(terms.length - 1);
            }
          }}
          onBlur={() => addTerm(draft)}
          placeholder={terms.length ? "Add term…" : "customer_id, email, …"}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--text-primary)",
            fontSize: 11,
            padding: "1px 2px",
            minWidth: 100,
            flex: 1,
          }}
        />
      )}
    </div>
  );
}

/* PropertyCard — common chrome for one editable field in the Selected
   Concept block. */
function PropertyCard({ label, hint, fullWidth = false, children }) {
  return (
    <div
      style={{
        gridColumn: fullWidth ? "1 / -1" : "auto",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        padding: "8px 10px",
        background: "var(--bg-1)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>{label}</div>
        {hint && (
          <span style={{ fontSize: 9, color: "var(--text-tertiary)", opacity: 0.7 }} title={hint}>
            <Info size={10} />
          </span>
        )}
      </div>
      <div style={{ marginTop: 3 }}>{children}</div>
    </div>
  );
}

export default function ModelerPanel() {
  const { activeFile, activeFileContent, updateContent, createNewFile, projectFiles } = useWorkspaceStore();
  const {
    model,
    selectedEntity,
    selectEntity,
    modelingViewMode,
    setModelingViewMode,
    requestLayoutRefresh,
  } = useDiagramStore();
  const { addToast, openModal } = useUiStore();
  const setBottomPanelTab = useUiStore((s) => s.setBottomPanelTab);
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();

  const modelKind = model?.model?.layer || model?.model?.kind || "physical";
  const activeLayer = ["conceptual", "logical", "physical"].includes(String(modelKind || "").toLowerCase())
    ? String(modelKind || "").toLowerCase()
    : modelingViewMode;
  const entities = Array.isArray(model?.entities) ? model.entities : [];
  const subjectAreas = Array.isArray(model?.subject_areas) ? model.subject_areas : [];
  const entityOptions = useMemo(() => allowedTypes(activeLayer), [activeLayer]);

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
    const nextType = defaultEntityType(activeLayer, modelKind);
    setEntityType((current) => (allowedTypes(activeLayer).includes(current) ? current : nextType));
  }, [activeLayer, modelKind]);

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
      <PanelFrame icon={<Wand2 size={14} />} eyebrow="Build" title="Build">
        <PanelEmpty
          icon={Wand2}
          title="No model open"
          description="Build is the create/edit surface — once you open a DataLex model you can add entities, relationships, and (on the physical layer) generate dbt targets without hand-editing YAML."
        />
      </PanelFrame>
    );
  }

  const activeIsDiagram = /\.diagram\.ya?ml$/i.test(activeFile?.name || activeFile?.path || "");
  const hasWorkspaceFiles = (projectFiles || []).length > 0;

  /* handleCreateEntity used to live below all the layer-specific
     returns; moved up here so the conceptual quick-add form (which
     calls it from its onSubmit) doesn't hit the temporal dead zone. */
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

  if (modelKind === "conceptual") {
    const relationshipCount = Array.isArray(model?.relationships) ? model.relationships.length : 0;
    return (
      <PanelFrame
        icon={<Wand2 size={14} />}
        eyebrow="Build · Conceptual"
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
          <div style={{ display: "grid", gap: 10 }}>
            {/* Inline quick-add — no dialog round-trip. Type a name + Enter
                and the concept lands on the canvas with sensible defaults
                (type: concept, domain inherited from the active model).
                For richer fields the "More options" link still opens the
                full dialog. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const cleanName = entityName.trim();
                if (!cleanName) return;
                handleCreateEntity();
              }}
              style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
            >
              <input
                type="text"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                placeholder="New concept name (e.g. Customer)"
                disabled={!canEdit}
                aria-label="Quick add concept name"
                style={{
                  flex: "1 1 200px",
                  minWidth: 0,
                  padding: "6px 8px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-1)",
                  color: "var(--text-primary)",
                }}
              />
              <button
                type="submit"
                className="panel-btn primary"
                disabled={!canEdit || !entityName.trim()}
                title="Add concept (Enter)"
              >
                <Plus size={12} /> Add
              </button>
              <button
                type="button"
                className="panel-btn"
                disabled={!canEdit}
                onClick={() => openModal("newConcept")}
                title="Open the full new-concept dialog with all options"
              >
                More options…
              </button>
            </form>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
          </div>
        </PanelSection>

        <PanelSection title="Selected Concept" icon={<Info size={11} />}>
          {selectedEntity ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              <PropertyCard label="Name">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedEntity.logical_name || selectedEntity.name}
                </div>
              </PropertyCard>
              <PropertyCard label="Domain" hint="Bounded context this concept belongs to (DDD-style).">
                <InlineField
                  value={selectedEntity.domain || ""}
                  placeholder="unassigned"
                  readOnly={!canEdit}
                  onSave={(next) => {
                    const out = setEntityDomain(activeFileContent, selectedEntity.name, next);
                    if (out) updateContent(out);
                  }}
                />
              </PropertyCard>
              <PropertyCard label="Owner" hint="Team or person who owns this concept end-to-end.">
                <InlineField
                  value={selectedEntity.owner || ""}
                  placeholder="unassigned"
                  readOnly={!canEdit}
                  onSave={(next) => {
                    const out = setEntityOwner(activeFileContent, selectedEntity.name, next);
                    if (out) updateContent(out);
                  }}
                />
              </PropertyCard>
              <PropertyCard label="Subject area" hint="Higher-level grouping for capability mapping.">
                <InlineField
                  value={selectedEntity.subject_area || ""}
                  placeholder="unassigned"
                  readOnly={!canEdit}
                  onSave={(next) => {
                    const out = setEntitySubjectArea(activeFileContent, selectedEntity.name, next);
                    if (out) updateContent(out);
                  }}
                />
              </PropertyCard>

              <PropertyCard label="Tags" fullWidth>
                <TagsField
                  value={selectedEntity.tags || []}
                  readOnly={!canEdit}
                  onSave={(nextTags) => {
                    const out = setEntityTags(activeFileContent, selectedEntity.name, nextTags);
                    if (out) updateContent(out);
                  }}
                />
              </PropertyCard>

              <PropertyCard label="Glossary terms" fullWidth hint="Names of glossary entries this concept owns or references. Click a chip to jump to the Dictionary.">
                <TermsField
                  value={selectedEntity.terms || []}
                  readOnly={!canEdit}
                  onSave={(nextTerms) => {
                    const out = setEntityTerms(activeFileContent, selectedEntity.name, nextTerms);
                    if (out) updateContent(out);
                  }}
                  onJumpToTerm={() => setBottomPanelTab("dictionary")}
                />
              </PropertyCard>

              <PropertyCard
                label="Visibility"
                fullWidth
                hint="Reserved for OSI export (Phase 2a). 'internal' stays in the team; 'shared' and 'public' are surfaced to AI agents."
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  {VISIBILITY_OPTIONS.map((opt) => {
                    const current = selectedEntity.visibility || "shared";
                    const isActive = current === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={!canEdit}
                        title={opt.hint}
                        onClick={() => {
                          const out = setEntityVisibility(activeFileContent, selectedEntity.name, opt.value);
                          if (out) updateContent(out);
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: `1px solid ${isActive ? "var(--accent, #3b82f6)" : "var(--border-default)"}`,
                          background: isActive ? "rgba(59,130,246,0.14)" : "transparent",
                          color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: canEdit ? "pointer" : "not-allowed",
                        }}
                      >
                        {opt.value === "internal" ? <EyeOff size={10} /> : <Eye size={10} />}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </PropertyCard>

              <PropertyCard label="Definition" fullWidth>
                <InlineTextArea
                  value={selectedEntity.description || ""}
                  readOnly={!canEdit}
                  onSave={(next) => {
                    const out = setEntityDescription(activeFileContent, selectedEntity.name, next);
                    if (out) updateContent(out);
                  }}
                />
              </PropertyCard>
            </div>
          ) : (
            <PanelEmpty icon={Boxes} title="No concept selected" description="Select a concept on the canvas to inspect and edit its business details here." />
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

  if (modelKind === "logical") {
    const relationshipCount = Array.isArray(model?.relationships) ? model.relationships.length : 0;
    return (
      <PanelFrame
        icon={<Wand2 size={14} />}
        eyebrow="Build · Logical"
        title="Logical Model"
        subtitle={`${entities.length} ${entities.length === 1 ? "entity" : "entities"} · ${relationshipCount} relationships`}
      >
        <PanelSection title="Process" icon={<Layers3 size={11} />}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {[
              ["1", "Shape", "Define logical entities, attributes, and naming before warehouse-specific modeling."],
              ["2", "Key", "Capture candidate keys, business keys, and inheritance for reusable business structure."],
              ["3", "Relate", "Connect entities with logical relationships, role names, and cardinality."],
            ].map(([n, title, text]) => (
              <div key={n} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: 10, background: "var(--bg-1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>
                  <span style={{ width: 18, height: 18, borderRadius: 999, display: "inline-grid", placeItems: "center", background: "rgba(8,145,178,0.14)", color: "#06b6d4", fontFamily: "var(--font-mono)" }}>{n}</span>
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
              onClick={() => openModal("newLogicalEntity")}
            >
              <Plus size={12} /> Add Logical Entity
            </button>
            <button
              className="panel-btn"
              disabled={!canEdit || entities.length < 2}
              onClick={() => openModal("newRelationship", {
                modelKind: "logical",
                tables: entities.map((entity) => ({ id: entity.name, name: entity.name, columns: [] })),
                fromEntity: entities[0]?.name || "",
                toEntity: entities[1]?.name || "",
              })}
            >
              <ArrowRightLeft size={12} /> Add Relationship
            </button>
          </div>
        </PanelSection>

        <PanelSection title="Selected Entity" icon={<Info size={11} />}>
          {selectedEntity ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              {[
                ["Name", selectedEntity.logical_name || selectedEntity.name],
                ["Subject area", selectedEntity.subject_area || selectedEntity.domain || "unassigned"],
                ["Candidate keys", String(Array.isArray(selectedEntity.candidate_keys) ? selectedEntity.candidate_keys.length : 0)],
                ["Business keys", String(Array.isArray(selectedEntity.business_keys) ? selectedEntity.business_keys.length : 0)],
              ].map(([label, value]) => (
                <div key={label} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-1)", minWidth: 0 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>{label}</div>
                  <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
                </div>
              ))}
              <div style={{ gridColumn: "1 / -1", border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-1)" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>Description</div>
                <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.45, color: "var(--text-secondary)" }}>
                  {selectedEntity.description || "No logical description yet. Select the entity and edit it in Details."}
                </div>
              </div>
            </div>
          ) : (
            <PanelEmpty icon={Boxes} title="No logical entity selected" description="Select a logical entity on the canvas to review its structure here." />
          )}
        </PanelSection>

        <PanelSection title="Logical Inventory" icon={<Boxes size={11} />}>
          {entities.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {entities.map((entity) => (
                <button
                  key={entity.name}
                  type="button"
                  onClick={() => selectEntity(entity.name)}
                  style={{
                    textAlign: "left",
                    border: `1px solid ${selectedEntity?.name === entity.name ? "#06b6d4" : "var(--border-default)"}`,
                    borderRadius: 8,
                    padding: 10,
                    background: selectedEntity?.name === entity.name ? "rgba(8,145,178,0.10)" : "var(--bg-1)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{entity.logical_name || entity.name}</div>
                  <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-tertiary)" }}>
                    {(entity.fields || []).length} attributes · {(entity.candidate_keys || []).length} key set(s)
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <PanelEmpty icon={Boxes} title="No logical entities" description="Use Add Logical Entity to start shaping the logical model." />
          )}
        </PanelSection>
      </PanelFrame>
    );
  }

  if (modelKind === "physical") {
    const relationshipCount = Array.isArray(model?.relationships) ? model.relationships.length : 0;
    const selectedPhysical = selectedEntity || null;
    const selectedPhysicalFields = Array.isArray(selectedPhysical?.fields)
      ? selectedPhysical.fields
      : Array.isArray(selectedPhysical?.columns)
        ? selectedPhysical.columns
        : [];
    const selectedPkCount = selectedPhysicalFields.filter((field) => field?.pk || field?.primary_key).length;
    const selectedFkCount = selectedPhysicalFields.filter((field) => field?.fk || field?.semanticFk || field?.foreign_key).length;
    const dbtBackedCount = entities.filter((entity) => entity?._sourceFile).length;
    return (
      <PanelFrame
        icon={<Wand2 size={14} />}
        eyebrow="Build · Physical"
        title="dbt-backed Physical Model"
        subtitle={`${entities.length} ${entities.length === 1 ? "object" : "objects"} · ${relationshipCount} relationships`}
      >
        <PanelSection title="Process" icon={<Layers3 size={11} />}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {[
              ["1", "Load", "Bring dbt model/source YAML into the diagram from Explorer or import a dbt repo first."],
              ["2", "Relate", "Create physical relationships, constraint intent, and warehouse-facing structure."],
              ["3", "Ship", "Review dbt YAML, inspect SQL preview, then export or apply forward-engineered SQL."],
            ].map(([n, title, text]) => (
              <div key={n} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: 10, background: "var(--bg-1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>
                  <span style={{ width: 18, height: 18, borderRadius: 999, display: "inline-grid", placeItems: "center", background: "rgba(79,70,229,0.14)", color: "#8b7fff", fontFamily: "var(--font-mono)" }}>{n}</span>
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
              onClick={() => openModal(activeIsDiagram && hasWorkspaceFiles ? "dbtYamlPicker" : "importDbtRepo")}
            >
              <Braces size={12} /> Add dbt YAML
            </button>
            <button
              className="panel-btn"
              disabled={!canEdit}
              onClick={() => openModal("importDbtRepo")}
            >
              <Plus size={12} /> Import dbt repo
            </button>
            <button
              className="panel-btn"
              disabled={!canEdit}
              onClick={() => openModal("connectors")}
            >
              <Plug size={12} /> Database Connections
            </button>
            <button
              className="panel-btn"
              disabled={!canEdit || entities.length < 2}
              onClick={() => openModal("newRelationship", {
                modelKind: "physical",
                tables: entities.map((entity) => ({
                  id: entity.name,
                  name: entity.name,
                  columns: Array.isArray(entity.fields) ? entity.fields : [],
                })),
                fromEntity: entities[0]?.name || "",
                toEntity: entities[1]?.name || "",
              })}
            >
              <ArrowRightLeft size={12} /> Add Relationship
            </button>
            <button
              className="panel-btn"
              onClick={() => setBottomPanelTab("dbt")}
            >
              <Braces size={12} /> Open dbt YAML
            </button>
            <button
              className="panel-btn"
              onClick={() => setBottomPanelTab("sql")}
            >
              <FileCode2 size={12} /> Open SQL Preview
            </button>
          </div>
        </PanelSection>

        <PanelSection title="Physical Readiness" icon={<Database size={11} />}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            {[
              ["Objects", String(entities.length)],
              ["dbt-backed", String(dbtBackedCount)],
              ["Relationships", String(relationshipCount)],
              ["Diagram file", activeIsDiagram ? "yes" : "no"],
            ].map(([label, value]) => (
              <div key={label} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-1)", minWidth: 0 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>{label}</div>
                <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
              </div>
            ))}
          </div>
          {activeIsDiagram && entities.length === 0 && (
            <div style={{ marginTop: 10, border: "1px solid var(--border-default)", borderRadius: 8, padding: "10px 12px", background: "var(--bg-1)", fontSize: 11, lineHeight: 1.5, color: "var(--text-secondary)" }}>
              This physical diagram is empty. Import a dbt repo or drag dbt model/source YAML from Explorer into the canvas to start building a true physical model.
            </div>
          )}
        </PanelSection>

        <PanelSection title="Selected Object" icon={<Info size={11} />}>
          {selectedPhysical ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              {[
                ["Name", selectedPhysical.logical_name || selectedPhysical.name],
                ["Source", selectedPhysical._sourceFile ? selectedPhysical._sourceFile.split("/").pop() : "diagram-only"],
                ["Columns", String(selectedPhysicalFields.length)],
                ["Relationships", String(relationshipCount)],
              ].map(([label, value]) => (
                <div key={label} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-1)", minWidth: 0 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>{label}</div>
                  <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
                </div>
              ))}
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="status-pill tone-accent">{selectedPkCount} PK</span>
                <span className="status-pill tone-warning">{selectedFkCount} FK</span>
                <span className="status-pill tone-info">{selectedPhysicalFields.filter((field) => field?.nn).length} NOT NULL</span>
                <span className="status-pill tone-success">{selectedPhysicalFields.filter((field) => field?.unique).length} UNIQUE</span>
              </div>
            </div>
          ) : (
            <PanelEmpty icon={Boxes} title="No physical object selected" description="Select a dbt-backed table or view on the canvas to inspect its physical details here." />
          )}
        </PanelSection>

        <PanelSection title="Diagram Inventory" icon={<Boxes size={11} />}>
          {entities.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {entities.map((entity) => {
                const fieldCount = Array.isArray(entity.fields) ? entity.fields.length : 0;
                return (
                  <button
                    key={entity.name}
                    type="button"
                    onClick={() => selectEntity(entity.name)}
                    style={{
                      textAlign: "left",
                      border: `1px solid ${selectedPhysical?.name === entity.name ? "#8b7fff" : "var(--border-default)"}`,
                      borderRadius: 8,
                      padding: 10,
                      background: selectedPhysical?.name === entity.name ? "rgba(79,70,229,0.10)" : "var(--bg-1)",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{entity.logical_name || entity.name}</div>
                    <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-tertiary)" }}>
                      {fieldCount} columns · {entity._sourceFile ? entity._sourceFile.split("/").pop() : "diagram-only"}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <PanelEmpty icon={Boxes} title="No physical objects" description="Import dbt YAML or drag dbt files from Explorer onto the canvas to populate this physical diagram." />
          )}
        </PanelSection>
      </PanelFrame>
    );
  }

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
    const base = `DataLex/${domainSlug}/Generated/dbt`;
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
              onClick={() => {
                setModelingViewMode(view.id);
                if (view.id !== activeLayer) {
                  openModal("newFile", {
                    layerHint: view.id,
                    artifact: "diagram",
                    domainHint: model?.domain || "core",
                  });
                }
              }}
              className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                activeLayer === view.id
                  ? "border-accent-blue bg-accent-blue/10 text-text-primary"
                  : "border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover"
              }`}
              title={activeLayer === view.id ? `Current ${view.label.toLowerCase()} diagram` : `Create or open a ${view.label.toLowerCase()} diagram`}
            >
              <div className="text-[11px] font-semibold">{view.label}</div>
              <div className="text-[10px] text-text-muted mt-1 leading-snug">{view.description}</div>
            </button>
          ))}
        </div>
        <div className="text-[11px] text-text-muted mt-2">
          Active layer: <span className="font-medium text-text-secondary">{activeLayer}</span>
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
              Output path: DataLex/{targetDomain || "core"}/Generated/dbt/{targetModelName || "model"}.sql and .yml
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
