/* DataLex shell — integrated root. Combines the Luna-class visual design
   (topbar / project tabs / left / canvas / right / status) with the full
   DataLex feature set (auth gate, real projects from the api-server, bottom
   drawer with all legacy panels, all existing dialogs, keyboard shortcuts).

   This file replaces App.jsx. Visual layout comes from datalex-design.css;
   the bottom-drawer row + dirty dot come from datalex-integration.css. */
import React, { useEffect, useState } from "react";
import {
  Columns3, ShieldCheck, GitCompare, Activity, Network, Clock, X,
  Wand2, LibraryBig, Map, BookOpen, RefreshCw, ChevronUp,
} from "lucide-react";

import yaml from "js-yaml";
import { TopBar, ProjectTabs, StatusBar } from "./Chrome";
import LeftPanel from "./LeftPanel";
import Canvas from "./Canvas";
import RightPanel from "./RightPanel";
import CommandPalette from "./CommandPalette";
import BottomDrawer from "./BottomDrawer";
import { DEMO_SCHEMA } from "./demoSchema";
import { THEMES } from "./notation";
import { adaptDataLexYaml } from "./schemaAdapter";
import { appendEntity, deleteEntity } from "./yamlPatch";

import { fetchGitStatus } from "../lib/api";
import {
  AddProjectModal,
  EditProjectModal,
  NewFileModal,
} from "../components/dialogs/ProjectModals";
import LoginPage from "../components/auth/LoginPage";
import KeyboardShortcutsPanel from "../components/panels/KeyboardShortcutsPanel";

// Heavy panels / dialogs are split into separate chunks — they only load when
// the user actually opens them, which keeps the initial JS bundle small.
const ModelerPanel        = React.lazy(() => import("../components/panels/ModelerPanel"));
const EntityPanel         = React.lazy(() => import("../components/panels/EntityPanel"));
const LibrariesPanel      = React.lazy(() => import("../components/panels/LibrariesPanel"));
const SubjectAreasPanel   = React.lazy(() => import("../components/panels/SubjectAreasPanel"));
const ValidationPanel     = React.lazy(() => import("../components/panels/ValidationPanel"));
const DiffPanel           = React.lazy(() => import("../components/panels/DiffPanel"));
const ImpactPanel         = React.lazy(() => import("../components/panels/ImpactPanel"));
const HistoryPanel        = React.lazy(() => import("../components/panels/HistoryPanel"));
const ModelGraphPanel     = React.lazy(() => import("../components/panels/ModelGraphPanel"));
const DictionaryPanel     = React.lazy(() => import("../components/panels/DictionaryPanel"));
const SettingsDialog      = React.lazy(() => import("../components/dialogs/SettingsDialog"));
const ConnectionsManager  = React.lazy(() => import("../components/dialogs/ConnectionsManager"));
const CommitDialog        = React.lazy(() => import("../components/dialogs/CommitDialog"));
const ExportDdlDialog     = React.lazy(() => import("../components/dialogs/ExportDdlDialog"));
const PanelDialog         = React.lazy(() => import("../components/dialogs/PanelDialog"));
const GitBranchDialog     = React.lazy(() => import("../components/dialogs/GitBranchDialog"));
const ViewerWelcome       = React.lazy(() => import("../components/viewer/ViewerWelcome"));

// The three main-canvas alternatives to the diagram. Lazy-loaded so the
// initial bundle stays tight when the user only ever uses the diagram.
const TableView           = React.lazy(() => import("./views/TableView"));
const ViewsView           = React.lazy(() => import("./views/ViewsView"));
const EnumsView           = React.lazy(() => import("./views/EnumsView"));

import useWorkspaceStore from "../stores/workspaceStore";
import useAuthStore from "../stores/authStore";
import useUiStore from "../stores/uiStore";
import useDiagramStore from "../stores/diagramStore";

import "../styles/datalex-design.css";
import "../styles/datalex-integration.css";

const THEME_STORAGE = "datalex.theme";
const DENSITY_STORAGE = "datalex.density";

