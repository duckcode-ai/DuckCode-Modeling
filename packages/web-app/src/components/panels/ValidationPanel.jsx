/* ValidationPanel — reports errors, warnings, dimensional-modeling
   nudges, and a completeness score for the active file.

   Redesigned on top of PanelFrame / PanelSection / PanelCard / StatusPill
   so it inherits the Luna theme surface language across midnight,
   obsidian, paper, and arctic. The completeness score is rendered as a
   ring-gauge (SVG) instead of a flat Tailwind-coloured bar; every issue
   row is a toned PanelCard with a left-border accent and severity icon.

   Issue categorisation logic (NUDGE_CODES / DIMENSIONAL_CODES and the
   runModelChecks integration) is preserved exactly — this rewrite is
   chrome + layout, not semantics. */
import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Gauge,
  Layers,
} from "lucide-react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import { runModelChecks } from "../../modelQuality";
import { lintDoc as lintDbtDoc } from "../../lib/dbtLint";
import { scanDangling, pruneDangling } from "../../lib/danglingScan";
import {
  PanelFrame,
  PanelSection,
  PanelCard,
  StatusPill,
  PanelEmpty,
} from "./PanelFrame";

/* ────────────────────────────────────────────────────────────────── */
/* Issue-code taxonomy (preserved from the previous implementation)   */
/* ────────────────────────────────────────────────────────────────── */
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
  "FACT_WITHOUT_DIMENSION_REFS",
  "DIM_WITHOUT_NATURAL_KEY",
  "SCD2_MISSING_SYSTEM_FIELDS",
  "FACT_TABLE_NO_METRICS",
  "DIMENSION_REF_NOT_FOUND",
]);

const DIMENSIONAL_CODES = new Set([
  "FACT_WITHOUT_DIMENSION_REFS",
  "DIM_WITHOUT_NATURAL_KEY",
  "SCD2_MISSING_SYSTEM_FIELDS",
  "FACT_TABLE_NO_METRICS",
  "DIMENSION_REF_NOT_FOUND",
]);

/* ────────────────────────────────────────────────────────────────── */
/* Semantic helpers                                                   */
/* ────────────────────────────────────────────────────────────────── */
function scoreBand(score) {
  if (score >= 80) return { tone: "success", color: "var(--cat-billing)", label: "Good" };
  if (score >= 60) return { tone: "warning", color: "var(--pk)", label: "Partial" };
  return { tone: "error", color: "#ef4444", label: "Gaps" };
}

function severityConfig(severity) {
  switch (severity) {
    case "error":
      return { tone: "error", Icon: AlertCircle, label: "Error" };
    case "warn":
      return { tone: "warning", Icon: AlertTriangle, label: "Warning" };
    case "info":
    default:
      return { tone: "info", Icon: Info, label: "Info" };
  }
}

/* ────────────────────────────────────────────────────────────────── */
/* RingGauge — SVG circular progress for the completeness score.      */
/* Stroke colour follows the score band so the gauge reads semantically
   at a glance: green ≥80, amber 60-79, red <60. The ring is theme
   aware because it uses Luna variables for the track.                */
/* ────────────────────────────────────────────────────────────────── */
function RingGauge({ value = 0, size = 72, stroke = 7 }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const band = scoreBand(pct);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border-default)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={band.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 400ms var(--ease, ease)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: band.color }}>{pct}</div>
        <div style={{ fontSize: 9, color: "var(--text-tertiary)", marginTop: 2, letterSpacing: "0.05em" }}>
          {band.label.toUpperCase()}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* EntityCompletenessRow — one row per entity in the completeness list */
