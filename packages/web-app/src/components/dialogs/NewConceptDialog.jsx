import React, { useMemo, useState } from "react";
import { Boxes, FolderTree, FileText } from "lucide-react";
import Modal from "./Modal";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import { addEntityWithOptions } from "../../lib/yamlRoundTrip";
import { addDiagramEntries, addInlineDiagramEntity } from "../../design/yamlPatch";
import { emitJourneyEvent } from "../../lib/onboardingJourney";

function conceptSlug(value) {
  return String(value || "concept")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "concept";
}

function conceptualFolderForFile(filePath) {
  const clean = String(filePath || "").replace(/^\/+/, "");
  if (!clean) return "core/conceptual";
  const parts = clean.split("/").filter(Boolean);
  if (parts.length >= 2 && /^(conceptual|logical|physical)$/i.test(parts[1])) {
    return `${parts[0]}/conceptual`;
  }
  return parts.slice(0, -1).join("/") || "core/conceptual";
}

function canonicalConceptYaml({ name, subjectArea, description }) {
  const slug = conceptSlug(name);
  const lines = [
    "kind: entity",
    "layer: conceptual",
    `name: ${slug}`,
  ];
  const logicalName = String(name || "").trim();
  if (logicalName && logicalName !== slug) lines.push(`logical_name: ${JSON.stringify(logicalName)}`);
  if (description) lines.push(`description: ${JSON.stringify(description)}`);
  if (subjectArea) lines.push(`domain: ${conceptSlug(subjectArea)}`);
  return `${lines.join("\n")}\n`;
}

function nextConceptName(entities) {
  const existing = new Set((entities || []).map((entity) => String(entity?.name || "").toLowerCase()).filter(Boolean));
  if (!existing.has("new concept")) return "New Concept";
  let i = 2;
  while (existing.has(`new concept ${i}`)) i += 1;
  return `New Concept ${i}`;
}