const ALL_BOTTOM_TABS = [
  { id: "modeler",       label: "Modeler",       icon: Wand2 },
  { id: "properties",    label: "Properties",    icon: Columns3 },
  { id: "libraries",     label: "Libraries",     icon: LibraryBig },
  { id: "subject-areas", label: "Subject Areas", icon: Map },
  { id: "validation",    label: "Validation",    icon: ShieldCheck, adminOnly: true },
  { id: "diff",          label: "Diff & Gate",   icon: GitCompare,  adminOnly: true },
  { id: "impact",        label: "Impact",        icon: Activity,    adminOnly: true },
  { id: "model-graph",   label: "Model Graph",   icon: Network },
  { id: "dictionary",    label: "Dictionary",    icon: BookOpen },
  { id: "history",       label: "History",       icon: Clock },
];

const LazyFallback = (
  <div style={{ padding: 20, fontSize: 12, color: "var(--text-tertiary)" }}>Loading…</div>
);

function BottomPanelContent({ tab }) {
  let node;
  switch (tab) {
    case "modeler":       node = <ModelerPanel />; break;
    case "properties":    node = <EntityPanel />; break;
    case "libraries":     node = <LibrariesPanel />; break;
    case "subject-areas": node = <SubjectAreasPanel />; break;
    case "validation":    node = <ValidationPanel />; break;
    case "diff":          node = <DiffPanel />; break;
    case "impact":        node = <ImpactPanel />; break;
    case "model-graph":   node = <ModelGraphPanel />; break;
    case "dictionary":    node = <DictionaryPanel />; break;
    case "history":       node = <HistoryPanel />; break;
    default:              node = <EntityPanel />;
  }
  return <React.Suspense fallback={LazyFallback}>{node}</React.Suspense>;
}

function WelcomeModal({ onClose }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 92vw)", maxHeight: "85vh", overflow: "auto",
          background: "var(--bg-2)", border: "1px solid var(--border-strong)",
          borderRadius: 12, boxShadow: "var(--shadow-pop)", position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 10, right: 10, zIndex: 1,
            background: "transparent", border: "none", color: "var(--text-tertiary)",
            cursor: "pointer", padding: 6, borderRadius: 6,
          }}
          title="Close"
        >
          <X size={16} />
        </button>
        <React.Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)" }}>Loading…</div>}>
          <ViewerWelcome />
        </React.Suspense>
      </div>
    </div>
  );
}

