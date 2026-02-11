import React from "react";
import {
  Save,
  X,
  AlertTriangle,
  Loader2,
  Moon,
  Sun,
  LayoutDashboard,
  Plug,
  ShieldCheck,
  Compass,
  Search,
  Settings,
  ChevronRight,
  FileCode2,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";

const ACTIVITY_LABELS = {
  model: { label: "Model", icon: LayoutDashboard, color: "text-accent-blue" },
  connect: { label: "Connect", icon: Plug, color: "text-cyan-500" },
  import: { label: "Import", icon: FileCode2, color: "text-green-500" },
  explore: { label: "Explore", icon: Compass, color: "text-purple-500" },
  search: { label: "Search", icon: Search, color: "text-amber-500" },
  settings: { label: "Settings", icon: Settings, color: "text-text-muted" },
};

export default function TopBar() {
  const {
    activeFile,
    isDirty,
    saveCurrentFile,
    openTabs,
    switchTab,
    closeTab,
    loading,
    offlineMode,
  } = useWorkspaceStore();

  const { model } = useDiagramStore();
  const { theme, toggleTheme, activeActivity } = useUiStore();
  const modelMeta = model?.model || {};
  const activityInfo = ACTIVITY_LABELS[activeActivity] || ACTIVITY_LABELS.model;
  const ActivityIcon = activityInfo.icon;

  return (
    <div className="h-auto bg-bg-secondary border-b border-border-primary flex flex-col">
      {/* Breadcrumb + tabs row */}
      <div className="flex items-center gap-0 px-1 pt-0.5 overflow-x-auto">
        {/* Activity breadcrumb */}
        <div className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold shrink-0 ${activityInfo.color}`}>
          <ActivityIcon size={12} />
          {activityInfo.label}
        </div>

        {/* Separator */}
        {openTabs.length > 0 && (
          <ChevronRight size={10} className="text-text-muted shrink-0 mx-0.5" />
        )}

        {/* File tabs */}
        {openTabs.map((tab) => {
          const key = offlineMode ? tab.id : tab.fullPath;
          const isActive = offlineMode
            ? activeFile?.id === tab.id
            : activeFile?.fullPath === tab.fullPath;

          return (
            <div
              key={key}
              className={`group flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] cursor-pointer border-b-2 transition-colors shrink-0 ${
                isActive
                  ? "border-accent-blue text-text-primary bg-bg-primary"
                  : "border-transparent text-text-muted hover:text-text-secondary hover:bg-bg-hover"
              }`}
              onClick={() => switchTab(tab)}
            >
              <FileCode2 size={10} className="shrink-0 text-accent-blue/60" />
              <span className="truncate max-w-[140px]">{tab.name || tab.path}</span>
              {isActive && isDirty && <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow shrink-0" />}
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-tertiary transition-all"
              >
                <X size={9} />
              </button>
            </div>
          );
        })}

        {/* Right-side actions */}
        <div className="flex items-center gap-1 ml-auto shrink-0 pr-2">
          {/* Model meta chips */}
          {modelMeta.name && activeActivity === "model" && (
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue text-[10px] font-medium">
                {modelMeta.name}
              </span>
              {modelMeta.version && (
                <span className="px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-secondary text-[10px]">
                  v{modelMeta.version}
                </span>
              )}
              {modelMeta.domain && (
                <span className="px-1.5 py-0.5 rounded-full bg-accent-purple/10 text-accent-purple text-[10px]">
                  {modelMeta.domain}
                </span>
              )}
              {modelMeta.state && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  modelMeta.state === "approved"
                    ? "bg-accent-green/10 text-accent-green"
                    : modelMeta.state === "deprecated"
                    ? "bg-accent-red/10 text-accent-red"
                    : "bg-accent-yellow/10 text-accent-yellow"
                }`}>
                  {modelMeta.state}
                </span>
              )}
            </div>
          )}

          {isDirty && (
            <span className="text-[10px] text-accent-yellow flex items-center gap-0.5">
              <AlertTriangle size={10} />
              Unsaved
            </span>
          )}
          {loading && (
            <Loader2 size={12} className="text-text-muted animate-spin" />
          )}
          <button
            onClick={toggleTheme}
            className="p-1 rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode (⌘D)`}
          >
            {theme === "light" ? <Moon size={13} /> : <Sun size={13} />}
          </button>
          <button
            onClick={saveCurrentFile}
            disabled={!isDirty || !activeFile}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save size={11} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