export default function NewConceptDialog() {
  const { closeModal, addToast, modalPayload } = useUiStore();
  const { activeFile, activeFileContent, updateContent, createNewFile, openFile } = useWorkspaceStore();
  const { model, requestLayoutRefresh } = useDiagramStore();

  const entities = Array.isArray(model?.entities) ? model.entities : [];
  const subjectAreas = Array.isArray(model?.subject_areas) ? model.subject_areas : [];
  const initialName = String(modalPayload?.nameHint || nextConceptName(entities));
  const [name, setName] = useState(initialName);
  const [subjectArea, setSubjectArea] = useState(String(modalPayload?.subjectAreaHint || ""));
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const targetX = Number.isFinite(Number(modalPayload?.x)) ? Number(modalPayload.x) : undefined;
  const targetY = Number.isFinite(Number(modalPayload?.y)) ? Number(modalPayload.y) : undefined;
  const canSubmit = String(name || "").trim().length > 0;
  const locationLabel = useMemo(() => {
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return "current canvas";
    return `x ${Math.round(targetX)}, y ${Math.round(targetY)}`;
  }, [targetX, targetY]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeFile) {
      setError("Open a project or conceptual diagram first.");
      return;
    }
    const cleanName = String(name || "").trim();
    if (!cleanName) {
      setError("Concept name is required.");
      return;
    }
    let parsed = null;
    try {
      const mod = await import("js-yaml");
      parsed = activeFileContent ? mod.load(activeFileContent) : null;
    } catch (_err) {
      parsed = null;
    }

    // Legacy aggregate model files still get an in-place concept append.
    // Canonical projects create one conceptual entity file per concept.
    if (parsed && String(parsed.kind || "").toLowerCase() !== "diagram" && Array.isArray(parsed.entities)) {
      const result = addEntityWithOptions(activeFileContent, {
        name: cleanName,
        type: "concept",
        description: String(description || "").trim(),
        subjectArea: String(subjectArea || "").trim(),
        display: Number.isFinite(targetX) && Number.isFinite(targetY)
          ? { x: targetX, y: targetY, width: 260 }
          : undefined,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      updateContent(result.yaml);
      requestLayoutRefresh?.();
      addToast({
        type: "success",
        message: `Created concept "${cleanName}".`,
      });
      emitJourneyEvent("entity:created", { kind: "concept", name: cleanName });
      closeModal();
      return;
    }

    const activeWasDiagram = /\.diagram\.ya?ml$/i.test(activeFile?.name || "");
    const diagramFile = activeFile;
    const diagramContent = activeFileContent;

    if (activeWasDiagram && diagramFile && diagramContent) {
      const nextDiagram = addInlineDiagramEntity(diagramContent, {
        name: cleanName,
        type: "concept",
        domain: conceptSlug(subjectArea || "core"),
        subject_area: String(subjectArea || "").trim(),
        description: String(description || "").trim(),
        x: Number.isFinite(targetX) ? targetX : 120,
        y: Number.isFinite(targetY) ? targetY : 120,
        width: 280,
      });
      if (!nextDiagram) {
        setError("Could not write this concept into the active diagram YAML.");
        return;
      }
      if (nextDiagram === diagramContent) {
        setError(`A concept named "${cleanName}" already exists in this diagram.`);
        return;
      }
      updateContent(nextDiagram);
      requestLayoutRefresh?.();
      addToast({ type: "success", message: `Created concept box "${cleanName}" in the diagram.` });
      emitJourneyEvent("entity:created", { kind: "concept", name: cleanName });
      closeModal();
      return;
    }

    const slug = conceptSlug(cleanName);
    const filePath = `${conceptualFolderForFile(activeFile?.path || activeFile?.fullPath || "")}/${slug}.yaml`;
    const conceptYaml = canonicalConceptYaml({
      name: cleanName,
      subjectArea: String(subjectArea || "").trim(),
      description: String(description || "").trim(),
    });

    try {
      await createNewFile(filePath, conceptYaml);
      if (activeWasDiagram && diagramFile && diagramContent) {
        const nextDiagram = addDiagramEntries(diagramContent, [{
          file: filePath,
          entity: slug,
          x: Number.isFinite(targetX) ? targetX : 120,
          y: Number.isFinite(targetY) ? targetY : 120,
        }]);
        if (nextDiagram && nextDiagram !== diagramContent) {
          await openFile(diagramFile);
          updateContent(nextDiagram);
        }
      }
      requestLayoutRefresh?.();
      addToast({ type: "success", message: `Created conceptual entity "${slug}".` });
      emitJourneyEvent("entity:created", { kind: "concept", name: slug });
      closeModal();
    } catch (err) {
      setError(err?.message || "Could not create conceptual entity file.");
    }
  };

  return (
    <Modal
      icon={<Boxes size={14} />}
      title="New Concept"
      subtitle="Create a business concept box in the conceptual canvas."
      size="md"
      onClose={closeModal}
      footerStatus={activeFile?.name ? `Target file: ${activeFile.name}` : "No active file"}
      footer={(
        <>
          <button
            type="button"
            className="canvas-btn"
            onClick={closeModal}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-concept-form"
            className="canvas-btn"
            style={{ background: "var(--accent-dim)", borderColor: "var(--accent)", color: "var(--text-primary)" }}
            disabled={!canSubmit}
          >
            Create concept box
          </button>
        </>
      )}
      footerAlign="between"
    >
      <form id="new-concept-form" onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
        <div
          style={{
            display: "grid",
            gap: 8,
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--border-default)",
            background: "var(--bg-2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
            <Boxes size={14} />
            This creates a new concept box on the canvas.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11, color: "var(--text-tertiary)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <FolderTree size={12} />
              Subject area grouping
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <FileText size={12} />
              Business-first metadata later in Details
            </span>
          </div>
        </div>

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="concept-name">Concept name</label>
          <input
            id="concept-name"
            className="panel-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer"
            autoFocus
          />
        </div>

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="concept-subject-area">Subject area</label>
          <input
            id="concept-subject-area"
            className="panel-input"
            list="new-concept-subject-areas"
            value={subjectArea}
            onChange={(e) => setSubjectArea(e.target.value)}
            placeholder="Customer, Orders, Claims…"
          />
          <datalist id="new-concept-subject-areas">
            {subjectAreas.map((area) => (
              <option key={area.name} value={area.name} />
            ))}
          </datalist>
        </div>

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="concept-description">Starter description</label>
          <textarea
            id="concept-description"
            className="panel-input"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short business meaning for this concept…"
            style={{ resize: "vertical" }}
          />
        </div>

        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px dashed var(--border-default)",
            background: "var(--bg-1)",
          }}
        >
          The new box will appear near <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{locationLabel}</span>.
          Fill owner, glossary terms, and relationship meaning after creation in the right-side Details panel.
        </div>

        {error && (
          <div className="dlx-modal-alert">
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
