import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Boxes,
  ArrowRightLeft,
  Gauge,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import { runModelChecks } from "../../modelQuality";

function completenessStatusCls(score) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-500";
  return "text-red-500";
}

export default function StatusBar() {
  const { activeFile, activeFileContent, offlineMode } = useWorkspaceStore();
  const { model, nodes, edges } = useDiagramStore();
  const { activeActivity, bottomPanelOpen, toggleBottomPanel } = useUiStore();

  const check = activeFileContent ? runModelChecks(activeFileContent) : null;
  const errorCount = check?.errors?.length || 0;
  // Exclude nudge codes from the status bar warning count to keep it clean
  const NUDGE_CODES = new Set([
    "MISSING_ENTITY_DESCRIPTION","MISSING_ENTITY_OWNER","MISSING_GRAIN_SOURCE_LAYER",
    "PII_TAG_WITHOUT_CLASSIFICATION","SENSITIVITY_WITHOUT_CLASSIFICATION",
    "FINANCIAL_FIELD_NO_EXAMPLES","CREATED_WITHOUT_UPDATED","LOW_FIELD_DESCRIPTION_COVERAGE",
    "LARGE_ENTITY_NO_INDEXES","REPORT_ENTITY_NO_METRICS","GLOSSARY_NO_FIELD_REFS","ORPHAN_IMPORT_ENTITY",
    "FACT_WITHOUT_DIMENSION_REFS","DIM_WITHOUT_NATURAL_KEY","SCD2_MISSING_SYSTEM_FIELDS",
    "FACT_TABLE_NO_METRICS","DIMENSION_REF_NOT_FOUND",
  ]);
  const warnCount = (check?.warnings || []).filter((w) => !NUDGE_CODES.has(w.code)).length;
  const gapCount = (check?.warnings || []).filter((w) => NUDGE_CODES.has(w.code)).length;
  const completeness = check?.completeness || null;
  const supportsBottomPanel =
    activeActivity === "model" || activeActivity === "explore" || activeActivity === "settings";

  return (
    <div className="h-7 bg-bg-secondary border-t border-border-primary/80 flex items-center px-3 gap-4 text-[11px] text-text-muted shrink-0">
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

      {/* Validation + completeness status */}
      <div className="ml-auto flex items-center gap-3">
        {supportsBottomPanel && (
          <button
            onClick={toggleBottomPanel}
            className="px-2 py-0.5 rounded border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={`${bottomPanelOpen ? "Hide" : "Show"} bottom panel (⌘J)`}
          >
            {bottomPanelOpen ? "Hide Panels" : "Show Panels"}
          </button>
        )}

        {/* Completeness score */}
        {completeness && (
          <span
            className={`flex items-center gap-1 ${completenessStatusCls(completeness.modelScore)}`}
            title={`Model completeness: ${completeness.modelScore}% — ${completeness.fullyComplete}/${completeness.totalEntities} entities fully complete`}
          >
            <Gauge size={11} />
            {completeness.modelScore}%
          </span>
        )}

        {/* Validation status */}
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
        {gapCount > 0 && (
          <span className="flex items-center gap-1 text-orange-500">
            <Gauge size={11} />
            {gapCount} {gapCount === 1 ? "gap" : "gaps"}
          </span>
        )}
      </div>
    </div>
  );
}
