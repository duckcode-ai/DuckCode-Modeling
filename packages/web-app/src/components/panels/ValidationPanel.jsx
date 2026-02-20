import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Gauge,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import { runModelChecks } from "../../modelQuality";

const SEVERITY_CONFIG = {
  error: { icon: AlertCircle, color: "text-status-error", bg: "bg-red-50 border-red-200" },
  warn: { icon: AlertTriangle, color: "text-status-warning", bg: "bg-yellow-50 border-yellow-200" },
  info: { icon: Info, color: "text-status-info", bg: "bg-blue-50 border-blue-200" },
};

// Nudge issue codes — shown in a dedicated Gaps section
const NUDGE_CODES = new Set([
  "MISSING_ENTITY_DESCRIPTION",
  "MISSING_ENTITY_OWNER",
  "MISSING_GRAIN_SOURCE_LAYER",
  "PII_TAG_WITHOUT_CLASSIFICATION",
  "SENSITIVITY_WITHOUT_CLASSIFICATION",
  "FINANCIAL_FIELD_NO_EXAMPLES",
  "CREATED_WITHOUT_UPDATED",
  "LOW_FIELD_DESCRIPTION_COVERAGE",
  "LARGE_ENTITY_NO_INDEXES",
  "REPORT_ENTITY_NO_METRICS",
  "GLOSSARY_NO_FIELD_REFS",
  "ORPHAN_IMPORT_ENTITY",
  // Dimensional modeling nudges
  "FACT_WITHOUT_DIMENSION_REFS",
  "DIM_WITHOUT_NATURAL_KEY",
  "SCD2_MISSING_SYSTEM_FIELDS",
  "FACT_TABLE_NO_METRICS",
  "DIMENSION_REF_NOT_FOUND",
]);

// Dimensional-specific codes — shown in a dedicated Dimensional Modeling section
const DIMENSIONAL_CODES = new Set([
  "FACT_WITHOUT_DIMENSION_REFS",
  "DIM_WITHOUT_NATURAL_KEY",
  "SCD2_MISSING_SYSTEM_FIELDS",
  "FACT_TABLE_NO_METRICS",
  "DIMENSION_REF_NOT_FOUND",
]);

function scoreColor(score) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-500";
}

function scoreBarColor(score) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-400";
  return "bg-red-400";
}

function scoreLabel(score) {
  if (score === 100) return { text: "Complete", cls: "bg-green-50 text-green-700" };
  if (score >= 80) return { text: "Good", cls: "bg-green-50 text-green-600" };
  if (score >= 60) return { text: "Partial", cls: "bg-yellow-50 text-yellow-600" };
  return { text: "Gaps", cls: "bg-red-50 text-red-600" };
}