function ToastContainer() {
  const { toasts, removeToast } = useUiStore();
  if (toasts.length === 0) return null;
  return (
    <div className="datalex-toasts">
      {toasts.map((toast) => (
        <div key={toast.id}
             style={{
               display: "flex", alignItems: "center", gap: 8,
               padding: "8px 12px", borderRadius: 8, fontSize: 12,
               background: toast.type === "error" ? "rgba(239,68,68,0.12)"
                         : toast.type === "success" ? "rgba(16,185,129,0.12)"
                         : "var(--bg-2)",
               border: `1px solid ${toast.type === "error" ? "rgba(239,68,68,0.4)"
                       : toast.type === "success" ? "rgba(16,185,129,0.4)"
                       : "var(--border-default)"}`,
               color: "var(--text-primary)",
               boxShadow: "var(--shadow-pop)",
               minWidth: 200,
             }}>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button onClick={() => removeToast(toast.id)}
                  style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 2 }}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Shell() {
  /* ── Theme + density ───────────────────────────────────────────── */
  const [theme, setTheme] = React.useState(() => localStorage.getItem(THEME_STORAGE) || "midnight");
  const [density, setDensity] = React.useState(() => localStorage.getItem(DENSITY_STORAGE) || "comfortable");

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_STORAGE, theme);
  }, [theme]);

  // External theme-change trigger — fired by SettingsDialog (and anywhere
  // else that mutates the theme directly) so the shell state stays in sync
  // with the DOM without either side needing to know about the other.
  React.useEffect(() => {
    const onExternal = (e) => {
      const next = e?.detail?.theme;
      if (next && THEMES.some((t) => t.id === next)) setTheme(next);
    };
    window.addEventListener("datalex:theme-change", onExternal);
    return () => window.removeEventListener("datalex:theme-change", onExternal);
  }, []);
  React.useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
    localStorage.setItem(DENSITY_STORAGE, density);
  }, [density]);

  const cycleTheme = React.useCallback(() => {
    const ids = THEMES.map((t) => t.id);
    setTheme((cur) => ids[(ids.indexOf(cur) + 1) % ids.length]);
  }, []);

  /* ── Auth ──────────────────────────────────────────────────────── */
  const { isAuthenticated, isLoading, restoreSession, canEdit, user } = useAuthStore();
  useEffect(() => { restoreSession(); }, []);

  /* ── Workspace ─────────────────────────────────────────────────── */
  const {
    projects, activeProjectId, openProjects, openTabs, activeFile,
    activeFileContent, isDirty, loadProjects, selectProject, closeProject,
    cycleProject, saveCurrentFile, error, clearError,
    lastAutoGeneratedDdl, lastAutoGenerateError,
  } = useWorkspaceStore();

  useEffect(() => {
    if (isAuthenticated) loadProjects();
  }, [isAuthenticated]);

  /* ── UI store (modals, bottom panel, selection, toasts, palette) ─ */
  const {
    activeModal, openModal, closeModal,
    bottomPanelOpen, bottomPanelTab, setBottomPanelTab, toggleBottomPanel,
    rightPanelOpen, rightPanelWidth, commandPaletteOpen, setCommandPaletteOpen,
    shellViewMode,
    addToast,
  } = useUiStore();

  /* Keep the `--right-w` CSS var in sync with the store so the grid knows
     how wide the right slot is on first paint and after the drag-resize
     strip commits a new width. */
  React.useEffect(() => {
    document.documentElement.style.setProperty("--right-w", `${rightPanelWidth}px`);
  }, [rightPanelWidth]);

  const { selectedEntityId } = useDiagramStore();

  /* ── Keyboard shortcuts (match legacy App.jsx behavior) ────────── */
  const [showShortcuts, setShowShortcuts] = useState(false);
  useEffect(() => {
    const handler = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "s") {
        e.preventDefault();
        (async () => {
          await useWorkspaceStore.getState().saveCurrentFile();
          const { lastAutoGeneratedDdl: gen, lastAutoGenerateError: genErr } = useWorkspaceStore.getState();
          if (gen) addToast({ type: "success", message: `Auto-generated DDL: ${gen}` });
          else if (genErr) addToast({ type: "error", message: `Auto DDL failed: ${genErr}` });
          else addToast({ type: "success", message: "Saved model." });
        })();
        return;
      }
      if (meta && e.key === "k") { e.preventDefault(); setCommandPaletteOpen(true); return; }
      if (meta && e.key === "j") { e.preventDefault(); toggleBottomPanel(); return; }
      if (meta && e.shiftKey && (e.key === "t" || e.key === "T")) { e.preventDefault(); cycleTheme(); return; }
      if (meta && e.key === "Tab") {
        const { openProjects: op } = useWorkspaceStore.getState();
        if (op.length > 1) { e.preventDefault(); cycleProject(e.shiftKey ? -1 : 1); return; }
      }
      if (meta && e.key === "w") {
        const ws = useWorkspaceStore.getState();
        if (ws.activeProjectId && ws.openProjects.length > 0) {
          e.preventDefault();
          if (ws.isDirty) {
            const p = ws.projects.find((x) => x.id === ws.activeProjectId);
            if (!window.confirm(`${p?.name || ws.activeProjectId} has unsaved changes. Close without saving?`)) return;
          }
          ws.closeProject(ws.activeProjectId);
          return;
        }
      }
      if (!isInput && e.key === "?") { setShowShortcuts((v) => !v); return; }
      if (e.key === "Escape" && showShortcuts) { setShowShortcuts(false); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showShortcuts, cycleTheme, cycleProject, toggleBottomPanel, setCommandPaletteOpen, addToast]);

  /* ── Auto-switch bottom tab when entity selected ───────────────── */
  useEffect(() => {
    if (selectedEntityId) setBottomPanelTab("properties");
  }, [selectedEntityId, setBottomPanelTab]);

  /* ── Current git branch (displayed on project tabs bar) ───────── */
  const [branch, setBranch] = useState("main");
  useEffect(() => {
    if (!activeProjectId) { setBranch("main"); return; }
    let cancelled = false;
    fetchGitStatus(activeProjectId)
      .then((s) => { if (!cancelled && s?.branch) setBranch(s.branch); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeProjectId, activeModal /* refresh after branch dialog closes */]);

  /* ── Surface store errors as toasts ────────────────────────────── */
  useEffect(() => {
    if (error) { addToast({ type: "error", message: error }); clearError(); }
  }, [error, clearError, addToast]);

  /* ── User initials for top-right chip ──────────────────────────── */
  const userInitials = React.useMemo(() => {
    const name = String(user?.name || user?.username || "DL");
    return name.split(/\s+/).map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "DL";
  }, [user]);

  /* ── Schema source: adapt active YAML; fall back to demo ───────── */
  const adapted = React.useMemo(() => adaptDataLexYaml(activeFileContent), [activeFileContent]);
  const schema = adapted || DEMO_SCHEMA;
  const isDemo = !adapted;

  /* Raw index list straight from the YAML, used by the inspector's
     IndexesView. Parsed lazily and cached per content change — js-yaml
     is already a dep so no extra cost. */
  const rawIndexes = React.useMemo(() => {
    if (!activeFileContent) return [];
    try {
      const doc = yaml.load(activeFileContent);
      return doc && Array.isArray(doc.indexes) ? doc.indexes : [];
    } catch (_e) { return []; }
  }, [activeFileContent]);

  /* ── Layout persistence (localStorage; keyed per project+file) ─── */
  const layoutKey = React.useMemo(() => {
    if (!activeProjectId || !activeFile) return null;
    const fp = activeFile.fullPath || activeFile.name || activeFile.id || "";
    return `datalex.layout.${activeProjectId}.${fp}`;
  }, [activeProjectId, activeFile]);

  const loadStoredLayout = React.useCallback(() => {
    if (!layoutKey) return {};
    try {
      const raw = localStorage.getItem(layoutKey);
      return raw ? JSON.parse(raw) : {};
    } catch (_e) { return {}; }
  }, [layoutKey]);

  /* ── Tables state (local copy so drag-move works + layout merge) ─ */
  const [tables, setTables] = React.useState(() => {
    const stored = layoutKey ? loadStoredLayout() : {};
    return schema.tables.map((t) => (stored[t.id] ? { ...t, ...stored[t.id] } : t));
  });
  React.useEffect(() => {
    const stored = loadStoredLayout();
    setTables(schema.tables.map((t) => (stored[t.id] ? { ...t, ...stored[t.id] } : t)));
  }, [schema, loadStoredLayout]);

  // Debounced write of positions back to localStorage whenever tables move.
  const saveLayoutTimer = React.useRef(null);
  React.useEffect(() => {
    if (!layoutKey) return;
    if (saveLayoutTimer.current) clearTimeout(saveLayoutTimer.current);
    saveLayoutTimer.current = setTimeout(() => {
      try {
        const map = {};
        tables.forEach((t) => { map[t.id] = { x: t.x, y: t.y }; });
        localStorage.setItem(layoutKey, JSON.stringify(map));
      } catch (_e) { /* quota or disabled storage — ignore */ }
    }, 300);
    return () => clearTimeout(saveLayoutTimer.current);
  }, [tables, layoutKey]);

  /* ── Diagram selection (luna panel) ────────────────────────────── */
  const [selected, setSelected] = React.useState(() =>
    schema.tables[0] ? { type: "table", id: schema.tables[0].id } : null
  );
  const [selectedCol, setSelectedCol] = React.useState(() =>
    schema.tables[0]?.columns[0]?.name || null
  );
  React.useEffect(() => {
    if (schema.tables[0]) {
      setSelected({ type: "table", id: schema.tables[0].id });
      setSelectedCol(schema.tables[0].columns[0]?.name || null);
    } else {
      setSelected(null);
      setSelectedCol(null);
    }
  }, [schema]);

  const activeTable = selected?.type === "table" ? tables.find((t) => t.id === selected.id) : null;
  const activeRel = selected?.type === "rel" ? schema.relationships.find((r) => r.id === selected.id) : null;

  const handleSelect = (sel) => {
    if (sel == null) { setSelected(null); return; }
    if (typeof sel === "string") {
      setSelected({ type: "table", id: sel });
      const t = tables.find((x) => x.id === sel);
      if (t) setSelectedCol(t.columns[0]?.name);
    } else {
      setSelected(sel);
      if (sel.type === "table") {
        const t = tables.find((x) => x.id === sel.id);
        if (t) setSelectedCol(t.columns[0]?.name);
      }
    }
  };

  /* ── Legend ────────────────────────────────────────────────────── */
  const [legendOpen, setLegendOpen] = React.useState(false);

  /* ── Project tabs: derive from workspace openProjects ─────────── */
  const projectTabs = React.useMemo(() => {
    if (!projects.length) return [];
    const orderedIds = openProjects.length ? openProjects : projects.map((p) => p.id);
    return orderedIds
      .map((id) => projects.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        name: p.name?.endsWith(".dlx") ? p.name : `${p.name}`,
        color: "var(--accent)",
        dirty: p.id === activeProjectId ? isDirty : false,
      }));
  }, [projects, openProjects, activeProjectId, isDirty]);

  const schemaList = React.useMemo(
    () => [{ name: schema.schema || "public", count: tables.length }],
    [schema.schema, tables.length]
  );

  const subjectAreaTreeItems = React.useMemo(
    () => (schema.subjectAreas || []).map((a) => ({ id: a.id, label: a.label, cat: a.cat })),
    [schema.subjectAreas]
  );

  /* ── Handlers wiring TopBar / tabs / tree into store ───────────── */
  const handleNewProject = () => openModal("addProject");
  const handleCloseProject = (pid) => {
    const ws = useWorkspaceStore.getState();
    if (ws.activeProjectId === pid && ws.isDirty) {
      const p = ws.projects.find((x) => x.id === pid);
      if (!window.confirm(`${p?.name || pid} has unsaved changes. Close without saving?`)) return;
    }
    closeProject(pid);
  };
  const handleNewTable = () => {
    if (activeFile) openModal("newFile");
    else addToast({ type: "error", message: "Open a project first." });
  };

  /* ── Entity add / delete (wired through yamlPatch helpers) ─────── */
  const handleAddEntity = React.useCallback((kind) => {
    const s = useWorkspaceStore.getState();
    if (!s.activeFile) { addToast({ type: "error", message: "Open a file first." }); return; }
    const isEnum = kind === "ENUMS";
    const label = isEnum ? "enum" : "entity";
    const name = window.prompt(`New ${label} name (e.g. ${isEnum ? "order_status" : "customer"})`);
    if (!name || !name.trim()) return;
    const clean = name.trim();
    const spec = isEnum
      ? { name: clean, type: "enum", values: [] }
      : { name: clean, type: "entity", fields: [{ name: "id", type: "uuid", primary_key: true }] };
    const next = appendEntity(s.activeFileContent, spec);
    if (next == null) {
      addToast({ type: "error", message: `Could not add ${label} — invalid YAML or duplicate name.` });
      return;
    }
    s.updateContent(next);
    addToast({ type: "success", message: `Added ${label} “${clean}”.` });
  }, [addToast]);

  const handleDeleteEntity = React.useCallback((entityName) => {
    if (!entityName) return;
    const s = useWorkspaceStore.getState();
    if (!s.activeFile) return;
    if (!window.confirm(`Delete entity “${entityName}”? This removes all fields and any relationships referencing it.`)) return;
    const next = deleteEntity(s.activeFileContent, entityName);
    if (next == null) { addToast({ type: "error", message: "Could not delete — invalid YAML." }); return; }
    s.updateContent(next);
    setSelected(null);
    addToast({ type: "success", message: `Deleted “${entityName}”.` });
  }, [addToast]);

  /* ── ELK auto-layout (palette action) ──────────────────────────── */
  const handleAutoLayout = React.useCallback(async () => {
    if (!tables.length) return;
    try {
      const mod = await import("../lib/elkLayout");
      const rfNodes = tables.map((t) => ({
        id: t.id,
        type: "entityNode",
        position: { x: t.x || 0, y: t.y || 0 },
        data: { fields: t.columns, subject_area: t.subject || t.cat },
      }));
      const rfEdges = (schema.relationships || []).map((r, i) => ({
        id: `e-${i}`,
        source: r.from?.table, target: r.to?.table,
      })).filter((e) => e.source && e.target);
      const { nodes: laid } = await mod.layoutWithElk(rfNodes, rfEdges, { density: "normal", groupBySubjectArea: false });
      const pos = new Map(laid.map((n) => [n.id, n.position]));
      setTables((prev) => prev.map((t) => {
        const p = pos.get(t.id);
        return p ? { ...t, x: Math.round(p.x), y: Math.round(p.y) } : t;
      }));
      addToast({ type: "success", message: "Auto-layout applied." });
    } catch (err) {
      addToast({ type: "error", message: `Auto-layout failed: ${err.message || err}` });
    }
  }, [tables, schema.relationships, addToast]);

  const activeBottomTabs = React.useMemo(
    () => ALL_BOTTOM_TABS.filter((t) => !t.adminOnly || (canEdit && canEdit())),
    [canEdit]
  );

  /* ── Render gates ──────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="auth-fullscreen">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--accent)", display: "grid", placeItems: "center" }}>
            <RefreshCw size={18} color="#fff" style={{ animation: "spin 1s linear infinite" }} />
          </div>
          <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Loading…</p>
        </div>
      </div>
    );
  }
  if (!isAuthenticated) {
    return <div className="auth-fullscreen"><LoginPage /></div>;
  }

  /* ── Shell render ──────────────────────────────────────────────── */
  return (
    <div className={`app ${bottomPanelOpen ? "with-bottom" : ""} ${rightPanelOpen ? "" : "no-right"}`}>
      <TopBar
        onOpenCmd={() => setCommandPaletteOpen(true)}
        theme={theme}
        setTheme={setTheme}
        onNewTable={handleNewTable}
        onNewFile={() => (activeProjectId ? openModal("newFile") : openModal("addProject"))}
        onOpenFile={() => openModal("addProject")}
        onSave={async () => {
          if (!activeFile) return addToast({ type: "error", message: "No file to save." });
          await saveCurrentFile();
          const s = useWorkspaceStore.getState();
          if (s.lastAutoGeneratedDdl) addToast({ type: "success", message: `DDL: ${s.lastAutoGeneratedDdl}` });
          else if (s.lastAutoGenerateError) addToast({ type: "error", message: `DDL failed: ${s.lastAutoGenerateError}` });
          else addToast({ type: "success", message: "Saved." });
        }}
        onSettings={() => openModal("settings")}
        onConnections={() => openModal("connectionsManager")}
        onCommit={() => openModal("commit")}
        onRunSql={() => openModal("exportDdl")}
        onImport={() => openModal("importDialog")}
        onSearch={() => setCommandPaletteOpen(true)}
        onOpenShortcuts={() => setShowShortcuts(true)}
        isDirty={isDirty}
        canSave={!!activeFile}
        userInitials={userInitials}
        userName={user?.name || user?.username || "DataLex"}
      />

      <ProjectTabs
        projects={projectTabs}
        activeId={activeProjectId}
        onSelect={(id) => selectProject(id)}
        onClose={handleCloseProject}
        onNew={handleNewProject}
        branchName={branch}
        onBranchClick={() => activeProjectId && openModal("gitBranch")}
      />

      <LeftPanel
        activeTable={selected?.type === "table" ? selected.id : null}
        onSelectTable={(id) => handleSelect({ type: "table", id })}
        tables={tables}
        theme={theme}
        setTheme={setTheme}
        subjectAreas={subjectAreaTreeItems}
        schemas={schemaList}
        connectionLabel={isDemo ? "prod-analytics-01" : (activeFile?.name || activeProjectId || "workspace")}
        connectionDsn={isDemo ? "postgres://…5432/subscriptions" : `datalex://${activeProjectId || "local"}`}
        onAddEntity={handleAddEntity}
      />

      {/* Main canvas cell swaps based on the top-bar ViewSwitcher.
          Only one surface mounts at a time; the others lazy-load on first
          click so the diagram path is not penalised. */}
      {shellViewMode === "diagram" && (
        <Canvas
          tables={tables}
          setTables={setTables}
          relationships={schema.relationships}
          areas={schema.subjectAreas || []}
          selected={selected}
          onSelect={handleSelect}
          title={schema.name}
          engine={schema.engine}
          legendOpen={legendOpen}
          setLegendOpen={setLegendOpen}
        />
      )}
      {shellViewMode === "table" && (
        <React.Suspense fallback={<div className="shell-view" style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 12 }}>Loading table view…</div>}>
          <TableView
            tables={tables}
            relationships={schema.relationships}
            activeTableId={selected?.type === "table" ? selected.id : null}
            onSelectTable={(id) => handleSelect({ type: "table", id })}
          />
        </React.Suspense>
      )}
      {shellViewMode === "views" && (
        <React.Suspense fallback={<div className="shell-view" style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 12 }}>Loading views…</div>}>
          <ViewsView
            onSelectTable={(id) => handleSelect({ type: "table", id })}
          />
        </React.Suspense>
      )}
      {shellViewMode === "enums" && (
        <React.Suspense fallback={<div className="shell-view" style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 12 }}>Loading enums…</div>}>
          <EnumsView />
        </React.Suspense>
      )}

      {rightPanelOpen && (
        <RightPanel
          table={activeTable}
          rel={activeRel}
          tables={tables}
          selectedCol={selectedCol}
          setSelectedCol={setSelectedCol}
          relationships={schema.relationships}
          indexes={rawIndexes}
          onSelectRel={handleSelect}
          onDeleteEntity={handleDeleteEntity}
          onExportDdl={() => openModal("exportDdl")}
        />
      )}

      {bottomPanelOpen && (
        <BottomDrawer tabs={activeBottomTabs}>
          <BottomPanelContent tab={bottomPanelTab} />
        </BottomDrawer>
      )}

      {!bottomPanelOpen && (
        <button className="bottom-reopen" onClick={toggleBottomPanel} title="Open panel (⌘J)">
          <ChevronUp size={12} /> Panel
        </button>
      )}

      <StatusBar
        density={density}
        setDensity={setDensity}
        tableCount={tables.length}
        relCount={schema.relationships.length}
        engine={schema.engine}
        saved={isDemo ? "Demo schema" : (isDirty ? "Unsaved" : `${openTabs.length} open`)}
        connectionState={isDemo ? "Demo mode" : "Connected"}
        bottomPanelOpen={bottomPanelOpen}
        onTogglePanel={toggleBottomPanel}
      />

      {/* Luna-style palette with real handlers for built-in actions. Extra
          actions (viewer welcome, git branch, …) are appended via
          extraCommands. The older LegacyCommandPalette remains available as
          a fallback if a user opts into it via a future setting. */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        tables={tables}
        onSelectTable={(id) => { handleSelect({ type: "table", id }); setCommandPaletteOpen(false); }}
        handlers={{
          newTable:        () => handleNewTable(),
          newRelationship: () => addToast({ type: "info", message: "New relationship — use the YAML tab." }),
          autoLayout:      () => handleAutoLayout(),
          exportSql:       () => openModal("exportDdl"),
          cycleTheme:      () => cycleTheme(),
        }}
        extraCommands={[
          { id: "welcome",    section: "Help",    label: "Show Viewer welcome",    meta: "",    icon: <span style={{ fontSize: 12 }}>👋</span>, run: () => openModal("welcome") },
          { id: "git-branch", section: "Git",     label: "Switch / create branch", meta: "",    icon: <span style={{ fontSize: 12 }}>⎇</span>,  run: () => activeProjectId && openModal("gitBranch") },
          { id: "commit",     section: "Git",     label: "Commit changes…",        meta: "",    icon: <span style={{ fontSize: 12 }}>✓</span>,  run: () => openModal("commit") },
          { id: "settings",   section: "Actions", label: "Settings…",              meta: "",    icon: <span style={{ fontSize: 12 }}>⚙</span>,  run: () => openModal("settings") },
          { id: "connect",    section: "Actions", label: "Manage connections…",    meta: "",    icon: <span style={{ fontSize: 12 }}>⛁</span>,  run: () => openModal("connectionsManager") },
          { id: "import",     section: "Actions", label: "Import schema…",         meta: "",    icon: <span style={{ fontSize: 12 }}>⇩</span>,  run: () => openModal("importDialog") },
        ]}
      />

      {/* Modals (lazy-loaded where heavy) */}
      <React.Suspense fallback={null}>
        {activeModal === "addProject"         && <AddProjectModal />}
        {activeModal === "editProject"        && <EditProjectModal />}
        {activeModal === "newFile"            && <NewFileModal />}
        {activeModal === "settings"           && <SettingsDialog />}
        {activeModal === "connectionsManager" && <ConnectionsManager />}
        {activeModal === "commit"             && <CommitDialog />}
        {activeModal === "exportDdl"          && <ExportDdlDialog />}
        {activeModal === "importDialog"       && <PanelDialog kind="import" />}
        {activeModal === "gitBranch"          && <GitBranchDialog />}
        {activeModal === "welcome"            && <WelcomeModal onClose={closeModal} />}
      </React.Suspense>

      {showShortcuts && <KeyboardShortcutsPanel onClose={() => setShowShortcuts(false)} />}

      <ToastContainer />
    </div>
  );
}
