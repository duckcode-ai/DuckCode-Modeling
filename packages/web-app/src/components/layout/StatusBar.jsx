import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Boxes,
  ArrowRightLeft,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import { runModelChecks } from "../../modelQuality";

export default function StatusBar() {
  const { activeFile, activeFileContent, offlineMode } = useWorkspaceStore();
  const { model, nodes, edges } = useDiagramStore();

  const check = activeFileContent ? runModelChecks(activeFileContent) : null;
  const errorCount = check?.errors?.length || 0;
  const warnCount = check?.warnings?.length || 0;

  return (
    <div className="h-6 bg-bg-secondary border-t border-border-primary flex items-center px-3 gap-4 text-[11px] text-text-muted shrink-0">
      {/* Mode */}
      <span className={`flex items-center gap-1 ${offlineMode ? "text-accent-yellow" : "text-accent-green"}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${offlineMode ? "bg-accent-yellow" : "bg-accent-green"}`} />
        {offlineMode ? "Offline" : "Connected"}
      </span>

      {/* Active file */}
      {activeFile && (
        <span className="flex items-center gap-1">
          <FileCode2 size={11} />
          {activeFile.name || activeFile.path}
        </span>
      )}

      {/* Entities & relationships */}
      {model && (
        <>
          <span className="flex items-center gap-1">
            <Boxes size={11} />
            {nodes.length} entities
          </span>
          <span className="flex items-center gap-1">
            <ArrowRightLeft size={11} />
            {edges.length} relationships
          </span>
        </>
      )}

      {/* Validation status */}
      <div className="ml-auto flex items-center gap-3">
        {errorCount > 0 ? (
          <span className="flex items-center gap-1 text-status-error">
            <AlertCircle size={11} />
            {errorCount} {errorCount === 1 ? "error" : "errors"}
          </span>
        ) : check ? (
          <span className="flex items-center gap-1 text-status-success">
            <CheckCircle2 size={11} />
            Valid
          </span>
        ) : null}
        {warnCount > 0 && (
          <span className="flex items-center gap-1 text-status-warning">
            <AlertTriangle size={11} />
            {warnCount} {warnCount === 1 ? "warning" : "warnings"}
          </span>
        )}
      </div>
    </div>
  );
}