function ScoreBar({ score, height = "h-1.5" }) {
  return (
    <div className={`w-full bg-gray-200 rounded-full ${height} overflow-hidden`}>
      <div
        className={`${scoreBarColor(score)} ${height} rounded-full transition-all duration-300`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

function EntityCompletenessRow({ entity }) {
  const [open, setOpen] = useState(false);
  const label = scoreLabel(entity.score);

  return (
    <div className="border border-border-primary rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-bg-hover transition-colors text-left"
      >
        {open ? <ChevronDown size={11} className="shrink-0 text-text-muted" /> : <ChevronRight size={11} className="shrink-0 text-text-muted" />}
        <span className="text-xs font-medium text-text-primary truncate flex-1">{entity.entityName}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${label.cls} shrink-0`}>
          {entity.score}%
        </span>
      </button>

      {/* Mini progress bar always visible */}
      <div className="px-2.5 pb-1.5">
        <ScoreBar score={entity.score} height="h-1" />
      </div>

      {open && entity.missing.length > 0 && (
        <div className="border-t border-border-primary bg-bg-secondary/40 px-2.5 py-2 space-y-1">
          {entity.missing.map((m, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-text-secondary">
              <span className="text-yellow-500 shrink-0 mt-0.5">↳</span>
              <span>{m}</span>
            </div>
          ))}
        </div>
      )}

      {open && entity.missing.length === 0 && (
        <div className="border-t border-border-primary bg-green-50/50 px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] text-green-600">
          <CheckCircle2 size={11} />
          All completeness checks passed
        </div>
      )}
    </div>
  );
}

function CompletenessSection({ completeness }) {
  const [open, setOpen] = useState(true);
  if (!completeness) return null;

  const label = scoreLabel(completeness.modelScore);

  return (
    <div className="border border-border-primary rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-bg-secondary/60 hover:bg-bg-hover transition-colors text-left"
      >
        <Gauge size={13} className={scoreColor(completeness.modelScore)} />
        <span className="text-xs font-semibold text-text-primary flex-1">Completeness</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${label.cls}`}>
          {completeness.modelScore}%
        </span>
        {open ? <ChevronDown size={11} className="text-text-muted" /> : <ChevronRight size={11} className="text-text-muted" />}
      </button>

      {open && (
        <div className="p-2.5 space-y-2 bg-bg-primary">
          {/* Overall bar */}
          <div className="space-y-1">
            <ScoreBar score={completeness.modelScore} height="h-2" />
            <div className="flex justify-between text-[10px] text-text-muted">
              <span>{completeness.fullyComplete}/{completeness.totalEntities} entities fully complete</span>
              {completeness.needsAttention.length > 0 && (
                <span className="text-red-500">{completeness.needsAttention.length} need attention</span>
              )}
            </div>
          </div>

          {/* Per-entity rows */}
          <div className="space-y-1.5">
            {completeness.entities.map((e) => (
              <EntityCompletenessRow key={e.entityName} entity={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue }) {
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
  const { activeFileContent } = useWorkspaceStore();

  const currentCheck = useMemo(() => {
    if (!activeFileContent) return null;
    return runModelChecks(activeFileContent);
  }, [activeFileContent]);

  const errors = currentCheck?.errors || [];
  const allNudges = (currentCheck?.warnings || []).filter((w) => NUDGE_CODES.has(w.code));
  const warnings = (currentCheck?.warnings || []).filter((w) => !NUDGE_CODES.has(w.code));
  const dimensionalIssues = allNudges.filter((w) => DIMENSIONAL_CODES.has(w.code));
  const gaps = allNudges.filter((w) => !DIMENSIONAL_CODES.has(w.code));
  const completeness = currentCheck?.completeness || null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-primary bg-bg-secondary/50 shrink-0">
        <span className="text-xs font-semibold text-text-primary">Validation</span>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {errors.length > 0 ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-semibold">
              <AlertCircle size={10} />
              {errors.length} {errors.length === 1 ? "error" : "errors"}
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
              {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
            </span>
          )}
          {dimensionalIssues.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 text-[10px] font-semibold">
              <Info size={10} />
              {dimensionalIssues.length} dimensional
            </span>
          )}
          {gaps.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 text-[10px] font-semibold">
              <Gauge size={10} />
              {gaps.length} {gaps.length === 1 ? "gap" : "gaps"}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {!activeFileContent ? (
          <div className="flex items-center justify-center h-full text-text-muted text-xs">
            Open a file to see validation results
          </div>
        ) : (
          <>
            {/* Completeness section — always shown when a file is open */}
            <CompletenessSection completeness={completeness} />

            {/* Errors */}
            {errors.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] text-status-error uppercase tracking-wider font-semibold px-1">
                  Errors ({errors.length})
                </h4>
                {errors.map((iss, idx) => (
                  <IssueRow key={`err-${idx}`} issue={iss} />
                ))}
              </div>
            )}

            {/* Structural / semantic warnings */}
            {warnings.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] text-status-warning uppercase tracking-wider font-semibold px-1">
                  Warnings ({warnings.length})
                </h4>
                {warnings.map((iss, idx) => (
                  <IssueRow key={`warn-${idx}`} issue={iss} />
                ))}
              </div>
            )}

            {/* Dimensional Modeling nudges */}
            {dimensionalIssues.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] text-sky-600 uppercase tracking-wider font-semibold px-1">
                  Dimensional Modeling ({dimensionalIssues.length})
                </h4>
                {dimensionalIssues.map((iss, idx) => (
                  <IssueRow key={`dim-${idx}`} issue={iss} />
                ))}
              </div>
            )}

            {/* Gap / completeness nudges */}
            {gaps.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] text-orange-500 uppercase tracking-wider font-semibold px-1">
                  Gaps ({gaps.length})
                </h4>
                {gaps.map((iss, idx) => (
                  <IssueRow key={`gap-${idx}`} issue={iss} />
                ))}
              </div>
            )}

            {/* All clean */}
            {errors.length === 0 && warnings.length === 0 && gaps.length === 0 && dimensionalIssues.length === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <CheckCircle2 size={28} className="text-green-500 mb-2" />
                <p className="text-sm text-text-primary font-medium">All checks passed</p>
                <p className="text-xs text-text-muted mt-1">No validation issues found in the current model</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
