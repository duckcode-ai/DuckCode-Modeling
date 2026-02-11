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
  List,
  Search,
  Plug,
  BookOpen,
  Compass,
  Import,
  Boxes,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import EntityListPanel from "../panels/EntityListPanel";

const ACTIVITIES = [
  { id: "model",    label: "Model",    icon: LayoutDashboard, group: "top" },
  { id: "connect",  label: "Connect",  icon: Plug,            group: "top" },
  { id: "explore",  label: "Explore",  icon: Compass,         group: "top" },
  { id: "search",   label: "Search",   icon: Search,          group: "top" },
  { id: "settings", label: "Settings", icon: Settings,        group: "bottom" },
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
      <div className="flex items-center gap-1.5 w-full px-1 py-1.5 text-xs text-text-muted uppercase tracking-wider font-semibold">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 flex-1 min-w-0 hover:text-text-secondary transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FolderOpen size={12} />
          Projects
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); openModal("addProject"); }}
          className="ml-auto p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-accent transition-colors"
          title="Add project folder"
        >
          <FolderPlus size={12} />
        </button>
      </div>

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

// ── Explore side panel: model stats + all tools (merged Validate + Explore) ──
function ExploreSection() {
  const { setBottomPanelTab } = useUiStore();
  const { model } = useDiagramStore();
  const entityCount = model?.entities?.length || 0;
  const relCount = model?.relationships?.length || 0;

  const tools = [
    { id: "validation",  label: "Validation",       icon: ShieldCheck, tab: "validation" },
    { id: "diff",        label: "Diff & Gate",      icon: GitCompare,  tab: "diff" },
    { id: "impact",      label: "Impact Analysis",  icon: Network,     tab: "impact" },
    { id: "model-graph", label: "Model Graph",      icon: Boxes,       tab: "model-graph" },
    { id: "dictionary",  label: "Data Dictionary",  icon: BookOpen,    tab: "dictionary" },
    { id: "history",     label: "History",           icon: FileText,    tab: "history" },
  ];

  return (
    <div className="px-2 py-1 space-y-3">
      {/* Model stats */}
      <div>
        <div className="px-1 py-1.5 text-[10px] text-text-muted uppercase tracking-wider font-semibold">
          Model Overview
        </div>
        <div className="grid grid-cols-2 gap-2 px-1">
          <div className="text-center p-2 rounded-lg bg-bg-primary border border-border-primary">
            <div className="text-lg font-bold text-text-primary">{entityCount}</div>
            <div className="text-[9px] text-text-muted">Entities</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-bg-primary border border-border-primary">
            <div className="text-lg font-bold text-text-primary">{relCount}</div>
            <div className="text-[9px] text-text-muted">Relationships</div>
          </div>
        </div>
      </div>

      <div className="mx-1 border-t border-border-primary" />

      {/* Tools */}
      <div>
        <div className="px-1 py-1 text-[10px] text-text-muted uppercase tracking-wider font-semibold">
          Tools
        </div>
        <div className="space-y-0.5">
          {tools.map(({ id, label, icon: Icon, tab }) => (
            <button
              key={id}
              onClick={() => setBottomPanelTab(tab)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Entity list in side panel ──
function EntitySection() {
  const { model } = useDiagramStore();
  const entities = model?.entities || [];
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="px-2 py-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-1 py-1.5 text-[10px] text-text-muted uppercase tracking-wider font-semibold hover:text-text-secondary transition-colors"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        Entities
        <span className="ml-auto text-[9px] font-normal">{entities.length}</span>
      </button>
      {expanded && (
        <div className="min-h-[100px] max-h-[300px]">
          <EntityListPanel />
        </div>
      )}
    </div>
  );
}


// ── Search side panel ──
function SearchSection() {
  const { setBottomPanelTab } = useUiStore();

  return (
    <div className="px-2 py-1 space-y-2">
      <div className="px-1 py-1.5 text-[10px] text-text-muted uppercase tracking-wider font-semibold">
        Search
      </div>
      <button onClick={() => setBottomPanelTab("search")}
        className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-xs text-text-muted border border-border-primary bg-bg-primary hover:border-accent-blue transition-colors">
        <Search size={12} />
        <span>Search models, entities...</span>
        <kbd className="ml-auto text-[9px] px-1 py-0.5 rounded bg-bg-tertiary border border-border-primary font-mono">⌘K</kbd>
      </button>
    </div>
  );
}

// ── Activity Bar (thin icon rail on the far left) ──
function ActivityBar({ activeActivity, onSelect }) {
  const topItems = ACTIVITIES.filter((a) => a.group === "top");
  const bottomItems = ACTIVITIES.filter((a) => a.group === "bottom");

  return (
    <div className="w-12 min-w-[48px] bg-bg-secondary border-r border-border-primary flex flex-col items-center py-2 shrink-0">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg bg-accent-blue flex items-center justify-center mb-3 shrink-0">
        <Database size={16} className="text-white" />
      </div>

      {/* Top activities */}
      <div className="flex flex-col items-center gap-0.5 flex-1">
        {topItems.map(({ id, label, icon: Icon }) => {
          const isActive = activeActivity === id;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              title={label}
              className={`relative w-10 h-10 flex flex-col items-center justify-center rounded-lg transition-all ${
                isActive
                  ? "bg-bg-active text-accent-blue"
                  : "text-text-muted hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              {isActive && (
                <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent-blue" />
              )}
              <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[8px] mt-0.5 font-medium leading-none">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom activities */}
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        {bottomItems.map(({ id, label, icon: Icon }) => {
          const isActive = activeActivity === id;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              title={label}
              className={`relative w-10 h-10 flex flex-col items-center justify-center rounded-lg transition-all ${
                isActive
                  ? "bg-bg-active text-accent-blue"
                  : "text-text-muted hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[8px] mt-0.5 font-medium leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Side Panel (contextual content based on active activity) ──
function SidePanel({ activity }) {
  const panelTitle = ACTIVITIES.find((a) => a.id === activity)?.label || "Panel";
  const { setSidePanelOpen } = useUiStore();

  return (
    <div className="w-[240px] min-w-[240px] bg-bg-secondary border-r border-border-primary flex flex-col overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-primary shrink-0">
        <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">{panelTitle}</span>
        <button
          onClick={() => setSidePanelOpen(false)}
          className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          title="Close panel"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto py-1 space-y-1">
        {activity === "model" && (
          <>
            <ProjectSection />
            <div className="mx-3 border-t border-border-primary" />
            <FileSection />
            <div className="mx-3 border-t border-border-primary" />
            <EntitySection />
          </>
        )}
        {activity === "connect" && (
          <div className="px-2 py-1 space-y-3">
            <div className="px-1 py-1.5 text-[10px] text-text-muted uppercase tracking-wider font-semibold">
              Data Sources
            </div>
            <div className="space-y-0.5">
              <button
                onClick={() => useUiStore.getState().setActiveActivity("connect")}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                <Plug size={13} />
                Database Connector
              </button>
              <button
                onClick={() => useUiStore.getState().setActiveActivity("import")}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                <Import size={13} />
                Import YAML / File
              </button>
            </div>
            <div className="mx-1 border-t border-border-primary" />
            <div className="px-1">
              <p className="text-[10px] text-text-muted leading-relaxed">
                Use the <strong>Database Connector</strong> wizard in the main area to connect, browse schemas, and pull tables as model files.
              </p>
              <p className="text-[10px] text-text-muted leading-relaxed mt-1">
                Or <strong>Import</strong> an existing YAML model file directly.
              </p>
            </div>
          </div>
        )}
        {activity === "explore" && <ExploreSection />}
        {activity === "import" && (
          <div className="px-3 py-2">
            <p className="text-[10px] text-text-muted leading-relaxed">
              Drag & drop or browse files to import SQL DDL, DBML, or Spark Schema JSON into a DataLex model.
            </p>
          </div>
        )}
        {activity === "search" && <SearchSection />}
        {activity === "settings" && (
          <div className="px-3 py-2 space-y-2">
            <p className="text-[10px] text-text-muted">Application settings</p>
            <button
              onClick={() => useUiStore.getState().toggleTheme()}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <Settings size={13} /> Toggle Theme
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Sidebar export: Activity Bar + Side Panel ──
export default function Sidebar() {
  const { activeActivity, setActiveActivity, sidePanelOpen, setSidePanelOpen } = useUiStore();
  const { loadProjects } = useWorkspaceStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleActivitySelect = (id) => {
    if (activeActivity === id) {
      // Toggle side panel if clicking the same activity
      setSidePanelOpen(!sidePanelOpen);
    } else {
      setActiveActivity(id);
      setSidePanelOpen(true);
    }
  };

  return (
    <div className="flex h-full">
      <ActivityBar activeActivity={activeActivity} onSelect={handleActivitySelect} />
      {sidePanelOpen && <SidePanel activity={activeActivity} />}
    </div>
  );
}
