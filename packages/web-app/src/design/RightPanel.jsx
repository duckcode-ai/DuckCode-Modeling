/* RightPanel — entity / relationship inspector.
   Uses the shared PanelFrame primitives so its visual language matches
   the bottom drawer (same header, same paddings, same tone colours).
   Physical/logical models use the richer technical inspector, while
   conceptual models swap in a business-focused details surface.

   Features added in PR 8:
     - PanelFrame port (away from the older .insp-* namespace).
     - ArrowLeft/Right tab navigation (see InspectorTabs).
     - Persisted tab + width via uiStore.rightPanelTab / rightPanelWidth.
     - Drag-resize strip on the left edge (commits width on mouse-up).
     - Live SQL preview (client-side DDL generator, no save required).
     - Working relationship editor (ON DELETE/UPDATE + edit + delete).
     - Editable indexes (addIndex / removeIndex). */
import React from "react";
import {
  Box, Copy, Trash2, Pencil, GitBranch, Database,
} from "lucide-react";
import {
  PanelFrame, PanelEmpty, StatusPill,
} from "../components/panels/PanelFrame";
import useUiStore from "../stores/uiStore";
import InspectorTabs from "./inspector/InspectorTabs";

/* Per-tab bodies are split into their own chunks. The common path
   (COLUMNS on a freshly selected entity) is the cheapest one — the
   others only load the first time the user clicks their tab. */
const ColumnsView     = React.lazy(() => import("./inspector/ColumnsView"));
const ConceptDetailsView = React.lazy(() => import("./inspector/ConceptDetailsView"));
const LogicalDetailsView = React.lazy(() => import("./inspector/LogicalDetailsView"));
const RelationsView   = React.lazy(() => import("./inspector/RelationsView"));
const IndexesView     = React.lazy(() => import("./inspector/IndexesView"));
const SqlView         = React.lazy(() => import("./inspector/SqlView"));
const YamlEditorShell = React.lazy(() => import("./inspector/YamlEditorShell"));
const AiAssistantSurface = React.lazy(() => import("../components/ai/AiAssistantSurface"));

const BASE_TABS = [
  { id: "AI",        label: "AI" },
  { id: "COLUMNS",   label: "Columns" },
  { id: "RELATIONS", label: "Relations" },
  { id: "INDEXES",   label: "Indexes" },
  { id: "SQL",       label: "SQL" },
  { id: "YAML",      label: "YAML" },
];

const CONCEPTUAL_TABS = [
  { id: "AI",        label: "AI" },
  { id: "DETAILS",   label: "Details" },
  { id: "RELATIONS", label: "Relationships" },
  { id: "YAML",      label: "YAML" },
];

const LOGICAL_TABS = [
  { id: "AI",        label: "AI" },
  { id: "DETAILS",   label: "Details" },
  { id: "RELATIONS", label: "Relationships" },
  { id: "YAML",      label: "YAML" },
];

function relationshipEndpointLabel(endpoint, fallbackEntity) {
  const entity = fallbackEntity || endpoint?.table || endpoint?.entity || "—";
  return endpoint?.col ? `${entity}.${endpoint.col}` : entity;
}

/* Drag-resize handle on the LEFT edge of the right panel. Writes the
   pixel width directly to `--right-w` on the root during drag (via RAF)
   so the grid reflows without React re-renders, then commits the final
   value to uiStore.rightPanelWidth on mouse-up. */
function ResizeHandle({ initialWidth, onCommit }) {
  const [dragging, setDragging] = React.useState(false);

  const onMouseDown = React.useCallback(
    (e) => {
      e.preventDefault();
      const root = document.documentElement;
      const startX = e.clientX;
      const startW = initialWidth;
      let nextW = startW;
      let raf = 0;

      const onMove = (ev) => {
        const delta = startX - ev.clientX;
        nextW = startW + delta;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const clamped = Math.max(280, Math.min(window.innerWidth - 400, nextW));
          root.style.setProperty("--right-w", `${clamped}px`);
        });
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const clamped = Math.max(280, Math.min(window.innerWidth - 400, nextW));
        onCommit(clamped);
        setDragging(false);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      setDragging(true);
    },
    [initialWidth, onCommit]
  );

  return (
    <div
      className={`right-resize ${dragging ? "dragging" : ""}`}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize inspector panel"
      title="Drag to resize"
    />
  );
}

