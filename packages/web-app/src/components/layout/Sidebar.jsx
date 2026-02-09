import React, { useEffect, useState } from "react";
import {
  Database,
  FolderOpen,
  FileText,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  LayoutDashboard,
  ShieldCheck,
  GitCompare,
  Network,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  FolderPlus,
  FileCode2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";

const NAV_ITEMS = [
  { id: "modeling", label: "Modeling", icon: LayoutDashboard },
  { id: "validation", label: "Validation", icon: ShieldCheck },
  { id: "diff", label: "Diff & Gate", icon: GitCompare },
  { id: "impact", label: "Impact", icon: Network },
];

function ProjectSection() {
  const {
    projects,
    activeProjectId,
    selectProject,
    removeProjectFolder,
    offlineMode,
  } = useWorkspaceStore();
  const { openModal } = useUiStore();
  const [expanded, setExpanded] = useState(true);

  if (offlineMode) {
    return (
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-text-muted mb-2">
          <Database size={12} />
          <span className="uppercase tracking-wider font-semibold">Offline Mode</span>
        </div>
        <p className="text-xs text-text-muted">
          API server not running. Using local browser storage.
        </p>
      </div>
    );
  }

  return (
    <div className="px-2 py-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-1 py-1.5 text-xs text-text-muted uppercase tracking-wider font-semibold hover:text-text-secondary transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FolderOpen size={12} />
        Projects
        <button
          onClick={(e) => { e.stopPropagation(); openModal("addProject"); }}
          className="ml-auto p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-accent transition-colors"
          title="Add project folder"
        >
          <FolderPlus size={12} />
        </button>
      </button>

      {expanded && (
        <div className="ml-1 space-y-0.5">
          {projects.map((project) => (
            <div
              key={project.id}
              className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                activeProjectId === project.id
                  ? "bg-bg-active text-text-accent"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }`}
              onClick={() => selectProject(project.id)}
            >
              <Database size={13} className="shrink-0" />
              <span className="truncate flex-1">{project.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeProjectFolder(project.id); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-status-error transition-all"
                title="Remove project"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {projects.length === 0 && (
            <p className="text-xs text-text-muted px-2 py-1">No projects added yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

function FileSection() {
  const {
    projectFiles,
    activeFile,
    openFile,
    offlineMode,
    localDocuments,
    switchTab,
    createNewFile,
  } = useWorkspaceStore();
  const [expanded, setExpanded] = useState(true);

  const files = offlineMode ? localDocuments : projectFiles;

  return (
    <div className="px-2 py-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-1 py-1.5 text-xs text-text-muted uppercase tracking-wider font-semibold hover:text-text-secondary transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FileText size={12} />
        Files
        <button
          onClick={(e) => { e.stopPropagation(); createNewFile("new.model.yaml"); }}
          className="ml-auto p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-accent transition-colors"
          title="New model file"
        >
          <Plus size={12} />
        </button>
      </button>

      {expanded && (
        <div className="ml-1 space-y-0.5 max-h-[300px] overflow-y-auto">
          {files.map((file) => {
            const key = offlineMode ? file.id : file.fullPath;
            const isActive = offlineMode
              ? activeFile?.id === file.id
              : activeFile?.fullPath === file.fullPath;

            return (
              <div
                key={key}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                  isActive
                    ? "bg-bg-active text-text-accent"
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
                onClick={() => offlineMode ? switchTab(file) : openFile(file)}
              >
                <FileCode2 size={13} className="shrink-0 text-accent-blue" />
                <span className="truncate flex-1">{file.name || file.path}</span>
              </div>
            );
          })}
          {files.length === 0 && (
            <p className="text-xs text-text-muted px-2 py-1">No model files found.</p>
          )}
        </div>
      )}
    </div>
  );
}

function NavSection() {
  const { activeView, setActiveView } = useUiStore();

  return (
    <div className="px-2 py-1">
      <div className="px-1 py-1.5 text-xs text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1.5">
        <LayoutDashboard size={12} />
        Views
      </div>
      <div className="ml-1 space-y-0.5">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors ${
              activeView === id
                ? "bg-bg-active text-text-accent"
                : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUiStore();
  const { loadProjects } = useWorkspaceStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  if (!sidebarOpen) {
    return (
      <div className="w-10 bg-bg-secondary border-r border-border-primary flex flex-col items-center py-2 gap-2">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          title="Open sidebar"
        >
          <PanelLeftOpen size={16} />
        </button>
        {NAV_ITEMS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { useUiStore.getState().setActiveView(id); }}
            className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            title={id}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="w-[260px] min-w-[260px] bg-bg-secondary border-r border-border-primary flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border-primary">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-accent-blue flex items-center justify-center">
            <Database size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-text-primary">DataLex</span>
        </div>
        <button
          onClick={toggleSidebar}
          className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          title="Collapse sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1 space-y-1">
        <ProjectSection />
        <div className="mx-3 border-t border-border-primary" />
        <FileSection />
        <div className="mx-3 border-t border-border-primary" />
        <NavSection />
      </div>

      {/* Footer */}
      <div className="border-t border-border-primary px-3 py-2">
        <button
          onClick={() => useUiStore.getState().openModal("settings")}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Settings size={13} />
          Settings
        </button>
      </div>
    </div>
  );
}
