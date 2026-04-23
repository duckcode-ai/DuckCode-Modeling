import React from "react";
import { BookOpen, FileText, Layers3, Tags, UserRound, GitBranch } from "lucide-react";
import { KeyValueGrid, PanelCard, PanelEmpty, PanelSection, StatusPill } from "../../components/panels/PanelFrame";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import { setEntityScalarProperty, updateEntityMeta, updateEntityTags } from "../../lib/yamlRoundTrip";
import { findConceptImplementations } from "../../lib/conceptualModeling";

function csvFromList(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function ConceptDetailsView({ table, schema, relationships = [] }) {
  const addToast = useUiStore((s) => s.addToast);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const projectFiles = useWorkspaceStore((s) => s.projectFiles);
  const fileContentCache = useWorkspaceStore((s) => s.fileContentCache);
  const ensureFilesLoaded = useWorkspaceStore((s) => s.ensureFilesLoaded);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const sourceFile = table?._sourceFile || "";
  const isDiagramFile = /\.diagram\.ya?ml$/i.test(activeFile?.name || "");
  const conceptName = table?.name || "";
  const fields = Array.isArray(table?.columns) ? table.columns : [];
  const related = Array.isArray(relationships)
    ? relationships.filter((rel) => rel?._fromEntityName === conceptName || rel?._toEntityName === conceptName)
    : [];

  React.useEffect(() => {
    if (!conceptName) return;
    const candidatePaths = (projectFiles || [])
      .filter((file) => {
        const path = String(file?.path || file?.fullPath || "");
        return /\.model\.ya?ml$/i.test(path) && !/\/conceptual\//i.test(path);
      })
      .map((file) => file.fullPath || file.path)
      .filter(Boolean);
    if (candidatePaths.length === 0) return;
    ensureFilesLoaded?.(candidatePaths).catch(() => {});
  }, [conceptName, ensureFilesLoaded, projectFiles]);

  const implementations = React.useMemo(() => findConceptImplementations({
    projectFiles,
    fileContentCache,
    conceptName,
  }), [conceptName, fileContentCache, projectFiles]);

  const applyEntityMutation = React.useCallback(async (mutate) => {
    const s = useWorkspaceStore.getState();
    if (isDiagramFile && !sourceFile) {
      addToast?.({ type: "error", message: `Could not resolve the source YAML for “${conceptName}”.` });
      return null;
    }
    if (isDiagramFile && sourceFile) {
      try {
        const result = await s.mutateReferencedFile(sourceFile, (content) => mutate(content));
        return result?.changed ? result.content : null;
      } catch (err) {
        addToast?.({ type: "error", message: err?.message || String(err) });
        return null;
      }
    }

    const next = mutate(s.activeFileContent);
    if (next != null) {
      s.updateContent(next);
      s.flushAutosave?.().catch(() => {});
    }
    return next;
  }, [addToast, conceptName, isDiagramFile, sourceFile]);

  const applyScalar = React.useCallback((key, value) => {
    void applyEntityMutation((content) => {
      const result = setEntityScalarProperty(content, conceptName, key, value);
      return result?.error ? null : result.yaml;
    });
  }, [applyEntityMutation, conceptName]);

  const applyTags = React.useCallback((value) => {
    void applyEntityMutation((content) => {
      const result = updateEntityTags(content, conceptName, value);
      return result?.error ? null : result.yaml;
    });
  }, [applyEntityMutation, conceptName]);

  const applyTerms = React.useCallback((value) => {
    const nextTerms = parseCsv(value);
    void applyEntityMutation((content) => {
      const result = updateEntityMeta(content, conceptName, "terms", nextTerms);
      return result?.error ? null : result.yaml;
    });
  }, [applyEntityMutation, conceptName]);

  if (!table) {
    return (
      <PanelEmpty
        icon={Layers3}
        title="No concept selected"
        description="Select a concept on the canvas to edit its business description, ownership, subject area, and glossary links."
      />
    );
  }

  return (
    <>
      <PanelSection title="Concept summary" icon={<Layers3 size={11} />}>
        <KeyValueGrid
          items={[
            { label: "Concept", value: conceptName },
            { label: "Type", value: table?.type || "concept" },
            { label: "Layer", value: schema?.modelKind || "conceptual" },
            { label: "Domain", value: table?.domain || schema?.domain || "—" },
            { label: "Subject area", value: table?.subject_area || "—" },
            { label: "Attributes", value: String(fields.length) },
            { label: "Business links", value: String(related.length) },
            { label: "Source file", value: sourceFile || "Active YAML" },
          ]}
        />
      </PanelSection>

      <PanelSection title="Business definition" icon={<FileText size={11} />}>
        <div className="inspector-inline-form">
          <label>Description</label>
          <textarea
            className="panel-input"
            defaultValue={table?.description || ""}
            rows={5}
            placeholder="Explain what this concept means to the business and when teams should use it."
            onBlur={(e) => applyScalar("description", e.target.value)}
          />
          <label>Subject area</label>
          <input
            className="panel-input"
            defaultValue={table?.subject_area || ""}
            placeholder="Customer, Finance, Risk, Claims..."
            onBlur={(e) => applyScalar("subject_area", e.target.value)}
          />
        </div>
      </PanelSection>

      <PanelSection title="Stewardship" icon={<UserRound size={11} />}>
        <div className="inspector-inline-form">
          <label>Owner</label>
          <input
            className="panel-input"
            defaultValue={table?.owner || ""}
            placeholder="Data steward or business owner"
            onBlur={(e) => applyScalar("owner", e.target.value)}
          />
        </div>
      </PanelSection>

      <PanelSection title="Dictionary links" icon={<BookOpen size={11} />}>
        <div className="inspector-inline-form">
          <label>Glossary terms</label>
          <input
            className="panel-input"
            defaultValue={csvFromList(table?.terms)}
            placeholder="Customer, Active customer, Policy holder"
            onBlur={(e) => applyTerms(e.target.value)}
          />
        </div>
      </PanelSection>

      <PanelSection
        title="Tags"
        icon={<Tags size={11} />}
        action={Array.isArray(table?.tags) && table.tags.length > 0 ? <StatusPill tone="info">{table.tags.length}</StatusPill> : null}
      >
        <div className="inspector-inline-form">
          <label>Concept tags</label>
          <input
            className="panel-input"
            defaultValue={csvFromList(table?.tags)}
            placeholder="core, governed, customer-domain"
            onBlur={(e) => applyTags(e.target.value)}
          />
        </div>
      </PanelSection>

      <PanelSection
        title="Traceability"
        icon={<GitBranch size={11} />}
        count={implementations.length}
        description="Shows logical and physical implementations that were promoted from this concept."
      >
        {implementations.length === 0 ? (
          <PanelEmpty
            icon={GitBranch}
            title="No implementations yet"
            description="Promote this concept to logical or physical to create downstream models with lineage."
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {implementations.map((item) => (
              <PanelCard
                key={`${item.filePath}:${item.entityName}`}
                dense
                tone={item.layer === "logical" ? "info" : "accent"}
                title={item.entityName}
                eyebrow={item.layer}
                subtitle={item.filePath}
                actions={<StatusPill tone={item.layer === "logical" ? "info" : "accent"}>{item.layer}</StatusPill>}
              >
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {item.derivedFrom ? `derived_from: ${item.derivedFrom}` : `mapped_from: ${item.mappedFrom}`}
                  </div>
                  <div>
                    <button
                      type="button"
                      className="panel-btn"
                      onClick={() => openFile?.({ fullPath: item.fullPath, path: item.filePath, name: item.filePath.split("/").pop() })}
                    >
                      Open model
                    </button>
                  </div>
                </div>
              </PanelCard>
            ))}
          </div>
        )}
      </PanelSection>
    </>
  );
}
