import React from "react";
import { ArrowRight, Boxes, FileText, GitBranch, Layers3, TableProperties } from "lucide-react";
import { PanelFrame, PanelSection, PanelCard, PanelEmpty, StatusPill, KeyValueGrid } from "./PanelFrame";

function endpointLabel(endpoint) {
  const table = endpoint?.table || endpoint?.entity || "—";
  return endpoint?.col ? `${table}.${endpoint.col}` : table;
}

function relationshipCountForTable(table, relationships) {
  const tableId = String(table?.id || "");
  return (relationships || []).filter(
    (rel) => String(rel?.from?.table || "") === tableId || String(rel?.to?.table || "") === tableId
  ).length;
}

export default function SelectionSummaryPanel({
  table,
  rel,
  relationships = [],
  schema = null,
  activeFile = null,
  isDiagramFile = false,
}) {
  if (!table && !rel) {
    const tables = Array.isArray(schema?.tables) ? schema.tables : [];
    const rels = Array.isArray(schema?.relationships) ? schema.relationships : [];
    const subjectAreas = Array.isArray(schema?.subjectAreas) ? schema.subjectAreas : [];
    return (
      <PanelFrame icon={<TableProperties size={14} />} eyebrow="Inspector" title="Selection">
        <PanelSection title="Workspace" icon={<Layers3 size={11} />}>
          <KeyValueGrid
            items={[
              { label: "Active file", value: activeFile?.name || activeFile?.path || "No file open" },
              { label: "Model", value: schema?.name || "Project" },
              { label: "Layer", value: schema?.modelKind || "physical" },
              { label: "Engine", value: schema?.engine || "DataLex" },
              { label: "Entities", value: String(tables.length) },
              { label: "Relationships", value: String(rels.length) },
              { label: "Subject areas", value: String(subjectAreas.length) },
            ]}
          />
        </PanelSection>
        <PanelEmpty
          icon={TableProperties}
          title="No selection"
          description="Select a table or relationship on the canvas to inspect its source, fields, and relationship summary."
        />
      </PanelFrame>
    );
  }

  if (rel) {
    return (
        <PanelFrame
        icon={<GitBranch size={14} />}
        eyebrow="Inspector"
        title={rel.name || "Relationship"}
        subtitle={isDiagramFile ? "Diagram relationship" : "Relationship"}
        status={<StatusPill tone="accent">{rel.kind || rel.cardinality || "relationship"}</StatusPill>}
      >
        <PanelSection title="Endpoints" icon={<ArrowRight size={11} />}>
          <KeyValueGrid
            items={[
              { label: "From", value: endpointLabel(rel.from) },
              { label: "To", value: endpointLabel(rel.to) },
              { label: "Source", value: rel._sourceFile || (isDiagramFile ? "Active diagram" : "Active YAML") },
              { label: "On delete", value: rel.onDelete || "—" },
              { label: "On update", value: rel.onUpdate || "—" },
            ]}
          />
        </PanelSection>
      </PanelFrame>
    );
  }

  const columns = Array.isArray(table?.columns) ? table.columns : [];
  const pkCount = columns.filter((column) => column.pk).length;
  const fkCount = columns.filter((column) => column.fk || column.semanticFk).length;
  const relCount = relationshipCountForTable(table, relationships);

  return (
    <PanelFrame
      icon={<Boxes size={14} />}
      eyebrow="Inspector"
      title={table?.name || table?.id || "Selection"}
      subtitle={isDiagramFile ? "Diagram selection summary" : "Selection summary"}
      status={<StatusPill tone="info">{table?.type || table?.kind || "table"}</StatusPill>}
    >
      <PanelSection title="Summary" icon={<FileText size={11} />}>
        <KeyValueGrid
          items={[
            { label: "Source file", value: table?._sourceFile || "Active YAML" },
            { label: "Schema", value: table?.schema || "public" },
            { label: "Domain", value: table?.domain || schema?.domain || "—" },
            { label: "Subject area", value: table?.subject_area || table?.subject || "—" },
            { label: "Columns", value: String(columns.length) },
            { label: "Relationships", value: String(relCount) },
            { label: "Primary keys", value: String(pkCount) },
            { label: "Foreign keys", value: String(fkCount) },
          ]}
        />
      </PanelSection>

      <PanelSection title="Fields" count={columns.length}>
        {columns.length === 0 ? (
          <PanelEmpty
            icon={Boxes}
            title="No fields"
            description="This selection does not expose any fields in the current adapter."
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {columns.slice(0, 12).map((column) => (
              <PanelCard
                key={column.name}
                dense
                tone={column.pk ? "accent" : (column.fk || column.semanticFk) ? "warning" : "neutral"}
                title={column.name}
                subtitle={column.description || undefined}
                actions={<StatusPill tone={column.pk ? "accent" : (column.fk || column.semanticFk) ? "warning" : "neutral"}>{column.type || "—"}</StatusPill>}
              >
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {column.pk && <StatusPill tone="accent">PK</StatusPill>}
                  {(column.fk || column.semanticFk) && <StatusPill tone="warning">FK</StatusPill>}
                  {column.nn && <StatusPill tone="info">NOT NULL</StatusPill>}
                  {column.unique && <StatusPill tone="success">UNIQUE</StatusPill>}
                  {column.generated && <StatusPill tone="neutral">GENERATED</StatusPill>}
                  {column.default != null && String(column.default).trim() !== "" && <StatusPill tone="neutral">DEFAULT</StatusPill>}
                  {column.check != null && String(column.check).trim() !== "" && <StatusPill tone="warning">CHECK</StatusPill>}
                </div>
              </PanelCard>
            ))}
            {columns.length > 12 && (
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                Showing 12 of {columns.length} fields. Use the right inspector for the full list.
              </div>
            )}
          </div>
        )}
      </PanelSection>
    </PanelFrame>
  );
}
