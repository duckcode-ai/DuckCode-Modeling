import React from "react";
import { X, FolderOpen, Plus } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";

/**
 * Horizontal project tab strip shown in the top bar. Each tab represents an
 * open project (not a file); clicking switches the workspace, × closes it, and
 * the trailing + opens the "Add Project" flow.
 *
 * Dirty state is inferred from isDirty of the active project; cached projects
 * expose their stored isDirty through projectCache.
 */
export default function ProjectTabs() {
  const {
    projects,
    openProjects,
    activeProjectId,
    projectCache,
    isDirty,
    selectProject,
    closeProject,
  } = useWorkspaceStore();
  const { openModal } = useUiStore();

  if (!openProjects || openProjects.length === 0) {
    return (
      <button
        onClick={() => openModal("addProject")}
        className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
        title="Open a project"
      >
        <FolderOpen size={14} strokeWidth={1.75} />
        <span className="text-xs">Open project</span>
      </button>
    );
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));

  const handleClose = async (e, id) => {
    e.stopPropagation();
    const cached = projectCache[id];
    const dirty = id === activeProjectId ? isDirty : !!cached?.isDirty;
    if (dirty) {
      const project = projectById.get(id);
      const name = project?.name || id;
      const confirmed = window.confirm(
        `${name} has unsaved changes. Close without saving?`
      );
      if (!confirmed) return;
    }
    await closeProject(id);
  };

  return (
    <div className="flex items-center gap-0.5 min-w-0 max-w-[520px] overflow-x-auto">
      {openProjects.map((id) => {
        const project = projectById.get(id);
        const name = project?.name || id;
        const isActive = id === activeProjectId;
        const cached = projectCache[id];
        const dirty = isActive ? isDirty : !!cached?.isDirty;
        return (
          <div
            key={id}
            onClick={() => selectProject(id)}
            className={`group relative flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-md cursor-pointer select-none transition-colors ${
              isActive
                ? "bg-bg-active text-text-accent"
                : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
            title={project?.path || name}
          >
            <FolderOpen size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="text-xs font-medium truncate max-w-[140px]">{name}</span>
            {dirty && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent-yellow shrink-0"
                title="Unsaved changes"
              />
            )}
            <button
              onClick={(e) => handleClose(e, id)}
              className="p-0.5 rounded hover:bg-bg-hover text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
              title="Close project tab"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => openModal("addProject")}
        className="ml-0.5 p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
        title="Add project"
      >
        <Plus size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
