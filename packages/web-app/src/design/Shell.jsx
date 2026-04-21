/* DataLex shell — integrated root. Combines the Luna-class visual design
   (topbar / project tabs / left / canvas / right / status) with the full
   DataLex feature set (real projects from the api-server, bottom drawer
   with all legacy panels, all existing dialogs, keyboard shortcuts).

   This file replaces App.jsx. Visual layout comes from datalex-design.css;
   the bottom-drawer row + dirty dot come from datalex-integration.css. */
import React, { useEffect, useState } from "react";
import {
  Columns3, ShieldCheck, GitCompare, Activity, Network, Clock, X,
  Wand2, LibraryBig, Map, BookOpen, ChevronUp,
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
import { adaptDataLexYaml, adaptDataLexModelYaml, adaptDiagramYaml } from "./schemaAdapter";
import { appendEntity, deleteEntityDeep, setEntityDisplay, setDiagramEntityDisplay } from "./yamlPatch";

import { fetchGitStatus } from "../lib/api";
import {
  AddProjectModal,
  EditProjectModal,
  NewFileModal,
} from "../components/dialogs/ProjectModals";
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
const ImportDbtRepoDialog = React.lazy(() => import("../components/dialogs/ImportDbtRepoDialog"));
const NewRelationshipDialog = React.lazy(() => import("../components/dialogs/NewRelationshipDialog"));
const BulkRenameColumnDialog = React.lazy(() => import("../components/dialogs/BulkRenameColumnDialog"));
const ShareBundleDialog   = React.lazy(() => import("../components/dialogs/ShareBundleDialog"));
const SnapshotsDialog     = React.lazy(() => import("../components/dialogs/SnapshotsDialog"));
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

  /* ── Identity (open-source: permissive stub, see stores/authStore.js) ── */
  const { canEdit } = useAuthStore();

  /* ── Workspace ─────────────────────────────────────────────────── */
  const {
    projects, activeProjectId, openProjects, openTabs, activeFile,
    activeFileContent, isDirty, loadProjects, selectProject, closeProject,
    cycleProject, saveCurrentFile, error, clearError,
    lastAutoGeneratedDdl, lastAutoGenerateError,
    projectFiles, fileContentCache, ensureFilesLoaded,
  } = useWorkspaceStore();

  useEffect(() => { loadProjects(); }, []);

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
      // Undo / Redo. CodeMirror handles these when focused in the YAML
      // editor itself; we only intercept outside input targets so editing
      // text in the inspector keeps native undo behaviour.
      if (meta && !isInput && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        const ok = useWorkspaceStore.getState().undo();
        if (!ok) addToast({ type: "info", message: "Nothing to undo." });
        return;
      }
      if (meta && !isInput && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        const ok = useWorkspaceStore.getState().redo();
        if (!ok) addToast({ type: "info", message: "Nothing to redo." });
        return;
      }
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

      // v0.3.4 — "c" recenters the canvas on the selected entity. No meta
      // modifier (so Cmd+C / Ctrl+C stay for copy), no input target. We
      // find the currently-selected table card by querying the DOM
      // (`.table-card.selected`) rather than closing over a state
      // variable — the keydown effect is installed early in render, well
      // before the `selected` state hook is declared, so referencing it
      // from here would hit JavaScript's temporal dead zone.
      if (!isInput && !meta && (e.key === "c" || e.key === "C")) {
        const card = document.querySelector(".table-card.selected");
        if (!card) return;
        e.preventDefault();
        // scrollIntoView's "center" option positions the card in the
        // middle of the nearest scrolling ancestor — that's `.canvas` in
        // our layout. Behaviour:smooth keeps the jump easy on the eye.
        try {
          card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        } catch {
          card.scrollIntoView({ block: "center", inline: "center" });
        }
        return;
      }
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

  /* ── Schema source: adapt active YAML; fall back to demo ─────────
     "Demo mode" = we have no real project on disk (the offline sample
     fixture). If the user has a registered project but the active file
     just doesn't parse as a DataLex model (e.g. a raw dbt schema.yml),
     show an empty diagram — NOT the Subscription Tracking demo — so the
     workspace chip / status bar / canvas all reflect reality.

     Diagram files (`.diagram.yaml`) compose entities from N referenced
     model files, so we route them through `adaptDiagramYaml` and pass
     the full projectFiles list as the lookup. */
  const isDiagramFile = React.useMemo(() => {
    const n = activeFile?.name || "";
    return /\.diagram\.ya?ml$/i.test(n);
  }, [activeFile]);

  /* Merge `fileContentCache` contents into the projectFiles list so the
     diagram adapter has `file.content` for each referenced path. Without
     this the list from `/api/projects/:id/files` is metadata-only and
     every diagram renders empty. */
  const filesForDiagram = React.useMemo(() => {
    if (!isDiagramFile) return projectFiles;
    const cache = fileContentCache || {};
    return (projectFiles || []).map((f) => {
      const key = (f?.fullPath || f?.path || "").replace(/^[/\\]+/, "");
      if (typeof f?.content === "string") return f;
      if (key && typeof cache[key] === "string") return { ...f, content: cache[key] };
      return f;
    });
  }, [isDiagramFile, projectFiles, fileContentCache]);

  /* When viewing a diagram file, prefetch any referenced file contents so
     the adapter can render them. The store's `ensureFilesLoaded` skips
     already-cached paths, so this is a no-op on subsequent renders. */
  React.useEffect(() => {
    if (!isDiagramFile || !activeFileContent) return;
    let paths = [];
    try {
      const doc = yaml.load(activeFileContent);
      if (doc && Array.isArray(doc.entities)) {
        paths = doc.entities
          .map((e) => String(e?.file || "").replace(/^[/\\]+/, ""))
          .filter(Boolean);
      }
    } catch (_e) { /* malformed — nothing to prefetch */ }
    if (paths.length > 0) ensureFilesLoaded(paths);
  }, [isDiagramFile, activeFileContent, ensureFilesLoaded]);

  const adapted = React.useMemo(() => {
    if (isDiagramFile) return adaptDiagramYaml(activeFileContent, filesForDiagram);
    // Try canonical DataLex (entities:) first, then the dbt-importer shape
    // (kind: model / kind: source with top-level columns:). Without the
    // second pass, opening an imported stg_*.yml directly renders nothing.
    return adaptDataLexYaml(activeFileContent) || adaptDataLexModelYaml(activeFileContent);
  }, [activeFileContent, isDiagramFile, filesForDiagram]);
  const isDemo = useWorkspaceStore((s) => s.offlineMode && !s.activeProjectId);
  const emptySchema = React.useMemo(
    () => ({ name: "Project", engine: "DataLex", schema: "public", tables: [], relationships: [], subjectAreas: [] }),
    []
  );
  const schema = adapted || (isDemo ? DEMO_SCHEMA : emptySchema);

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

  /* v0.4.1 — top-bar domain switcher. Turns the adapted `subjectAreas`
     into the switcher's data model (name, count, color) and tallies
     how many tables have no `subject_area` at all so we can render the
     "Unassigned" section. Derived from `schema.tables` rather than
     the post-filter `tables` state so the switcher counts the full
     model, not whichever subset is currently shown. */
  const topBarDomains = React.useMemo(() => {
    const raw = Array.isArray(schema.subjectAreas) ? schema.subjectAreas : [];
    return raw
      .map((a) => ({
        name: a.name || a.label || a.id,
        count: Number.isFinite(a.count) ? a.count : 0,
        color: a.color,
      }))
      .filter((d) => !!d.name);
  }, [schema.subjectAreas]);

  const unassignedCount = React.useMemo(
    () => (schema.tables || []).reduce((n, t) => n + (t?.subject_area ? 0 : 1), 0),
    [schema.tables]
  );
  const hasUnassignedInModel = unassignedCount > 0 && topBarDomains.length > 0;

  /* Filter the post-layout `tables` down to the selected domain. The
     relationships array also gets filtered so dangling edges don't
     linger after the endpoints leave the canvas. When no filter is
     active we pass everything through unchanged — the filter work is
     cheap enough (O(n)) that memoising on the raw arrays is enough. */
  const activeSchemaFilter = useDiagramStore((s) => s.activeSchemaFilter);
  const UNASSIGNED_DOMAIN = "__unassigned_subject_area__";
  const filteredTables = React.useMemo(() => {
    if (!activeSchemaFilter) return tables;
    if (activeSchemaFilter === UNASSIGNED_DOMAIN) {
      return tables.filter((t) => !t?.subject_area);
    }
    return tables.filter((t) => t?.subject_area === activeSchemaFilter);
  }, [tables, activeSchemaFilter]);
  const filteredTableIds = React.useMemo(
    () => new Set(filteredTables.map((t) => t.id)),
    [filteredTables]
  );
  const filteredRelationships = React.useMemo(() => {
    const rels = schema.relationships || [];
    if (!activeSchemaFilter) return rels;
    return rels.filter((r) => filteredTableIds.has(r.from?.table) && filteredTableIds.has(r.to?.table));
  }, [schema.relationships, activeSchemaFilter, filteredTableIds]);

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
    if (!window.confirm(`Delete entity “${entityName}”? This removes its fields and every relationship, index, metric, and governance entry referencing it.`)) return;
    const result = deleteEntityDeep(s.activeFileContent, entityName);
    if (!result) {
      addToast({ type: "error", message: `Could not delete “${entityName}” — entity not found or YAML invalid.` });
      return;
    }
    s.updateContent(result.yaml);
    setSelected(null);
    const extras = [];
    if (result.impact.relationships) extras.push(`${result.impact.relationships} relationship${result.impact.relationships === 1 ? "" : "s"}`);
    if (result.impact.indexes)       extras.push(`${result.impact.indexes} index${result.impact.indexes === 1 ? "" : "es"}`);
    if (result.impact.metrics)       extras.push(`${result.impact.metrics} metric${result.impact.metrics === 1 ? "" : "s"}`);
    if (result.impact.governance)    extras.push(`${result.impact.governance} governance entr${result.impact.governance === 1 ? "y" : "ies"}`);
    const suffix = extras.length ? ` (also removed ${extras.join(", ")})` : "";
    addToast({ type: "success", message: `Deleted “${entityName}”${suffix}.` });
    // Nudge read-only graph panels that key off modelGraphVersion so they
    // refetch instead of showing a stale cascade.
    s.bumpModelGraphVersion?.();
  }, [addToast]);

  /* ── ELK auto-layout (palette action) ──────────────────────────────
   * v0.3.4: respects `manualPosition` — entities the user has already
   * dragged (persisted to YAML `display.x/y` or diagram ref x/y) stay
   * put. ELK is only asked to place tables that have no manual position
   * yet, and we nudge the result so it doesn't overlap the locked set.
   * A "locked" node is submitted to ELK in its existing coordinates so
   * the layered algorithm routes around it when possible. If nothing is
   * locked, behaviour is identical to pre-0.3.4 (full relayout). */
  const handleAutoLayout = React.useCallback(async () => {
    if (!tables.length) return;
    try {
      const mod = await import("../lib/elkLayout");
      const rfNodes = tables.map((t) => ({
        id: t.id,
        type: "entityNode",
        position: { x: t.x || 0, y: t.y || 0 },
        data: {
          fields: t.columns,
          subject_area: t.subject || t.cat,
          manualPosition: !!t.manualPosition,
        },
      }));
      const rfEdges = (schema.relationships || []).map((r, i) => ({
        id: `e-${i}`,
        source: r.from?.table, target: r.to?.table,
      })).filter((e) => e.source && e.target);

      const lockedIds = new Set(tables.filter((t) => t.manualPosition).map((t) => t.id));
      const lockedCount = lockedIds.size;

      // Fast path: nothing locked → behave like before.
      if (lockedCount === 0) {
        const { nodes: laid } = await mod.layoutWithElk(rfNodes, rfEdges, { density: "normal", groupBySubjectArea: false });
        const pos = new Map(laid.map((n) => [n.id, n.position]));
        setTables((prev) => prev.map((t) => {
          const p = pos.get(t.id);
          return p ? { ...t, x: Math.round(p.x), y: Math.round(p.y) } : t;
        }));
        addToast({ type: "success", message: "Auto-layout applied." });
        return;
      }

      // Split: layout only the non-locked subset. Edges are kept when at
      // least one end is in the subset — those dangle into the locked
      // region and help ELK's layered pass place children near parents.
      const unlockedNodes = rfNodes.filter((n) => !lockedIds.has(n.id));
      const allIds = new Set(rfNodes.map((n) => n.id));
      const subsetIds = new Set(unlockedNodes.map((n) => n.id));
      const subsetEdges = rfEdges.filter(
        (e) => allIds.has(e.source) && allIds.has(e.target) && (subsetIds.has(e.source) || subsetIds.has(e.target))
      );

      // If every entity is locked there's nothing to do.
      if (unlockedNodes.length === 0) {
        addToast({ type: "info", message: "All entities are manually placed — nothing to auto-layout." });
        return;
      }

      const { nodes: laid } = await mod.layoutWithElk(unlockedNodes, subsetEdges, {
        density: "normal",
        groupBySubjectArea: false,
      });

      // ELK lays out relative to its own origin; offset the result so the
      // freshly-placed block sits to the right of the locked cluster and
      // doesn't stomp on it.
      let offsetX = 0;
      let offsetY = 0;
      const lockedTables = tables.filter((t) => t.manualPosition);
      if (lockedTables.length > 0) {
        const lockedMaxX = Math.max(...lockedTables.map((t) => (t.x || 0) + (t.width || 280)));
        const lockedMinY = Math.min(...lockedTables.map((t) => t.y || 0));
        offsetX = Math.round(lockedMaxX + 80);
        offsetY = Math.round(lockedMinY);
      }

      const pos = new Map(
        laid.map((n) => [n.id, { x: n.position.x + offsetX, y: n.position.y + offsetY }])
      );
      setTables((prev) => prev.map((t) => {
        if (t.manualPosition) return t; // locked — don't touch
        const p = pos.get(t.id);
        return p ? { ...t, x: Math.round(p.x), y: Math.round(p.y) } : t;
      }));
      addToast({
        type: "success",
        message: `Auto-layout applied (${lockedCount} manually placed ${lockedCount === 1 ? "entity" : "entities"} preserved).`,
      });
    } catch (err) {
      addToast({ type: "error", message: `Auto-layout failed: ${err.message || err}` });
    }
  }, [tables, schema.relationships, addToast]);

  /* ── Persist moved node position to YAML `display:` ──────────────
   * Called by Canvas after a table drag completes. We round-trip through
   * `setEntityDisplay` → `updateContent`, which records the change in
   * history and flushes to the offline doc store. Cheap enough to run
   * synchronously on drag end; the mutate helper is ~microseconds on
   * jaffle-scale YAML. */
  const handleTableMoveEnd = React.useCallback((tableId) => {
    const t = tables.find((x) => x.id === tableId);
    if (!t) return;
    const s = useWorkspaceStore.getState();
    if (!s.activeFileContent) return;
    // When the active file is a diagram, positions live in the diagram
    // YAML's `entities[i].{x,y}` — keyed by (file, entity). Otherwise the
    // position belongs to the model file's `display:` block.
    const activeName = s.activeFile?.name || "";
    const activeIsDiagram = /\.diagram\.ya?ml$/i.test(activeName);
    let next;
    if (activeIsDiagram) {
      const sourceFile = t._sourceFile || "";
      if (!sourceFile) return;
      next = setDiagramEntityDisplay(s.activeFileContent, sourceFile, t.id, { x: t.x, y: t.y });
    } else {
      next = setEntityDisplay(s.activeFileContent, t.id, { x: t.x, y: t.y });
    }
    if (next && next !== s.activeFileContent) {
      s.updateContent(next);
    }
  }, [tables]);

  /* ── Drag-to-connect handoff to NewRelationshipDialog ─────────── */
  const handleCanvasConnect = React.useCallback((payload) => {
    openModal("newRelationship", payload);
  }, [openModal]);

  /* ── Drop a YAML source onto the canvas: append its file reference
         to the active diagram's `entities:` and prefetch content. Only
         wired when the active file is a .diagram.yaml. */
  const handleCanvasDropYamlSource = React.useCallback(async ({ path, x, y }) => {
    if (!isDiagramFile) {
      addToast({
        type: "info",
        message: "Open a .diagram.yaml file first, then drop models onto the canvas.",
      });
      return;
    }
    try {
      await useWorkspaceStore.getState().addDiagramReferences([
        { file: path, entity: "*", x, y },
      ]);
    } catch (err) {
      addToast({ type: "error", message: `Could not add to diagram: ${err?.message || err}` });
    }
  }, [isDiagramFile, addToast]);

  const activeBottomTabs = React.useMemo(
    () => ALL_BOTTOM_TABS.filter((t) => !t.adminOnly || (canEdit && canEdit())),
    [canEdit]
  );

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
        onSaveAll={async () => {
          try {
            const result = await useWorkspaceStore.getState().saveAllDirty();
            if (!result || result.total === 0) {
              addToast({ type: "info", message: "Nothing to save." });
            } else if (result.ok) {
              addToast({ type: "success", message: `Saved ${result.saved} file(s).` });
            } else {
              addToast({ type: "warning", message: `Saved ${result.saved}/${result.total}; some files failed.` });
            }
          } catch (err) {
            addToast({ type: "error", message: `Save all failed: ${err?.message || err}` });
          }
        }}
        canSaveAll={!!activeProjectId && !useWorkspaceStore.getState().offlineMode}
        onUndo={() => {
          const ok = useWorkspaceStore.getState().undo();
          if (!ok) addToast({ type: "info", message: "Nothing to undo." });
        }}
        onRedo={() => {
          const ok = useWorkspaceStore.getState().redo();
          if (!ok) addToast({ type: "info", message: "Nothing to redo." });
        }}
        onSettings={() => openModal("settings")}
        onConnections={() => openModal("connectionsManager")}
        onCommit={() => openModal("commit")}
        onRunSql={() => openModal("exportDdl")}
        onImport={() => openModal("importDialog")}
        onImportDbt={() => openModal("importDbtRepo")}
        onSearch={() => setCommandPaletteOpen(true)}
        isDirty={isDirty}
        canSave={!!activeFile}
        domains={topBarDomains}
        hasUnassigned={hasUnassignedInModel}
        unassignedCount={unassignedCount}
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
        connectionLabel={
          isDemo
            ? "demo workspace"
            : (projects.find((p) => p.id === activeProjectId)?.name || activeProjectId || "workspace")
        }
        connectionDsn={
          isDemo
            ? "offline sample project"
            : (projects.find((p) => p.id === activeProjectId)?.path || `datalex://${activeProjectId || "local"}`)
        }
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={(id) => selectProject(id)}
        onAddEntity={handleAddEntity}
      />

      {/* Main canvas cell swaps based on the top-bar ViewSwitcher.
          Only one surface mounts at a time; the others lazy-load on first
          click so the diagram path is not penalised. */}
      {shellViewMode === "diagram" && (
        <Canvas
          tables={filteredTables}
          setTables={setTables}
          relationships={filteredRelationships}
          areas={schema.subjectAreas || []}
          selected={selected}
          onSelect={handleSelect}
          onMoveEnd={handleTableMoveEnd}
          onConnect={handleCanvasConnect}
          onDropYamlSource={handleCanvasDropYamlSource}
          title={schema.name}
          engine={schema.engine}
          legendOpen={legendOpen}
          setLegendOpen={setLegendOpen}
        />
      )}
      {shellViewMode === "table" && (
        <React.Suspense fallback={<div className="shell-view" style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 12 }}>Loading table view…</div>}>
          <TableView
            tables={filteredTables}
            relationships={filteredRelationships}
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
          newRelationship: () => openModal("newRelationship", {
            // Give the dialog a picker over the current diagram's entities
            // so the user isn't forced to drag between column dots.
            tables: (tables || []).map((t) => ({
              id: t.id || t.name,
              name: t.name || t.id,
              columns: (t.columns || []).map((c) => ({ name: c.name })),
            })),
          }),
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
          { id: "import-dbt", section: "Actions", label: "Import dbt repo…",       meta: "",    icon: <span style={{ fontSize: 12 }}>⤓</span>,  run: () => openModal("importDbtRepo") },
          { id: "demo-jaffle",section: "Actions", label: "Load jaffle-shop demo",  meta: "",    icon: <span style={{ fontSize: 12 }}>✨</span>, run: () => openModal("importDbtRepo") },
          // v0.5.0 — stakeholder-share + snapshot flows. Share opens the
          // HTML bundle dialog prefilled from the currently-adapted schema;
          // snapshots routes through the new git-tag API.
          { id: "share-diagram", section: "Share", label: "Share diagram as HTML…", meta: "", icon: <span style={{ fontSize: 12 }}>⇪</span>, run: () => openModal("shareBundle", {
            title: schema?.name || activeFile?.name?.replace(/\.(diagram|model)\.ya?ml$/i, "") || "Diagram",
            projectName: (projects || []).find((p) => p.id === activeProjectId)?.name,
            tables: filteredTables,
            relationships: filteredRelationships,
            subjectAreas: schema?.subjectAreas || [],
          }) },
          { id: "snapshot-manage", section: "Share", label: "Snapshots (git tags)…", meta: "", icon: <span style={{ fontSize: 12 }}>⛒</span>, run: () => activeProjectId && openModal("snapshots") },
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
        {activeModal === "importDbtRepo"      && <ImportDbtRepoDialog />}
        {activeModal === "newRelationship"    && <NewRelationshipDialog />}
        {activeModal === "bulkRenameColumn"   && <BulkRenameColumnDialog />}
        {activeModal === "shareBundle"        && <ShareBundleDialog />}
        {activeModal === "snapshots"          && <SnapshotsDialog />}
        {activeModal === "gitBranch"          && <GitBranchDialog />}
        {activeModal === "welcome"            && <WelcomeModal onClose={closeModal} />}
      </React.Suspense>

      {showShortcuts && <KeyboardShortcutsPanel onClose={() => setShowShortcuts(false)} />}

      <ToastContainer />
    </div>
  );
}
