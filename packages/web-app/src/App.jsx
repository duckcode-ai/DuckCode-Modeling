import React, { useEffect, useState } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";

import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import StatusBar from "./components/layout/StatusBar";
import YamlEditor from "./components/editor/YamlEditor";
import DiagramCanvas from "./components/diagram/DiagramCanvas";
import EntityPanel from "./components/panels/EntityPanel";
import ValidationPanel from "./components/panels/ValidationPanel";
import DiffPanel from "./components/panels/DiffPanel";
import ImpactPanel from "./components/panels/ImpactPanel";
import HistoryPanel from "./components/panels/HistoryPanel";
import ModelGraphPanel from "./components/panels/ModelGraphPanel";
import DictionaryPanel from "./components/panels/DictionaryPanel";
import ImportPanel from "./components/panels/ImportPanel";
import ConnectorsPanel from "./components/panels/ConnectorsPanel";
import GlobalSearchPanel from "./components/panels/GlobalSearchPanel";
import KeyboardShortcutsPanel from "./components/panels/KeyboardShortcutsPanel";

import useUiStore from "./stores/uiStore";
import useWorkspaceStore from "./stores/workspaceStore";
import useDiagramStore from "./stores/diagramStore";

import {
  Columns3,
  ShieldCheck,
  GitCompare,
  Network,
  Clock,
  X,
  FolderPlus,
  Plus,
  Pencil,
  AlertCircle,
  Search,
  Database,
  BookOpen,
  Import,
} from "lucide-react";

const BOTTOM_TABS = [
  { id: "properties", label: "Properties", icon: Columns3 },
  { id: "validation", label: "Validation", icon: ShieldCheck },
  { id: "diff", label: "Diff & Gate", icon: GitCompare },
  { id: "impact", label: "Impact", icon: Network },
  { id: "model-graph", label: "Model Graph", icon: Network },
  { id: "dictionary", label: "Dictionary", icon: BookOpen },
  { id: "history", label: "History", icon: Clock },
];

