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
  Moon,
  Sun,
  Keyboard,
  GitBranch,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Link,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import EntityListPanel from "../panels/EntityListPanel";
import ConnectorLogo from "../icons/ConnectorLogo";
import BookmarksPanel from "../viewer/BookmarksPanel";
import { fetchConnections, cloneGitRepo } from "../../lib/api";

const ALL_ACTIVITIES = [
  { id: "model",    label: "Model",    icon: LayoutDashboard, group: "top" },
  { id: "connect",  label: "Connect",  icon: Plug,            group: "top",    adminOnly: true },
  { id: "settings", label: "Settings", icon: Settings,        group: "bottom" },
];

// All available connectors — shown as a quick-launch grid in the Connect sidebar panel
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
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
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
        {canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); openModal("addProject"); }}
            className="ml-auto p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-accent transition-colors"
            title="Add project folder"
          >
            <FolderPlus size={12} />
          </button>
        )}
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
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openModal("editProject", { project }); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-accent transition-all"
                      title="Edit project"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeProjectFolder(project.id); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-status-error transition-all"
                      title="Remove project"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                {/* GitHub / branch chips — always visible */}
                <div className="flex items-center gap-1 ml-5 flex-wrap">
                  {ghShort ? (
                    <span
                      className="flex items-center gap-0.5 text-[9px] px-1 py-0 rounded border font-medium bg-bg-tertiary border-border-primary text-text-secondary truncate max-w-[140px]"
                      title={project.githubRepo}
                    >
                      <svg viewBox="0 0 16 16" width="8" height="8" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                      {ghShort}
                    </span>
                  ) : canEdit ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); openModal("editProject", { project }); }}
                      className="flex items-center gap-0.5 text-[9px] px-1 py-0 rounded border border-dashed border-border-secondary text-text-muted hover:text-accent-blue hover:border-accent-blue/50 transition-colors"
                      title="Link GitHub repo"
                    >
                      <svg viewBox="0 0 16 16" width="8" height="8" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                      Link GitHub
                    </button>
                  ) : null}
                  {project.defaultBranch && (
                    <span className="flex items-center gap-0.5 text-[9px] px-1 py-0 rounded border font-mono bg-bg-tertiary border-border-primary text-accent-green">
                      <GitBranch size={8} />
                      {project.defaultBranch}
                    </span>
                  )}
                </div>
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

// ── Build a folder-tree from the flat files array ──
function buildFileTree(files) {
  const root = { type: "dir", name: "", path: "", children: [] };
  for (const file of files) {
    const parts = String(file.path || file.name || "").replace(/\\/g, "/").split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      const dirPath = parts.slice(0, i + 1).join("/");
      let dir = node.children.find((c) => c.type === "dir" && c.name === name);
      if (!dir) {
        dir = { type: "dir", name, path: dirPath, children: [] };
        node.children.push(dir);
      }
      node = dir;
    }
    node.children.push({ type: "file", name: file.name, path: file.path, fileData: file });
  }
  return root;
}

