/* RightPanel — entity / relationship inspector.
   Uses the shared PanelFrame primitives so its visual language matches
   the bottom drawer (same header, same paddings, same tone colours). The
   five tabs (COLUMNS / RELATIONS / INDEXES / SQL / YAML) each live in
   their own file under `./inspector/` and are lazy-loaded — YAML pulls
   in CodeMirror, so we keep it behind Suspense.

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
const RelationsView   = React.lazy(() => import("./inspector/RelationsView"));
const IndexesView     = React.lazy(() => import("./inspector/IndexesView"));
const SqlView         = React.lazy(() => import("./inspector/SqlView"));
const YamlEditorShell = React.lazy(() => import("./inspector/YamlEditorShell"));

const TABS = [
  { id: "COLUMNS",   label: "Columns" },
  { id: "RELATIONS", label: "Relations" },
  { id: "INDEXES",   label: "Indexes" },
  { id: "SQL",       label: "SQL" },
  { id: "YAML",      label: "YAML" },
];

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
  relationships = [], indexes = [], onDeleteEntity, onSelectRel, onExportDdl,
}) {
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useUiStore((s) => s.setRightPanelWidth);

  // Coerce to a known tab id.
  const tab = TABS.some((t) => t.id === rightPanelTab) ? rightPanelTab : "COLUMNS";

  /* ── Header content varies by selection kind ──────────────── */
  const header = React.useMemo(() => {
    if (rel) {
      return {
        icon: <GitBranch size={14} />,
        eyebrow: "Relationship",
        title: rel.name,
        subtitle: `${rel.from.table}.${rel.from.col} → ${rel.to.table}.${rel.to.col}`,
        statusTone: "accent",
        statusLabel: "Relationship",
      };
    }
    if (table) {
      return {
        icon: <Box size={14} />,
        eyebrow: table.subject || table.cat || null,
        title: table.name,
        subtitle: `${table.schema}.${table.name} · ${table.columns.length} columns${table.rowCount ? ` · ${table.rowCount}` : ""}`,
        statusTone: table.kind === "ENUM" ? "warning" : "accent",
        statusLabel: table.kind || "Table",
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
  if (tab === "YAML") {
    body = <YamlEditorShell />;
  } else if (noSelection) {
    body = (
      <PanelEmpty
        icon={Database}
        title="No selection"
        description="Pick a table or relationship on the canvas to inspect it. The YAML tab is always available to edit the file directly."
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
      />
    );
  } else if (tab === "INDEXES") {
    body = table
      ? <IndexesView table={table} indexes={indexes} />
      : <PanelEmpty icon={Database} title="Indexes" description="Select a table to view its indexes." />;
  } else if (tab === "SQL") {
    body = table
      ? <SqlView table={table} onExport={onExportDdl} />
      : <PanelEmpty icon={Database} title="SQL preview" description="Select a table to see its CREATE statement." />;
  }

  return (
    <div className="right">
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
            tabs={TABS}
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
            padding: tab === "YAML" ? 0 : 14,
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
