import React, { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import { Boxes, FileText, KeyRound, ListOrdered } from "lucide-react";
import Modal from "./Modal";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import { addInlineDiagramEntity } from "../../design/yamlPatch";
import { emitJourneyEvent } from "../../lib/onboardingJourney";

const LOGICAL_ENTITY_TYPES = [
  { id: "logical_entity", label: "Logical Entity" },
  { id: "fact_table", label: "Fact" },
  { id: "dimension_table", label: "Dimension" },
  { id: "bridge_table", label: "Bridge" },
  { id: "hub", label: "Hub" },
  { id: "link", label: "Link" },
  { id: "satellite", label: "Satellite" },
];

function slugify(value) {
  return String(value || "entity")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "entity";
}

function defaultAttributes(type, name) {
  const stem = slugify(name);
  if (type === "fact_table") return `${stem}_id: identifier\noccurred_at: timestamp\namount: decimal(12,2)`;
  if (type === "dimension_table") return `${stem}_sk: identifier\n${stem}_code: string\n${stem}_name: string`;
  if (type === "bridge_table") return `left_entity_id: identifier\nright_entity_id: identifier`;
  if (type === "hub") return `${stem}_hk: identifier\n${stem}_id: string\nloaded_at: timestamp`;
  if (type === "link") return `${stem}_hk: identifier\nleft_hk: identifier\nright_hk: identifier`;
  if (type === "satellite") return `parent_hk: identifier\ndescriptive_attr: string\nloaded_at: timestamp`;
  return `${stem}_id: identifier\n${stem}_name: string`;
}

function defaultCandidateKeys(type, name) {
  const stem = slugify(name);
  if (type === "hub") return `${stem}_id`;
  if (type === "dimension_table") return `${stem}_code`;
  return `${stem}_id`;
}

function defaultBusinessKeys(type, name) {
  const stem = slugify(name);
  if (type === "hub") return `${stem}_id`;
  return "";
}

function parseAttributes(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [rawName, rawType] = line.split(":");
      const fieldName = String(rawName || "").trim();
      const fieldType = String(rawType || "string").trim() || "string";
      if (!fieldName) return null;
      return {
        name: fieldName,
        type: fieldType,
        nullable: index !== 0,
      };
    })
    .filter(Boolean);
}

function parseKeySets(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((item) => item.trim()).filter(Boolean))
    .filter((set) => set.length > 0);
}

