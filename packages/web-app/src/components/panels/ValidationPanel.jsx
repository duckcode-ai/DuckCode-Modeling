import React, { useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  FileCode2,
  ChevronRight,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import { runModelChecks } from "../../modelQuality";

const SEVERITY_CONFIG = {
  error: { icon: AlertCircle, color: "text-status-error", bg: "bg-red-50 border-red-200" },
  warn: { icon: AlertTriangle, color: "text-status-warning", bg: "bg-yellow-50 border-yellow-200" },
  info: { icon: Info, color: "text-status-info", bg: "bg-blue-50 border-blue-200" },
};

function IssueRow({ issue, index }) {
  const config = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-2 px-3 py-2 border rounded-md ${config.bg} transition-colors`}>
      <Icon size={13} className={`${config.color} shrink-0 mt-0.5`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${config.color}`}>
            {issue.code}
          </span>
          {issue.path && issue.path !== "/" && (
            <code className="text-[10px] text-text-muted bg-bg-primary px-1 py-0 rounded">
              {issue.path}
            </code>
          )}
        </div>
        <p className="text-xs text-text-secondary mt-0.5">{issue.message}</p>
      </div>
    </div>
  );
}

export default function ValidationPanel() {
  const { activeFileContent, projectFiles, offlineMode, localDocuments } = useWorkspaceStore();

  const currentCheck = useMemo(() => {
    if (!activeFileContent) return null;
    return runModelChecks(activeFileContent);
  }, [activeFileContent]);

  const allFileChecks = useMemo(() => {
    const files = offlineMode ? localDocuments : projectFiles;
    return files.map((file) => {
      const content = file.content || "";
      const check = content ? runModelChecks(content) : { errors: [], warnings: [], issues: [] };
      return { file, check };
    });
  }, [offlineMode, localDocuments, projectFiles]);

  const errors = currentCheck?.errors || [];
  const warnings = currentCheck?.warnings || [];
  const issues = currentCheck?.issues || [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-primary bg-bg-secondary/50">
        <span className="text-xs font-semibold text-text-primary">Validation</span>
        <div className="flex items-center gap-2 ml-auto">
          {errors.length > 0 ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-semibold">
              <AlertCircle size={10} />
              {errors.length} errors
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-600 text-[10px] font-semibold">
              <CheckCircle2 size={10} />
              No errors
            </span>
          )}
          {warnings.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-600 text-[10px] font-semibold">
              <AlertTriangle size={10} />
              {warnings.length} warnings
            </span>
          )}
        </div>
      </div>

      {/* Issues list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!activeFileContent ? (
          <div className="flex items-center justify-center h-full text-text-muted text-xs">
            Open a file to see validation results
          </div>
        ) : issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 size={32} className="text-green-500 mb-2" />
            <p className="text-sm text-text-primary font-medium">All checks passed</p>
            <p className="text-xs text-text-muted mt-1">No validation issues found in the current model</p>
          </div>
        ) : (
          <>
            {/* Group by severity */}
            {errors.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] text-status-error uppercase tracking-wider font-semibold px-1">
                  Errors ({errors.length})
                </h4>
                {errors.map((issue, idx) => (
                  <IssueRow key={`err-${idx}`} issue={issue} index={idx} />
                ))}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="space-y-1.5 mt-3">
                <h4 className="text-[10px] text-status-warning uppercase tracking-wider font-semibold px-1">
                  Warnings ({warnings.length})
                </h4>
                {warnings.map((issue, idx) => (
                  <IssueRow key={`warn-${idx}`} issue={issue} index={idx} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
