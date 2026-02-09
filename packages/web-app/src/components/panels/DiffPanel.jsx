import React, { useMemo, useState } from "react";
import {
  GitCompare,
  AlertCircle,
  CheckCircle2,
  Plus,
  Minus,
  RefreshCw,
  ArrowRightLeft,
  Shield,
  Download,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import { runGate } from "../../modelQuality";

export default function DiffPanel() {
  const { activeFileContent, baselineContent, baselineFile } = useWorkspaceStore();
  const [allowBreaking, setAllowBreaking] = useState(false);

  const gateResult = useMemo(() => {
    if (!activeFileContent || !baselineContent) return null;
    return runGate(baselineContent, activeFileContent, allowBreaking);
  }, [activeFileContent, baselineContent, allowBreaking]);

  const diff = gateResult?.diff;
  const gatePassed = gateResult?.gatePassed;

  if (!baselineContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted text-xs p-4">
        <GitCompare size={28} className="mb-2 text-text-muted/50" />
        <p className="text-sm mb-1">No baseline selected</p>
        <p className="text-xs text-center">
          Set a baseline file to compare changes and run quality gates
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-primary bg-bg-secondary/50">
        <span className="text-xs font-semibold text-text-primary">Diff & Gate</span>
        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={allowBreaking}
              onChange={(e) => setAllowBreaking(e.target.checked)}
              className="w-3 h-3 rounded accent-accent-blue"
            />
            Allow breaking
          </label>
          {gateResult && (
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              gatePassed
                ? "bg-green-50 text-green-600"
                : "bg-red-50 text-red-600"
            }`}>
              {gatePassed ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
              Gate {gatePassed ? "PASSED" : "FAILED"}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Gate message */}
        {gateResult && (
          <div className={`px-3 py-2 rounded-md border text-xs ${
            gatePassed
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}>
            {gateResult.message}
          </div>
        )}

        {/* Diff summary */}
        {diff && (
          <div className="space-y-2">
            <h4 className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
              Change Summary
            </h4>

            <div className="grid grid-cols-2 gap-2">
              <div className="px-3 py-2 bg-bg-primary border border-border-primary rounded-md">
                <div className="text-[10px] text-text-muted uppercase mb-1">Entities</div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 text-green-600">
                    <Plus size={10} /> {diff.summary.added_entities}
                  </span>
                  <span className="flex items-center gap-1 text-red-600">
                    <Minus size={10} /> {diff.summary.removed_entities}
                  </span>
                  <span className="flex items-center gap-1 text-amber-600">
                    <RefreshCw size={10} /> {diff.summary.changed_entities}
                  </span>
                </div>
              </div>

              <div className="px-3 py-2 bg-bg-primary border border-border-primary rounded-md">
                <div className="text-[10px] text-text-muted uppercase mb-1">Relationships</div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 text-green-600">
                    <Plus size={10} /> {diff.summary.added_relationships}
                  </span>
                  <span className="flex items-center gap-1 text-red-600">
                    <Minus size={10} /> {diff.summary.removed_relationships}
                  </span>
                </div>
              </div>
            </div>

            {/* Breaking changes */}
            {diff.summary.breaking_change_count > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] text-status-error uppercase tracking-wider font-semibold flex items-center gap-1">
                  <Shield size={10} />
                  Breaking Changes ({diff.summary.breaking_change_count})
                </h4>
                {(diff.breaking_changes || []).map((change, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md"
                  >
                    <AlertCircle size={12} className="text-red-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-red-700">{change}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Changed entities detail */}
            {diff.changed_entities && diff.changed_entities.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                  Changed Entities
                </h4>
                {diff.changed_entities.map((entity) => (
                  <div
                    key={entity.entity}
                    className="px-3 py-2 bg-bg-primary border border-border-primary rounded-md"
                  >
                    <div className="text-xs font-medium text-text-primary mb-1">{entity.entity}</div>
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      {entity.added_fields?.length > 0 && (
                        <span className="text-green-600">
                          +fields: {entity.added_fields.join(", ")}
                        </span>
                      )}
                      {entity.removed_fields?.length > 0 && (
                        <span className="text-red-600">
                          -fields: {entity.removed_fields.join(", ")}
                        </span>
                      )}
                      {entity.type_changes?.length > 0 && (
                        <span className="text-amber-600">
                          type changes: {entity.type_changes.map((c) => c.field).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {diff.summary.breaking_change_count === 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-md">
                <CheckCircle2 size={14} className="text-green-500" />
                <span className="text-xs text-green-700">No breaking changes detected</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
