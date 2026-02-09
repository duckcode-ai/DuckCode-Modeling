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
  AlertCircle,
} from "lucide-react";

const BOTTOM_TABS = [
  { id: "properties", label: "Properties", icon: Columns3 },
  { id: "validation", label: "Validation", icon: ShieldCheck },
  { id: "diff", label: "Diff & Gate", icon: GitCompare },
  { id: "impact", label: "Impact", icon: Network },
  { id: "history", label: "History", icon: Clock },
];

function AddProjectModal() {
  const { closeModal } = useUiStore();
  const { addProjectFolder } = useWorkspaceStore();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError("Both name and path are required");
      return;
    }
    try {
      await addProjectFolder(name.trim(), path.trim());
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
          </div>
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

export default function App() {
  const { activeModal, bottomPanelOpen, bottomPanelTab, setBottomPanelTab, toggleBottomPanel } = useUiStore();
  const { error, clearError } = useWorkspaceStore();
  const { selectedEntityId } = useDiagramStore();

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        useWorkspaceStore.getState().saveCurrentFile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar with tabs */}
          <TopBar />

          {/* Main workspace area */}
          <div className="flex-1 min-h-0">
            <Allotment vertical>
              {/* Top: Editor + Diagram split */}
              <Allotment.Pane>
                <Allotment>
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
                    <div className="flex items-center border-b border-border-primary bg-bg-secondary/30 shrink-0">
                      {BOTTOM_TABS.map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          onClick={() => setBottomPanelTab(id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${
                            bottomPanelTab === id
                              ? "border-accent-blue text-text-accent"
                              : "border-transparent text-text-muted hover:text-text-secondary hover:bg-bg-hover"
                          }`}
                        >
                          <Icon size={12} />
                          {label}
                        </button>
                      ))}
                      <button
                        onClick={toggleBottomPanel}
                        className="ml-auto mr-2 p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                        title="Close panel"
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
          </div>

          {/* Status bar */}
          <StatusBar />
        </div>
      </div>

      {/* Modals */}
      {activeModal === "addProject" && <AddProjectModal />}
      {activeModal === "newFile" && <NewFileModal />}

      {/* Toasts */}
      <ToastContainer />
    </div>
  );
}