/* ────────────────────────────────────────────────────────────────── */
function EntityCompletenessRow({ entity }) {
  const [open, setOpen] = useState(false);
  const band = scoreBand(entity.score);

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        background: "var(--bg-1)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          background: "transparent",
          border: "none",
          color: "var(--text-primary)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {open ? (
          <ChevronDown size={11} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
        ) : (
          <ChevronRight size={11} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
        )}
        <span
          style={{
            flex: 1,
            fontSize: 11.5,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-mono)",
          }}
          title={entity.entityName}
        >
          {entity.entityName}
        </span>
        <StatusPill tone={band.tone}>{entity.score}%</StatusPill>
      </button>

      {/* Thin progress bar always visible */}
      <div style={{ padding: "0 10px 6px" }}>
        <div
          style={{
            width: "100%",
            height: 3,
            background: "var(--border-subtle)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${entity.score}%`,
              height: "100%",
              background: band.color,
              transition: "width 300ms var(--ease, ease)",
            }}
          />
        </div>
      </div>

      {open && entity.missing.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--bg-0)",
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {entity.missing.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                fontSize: 11,
                color: "var(--text-secondary)",
              }}
            >
              <span style={{ color: "var(--pk)", flexShrink: 0, marginTop: 1 }}>↳</span>
              <span>{m}</span>
            </div>
          ))}
        </div>
      )}

      {open && entity.missing.length === 0 && (
        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--bg-0)",
            padding: "6px 10px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--cat-billing)",
          }}
        >
          <CheckCircle2 size={11} />
          All completeness checks passed
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* IssueRow — one issue rendered as a toned PanelCard                 */
/* ────────────────────────────────────────────────────────────────── */
function IssueRow({ issue }) {
  const { tone, Icon } = severityConfig(issue.severity);
  return (
    <PanelCard tone={tone} dense>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Icon
          size={14}
          style={{
            color: `var(--cat-${
              tone === "error" ? "users" : tone === "warning" ? "billing" : "product"
            })`,
            flexShrink: 0,
            marginTop: 2,
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {issue.code}
            </span>
            {issue.path && issue.path !== "/" && (
              <code
                style={{
                  fontSize: 10,
                  color: "var(--text-tertiary)",
                  background: "var(--bg-0)",
                  padding: "1px 6px",
                  borderRadius: 3,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {issue.path}
              </code>
            )}
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            {issue.message}
          </p>
        </div>
      </div>
    </PanelCard>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Main panel                                                          */
/* ────────────────────────────────────────────────────────────────── */
export default function ValidationPanel() {
  const { activeFileContent, activeFile, updateContent } = useWorkspaceStore();
  const addToast = useUiStore((s) => s.addToast);

  const currentCheck = useMemo(() => {
    if (!activeFileContent) return null;
    return runModelChecks(activeFileContent);
  }, [activeFileContent]);

  /* Phase 4.4 — scan `relationships:` for dangling endpoints (missing
     entity or column). Runs independently of runModelChecks so users
     get a single-click "Remove dangling" path without wading through
     the general warnings list. */
  const danglingFindings = useMemo(() => {
    if (!activeFileContent) return [];
    return scanDangling(activeFileContent);
  }, [activeFileContent]);

  const handleRemoveDangling = () => {
    if (!activeFileContent) return;
    const count = danglingFindings.length;
    if (count === 0) return;
    const ok = window.confirm(
      `Remove ${count} dangling relationship${count === 1 ? "" : "s"}?\n\nThis rewrites the active file's relationships: block to drop any entry whose endpoints reference a missing entity or column.`
    );
    if (!ok) return;
    const next = pruneDangling(activeFileContent);
    if (next === activeFileContent) return;
    updateContent(next);
    addToast({
      type: "success",
      message: `Removed ${count} dangling relationship${count === 1 ? "" : "s"}.`,
    });
  };

  /* dbt-specific findings — runs in parallel with `runModelChecks` rather
     than replacing it. Different rule set (dbt contract hygiene vs. DataLex
     completeness), so users benefit from both. Findings are rendered in
     their own PanelSection below so they don't confuse the existing
     severity buckets. */
  const dbtFindings = useMemo(() => {
    if (!activeFileContent) return [];
    try {
      const doc = yaml.load(activeFileContent);
      if (!doc || typeof doc !== "object") return [];
      const filePath = activeFile?.fullPath || activeFile?.name || "";
      return lintDbtDoc(doc, { filePath });
    } catch (_err) {
      // Bad YAML is already surfaced by runModelChecks as an error — don't
      // double-report here.
      return [];
    }
  }, [activeFileContent, activeFile]);

  const errors = currentCheck?.errors || [];
  const allNudges = (currentCheck?.warnings || []).filter((w) => NUDGE_CODES.has(w.code));
  const warnings = (currentCheck?.warnings || []).filter((w) => !NUDGE_CODES.has(w.code));
  const dimensionalIssues = allNudges.filter((w) => DIMENSIONAL_CODES.has(w.code));
  const gaps = allNudges.filter((w) => !DIMENSIONAL_CODES.has(w.code));
  const completeness = currentCheck?.completeness || null;

  /* Summary cluster shown in the header's `actions` slot. One status
     pill per category; zero-count categories collapse to a single
     "No errors" success pill so the header never feels empty. */
  const totalIssues =
    errors.length + warnings.length + dimensionalIssues.length + gaps.length + dbtFindings.length;
  const headerStatus = activeFileContent ? (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {errors.length > 0 ? (
        <StatusPill tone="error" icon={<AlertCircle size={10} />}>
          {errors.length} {errors.length === 1 ? "error" : "errors"}
        </StatusPill>
      ) : (
        <StatusPill tone="success" icon={<CheckCircle2 size={10} />}>
          No errors
        </StatusPill>
      )}
      {warnings.length > 0 && (
        <StatusPill tone="warning" icon={<AlertTriangle size={10} />}>
          {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
        </StatusPill>
      )}
      {dimensionalIssues.length > 0 && (
        <StatusPill tone="info" icon={<Layers size={10} />}>
          {dimensionalIssues.length} dimensional
        </StatusPill>
      )}
      {gaps.length > 0 && (
        <StatusPill tone="accent" icon={<Gauge size={10} />}>
          {gaps.length} {gaps.length === 1 ? "gap" : "gaps"}
        </StatusPill>
      )}
      {dbtFindings.length > 0 && (
        <StatusPill tone="info" icon={<Info size={10} />}>
          {dbtFindings.length} dbt
        </StatusPill>
      )}
    </div>
  ) : null;

  /* Empty state: no active file */
  if (!activeFileContent) {
    return (
      <PanelFrame icon={<CheckCircle2 size={14} />} eyebrow="Quality" title="Validation">
        <PanelEmpty
          icon={Info}
          title="No file open"
          description="Open a .dlx or dbt file in the editor to see validation results."
        />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      icon={<CheckCircle2 size={14} />}
      eyebrow="Quality"
      title="Validation"
      subtitle={totalIssues === 0 ? "All checks passed" : `${totalIssues} total findings`}
      actions={headerStatus}
    >
      {/* Dangling relationships banner (Phase 4.4) */}
      {danglingFindings.length > 0 && (
        <PanelSection
          title="Dangling relationships"
          count={danglingFindings.length}
          icon={<AlertTriangle size={11} style={{ color: "#ef4444" }} />}
          description="Relationships whose endpoints reference a missing entity or column."
          action={
            <button
              type="button"
              className="panel-btn primary"
              onClick={handleRemoveDangling}
              title="Drop every dangling relationship from this file"
            >
              Remove dangling
            </button>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {danglingFindings.map((d) => (
              <PanelCard key={`dangle-${d.index}`} tone="error" dense>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {d.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {d.from} <span style={{ opacity: 0.5 }}>→</span> {d.to}
                  </div>
                  <div style={{ fontSize: 11, color: "#ef4444" }}>{d.reason}</div>
                </div>
              </PanelCard>
            ))}
          </div>
        </PanelSection>
      )}

      {/* Completeness gauge + per-entity list */}
      {completeness && (
        <PanelSection
          title="Completeness"
          icon={<Gauge size={11} />}
          action={
            <StatusPill tone={scoreBand(completeness.modelScore).tone}>
              {completeness.fullyComplete}/{completeness.totalEntities} complete
            </StatusPill>
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
            <RingGauge value={completeness.modelScore} />
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                Model score {completeness.modelScore}%
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                {completeness.fullyComplete} of {completeness.totalEntities} entities are fully complete
                {completeness.needsAttention.length > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "#ef4444" }}>
                      {completeness.needsAttention.length} need attention
                    </span>
                  </>
                )}
                .
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {completeness.entities.map((e) => (
              <EntityCompletenessRow key={e.entityName} entity={e} />
            ))}
          </div>
        </PanelSection>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <PanelSection
          title="Errors"
          count={errors.length}
          icon={<AlertCircle size={11} style={{ color: "var(--cat-users)" }} />}
          description="Blocking issues that will fail the semantic gate."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {errors.map((iss, idx) => (
              <IssueRow key={`err-${idx}`} issue={iss} />
            ))}
          </div>
        </PanelSection>
      )}

      {/* Structural / semantic warnings (non-nudge) */}
      {warnings.length > 0 && (
        <PanelSection
          title="Warnings"
          count={warnings.length}
          icon={<AlertTriangle size={11} style={{ color: "var(--cat-billing)" }} />}
          description="Structural concerns that should be resolved before release."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {warnings.map((iss, idx) => (
              <IssueRow key={`warn-${idx}`} issue={iss} />
            ))}
          </div>
        </PanelSection>
      )}

      {/* Dimensional modeling nudges */}
      {dimensionalIssues.length > 0 && (
        <PanelSection
          title="Dimensional Modeling"
          count={dimensionalIssues.length}
          icon={<Layers size={11} style={{ color: "var(--cat-product)" }} />}
          description="Fact / dimension hygiene — surrogate keys, grain clarity, metric coverage."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {dimensionalIssues.map((iss, idx) => (
              <IssueRow key={`dim-${idx}`} issue={iss} />
            ))}
          </div>
        </PanelSection>
      )}

      {/* Gaps / completeness nudges */}
      {gaps.length > 0 && (
        <PanelSection
          title="Gaps"
          count={gaps.length}
          icon={<Gauge size={11} style={{ color: "var(--cat-system)" }} />}
          description="Recommended improvements that raise the completeness score."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {gaps.map((iss, idx) => (
              <IssueRow key={`gap-${idx}`} issue={iss} />
            ))}
          </div>
        </PanelSection>
      )}

      {/* dbt metadata findings (separate from DataLex completeness) */}
      {dbtFindings.length > 0 && (
        <PanelSection
          title="dbt Metadata"
          count={dbtFindings.length}
          icon={<Info size={11} style={{ color: "var(--cat-product)" }} />}
          description="Missing descriptions, types, and test coverage — dbt contracts will fail without these."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {dbtFindings.map((iss, idx) => (
              <IssueRow key={`dbt-${idx}`} issue={iss} />
            ))}
          </div>
        </PanelSection>
      )}

      {/* All clean */}
      {totalIssues === 0 && (
        <PanelEmpty
          icon={CheckCircle2}
          title="All checks passed"
          description="No validation issues found in the current model."
        />
      )}
    </PanelFrame>
  );
}