export default function RightPanel({
  table, rel, tables, selectedCol, setSelectedCol,
  relationships = [], indexes = [], schema = null, isDiagramFile = false,
  onDeleteEntity, onSelectRel, onExportDdl,
}) {
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useUiStore((s) => s.setRightPanelWidth);
  const openAiPanel = useUiStore((s) => s.openAiPanel);
  const aiPanelPayload = useUiStore((s) => s.aiPanelPayload);
  const modelKind = String(schema?.modelKind || "physical").trim().toLowerCase();
  const tabs = React.useMemo(() => {
    if (modelKind === "conceptual") {
      return CONCEPTUAL_TABS;
    }
    if (modelKind === "logical") {
      return LOGICAL_TABS;
    }
    return BASE_TABS;
  }, [modelKind]);

  // Coerce to a known tab id.
  const fallbackTab = modelKind === "conceptual" ? "DETAILS" : "COLUMNS";
  const tab = tabs.some((t) => t.id === rightPanelTab) ? rightPanelTab : fallbackTab;

  /* ── Header content varies by selection kind ──────────────── */
  const header = React.useMemo(() => {
    if (rel) {
      return {
        icon: <GitBranch size={14} />,
        eyebrow: "Relationship",
        title: rel.name,
        subtitle: `${relationshipEndpointLabel(rel.from, rel._fromEntityName)} → ${relationshipEndpointLabel(rel.to, rel._toEntityName)}`,
        statusTone: "accent",
        statusLabel: !rel.from?.col && !rel.to?.col ? "Conceptual" : "Relationship",
      };
    }
    if (table) {
      const isConcept = modelKind === "conceptual" || String(table.type || "").toLowerCase() === "concept";
      return {
        icon: <Box size={14} />,
        eyebrow: isConcept ? "Business concept" : (table.subject || table.cat || null),
        title: table.name,
        subtitle: isConcept
          ? `${schema?.domain || table?.domain || "Shared domain"} · ${table.subject_area || "Unassigned subject area"}`
          : `${table.schema}.${table.name} · ${table.columns.length} columns${table.rowCount ? ` · ${table.rowCount}` : ""}`,
        statusTone: table.kind === "ENUM" ? "warning" : "accent",
        statusLabel: isConcept ? "Concept" : (table.type || table.kind || "Table"),
      };
    }
    return {
      icon: <Database size={14} />,
      eyebrow: null,
      title: "Inspector",
      subtitle: "No selection",
      statusTone: "neutral",
      statusLabel: null,
    };
  }, [table, rel]);

  /* ── Header trailing actions (copy / edit / delete) ───────── */
  const askAiPayload = React.useMemo(() => ({
    source: "right-inspector",
    targetName: rel?.name || table?.name || "selection",
    context: rel
      ? { kind: "relationship", relId: rel.id || rel.name, relationshipName: rel.name }
      : table
        ? { kind: "entity", entityName: table.name, modelKind }
        : { kind: "inspector", modelKind },
  }), [table, rel, modelKind]);

  const handleInspectorContextMenu = React.useCallback((event) => {
    const target = event.target;
    const isEditable = target?.closest?.("input, textarea, select, [contenteditable='true']");
    if (isEditable) return;
    event.preventDefault();
    openAiPanel({
      ...askAiPayload,
      source: "right-inspector-context",
      targetName: selectedCol || askAiPayload.targetName,
      context: {
        ...(askAiPayload.context || {}),
        fieldName: selectedCol || undefined,
      },
    });
  }, [askAiPayload, openAiPanel, selectedCol]);

  const headerActions = table && !rel ? (
    <div className="panel-btn-row">
      <button
        className="panel-btn"
        title="Copy table name"
        onClick={() => navigator.clipboard?.writeText(table.name).catch(() => {})}
      >
        <Copy size={12} /> Copy
      </button>
      <button
        className="panel-btn danger"
        title="Delete entity"
        onClick={() => onDeleteEntity && onDeleteEntity(table.name)}
      >
        <Trash2 size={12} /> Delete
      </button>
    </div>
  ) : null;

  /* ── No-selection state ───────────────────────────────────── */
  const noSelection = !table && !rel;

  /* ── Tab body ─────────────────────────────────────────────── */
  let body;
  if (tab === "AI") {
    body = (
      <AiAssistantSurface
        compact
        payload={aiPanelPayload || askAiPayload}
      />
    );
  } else if (tab === "YAML") {
    body = <YamlEditorShell />;
  } else if (tab === "SQL") {
    body = (isDiagramFile && schema?.tables?.length)
      ? <SqlView table={table} schema={schema} isDiagramFile={true} onExport={onExportDdl} />
      : table
        ? <SqlView table={table} schema={schema} isDiagramFile={false} onExport={onExportDdl} />
        : <PanelEmpty icon={Database} title="SQL preview" description="Select a table to see its CREATE statement." />;
  } else if (noSelection) {
    body = (
      <PanelEmpty
        icon={Database}
        title="No selection"
        description={
          modelKind === "conceptual"
            ? "Pick a concept or business relationship on the canvas. Use the studio below to add concepts, then edit the selected concept here."
            : "Pick a table or relationship on the canvas to inspect it. The YAML tab is always available to edit the file directly."
        }
      />
    );
  } else if (tab === "DETAILS") {
    body = modelKind === "logical"
      ? <LogicalDetailsView table={table} />
      : (
        <ConceptDetailsView
          table={table}
          schema={schema}
          relationships={relationships}
        />
      );
  } else if (tab === "COLUMNS") {
    const col = table
      ? (table.columns.find((c) => c.name === selectedCol) || table.columns[0])
      : null;
    body = table
      ? <ColumnsView table={table} col={col} setSelectedCol={setSelectedCol} entityName={table.name} />
      : <PanelEmpty icon={Box} title="Columns" description="Select a table to view its columns." />;
  } else if (tab === "RELATIONS") {
    body = (
      <RelationsView
        table={table}
        rel={rel}
        relationships={relationships}
        onSelect={onSelectRel}
        tables={tables}
        modelKind={modelKind}
      />
    );
  } else if (tab === "INDEXES") {
    body = table
      ? <IndexesView table={table} indexes={indexes} />
      : <PanelEmpty icon={Database} title="Indexes" description="Select a table to view its indexes." />;
  }

  return (
    <div className="right" onContextMenu={handleInspectorContextMenu}>
      <ResizeHandle initialWidth={rightPanelWidth} onCommit={setRightPanelWidth} />
      <PanelFrame
        icon={header.icon}
        eyebrow={header.eyebrow}
        title={header.title}
        subtitle={header.subtitle}
        status={header.statusLabel && (
          <StatusPill tone={header.statusTone}>{header.statusLabel}</StatusPill>
        )}
        actions={headerActions}
        toolbar={
          <InspectorTabs
            tab={tab}
            setTab={setRightPanelTab}
            tabs={tabs}
          />
        }
        bodyPadding={0}
      >
        {/* The body itself handles its own padding (sections have their
            own spacing). YAML tab fills edge-to-edge for the editor. */}
        <div
          id={`inspector-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`inspector-tab-${tab}`}
          style={{
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            padding: tab === "YAML" || tab === "AI" ? 0 : 14,
          }}
        >
          <React.Suspense
            fallback={
              <div style={{ padding: 20, fontSize: 12, color: "var(--text-tertiary)" }}>
                Loading…
              </div>
            }
          >
            {body}
          </React.Suspense>
        </div>
      </PanelFrame>
    </div>
  );
}
