import React from "react";
import {
  FolderPlus,
  FilePlus,
  Save,
  Download,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3x3,
  Sparkles,
  ArrowRightLeft,
  Loader2,
  AlertTriangle,
  X,
  Moon,
  Sun,
  LifeBuoy,
  LayoutDashboard,
  Plug,
  FileCode2,
  Search,
  Settings,
  GitBranch,
  GitCommit,
  UploadCloud,
  DownloadCloud,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import UserMenu from "../auth/UserMenu";
import ProjectTabs from "./ProjectTabs";
import {
  standardsFixModel,
  transformActiveModel,
  fetchGitStatus,
  pushGitBranch,
  pullGitBranch,
} from "../../lib/api";

const ACTIVITY_LABELS = {
  model:    { label: "Model",    icon: LayoutDashboard, color: "text-accent-blue" },
  connect:  { label: "Connect",  icon: Plug,            color: "text-cyan-500" },
  import:   { label: "Import",   icon: FileCode2,       color: "text-green-500" },
  search:   { label: "Search",   icon: Search,          color: "text-amber-500" },
  settings: { label: "Settings", icon: Settings,        color: "text-slate-500" },
};

/* ── Reusable primitives ──────────────────────────────────────────────── */

function Group({ children, className = "" }) {
  return (
    <div className={`flex items-center gap-0.5 ${className}`}>{children}</div>
  );
}

function Divider() {
  return <span className="dl-toolbar-divider" aria-hidden="true" />;
}

function TBButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  title,
  variant = "default",
  iconOnly = false,
  loading = false,
}) {
  const cls =
    variant === "primary"
      ? "dl-toolbar-btn dl-toolbar-btn--primary"
      : iconOnly
      ? "dl-toolbar-btn dl-toolbar-btn--ghost-icon"
      : "dl-toolbar-btn";
  const IconComp = loading ? Loader2 : Icon;
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
    >
      {IconComp && (
        <IconComp size={14} className={loading ? "animate-spin" : ""} strokeWidth={1.75} />
      )}
      {!iconOnly && label && <span>{label}</span>}
    </button>
  );
}

/* ── TopBar ───────────────────────────────────────────────────────────── */