function FileTreeNode({ node, depth, activeFile, onOpen, offlineMode, switchTab, activeProjectId }) {
  const [open, setOpen] = useState(depth < 1);

  if (node.type === "file") {
    const isActive = offlineMode
      ? activeFile?.id === node.fileData?.id
      : activeFile?.fullPath === node.fileData?.fullPath;
    return (
      <div
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        className={`flex items-center gap-1.5 pr-2 py-1 rounded-md text-xs cursor-pointer transition-colors ${
          isActive
            ? "bg-accent-blue/10 text-accent-blue"
            : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
        }`}
        onClick={() => offlineMode ? switchTab(node.fileData) : onOpen(node.fileData)}
        draggable={!offlineMode && Boolean(node.fileData?.fullPath)}
        onDragStart={(e) => {
          if (offlineMode || !node.fileData?.fullPath || !activeProjectId) return;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData(
            PROJECT_FILE_DRAG_TYPE,
            JSON.stringify({ fullPath: node.fileData.fullPath, name: node.fileData.name, projectId: activeProjectId })
          );
        }}
      >
        <FileCode2 size={12} className="shrink-0 text-accent-blue/70" />
        <span className="truncate">{node.name}</span>
      </div>
    );
  }

  // Directory node
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className="flex items-center gap-1.5 w-full pr-2 py-1 rounded-md text-xs text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <FolderOpen size={11} className="shrink-0" />
        <span className="truncate font-medium">{node.name}</span>
        <span className="ml-auto text-[9px] font-normal opacity-60">
          {node.children.filter((c) => c.type === "file").length +
            node.children.filter((c) => c.type === "dir").reduce((n, d) => n + d.children.length, 0)}
        </span>
      </button>
      {open && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.type === "dir" ? `d-${child.path}` : `f-${child.path}`}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onOpen={onOpen}
              offlineMode={offlineMode}
              switchTab={switchTab}
              activeProjectId={activeProjectId}
            />
          ))}
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
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
  const [expanded, setExpanded] = useState(true);
  const [dropActive, setDropActive] = useState(false);

  const files = offlineMode ? localDocuments : projectFiles;
  const tree = offlineMode ? null : buildFileTree(files);

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
          Models
          <span className="ml-1 text-[9px] font-normal normal-case">{files.length}</span>
        </button>
        {canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); createNewFile("new.model.yaml"); }}
            className="ml-auto p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-accent transition-colors"
            title="New model file"
          >
            <Plus size={12} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="max-h-[340px] overflow-y-auto">
          {files.length === 0 ? (
            <div className="px-2 py-1 space-y-1">
              <p className="text-xs text-text-muted">No YAML files found.</p>
              {!offlineMode && activeProjectId && projectPath && (
                <p className="text-[10px] text-text-muted">
                  If this folder has files on your host and DuckCodeModeling runs in Docker, mount the parent folder and use
                  a container path such as <code>/workspace/host/...</code>.
                </p>
              )}
            </div>
          ) : offlineMode ? (
            // Offline: flat list of local documents
            files.map((file) => {
              const isActive = activeFile?.id === file.id;
              return (
                <div
                  key={file.id}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer transition-colors ${
                    isActive
                      ? "bg-accent-blue/10 text-accent-blue"
                      : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                  onClick={() => switchTab(file)}
                >
                  <FileCode2 size={12} className="shrink-0 text-accent-blue/70" />
                  <span className="truncate">{file.name}</span>
                </div>
              );
            })
          ) : (
            // Online: folder-tree view
            tree && tree.children.map((node) => (
              <FileTreeNode
                key={node.type === "dir" ? `d-${node.path}` : `f-${node.path}`}
                node={node}
                depth={0}
                activeFile={activeFile}
                onOpen={openFile}
                offlineMode={offlineMode}
                switchTab={switchTab}
                activeProjectId={activeProjectId}
              />
            ))
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


// ── Git Repository Connection (Connect panel) ──
function detectProvider(url) {
  if (/github\.com/i.test(url)) return "github";
  if (/gitlab\.com/i.test(url)) return "gitlab";
  return "git";
}

function deriveName(url) {
  return String(url || "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean)
    .pop() || "";
}

// Inline GitHub logo SVG
function GithubLogo({ size = 14, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

// Inline GitLab logo SVG
function GitlabLogo({ size = 14, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 0 0-.867 0L16.418 9.45H7.582L4.918 1.263a.455.455 0 0 0-.867 0L1.387 9.452.045 13.587a.924.924 0 0 0 .331 1.023L12 23.054l11.624-8.444a.92.92 0 0 0 .331-1.023z" />
    </svg>
  );
}

function GitConnectSection() {
  const { projects, loadProjects, selectProject } = useWorkspaceStore();
  const { setActiveActivity } = useUiStore();
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [projectName, setProjectName] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState(null); // null | "cloning" | "success" | "error"
  const [errorMsg, setErrorMsg] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [refreshingId, setRefreshingId] = useState(null);

  const provider = detectProvider(url);
  const connectedRepos = projects.filter((p) => p.githubRepo);

  // Link to generate a token for the detected provider
  const tokenHelpUrl = provider === "gitlab"
    ? "https://gitlab.com/-/user_settings/personal_access_tokens"
    : "https://github.com/settings/tokens/new?scopes=repo&description=DuckCode+Modeling";

  function handleUrlChange(val) {
    setUrl(val);
    setProjectName(deriveName(val));
    setStatus(null);
  }

  async function handleConnect(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setStatus("cloning");
    setErrorMsg("");
    try {
      const project = await cloneGitRepo(url.trim(), branch.trim() || "main", projectName.trim(), token.trim());
      await loadProjects();
      await selectProject(project.id);
      setActiveActivity("model");
      setStatus("success");
    } catch (err) {
      setStatus("error");
      const msg = err.message || "Clone failed";
      setErrorMsg(
        msg.includes("HTTP 404")
          ? "API server needs a restart to pick up the new route. Restart the server and try again."
          : msg
      );
    }
  }

  async function handleRefresh(project) {
    setRefreshingId(project.id);
    try {
      // Re-use the same token that was entered (if still in state), otherwise rely on cached remote URL
      await cloneGitRepo(project.githubRepo, project.defaultBranch || "main", project.name, token.trim());
      await loadProjects();
      await selectProject(project.id);
    } catch (_err) {
      // swallow — user can retry
    } finally {
      setRefreshingId(null);
    }
  }

  return (
    <div className="mx-2 my-1 rounded-lg border border-border-primary/80 bg-bg-surface overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border-primary/60">
        <div className="flex items-center gap-2 mb-0.5">
          <GitBranch size={13} className="text-accent-blue" />
          <span className="text-xs font-semibold text-text-primary">Git Repository</span>
        </div>
        <p className="text-[10px] text-text-muted leading-relaxed">
          Connect a GitHub or GitLab repo to auto-load all model files.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleConnect} className="px-3 py-3 space-y-2.5">
        {/* Provider detect + URL */}
        <div>
          <label className="text-[10px] text-text-muted font-medium block mb-1">Repository URL</label>
          <div className="relative">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted">
              {provider === "github" ? <GithubLogo size={12} /> : provider === "gitlab" ? <GitlabLogo size={12} className="text-orange-500" /> : <Link size={12} />}
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://github.com/org/repo"
              className="w-full bg-bg-primary border border-border-primary rounded-md pl-7 pr-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors"
            />
          </div>
        </div>

        {/* Branch + Name row */}
        <div className="flex gap-2">
          <div className="flex-[0_0_80px]">
            <label className="text-[10px] text-text-muted font-medium block mb-1">Branch</label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-[10px] text-text-muted font-medium block mb-1">Project name</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-repo"
              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors"
            />
          </div>
        </div>

        {/* Access token */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-text-muted font-medium">
              Personal Access Token
              <span className="ml-1 text-[9px] text-text-muted opacity-60">(required for private repos)</span>
            </label>
            <a
              href={tokenHelpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-accent-blue hover:underline"
            >
              Generate token ↗
            </a>
          </div>
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={provider === "gitlab" ? "glpat-xxxx…" : "ghp_xxxx…"}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 pr-8 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors font-mono"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors text-[9px]"
              title={showToken ? "Hide token" : "Show token"}
            >
              {showToken ? "hide" : "show"}
            </button>
          </div>
        </div>

        {/* Status feedback */}
        {status === "error" && (
          <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-status-error/10 border border-status-error/20">
            <AlertCircle size={11} className="text-status-error shrink-0 mt-0.5" />
            <p className="text-[10px] text-status-error leading-relaxed">{errorMsg}</p>
          </div>
        )}
        {status === "success" && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-status-success/10 border border-status-success/20">
            <CheckCircle2 size={11} className="text-status-success" />
            <p className="text-[10px] text-status-success">Connected! Models loaded.</p>
          </div>
        )}

        {/* Connect button */}
        <button
          type="submit"
          disabled={!url.trim() || status === "cloning"}
          className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {status === "cloning" ? (
            <><Loader2 size={11} className="animate-spin" /> Cloning…</>
          ) : (
            <><GitBranch size={11} /> Connect & Fetch Models</>
          )}
        </button>
      </form>

      {/* Folder structure guide */}
      <div className="border-t border-border-primary/60">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="flex items-center gap-1.5 w-full px-3 py-2 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
        >
          {showGuide ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          Expected folder structure
        </button>
        {showGuide && (
          <div className="px-3 pb-3">
            <pre className="text-[10px] text-text-secondary bg-bg-tertiary rounded-md px-3 py-2 leading-relaxed font-mono overflow-x-auto">{`your-repo/
  models/
    sales/
      orders.model.yaml
    finance/
      gl.model.yaml
  ddl/
  migrations/`}</pre>
            <p className="text-[10px] text-text-muted mt-1.5 leading-relaxed">
              Place <code className="text-accent-blue">*.model.yaml</code> files anywhere inside the repo. DuckCode discovers them automatically.
            </p>
          </div>
        )}
      </div>

      {/* Connected repos */}
      {connectedRepos.length > 0 && (
        <div className="border-t border-border-primary/60 px-3 py-2 space-y-1">
          <p className="text-[9px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">Connected</p>
          {connectedRepos.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5">
              {detectProvider(p.githubRepo) === "gitlab"
                ? <GitlabLogo size={11} className="text-orange-500 shrink-0" />
                : <GithubLogo size={11} className="text-text-muted shrink-0" />}
              <button
                onClick={() => { selectProject(p.id); setActiveActivity("model"); }}
                className="flex-1 min-w-0 text-left text-[11px] text-text-secondary hover:text-text-primary truncate transition-colors"
              >
                {p.name}
              </button>
              <span className="text-[9px] text-text-muted shrink-0">{p.defaultBranch || "main"}</span>
              <button
                onClick={() => handleRefresh(p)}
                disabled={refreshingId === p.id}
                title="Pull latest"
                className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
              >
                <RefreshCw size={10} className={refreshingId === p.id ? "animate-spin" : ""} />
              </button>
            </div>
          ))}
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
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
  const ACTIVITIES = ALL_ACTIVITIES.filter((a) => !a.adminOnly || canEdit);
  const topItems = ACTIVITIES.filter((a) => a.group === "top");
  const bottomItems = ACTIVITIES.filter((a) => a.group === "bottom");
  const homeActive = activeActivity === "search" || activeActivity === "home";

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
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
  const ACTIVITIES = ALL_ACTIVITIES.filter((a) => !a.adminOnly || canEdit);
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
            {!canEdit && <BookmarksPanel />}
          </>
        )}
        {activity === "connect" && (
          <GitConnectSection />
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

  const { canEdit: canEditFn } = useAuthStore();
  const handleHomeSelect = () => {
    // Viewers get the welcome/landing page; admins go straight to global search
    setActiveActivity(canEditFn() ? "search" : "home");
    setSidePanelOpen(false);
  };

  return (
    <div className="flex h-full">
      <ActivityBar activeActivity={activeActivity} onSelect={handleActivitySelect} onHome={handleHomeSelect} />
      {sidePanelOpen && activeActivity !== "search" && <SidePanel activity={activeActivity} />}
    </div>
  );
}
