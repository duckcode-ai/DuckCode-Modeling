import { useEffect, useState } from "react";
import {
  Database,
  FolderOpen,
  FileText,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  LayoutDashboard,
  Settings,
  PanelLeftClose,
  FolderPlus,
  FileCode2,
  Pencil,
  Plug,
  Import,
  Moon,
  Sun,
  Keyboard,
  GitBranch,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import EntityListPanel from "../panels/EntityListPanel";
import ConnectorLogo from "../icons/ConnectorLogo";
import { fetchConnections } from "../../lib/api";

const ACTIVITIES = [
  { id: "model",    label: "Model",    icon: LayoutDashboard, group: "top" },
  { id: "connect",  label: "Connect",  icon: Plug,            group: "top" },
  { id: "settings", label: "Settings", icon: Settings,        group: "bottom" },
];

const PROJECT_FILE_DRAG_TYPE = "application/x-duckcodemodeling-project-file";

function parseInternalProjectFileDrop(dataTransfer) {
  const raw = dataTransfer?.getData(PROJECT_FILE_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.fullPath) return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

const CONNECTOR_LABELS = {
  dbt_repo: "dbt",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  snowflake: "Snowflake",
  bigquery: "BigQuery",
  databricks: "Databricks",
  sqlserver: "SQL Server",
  azure_sql: "Azure SQL",
  azure_fabric: "Azure Fabric",
  redshift: "Redshift",
};

function normalizeConnectorType(connector) {
  const normalized = String(connector || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("snowflake")) return "snowflake";
  return normalized;
}

function normalizeProjectPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function buildProjectConnectorMap(projects, connections) {
  const projectById = new Map((projects || []).map((project) => [project.id, project]));
  const projectByPath = new Map(
    (projects || [])
      .map((project) => [normalizeProjectPath(project.path), project])
      .filter(([projectPath]) => Boolean(projectPath))
  );

  const projectConnectorMap = {};

  for (const connection of connections || []) {
    const connector = normalizeConnectorType(connection?.connector);
    if (!connector) continue;

    const imports = Array.isArray(connection?.imports) ? connection.imports : [];
    for (const event of imports) {
      let project = null;
      const eventProjectId = String(event?.projectId || "").trim();
      if (eventProjectId) {
        project = projectById.get(eventProjectId) || null;
      }

      if (!project) {
        const eventProjectPath = normalizeProjectPath(event?.projectPath);
        if (eventProjectPath) {
          project = projectByPath.get(eventProjectPath) || null;
        }
      }

      if (!project) continue;

      const timestamp = String(
        event?.timestamp ||
        connection?.updatedAt ||
        connection?.lastConnectedAt ||
        connection?.createdAt ||
        ""
      );

      const existing = projectConnectorMap[project.id];
      if (!existing || timestamp > existing.timestamp) {
        projectConnectorMap[project.id] = {
          connector,
          label: CONNECTOR_LABELS[connector] || connector,
          timestamp,
        };
      }
    }
  }

  return projectConnectorMap;
}

function ProjectSection() {
  const {
    projects,
    activeProjectId,
    selectProject,
    removeProjectFolder,
    importModelFilesToProject,
    moveProjectFileToProject,
    offlineMode,
  } = useWorkspaceStore();
  const { openModal, addToast } = useUiStore();
  const [expanded, setExpanded] = useState(true);
  const [dropProjectId, setDropProjectId] = useState(null);
  const [projectConnectors, setProjectConnectors] = useState({});

  useEffect(() => {
    let cancelled = false;

    const loadProjectConnectors = async () => {
      if (offlineMode || projects.length === 0) {
        if (!cancelled) setProjectConnectors({});
        return;
      }

      try {
        const connections = await fetchConnections();
        if (cancelled) return;
        setProjectConnectors(buildProjectConnectorMap(projects, connections));
      } catch (_err) {
        if (!cancelled) setProjectConnectors({});
      }
    };

    loadProjectConnectors();
    return () => {
      cancelled = true;
    };
  }, [offlineMode, projects]);

  if (offlineMode) {
    return (
      <div className="mx-2 my-2 px-3 py-2 rounded-lg border border-border-primary bg-bg-surface">
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

  const handleProjectDrop = async (projectId, e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropProjectId(null);
    const internalFile = parseInternalProjectFileDrop(e.dataTransfer);
    if (internalFile?.fullPath) {
      if (internalFile.projectId === projectId) {
        addToast?.({ type: "error", message: "Source and target project are the same." });
        return;
      }
      try {
        await moveProjectFileToProject(projectId, internalFile.fullPath, "move");
        addToast?.({
          type: "success",
          message: `Moved ${internalFile.name || "file"} to selected project`,
        });
      } catch (err) {
        addToast?.({ type: "error", message: err.message || "Failed to move file" });
      }
      return;
    }

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    try {
      const created = await importModelFilesToProject(projectId, files);
      addToast?.({
        type: "success",
        message: `Imported ${created.length} file${created.length === 1 ? "" : "s"} into project`,
      });
    } catch (err) {
      addToast?.({ type: "error", message: err.message || "Failed to import dropped files" });
    }
  };


  return (
    <div className="mx-2 my-1 px-2 py-1 rounded-lg border border-border-primary/80 bg-bg-surface">
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
        <div className="ml-1 space-y-0.5 max-h-[220px] overflow-y-auto">
          {projects.map((project) => {
            const connectorMeta = projectConnectors[project.id] || null;
            const connectorType = connectorMeta?.connector || "";

            const ghShort = project.githubRepo
              ? project.githubRepo.replace(/^https?:\/\/github\.com\//, "")
              : null;

            return (
              <div
                key={project.id}
                className={`group flex flex-col gap-0.5 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                  dropProjectId === project.id
                    ? "bg-accent-blue/10 text-accent-blue ring-1 ring-accent-blue/30"
                    : activeProjectId === project.id
                    ? "bg-accent-blue/10 text-accent-blue border border-accent-blue/30"
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
                onClick={() => selectProject(project.id)}
                onDragOver={(e) => { e.preventDefault(); setDropProjectId(project.id); }}
                onDragLeave={() => setDropProjectId((curr) => (curr === project.id ? null : curr))}
                onDrop={(e) => handleProjectDrop(project.id, e)}
              >
                {/* Name row */}
                <div className="flex items-center gap-2">
                  {connectorType ? (
                    <ConnectorLogo type={connectorType} size={14} className="shrink-0 rounded-md" />
                  ) : (
                    <Database size={13} className="shrink-0" />
                  )}
                  <span className="truncate flex-1">{project.name}</span>
                  {dropProjectId === project.id && (
                    <span className="text-[9px] px-1 py-0 rounded bg-accent-blue/10 text-accent-blue shrink-0">
                      Drop YAML
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); openModal("editProject", { project }); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-accent transition-all"
                    title="Edit project"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeProjectFolder(project.id); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-status-error transition-all"
                    title="Remove project"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                {/* GitHub / branch chips */}
                {(ghShort || project.defaultBranch) && (
                  <div className="flex items-center gap-1 ml-5 flex-wrap">
                    {ghShort && (
                      <span
                        className="flex items-center gap-0.5 text-[9px] px-1 py-0 rounded border font-medium bg-slate-50 border-slate-200 text-slate-500 truncate max-w-[120px]"
                        title={project.githubRepo}
                      >
                        <svg viewBox="0 0 16 16" width="8" height="8" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                        {ghShort}
                      </span>
                    )}
                    {project.defaultBranch && (
                      <span className="flex items-center gap-0.5 text-[9px] px-1 py-0 rounded border font-mono bg-emerald-50 border-emerald-200 text-emerald-700">
                        <GitBranch size={8} />
                        {project.defaultBranch}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
    activeProjectId,
    projectPath,
    openFile,
    offlineMode,
    localDocuments,
    switchTab,
    createNewFile,
    importModelFilesToProject,
  } = useWorkspaceStore();
  const { addToast } = useUiStore();
  const [expanded, setExpanded] = useState(true);
  const [dropActive, setDropActive] = useState(false);

  const files = offlineMode ? localDocuments : projectFiles;

  const handleDropToActiveProject = async (e) => {
    e.preventDefault();
    setDropActive(false);
    if (offlineMode || !activeProjectId) return;
    const dropped = Array.from(e.dataTransfer?.files || []);
    if (dropped.length === 0) return;
    try {
      const created = await importModelFilesToProject(activeProjectId, dropped);
      addToast?.({
        type: "success",
        message: `Imported ${created.length} file${created.length === 1 ? "" : "s"} into active project`,
      });
    } catch (err) {
      addToast?.({ type: "error", message: err.message || "Failed to import dropped files" });
    }
  };

  return (
    <div
      className={`mx-2 my-1 px-2 py-1 rounded-lg border bg-bg-surface ${dropActive ? "ring-1 ring-accent-blue/30 border-accent-blue/30" : "border-border-primary/80"}`}
      onDragOver={(e) => {
        if (offlineMode || !activeProjectId) return;
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDropToActiveProject}
    >
      <div className="flex items-center gap-1.5 w-full px-1 py-1.5 text-xs text-text-muted uppercase tracking-wider font-semibold">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 flex-1 min-w-0 hover:text-text-secondary transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FileText size={12} />
          Files
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); createNewFile("new.model.yaml"); }}
          className="ml-auto p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-accent transition-colors"
          title="New model file"
        >
          <Plus size={12} />
        </button>
      </div>

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
                    ? "bg-accent-blue/10 text-accent-blue border border-accent-blue/30"
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
                onClick={() => offlineMode ? switchTab(file) : openFile(file)}
                draggable={!offlineMode && Boolean(file.fullPath)}
                onDragStart={(e) => {
                  if (offlineMode || !file.fullPath || !activeProjectId) return;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(
                    PROJECT_FILE_DRAG_TYPE,
                    JSON.stringify({
                      fullPath: file.fullPath,
                      name: file.name,
                      projectId: activeProjectId,
                    })
                  );
                }}
              >
                <FileCode2 size={13} className="shrink-0 text-accent-blue" />
                <span className="truncate flex-1">{file.name || file.path}</span>
              </div>
            );
          })}
          {files.length === 0 && (
            <div className="px-2 py-1 space-y-1">
              <p className="text-xs text-text-muted">No YAML files found.</p>
              {!offlineMode && activeProjectId && projectPath && (
                <p className="text-[10px] text-text-muted">
                  If this folder has files on your host and DuckCodeModeling runs in Docker, mount the parent folder and use
                  a container path such as <code>/workspace/host/...</code>.
                </p>
              )}
            </div>
          )}
          {dropActive && !offlineMode && activeProjectId && (
            <p className="text-[10px] text-accent-blue px-2 py-1 font-medium">
              Drop `.yaml` / `.yml` files to import into this project
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Entity list in side panel ──
function EntitySection() {
  const { model } = useDiagramStore();
  const entities = model?.entities || [];
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mx-2 my-1 px-2 py-1 rounded-lg border border-border-primary/80 bg-bg-surface">
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


// ── Settings theme toggle (used inside Settings panel) ──
function SettingsThemeToggle() {
  const { theme, toggleTheme } = useUiStore();
  return (
    <button
      onClick={toggleTheme}
      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
    >
      {theme === "light" ? <Moon size={12} /> : <Sun size={12} />}
      {theme === "light" ? "Switch to Dark mode" : "Switch to Light mode"}
      <code className="ml-auto px-1 py-0 rounded bg-bg-tertiary border border-border-primary/50 font-mono text-[9px]">⌘D</code>
    </button>
  );
}

// ── Activity Bar (thin icon rail on the far left) ──
function ActivityBar({ activeActivity, onSelect, onHome }) {
  const topItems = ACTIVITIES.filter((a) => a.group === "top");
  const bottomItems = ACTIVITIES.filter((a) => a.group === "bottom");
  const homeActive = activeActivity === "search";

  return (
    <div className="w-14 min-w-[56px] bg-bg-secondary border-r border-border-primary flex flex-col items-center py-2 shrink-0">
      {/* Home / Logo */}
      <button
        onClick={onHome}
        title="Home"
        className={`relative w-11 h-11 flex items-center justify-center rounded-xl mb-3 shrink-0 transition-all ${
          homeActive
            ? "bg-accent-blue/10 ring-1 ring-accent-blue/30 shadow-sm"
            : "bg-bg-surface border border-border-primary hover:bg-bg-hover"
        }`}
      >
        {homeActive && (
          <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent-blue" />
        )}
        <img src="/DuckCodeModeling.png" alt="DuckCodeModeling" className="w-7 h-7 object-contain" />
      </button>

      {/* Top activities */}
      <div className="flex flex-col items-center gap-0.5 flex-1">
        {topItems.map(({ id, label, icon: Icon }) => {
          const isActive = activeActivity === id;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              title={label}
              className={`relative w-11 h-11 flex flex-col items-center justify-center rounded-xl transition-all ${
                isActive
                  ? "bg-accent-blue/10 text-accent-blue shadow-sm"
                  : "text-text-muted hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              {isActive && (
                <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent-blue" />
              )}
              <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[8px] mt-0.5 font-semibold leading-none">{label}</span>
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
              className={`relative w-11 h-11 flex flex-col items-center justify-center rounded-xl transition-all ${
                isActive
                  ? "bg-accent-blue/10 text-accent-blue shadow-sm"
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
    <div className="w-[260px] min-w-[260px] bg-bg-surface border-r border-border-primary flex flex-col overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border-primary shrink-0 bg-bg-secondary">
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
      <div className="flex-1 overflow-y-auto py-2 space-y-1.5">
        {activity === "model" && (
          <>
            <ProjectSection />
            <FileSection />
            <EntitySection />
          </>
        )}
        {activity === "connect" && (
          <div className="mx-2 my-1 px-2 py-2 space-y-2 rounded-lg border border-border-primary/80 bg-bg-surface">
            <div className="px-1 py-1 text-[10px] text-text-muted uppercase tracking-wider font-semibold">
              Data Sources
            </div>
            <div className="space-y-0.5">
              <button
                onClick={() => useUiStore.getState().setActiveActivity("connect")}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                <Plug size={12} />
                Database Connector
              </button>
              <button
                onClick={() => useUiStore.getState().setActiveActivity("import")}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                <Import size={12} />
                Import YAML / File
              </button>
            </div>
            <div className="mx-1 border-t border-border-primary/60" />
            <div className="px-1">
              <p className="text-[10px] text-text-muted leading-relaxed">
                Connect to a warehouse to pull physical schemas as versioned model files, or import an existing YAML, DDL, or DBML file.
              </p>
            </div>
          </div>
        )}
        {activity === "import" && (
          <div className="mx-2 my-1 px-3 py-2 rounded-lg border border-border-primary/80 bg-bg-surface">
            <p className="text-[10px] text-text-muted leading-relaxed">
              Drag & drop or browse files to import SQL DDL, DBML, or Spark Schema JSON into a model.
            </p>
          </div>
        )}
        {activity === "settings" && (
          <div className="mx-2 my-1 space-y-2">
            {/* Appearance */}
            <div className="px-2 py-1 rounded-lg border border-border-primary/80 bg-bg-surface">
              <div className="px-1 py-1.5 text-[10px] text-text-muted uppercase tracking-wider font-semibold">Appearance</div>
              <SettingsThemeToggle />
            </div>
            {/* Keyboard shortcuts reference */}
            <div className="px-2 py-1 rounded-lg border border-border-primary/80 bg-bg-surface">
              <div className="px-1 py-1.5 text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Keyboard size={10} /> Shortcuts
              </div>
              <div className="space-y-1 px-1 pb-1.5">
                {[
                  ["Save", "⌘S"], ["Global search", "⌘K"], ["Sidebar", "⌘\\"],
                  ["Bottom panel", "⌘J"], ["Dark mode", "⌘D"], ["Help", "?"],
                  ["Model", "⌘1"], ["Connect", "⌘2"], ["Settings", "⌘3"],
                ].map(([label, key]) => (
                  <div key={label} className="flex items-center justify-between text-[10px] text-text-muted">
                    <span>{label}</span>
                    <code className="px-1.5 py-0 rounded bg-bg-tertiary border border-border-primary/50 font-mono text-[9px]">{key}</code>
                  </div>
                ))}
              </div>
            </div>
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

  const handleHomeSelect = () => {
    setActiveActivity("search");
    setSidePanelOpen(false);
  };

  return (
    <div className="flex h-full">
      <ActivityBar activeActivity={activeActivity} onSelect={handleActivitySelect} onHome={handleHomeSelect} />
      {sidePanelOpen && activeActivity !== "search" && <SidePanel activity={activeActivity} />}
    </div>
  );
}