export default function TopBar() {
  const {
    activeFile,
    activeFileContent,
    isDirty,
    saveCurrentFile,
    openTabs,
    switchTab,
    closeTab,
    loading,
    offlineMode,
    projectConfig,
    updateContent,
    activeProjectId,
  } = useWorkspaceStore();

  const { model } = useDiagramStore();
  const { theme, toggleTheme, activeActivity, openModal, addToast } = useUiStore();
  const { canEdit } = useAuthStore();
  const [modelOpLoading, setModelOpLoading] = React.useState(false);
  const [gitStatus, setGitStatus] = React.useState(null);
  const [gitBusy, setGitBusy] = React.useState(false);

  const refreshGit = React.useCallback(async () => {
    if (!activeProjectId) {
      setGitStatus(null);
      return;
    }
    try {
      const s = await fetchGitStatus(activeProjectId);
      setGitStatus(s);
    } catch {
      setGitStatus(null);
    }
  }, [activeProjectId]);

  React.useEffect(() => {
    refreshGit();
    const t = setInterval(refreshGit, 15000);
    return () => clearInterval(t);
  }, [refreshGit]);

  const handleGitPush = React.useCallback(async () => {
    if (!activeProjectId) return;
    setGitBusy(true);
    try {
      await pushGitBranch(activeProjectId, {});
      addToast?.({ type: "success", message: "Pushed to remote." });
      refreshGit();
    } catch (err) {
      addToast?.({ type: "error", message: err.message || "Push failed" });
    } finally {
      setGitBusy(false);
    }
  }, [activeProjectId, addToast, refreshGit]);

  const handleGitPull = React.useCallback(async () => {
    if (!activeProjectId) return;
    setGitBusy(true);
    try {
      await pullGitBranch(activeProjectId, {});
      addToast?.({ type: "success", message: "Pulled from remote." });
      refreshGit();
    } catch (err) {
      addToast?.({ type: "error", message: err.message || "Pull failed" });
    } finally {
      setGitBusy(false);
    }
  }, [activeProjectId, addToast, refreshGit]);

  const modelMeta = model?.model || {};
  const modelKind = modelMeta.kind || "physical";
  const nextTransform =
    modelKind === "conceptual"
      ? { command: "conceptual-to-logical", label: "To Logical" }
      : modelKind === "logical"
      ? { command: "logical-to-physical", label: "To Physical" }
      : null;
  const activityInfo = ACTIVITY_LABELS[activeActivity] || ACTIVITY_LABELS.model;
  const ActivityIcon = activityInfo.icon;

  const handleQuickExport = React.useCallback(() => {
    const el = document.querySelector(".react-flow");
    if (!el) return;
    import("html-to-image").then(({ toPng }) => {
      toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 }).then((dataUrl) => {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "datalex-diagram.png";
        a.click();
      });
    });
  }, []);

  const handleTransform = React.useCallback(async () => {
    if (!nextTransform || !activeFileContent) return;
    setModelOpLoading(true);
    try {
      const dialect = String(projectConfig?.defaultDialect || "postgres").toLowerCase();
      const result = await transformActiveModel({
        modelContent: activeFileContent,
        modelPath: activeFile?.fullPath,
        transform: nextTransform.command,
        dialect,
      });
      updateContent(result.transformedYaml || "");
      addToast?.({ type: "success", message: `Transformed model ${nextTransform.label.toLowerCase()}.` });
    } catch (err) {
      addToast?.({ type: "error", message: err.message || "Transform failed" });
    } finally {
      setModelOpLoading(false);
    }
  }, [nextTransform, activeFileContent, activeFile, projectConfig, updateContent, addToast]);

  const handleStandardsFix = React.useCallback(async () => {
    if (!activeFileContent) return;
    setModelOpLoading(true);
    try {
      const result = await standardsFixModel({
        modelContent: activeFileContent,
        modelPath: activeFile?.fullPath,
      });
      updateContent(result.fixedYaml || "");
      addToast?.({ type: "success", message: "Applied standards autofixes." });
    } catch (err) {
      addToast?.({ type: "error", message: err.message || "Standards fix failed" });
    } finally {
      setModelOpLoading(false);
    }
  }, [activeFileContent, activeFile, updateContent, addToast]);

  const onCanvas = activeActivity === "model" || activeActivity === "settings";
  const editable = canEdit();

  return (
    <div className="bg-bg-toolbar border-b border-border-primary/90 shadow-xs">
      {/* Row 1 — Grouped toolbar */}
      <div className="h-11 px-2 flex items-center gap-1">
        {/* Activity chip */}
        <div
          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-semibold shrink-0 border border-border-primary bg-bg-surface shadow-xs ${activityInfo.color}`}
          title={`${activityInfo.label} workspace`}
        >
          <ActivityIcon size={13} strokeWidth={1.9} />
          {activityInfo.label}
        </div>

        <Divider />

        {/* File group */}
        <Group>
          {editable && (
            <TBButton
              icon={FolderPlus}
              label="Project"
              title="Add project folder"
              onClick={() => openModal("addProject")}
            />
          )}
          {editable && (
            <TBButton
              icon={FilePlus}
              label="New"
              title="New model file"
              onClick={() => openModal("newFile")}
              disabled={!onCanvas}
            />
          )}
          {editable ? (
            <TBButton
              icon={Save}
              label="Save"
              title={isDirty ? "Save changes (⌘S)" : "No changes to save"}
              variant={isDirty ? "primary" : "default"}
              onClick={saveCurrentFile}
              disabled={!isDirty || !activeFile}
            />
          ) : (
            <TBButton
              icon={Download}
              label="Export"
              title="Export diagram as PNG"
              onClick={handleQuickExport}
            />
          )}
        </Group>

        <Divider />

        {/* Project tabs — multiple open projects, Cmd+Tab to cycle */}
        <ProjectTabs />

        <Divider />

        {/* Edit group — undo/redo wiring tracked separately from Luna-class UI work */}
        <Group>
          <TBButton icon={Undo2} label="Undo" iconOnly disabled title="Undo (coming soon)" />
          <TBButton icon={Redo2} label="Redo" iconOnly disabled title="Redo (coming soon)" />
        </Group>

        <Divider />

        {/* View group — diagram zoom/grid (proxies DiagramToolbar actions via DOM events) */}
        <Group>
          <TBButton
            icon={ZoomIn}
            label="Zoom in"
            iconOnly
            title="Zoom in"
            onClick={() => window.dispatchEvent(new CustomEvent("dl:diagram:zoom-in"))}
            disabled={!onCanvas}
          />
          <TBButton
            icon={ZoomOut}
            label="Zoom out"
            iconOnly
            title="Zoom out"
            onClick={() => window.dispatchEvent(new CustomEvent("dl:diagram:zoom-out"))}
            disabled={!onCanvas}
          />
          <TBButton
            icon={Maximize2}
            label="Fit"
            iconOnly
            title="Fit to view"
            onClick={() => window.dispatchEvent(new CustomEvent("dl:diagram:fit"))}
            disabled={!onCanvas}
          />
          <TBButton
            icon={Grid3x3}
            label="Grid"
            iconOnly
            title="Toggle grid"
            onClick={() => window.dispatchEvent(new CustomEvent("dl:diagram:toggle-grid"))}
            disabled={!onCanvas}
          />
        </Group>

        {/* Model ops — only when a model is loaded on the canvas */}
        {editable && modelMeta.name && onCanvas && (
          <>
            <Divider />
            <Group>
              <TBButton
                icon={Sparkles}
                label="Standards"
                title="Apply supported standards autofixes"
                onClick={handleStandardsFix}
                disabled={modelOpLoading || !activeFile}
                loading={modelOpLoading}
              />
              {nextTransform && (
                <TBButton
                  icon={ArrowRightLeft}
                  label={nextTransform.label}
                  title={`Transform model ${nextTransform.label.toLowerCase()}`}
                  onClick={handleTransform}
                  disabled={modelOpLoading || !activeFile}
                />
              )}
            </Group>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Model meta chips */}
        {modelMeta.name && onCanvas && (
          <Group className="mr-1">
            <span className="dl-chip dl-chip--accent">{modelMeta.name}</span>
            {modelMeta.version && (
              <span className="dl-chip">v{modelMeta.version}</span>
            )}
            <span
              className="dl-chip"
              style={{
                background: "var(--color-accent-green-soft)",
                color: "var(--color-accent-green)",
                border: "none",
              }}
            >
              {modelKind}
            </span>
            {modelMeta.domain && (
              <span
                className="dl-chip"
                style={{
                  background: "var(--color-accent-purple-soft)",
                  color: "var(--color-accent-purple)",
                  border: "none",
                }}
              >
                {modelMeta.domain}
              </span>
            )}
          </Group>
        )}

        {/* Unsaved indicator */}
        {editable && isDirty && (
          <span className="flex items-center gap-1 px-1.5 text-xs text-accent-yellow">
            <AlertTriangle size={12} />
            Unsaved
          </span>
        )}

        {loading && <Loader2 size={13} className="text-text-muted animate-spin mx-1" />}

        <Divider />

        {/* Git section */}
        {gitStatus ? (
          <Group>
            <TBButton
              icon={GitBranch}
              label={gitStatus.branch || "HEAD"}
              title={`Branch: ${gitStatus.branch || "HEAD"}`}
              onClick={() => openModal("commit")}
              disabled={!editable}
            />
            {gitStatus.behind > 0 && (
              <span
                className="dl-chip"
                title={`${gitStatus.behind} commit(s) behind`}
              >
                <ArrowDown size={10} /> {gitStatus.behind}
              </span>
            )}
            {gitStatus.ahead > 0 && (
              <span
                className="dl-chip dl-chip--accent"
                title={`${gitStatus.ahead} commit(s) ahead`}
              >
                <ArrowUp size={10} /> {gitStatus.ahead}
              </span>
            )}
            <TBButton
              icon={GitCommit}
              iconOnly
              title="Commit changes…"
              onClick={() => openModal("commit")}
              disabled={!editable || gitBusy}
            />
            <TBButton
              icon={DownloadCloud}
              iconOnly
              title="Pull"
              onClick={handleGitPull}
              disabled={!editable || gitBusy}
            />
            <TBButton
              icon={UploadCloud}
              iconOnly
              title="Push"
              onClick={handleGitPush}
              disabled={!editable || gitBusy}
              loading={gitBusy}
            />
          </Group>
        ) : (
          <TBButton icon={GitBranch} label="Git" title="No git repository" disabled />
        )}

        <Divider />

        {/* Right cluster */}
        <Group>
          <TBButton
            icon={Plug}
            iconOnly
            title="Connections"
            onClick={() => openModal("connectionsManager")}
          />
          <TBButton
            icon={Settings}
            iconOnly
            title="Settings"
            onClick={() => openModal("settings")}
          />
          <a
            href="https://discord.gg/Dnm6bUvk"
            target="_blank"
            rel="noopener noreferrer"
            className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
            title="Community (Discord)"
          >
            <LifeBuoy size={14} strokeWidth={1.75} />
          </a>
          <TBButton
            icon={theme === "light" ? Moon : Sun}
            iconOnly
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode (⌘D)`}
            onClick={toggleTheme}
          />
          <UserMenu />
        </Group>
      </div>

      {/* Row 2 — File tabs */}
      {openTabs.length > 0 && (
        <div className="h-8 px-2 flex items-center gap-0.5 border-t border-border-subtle bg-bg-surface/40 overflow-x-auto">
          {openTabs.map((tab) => {
            const key = offlineMode ? tab.id : tab.fullPath;
            const isActive = offlineMode
              ? activeFile?.id === tab.id
              : activeFile?.fullPath === tab.fullPath;

            return (
              <div
                key={key}
                onClick={() => switchTab(tab)}
                className={`group flex items-center gap-1.5 h-7 px-2 text-xs rounded-md cursor-pointer transition-all shrink-0 ${
                  isActive
                    ? "bg-bg-active text-text-accent shadow-xs"
                    : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                }`}
              >
                <FileCode2 size={11} className="shrink-0 text-accent-blue/70" strokeWidth={1.75} />
                <span className="truncate max-w-[160px] font-medium">{tab.name || tab.path}</span>
                {isActive && isDirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow shrink-0" />
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-tertiary transition-all"
                  title="Close tab"
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