function AddProjectModal() {
  const { closeModal } = useUiStore();
  const { addProjectFolder } = useWorkspaceStore();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [createIfMissing, setCreateIfMissing] = useState(true);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError("Both name and path are required");
      return;
    }
    try {
      await addProjectFolder(name.trim(), path.trim(), createIfMissing);
      closeModal();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
      <div className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl w-[420px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <FolderPlus size={16} className="text-accent-blue" />
            Add Project Folder
          </h3>
          <button onClick={closeModal} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Project Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. commerce-models"
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Folder Path (absolute)</label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="e.g. /Users/you/projects/models"
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Recommended: run DuckCodeModeling locally for full file access. In Docker, use mounted container paths like
              {" "}<code>/workspace/host/...</code>.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={createIfMissing}
              onChange={(e) => setCreateIfMissing(e.target.checked)}
            />
            Create folder if it does not exist
          </label>
          {error && (
            <div className="flex items-center gap-2 text-xs text-status-error">
              <AlertCircle size={12} />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors">
              Add Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewFileModal() {
  const { closeModal } = useUiStore();
  const { createNewFile } = useWorkspaceStore();
  const [name, setName] = useState("new.model.yaml");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    createNewFile(name.trim());
    closeModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
      <div className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl w-[380px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Plus size={16} className="text-accent-blue" />
            New Model File
          </h3>
          <button onClick={closeModal} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">File Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-accent-blue"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditProjectModal() {
  const { closeModal, modalPayload } = useUiStore();
  const { updateProjectFolder } = useWorkspaceStore();
  const project = modalPayload?.project || null;
  const [name, setName] = useState(project?.name || "");
  const [path, setPath] = useState(project?.path || "");
  const [createIfMissing, setCreateIfMissing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(project?.name || "");
    setPath(project?.path || "");
    setCreateIfMissing(false);
    setError("");
  }, [project?.id]);

  if (!project) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError("Both name and path are required");
      return;
    }
    try {
      await updateProjectFolder(project.id, name.trim(), path.trim(), createIfMissing);
      closeModal();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
      <div className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl w-[420px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Pencil size={16} className="text-accent-blue" />
            Edit Project Folder
          </h3>
          <button onClick={closeModal} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Project Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Folder Path (absolute)</label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              In Docker mode, this must be a mounted container path (for example <code>/workspace/host/Models</code>).
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={createIfMissing}
              onChange={(e) => setCreateIfMissing(e.target.checked)}
            />
            Create folder if it does not exist
          </label>
          {error && (
            <div className="flex items-center gap-2 text-xs text-status-error">
              <AlertCircle size={12} />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BottomPanelContent({ tab }) {
  switch (tab) {
    case "properties":
      return <EntityPanel />;
    case "validation":
      return <ValidationPanel />;
    case "diff":
      return <DiffPanel />;
    case "impact":
      return <ImpactPanel />;
    case "model-graph":
      return <ModelGraphPanel />;
    case "dictionary":
      return <DictionaryPanel />;
    case "history":
      return <HistoryPanel />;
    default:
      return <EntityPanel />;
  }
}

function ToastContainer() {
  const { toasts, removeToast } = useUiStore();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg border text-xs font-medium ${
            toast.type === "error"
              ? "bg-red-50 border-red-200 text-red-700"
              : toast.type === "success"
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-blue-50 border-blue-200 text-blue-700"
          }`}
        >
          {toast.message}
          <button onClick={() => removeToast(toast.id)} className="ml-2 p-0.5 rounded hover:bg-black/5">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Primary content area for "connect" activity ──
function ConnectView() {
  return (
    <div className="h-full flex flex-col bg-bg-surface">
      <div className="flex items-center px-5 py-3 border-b border-border-primary bg-white/70 backdrop-blur-md shrink-0">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 text-white shadow-sm mr-2">
          <Database size={14} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">Database Connectors</div>
          <div className="text-[11px] text-text-muted">Connect, preview, and pull physical schemas into versioned DuckCodeModeling models</div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ConnectorsPanel />
      </div>
    </div>
  );
}

// ── Primary content area for "import" activity ──
function ImportView() {
  return (
    <div className="h-full flex flex-col bg-bg-surface">
      <div className="flex-1 overflow-hidden">
        <ImportPanel />
      </div>
    </div>
  );
}

// ── Primary content area for "search" activity ──
function SearchView() {
  return (
    <div className="h-full flex flex-col bg-bg-surface">
      <div className="flex-1 overflow-hidden">
        <GlobalSearchPanel />
      </div>
    </div>
  );
}

// ── Primary content area for "model" activity (editor + diagram) ──
function ModelView({ bottomPanelOpen, bottomPanelTab, setBottomPanelTab, toggleBottomPanel }) {
  return (
    <Allotment vertical style={{ height: "100%" }}>
      {/* Top: Editor + Diagram split */}
      <Allotment.Pane>
        <Allotment style={{ height: "100%" }}>
          {/* YAML Editor */}
          <Allotment.Pane minSize={250} preferredSize={500}>
            <div className="h-full flex flex-col bg-bg-surface">
              <div className="flex items-center px-3 py-1 border-b border-border-primary bg-bg-secondary/50">
                <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">YAML Editor</span>
              </div>
              <YamlEditor />
            </div>
          </Allotment.Pane>

          {/* Diagram */}
          <Allotment.Pane minSize={300}>
            <div className="h-full bg-bg-surface">
              <DiagramCanvas />
            </div>
          </Allotment.Pane>
        </Allotment>
      </Allotment.Pane>

      {/* Bottom panel */}
      {bottomPanelOpen && (
        <Allotment.Pane minSize={120} preferredSize={260} maxSize={500}>
          <div className="h-full flex flex-col bg-bg-surface border-t border-border-primary">
            {/* Bottom panel tabs */}
            <div className="flex items-center border-b border-border-primary bg-bg-secondary/30 shrink-0 overflow-x-auto">
              {BOTTOM_TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setBottomPanelTab(id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    bottomPanelTab === id
                      ? "border-accent-blue text-text-accent"
                      : "border-transparent text-text-muted hover:text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  <Icon size={11} />
                  {label}
                </button>
              ))}
              <button
                onClick={toggleBottomPanel}
                className="ml-auto mr-2 p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
                title="Close panel (⌘J)"
              >
                <X size={12} />
              </button>
            </div>
            {/* Panel content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <BottomPanelContent tab={bottomPanelTab} />
            </div>
          </div>
        </Allotment.Pane>
      )}
    </Allotment>
  );
}

export default function App() {
  const { activeModal, activeActivity, bottomPanelOpen, bottomPanelTab, setBottomPanelTab, toggleBottomPanel } = useUiStore();
  const { error, clearError } = useWorkspaceStore();
  const { selectedEntityId } = useDiagramStore();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Initialize theme on mount
  useEffect(() => {
    const saved = localStorage.getItem("dm_theme") || "light";
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;

      // ⌘+S — Save
      if (meta && e.key === "s") {
        e.preventDefault();
        useWorkspaceStore.getState().saveCurrentFile();
        return;
      }
      // ⌘+K — Global search
      if (meta && e.key === "k") {
        e.preventDefault();
        useUiStore.getState().setActiveActivity("search");
        return;
      }
      // ⌘+\ — Toggle sidebar
      if (meta && e.key === "\\") {
        e.preventDefault();
        useUiStore.getState().toggleSidebar();
        return;
      }
      // ⌘+J — Toggle bottom panel
      if (meta && e.key === "j") {
        e.preventDefault();
        toggleBottomPanel();
        return;
      }
      // ⌘+D — Toggle dark mode
      if (meta && e.key === "d") {
        e.preventDefault();
        useUiStore.getState().toggleTheme();
        return;
      }
      // ⌘+1..5 — Switch activities
      if (meta && e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        const activities = ["model", "connect", "explore", "search", "import"];
        const idx = parseInt(e.key) - 1;
        if (idx < activities.length) {
          useUiStore.getState().setActiveActivity(activities[idx]);
        }
        return;
      }
      // ? — Show shortcuts (only when not in input)
      if (!isInput && e.key === "?") {
        setShowShortcuts((v) => !v);
        return;
      }
      // Esc — close shortcuts
      if (e.key === "Escape" && showShortcuts) {
        setShowShortcuts(false);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showShortcuts, setBottomPanelTab, toggleBottomPanel]);

  // Auto-open properties panel when entity selected
  useEffect(() => {
    if (selectedEntityId) {
      setBottomPanelTab("properties");
    }
  }, [selectedEntityId, setBottomPanelTab]);

  // Show error toast
  useEffect(() => {
    if (error) {
      useUiStore.getState().addToast({ type: "error", message: error });
      clearError();
    }
  }, [error, clearError]);

  // Determine which primary view to show
  const showModelView = activeActivity === "model" || activeActivity === "explore" || activeActivity === "settings";
  const showConnectView = activeActivity === "connect";
  const showImportView = activeActivity === "import";
  const showSearchView = activeActivity === "search";

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_45%)]">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar: Activity Bar + Side Panel */}
        <Sidebar />

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar with tabs */}
          <TopBar />

          {/* Primary view area */}
          <div className="flex-1 min-h-0">
            {showConnectView && <ConnectView />}
            {showImportView && <ImportView />}
            {showSearchView && <SearchView />}
            {showModelView && (
              <ModelView
                bottomPanelOpen={bottomPanelOpen}
                bottomPanelTab={bottomPanelTab}
                setBottomPanelTab={setBottomPanelTab}
                toggleBottomPanel={toggleBottomPanel}
              />
            )}
          </div>

          {/* Status bar */}
          <StatusBar />
        </div>
      </div>

      {/* Modals */}
      {activeModal === "addProject" && <AddProjectModal />}
      {activeModal === "editProject" && <EditProjectModal />}
      {activeModal === "newFile" && <NewFileModal />}
      {showShortcuts && <KeyboardShortcutsPanel onClose={() => setShowShortcuts(false)} />}

      {/* Toasts */}
      <ToastContainer />
    </div>
  );
}
