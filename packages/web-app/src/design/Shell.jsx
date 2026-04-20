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

import { TopBar, ProjectTabs, StatusBar } from "./Chrome";
import LeftPanel from "./LeftPanel";
import Canvas from "./Canvas";
import RightPanel from "./RightPanel";
import CommandPalette from "./CommandPalette";
import { DEMO_SCHEMA } from "./demoSchema";
import { THEMES } from "./notation";
import { adaptDataLexYaml } from "./schemaAdapter";

// Legacy panels & dialogs (reused, not re-ported)
import ModelerPanel from "../components/panels/ModelerPanel";
import EntityPanel from "../components/panels/EntityPanel";
import LibrariesPanel from "../components/panels/LibrariesPanel";
import SubjectAreasPanel from "../components/panels/SubjectAreasPanel";
import ValidationPanel from "../components/panels/ValidationPanel";
import DiffPanel from "../components/panels/DiffPanel";
import ImpactPanel from "../components/panels/ImpactPanel";
import HistoryPanel from "../components/panels/HistoryPanel";
import ModelGraphPanel from "../components/panels/ModelGraphPanel";
import DictionaryPanel from "../components/panels/DictionaryPanel";
import KeyboardShortcutsPanel from "../components/panels/KeyboardShortcutsPanel";
import SettingsDialog from "../components/dialogs/SettingsDialog";
import ConnectionsManager from "../components/dialogs/ConnectionsManager";
import CommitDialog from "../components/dialogs/CommitDialog";
import LegacyCommandPalette from "../components/dialogs/CommandPalette";
import {
  AddProjectModal,
  EditProjectModal,
  NewFileModal,
} from "../components/dialogs/ProjectModals";
import LoginPage from "../components/auth/LoginPage";
import ViewerWelcome from "../components/viewer/ViewerWelcome";

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

function BottomPanelContent({ tab }) {
  switch (tab) {
    case "modeler":       return <ModelerPanel />;
    case "properties":    return <EntityPanel />;
    case "libraries":     return <LibrariesPanel />;
    case "subject-areas": return <SubjectAreasPanel />;
    case "validation":    return <ValidationPanel />;
    case "diff":          return <DiffPanel />;
    case "impact":        return <ImpactPanel />;
    case "model-graph":   return <ModelGraphPanel />;
    case "dictionary":    return <DictionaryPanel />;
    case "history":       return <HistoryPanel />;
    default:              return <EntityPanel />;
  }
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
    rightPanelOpen, commandPaletteOpen, setCommandPaletteOpen,
    addToast,
  } = useUiStore();

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

  /* ── Tables state (local copy so drag-move works visually) ─────── */
  const [tables, setTables] = React.useState(schema.tables);
  React.useEffect(() => { setTables(schema.tables); }, [schema]);

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
        color: "#5b8cff",
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
    <div className={`app ${bottomPanelOpen ? "with-bottom" : ""}`}>
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
        onRunSql={() => setBottomPanelTab("diff")}
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
        branchName="main"
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
      />

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

      {rightPanelOpen && (
        <RightPanel
          table={activeTable}
          rel={activeRel}
          tables={tables}
          selectedCol={selectedCol}
          setSelectedCol={setSelectedCol}
        />
      )}

      {bottomPanelOpen && (
        <div className="bottom-drawer">
          <div className="bottom-drawer-tabs">
            {activeBottomTabs.map(({ id, label, icon: Icon }) => (
              <button key={id}
                      className={`bottom-drawer-tab ${bottomPanelTab === id ? "active" : ""}`}
                      onClick={() => setBottomPanelTab(id)}>
                <Icon />
                {label}
              </button>
            ))}
            <button className="bottom-drawer-close" onClick={toggleBottomPanel} title="Close panel (⌘J)">
              <X size={14} />
            </button>
          </div>
          <div className="bottom-drawer-body">
            <div className="legacy-panel-root">
              <BottomPanelContent tab={bottomPanelTab} />
            </div>
          </div>
        </div>
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
      />

      {/* Luna-style palette (visual) + legacy palette (full actions, ⌘K) */}
      <CommandPalette
        open={false}
        onClose={() => {}}
        tables={tables}
        onSelectTable={(id) => handleSelect({ type: "table", id })}
      />

      {commandPaletteOpen && <LegacyCommandPalette />}

      {/* Modals */}
      {activeModal === "addProject"         && <AddProjectModal />}
      {activeModal === "editProject"        && <EditProjectModal />}
      {activeModal === "newFile"            && <NewFileModal />}
      {activeModal === "settings"           && <SettingsDialog />}
      {activeModal === "connectionsManager" && <ConnectionsManager />}
      {activeModal === "commit"             && <CommitDialog />}

      {showShortcuts && <KeyboardShortcutsPanel onClose={() => setShowShortcuts(false)} />}

      <ToastContainer />
    </div>
  );
}
