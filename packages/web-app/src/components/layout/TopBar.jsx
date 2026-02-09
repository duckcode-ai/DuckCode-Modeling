import React from "react";
import {
  Save,
  Play,
  FileDown,
  FileUp,
  Plus,
  RotateCcw,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";

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
  const modelMeta = model?.model || {};

  return (
    <div className="h-auto bg-bg-secondary border-b border-border-primary flex flex-col">
      {/* Tabs row */}
      <div className="flex items-center gap-0 px-1 pt-1 overflow-x-auto">
        {openTabs.map((tab) => {
          const key = offlineMode ? tab.id : tab.fullPath;
          const isActive = offlineMode
            ? activeFile?.id === tab.id
            : activeFile?.fullPath === tab.fullPath;

          return (
            <div
              key={key}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-b-2 transition-colors shrink-0 ${
                isActive
                  ? "border-accent-blue text-text-primary bg-bg-primary"
                  : "border-transparent text-text-muted hover:text-text-secondary hover:bg-bg-hover"
              }`}
              onClick={() => switchTab(tab)}
            >
              <span className="truncate max-w-[160px]">{tab.name || tab.path}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-tertiary transition-all"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-between px-3 py-1.5 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Model meta chips */}
          {modelMeta.name && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue text-xs font-medium">
                {modelMeta.name}
              </span>
              {modelMeta.version && (
                <span className="px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary text-xs">
                  v{modelMeta.version}
                </span>
              )}
              {modelMeta.domain && (
                <span className="px-2 py-0.5 rounded-full bg-accent-purple/15 text-accent-purple text-xs">
                  {modelMeta.domain}
                </span>
              )}
              {modelMeta.state && (
                <span className={`px-2 py-0.5 rounded-full text-xs ${
                  modelMeta.state === "approved"
                    ? "bg-accent-green/15 text-accent-green"
                    : modelMeta.state === "deprecated"
                    ? "bg-accent-red/15 text-accent-red"
                    : "bg-accent-yellow/15 text-accent-yellow"
                }`}>
                  {modelMeta.state}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isDirty && (
            <span className="text-xs text-accent-yellow flex items-center gap-1">
              <AlertTriangle size={11} />
              Unsaved
            </span>
          )}
          {loading && (
            <Loader2 size={14} className="text-text-muted animate-spin" />
          )}
          <button
            onClick={saveCurrentFile}
            disabled={!isDirty || !activeFile}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save size={12} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