function appendLogicalEntityToModel(yamlText, entity) {
  let doc;
  try {
    doc = yaml.load(yamlText);
  } catch (_err) {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  if (!Array.isArray(doc.entities)) doc.entities = [];
  const exists = doc.entities.some((entry) => String(entry?.name || "").trim().toLowerCase() === String(entity.name || "").trim().toLowerCase());
  if (exists) return yamlText;
  doc.entities.push(entity);
  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
}

export default function NewLogicalEntityDialog() {
  const { closeModal, addToast, modalPayload } = useUiStore();
  const { activeFile, activeFileContent, updateContent } = useWorkspaceStore();
  const { requestLayoutRefresh } = useDiagramStore();

  const [entityType, setEntityType] = useState("logical_entity");
  const [name, setName] = useState("New Logical Entity");
  const [subjectArea, setSubjectArea] = useState(String(modalPayload?.subjectAreaHint || ""));
  const [description, setDescription] = useState("");
  const [attributesText, setAttributesText] = useState(defaultAttributes("logical_entity", "New Logical Entity"));
  const [candidateKeysText, setCandidateKeysText] = useState(defaultCandidateKeys("logical_entity", "New Logical Entity"));
  const [businessKeysText, setBusinessKeysText] = useState(defaultBusinessKeys("logical_entity", "New Logical Entity"));
  const [subtypeOf, setSubtypeOf] = useState("");
  const [error, setError] = useState("");

  const targetX = Number.isFinite(Number(modalPayload?.x)) ? Number(modalPayload.x) : undefined;
  const targetY = Number.isFinite(Number(modalPayload?.y)) ? Number(modalPayload.y) : undefined;
  const activeIsDiagram = /\.diagram\.ya?ml$/i.test(activeFile?.name || activeFile?.path || "");

  useEffect(() => {
    setAttributesText(defaultAttributes(entityType, name));
    setCandidateKeysText(defaultCandidateKeys(entityType, name));
    setBusinessKeysText(defaultBusinessKeys(entityType, name));
  }, [entityType, name]);

  const previewFields = useMemo(() => parseAttributes(attributesText), [attributesText]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const cleanName = String(name || "").trim();
    if (!activeFile || !activeFileContent) {
      setError("Open a logical file or logical diagram first.");
      return;
    }
    if (!cleanName) {
      setError("Entity name is required.");
      return;
    }

    const entity = {
      name: cleanName,
      type: entityType,
      logical_name: cleanName,
      description: String(description || "").trim(),
      subject_area: String(subjectArea || "").trim() || undefined,
      domain: String(subjectArea || "").trim() || undefined,
      fields: previewFields.length ? previewFields : parseAttributes(defaultAttributes(entityType, cleanName)),
      candidate_keys: parseKeySets(candidateKeysText),
      business_keys: parseKeySets(businessKeysText),
      subtype_of: String(subtypeOf || "").trim() || undefined,
      x: Number.isFinite(targetX) ? targetX : 120,
      y: Number.isFinite(targetY) ? targetY : 120,
      width: 320,
    };

    const next = activeIsDiagram
      ? addInlineDiagramEntity(activeFileContent, entity)
      : appendLogicalEntityToModel(activeFileContent, entity);
    if (!next) {
      setError("Could not add this logical entity to the active file.");
      return;
    }
    if (next === activeFileContent) {
      setError(`An entity named "${cleanName}" already exists.`);
      return;
    }

    updateContent(next);
    requestLayoutRefresh?.();
    addToast({ type: "success", message: `Created logical entity "${cleanName}".` });
    emitJourneyEvent("entity:created", { kind: "logical", name: cleanName });
    closeModal();
  };

  return (
    <Modal
      icon={<Boxes size={14} />}
      title="New Logical Entity"
      subtitle="Create a logical entity with starter attributes and key intent."
      size="md"
      onClose={closeModal}
      footer={(
        <>
          <button type="button" className="canvas-btn" onClick={closeModal}>Cancel</button>
          <button
            type="submit"
            form="new-logical-entity-form"
            className="canvas-btn"
            style={{ background: "var(--accent-dim)", borderColor: "var(--accent)", color: "var(--text-primary)" }}
          >
            Create entity
          </button>
        </>
      )}
    >
      <form id="new-logical-entity-form" onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label className="dlx-modal-field-label">Entity name</label>
            <input className="panel-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="dlx-modal-field-label">Logical type</label>
              <select className="panel-input" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                {LOGICAL_ENTITY_TYPES.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="dlx-modal-field-label">Subject area</label>
              <input className="panel-input" value={subjectArea} onChange={(e) => setSubjectArea(e.target.value)} placeholder="Sales, Finance, Customer..." />
            </div>
          </div>

          <div>
            <label className="dlx-modal-field-label">Description</label>
            <textarea className="panel-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What business structure does this logical entity represent?" />
          </div>

          <div>
            <label className="dlx-modal-field-label"><FileText size={12} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />Attributes</label>
            <textarea className="panel-input" rows={5} value={attributesText} onChange={(e) => setAttributesText(e.target.value)} placeholder="account_id: identifier&#10;account_name: string" />
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-tertiary)" }}>
              One attribute per line. Format: <code>name:type</code>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="dlx-modal-field-label"><KeyRound size={12} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />Candidate keys</label>
              <textarea className="panel-input" rows={3} value={candidateKeysText} onChange={(e) => setCandidateKeysText(e.target.value)} placeholder="account_id&#10;account_code, source_system" />
            </div>
            <div>
              <label className="dlx-modal-field-label"><ListOrdered size={12} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />Business keys</label>
              <textarea className="panel-input" rows={3} value={businessKeysText} onChange={(e) => setBusinessKeysText(e.target.value)} placeholder="customer_number" />
            </div>
          </div>

          <div>
            <label className="dlx-modal-field-label">Subtype of</label>
            <input className="panel-input" value={subtypeOf} onChange={(e) => setSubtypeOf(e.target.value)} placeholder="Optional parent logical entity" />
          </div>

          <div style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: 12, background: "var(--bg-1)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>Preview</div>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {cleanName(name)} · {LOGICAL_ENTITY_TYPES.find((option) => option.id === entityType)?.label || entityType}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-tertiary)" }}>
              {previewFields.length} attributes · {parseKeySets(candidateKeysText).length} candidate key set(s)
            </div>
          </div>

          {error && (
            <div className="dlx-modal-alert">{error}</div>
          )}
        </div>
      </form>
    </Modal>
  );
}

function cleanName(value) {
  return String(value || "").trim() || "New Logical Entity";
}
