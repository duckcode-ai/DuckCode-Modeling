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
  Wand2,
} from "lucide-react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import { runModelChecks } from "../../modelQuality";
import { lintDoc as lintDbtDoc, lintMeshInterfaces } from "../../lib/dbtLint";
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
  if (score >= 60) return { tone: "info", color: "var(--accent)", label: "Core Coverage" };
  return { tone: "warning", color: "var(--pk)", label: "Needs Coverage" };
}

function summarizeCoverageMissing(entity) {
  const missing = Array.isArray(entity?.missing) ? entity.missing : [];
  if (missing.length === 0) return "Fully covered";
  if (missing.length <= 2) return missing.join(" · ");
  return `${missing.slice(0, 2).join(" · ")} · +${missing.length - 2} more`;
}

function coverageStatusCopy(entity) {
  const score = Number(entity?.score || 0);
  const missingCount = Array.isArray(entity?.missing) ? entity.missing.length : 0;
  const name = String(entity?.entityName || "This entity");
  if (missingCount === 0) return `${name} is fully covered for documentation and contract quality.`;
  if (score >= 80) return `${name} is close to complete but still has ${missingCount} coverage gap${missingCount === 1 ? "" : "s"} to close.`;
  if (score >= 60) return `${name} has core metadata in place, but it still needs ${missingCount} coverage improvement${missingCount === 1 ? "" : "s"}.`;
  return `${name} is missing several metadata and contract signals, so people will have less context when using it.`;
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

const ISSUE_GUIDANCE = {
  MISSING_GRAIN: {
    why: "Grain defines the row-level meaning of the model. Without it, metrics, joins, and downstream modeling assumptions drift.",
    nextStep: "Declare the business grain on the entity using the field or fields that uniquely identify one record.",
  },
  MISSING_PRIMARY_KEY: {
    why: "Primary keys anchor uniqueness, relationship wiring, and entity identity across the model.",
    nextStep: "Mark at least one field as the primary key, or switch the entity type if the object is intentionally keyless.",
  },
  RELATIONSHIP_REF_NOT_FOUND: {
    why: "Broken relationship endpoints make joins unreliable and usually indicate a rename, deletion, or stale foreign-key reference.",
    nextStep: "Update the relationship to point to an existing entity.field pair, or remove it if the dependency no longer exists.",
  },
  INVALID_RELATIONSHIP_FROM: {
    why: "The source side of the relationship is malformed, so the model cannot reason about lineage or cardinality.",
    nextStep: "Set the relationship source to a valid Entity.field endpoint.",
  },
  INVALID_RELATIONSHIP_TO: {
    why: "The target side of the relationship is malformed, so the model cannot reason about lineage or cardinality.",
    nextStep: "Set the relationship target to a valid Entity.field endpoint.",
  },
  DIMENSION_REF_NOT_FOUND: {
    why: "A fact table references a dimension that is not present, which weakens the star schema and breaks navigation.",
    nextStep: "Point dimension_refs to an existing dimension entity or import the missing dimension into the model.",
  },
  FACT_TABLE_NO_METRICS: {
    why: "A report-layer fact without metrics usually means the semantic layer is incomplete for business consumption.",
    nextStep: "Define at least one metric on the fact table so consumers have a supported KPI entry point.",
  },
  MISSING_ENTITY_DESCRIPTION: {
    why: "Without a description, consumers do not know what this model represents or when to use it.",
    nextStep: "Add a short business-facing description that explains the entity’s purpose and scope.",
  },
  MISSING_ENTITY_OWNER: {
    why: "Ownership is needed so quality issues, access requests, and change decisions have a clear accountable team.",
    nextStep: "Assign an owner such as a team alias or responsible email.",
  },
  CONCEPTUAL_MISSING_DESCRIPTION: {
    why: "A conceptual model is meant to communicate business meaning first. Without a description, the concept is just a label.",
    nextStep: "Add a short business definition that explains what the concept represents and where it applies.",
  },
  CONCEPTUAL_MISSING_OWNER: {
    why: "Conceptual models need a steward so business questions and definition changes have a clear owner.",
    nextStep: "Assign a business owner or steward for this concept.",
  },
  CONCEPTUAL_MISSING_SUBJECT_AREA: {
    why: "Subject areas are how enterprise teams group concepts into bounded contexts.",
    nextStep: "Assign the concept to a subject area or bounded context.",
  },
  CONCEPTUAL_MISSING_GLOSSARY_LINK: {
    why: "Without glossary linkage, the conceptual model stays disconnected from the business dictionary.",
    nextStep: "Link the concept to one or more glossary terms through related_fields or concept references.",
  },
  CONCEPTUAL_ORPHAN_CONCEPT: {
    why: "Concepts with no relationships are often placeholders or disconnected ideas, which weakens the enterprise story.",
    nextStep: "Relate this concept to adjacent business concepts or remove it from the conceptual model.",
  },
  CONCEPTUAL_CROSS_DOMAIN_REL_NO_DESCRIPTION: {
    why: "Cross-domain relationships are where business boundaries blur, so they need explicit explanation.",
    nextStep: "Add a description that explains why the two bounded contexts connect and what the relationship means.",
  },
  CONCEPTUAL_WEAK_RELATIONSHIP_VERB: {
    why: "Conceptual relationships should read like business language, not just a technical edge.",
    nextStep: "Add a verb phrase such as places, owns, participates in, contains, or based in.",
  },
  LOGICAL_MISSING_CANDIDATE_KEY: {
    why: "Logical models need candidate keys so identity is clear before physical PK choices are made.",
    nextStep: "Declare candidate_keys for each logical entity, even when the physical model later uses a surrogate key.",
  },
  LOGICAL_MANY_TO_MANY_NEEDS_ASSOCIATIVE_ENTITY: {
    why: "A many-to-many relationship must be resolved before physical generation can create reliable dbt tables.",
    nextStep: "Add an associative entity or bridge entity and connect both sides through it.",
  },
  LOGICAL_UNRESOLVED_TYPE: {
    why: "Logical attributes need platform-neutral types so they can map cleanly into physical dialect types.",
    nextStep: "Set a logical type such as string, number, date, timestamp, boolean, identifier, or money.",
  },
  PHYSICAL_MISSING_DBT_SOURCE: {
    why: "Physical diagrams should be grounded in dbt model/source YAML so the canvas reflects runnable assets.",
    nextStep: "Drag dbt YAML files from Explorer onto the physical diagram.",
  },
  PHYSICAL_MISSING_SQL_OUTPUT: {
    why: "Physical release readiness needs generated or referenced SQL so the model can become runnable.",
    nextStep: "Generate or link dbt SQL under generated-sql/ or the domain's physical folder for the physical model.",
  },
  CONCEPTUAL_MISSING_DOMAIN: {
    why: "The model domain tells consumers which business area owns the conceptual view.",
    nextStep: "Set model.domain to the bounded context or enterprise domain this conceptual model covers.",
  },
  LOW_FIELD_DESCRIPTION_COVERAGE: {
    why: "Poor field coverage makes the model hard to trust and slows adoption in analytics and AI workflows.",
    nextStep: "Fill in descriptions for the highest-usage columns first, then raise the coverage across the remaining fields.",
  },
  REPORT_ENTITY_NO_METRICS: {
    why: "Report-layer models should expose business measures, not just raw shape.",
    nextStep: "Add metrics that define how the report entity should be queried and interpreted.",
  },
  GLOSSARY_NO_FIELD_REFS: {
    why: "Glossary terms without field links stay detached from the actual data model.",
    nextStep: "Connect business terms to concrete fields through related_fields so users can navigate from concept to implementation.",
  },
};

function issueGuidance(issue) {
  const direct = ISSUE_GUIDANCE[issue?.code];
  if (direct) return direct;
  if (issue?.severity === "error") {
    return {
      why: "This issue blocks the model from passing validation or semantic gate checks.",
      nextStep: "Fix the referenced field, relationship, or metadata shape so the model becomes structurally valid.",
    };
  }
  if (issue?.severity === "warn") {
    return {
      why: "This is a quality or modeling risk that can lead to weak contracts, poor discoverability, or confusing downstream usage.",
      nextStep: "Address the missing metadata or modeling mismatch before promoting the model further.",
    };
  }
  return {
    why: "This is informational guidance intended to improve model clarity and completeness.",
    nextStep: "Use it as a cleanup item to strengthen the model contract.",
  };
}

function issueTarget(issue) {
  const path = String(issue?.path || "");
  const entityMatch = path.match(/^\/entities\/([^/]+)/);
  if (entityMatch) return entityMatch[1];
  if (path.startsWith("/relationships")) return "Relationships";
  if (path.startsWith("/metrics")) return "Metrics";
  if (path.startsWith("/glossary")) return "Glossary";
  if (path.startsWith("/indexes")) return "Indexes";
  if (path.startsWith("/model")) return "Model";
  const quoted = String(issue?.message || "").match(/'([^']+)'/);
  if (quoted) return quoted[1];
  return "General";
}

function endpointEntityName(value) {
  if (typeof value === "string") return value.split(".")[0];
  return value?.entity || value?.table || "";
}

function runLayerChecks(activeFileContent, activeFile) {
  let doc;
  try { doc = yaml.load(activeFileContent); } catch (_err) { return []; }
  if (!doc || typeof doc !== "object") return [];
  const layer = String(doc.layer || doc.model?.layer || doc.model?.kind || "").toLowerCase();
  const isDiagram = String(doc.kind || "").toLowerCase() === "diagram" || /\.diagram\.ya?ml$/i.test(activeFile?.name || activeFile?.path || "");
  const entities = Array.isArray(doc.entities) ? doc.entities : [];
  const relationships = Array.isArray(doc.relationships) ? doc.relationships : [];
  const issues = [];

  if (layer === "conceptual") {
    entities.forEach((entity, index) => {
      if (entity?.file) return;
      const name = entity?.name || entity?.entity || `Concept ${index + 1}`;
      if (!entity?.description) issues.push({ severity: "warn", code: "CONCEPTUAL_MISSING_DESCRIPTION", path: `/entities/${name}`, message: `${name} needs a business definition.` });
      if (!entity?.domain && !entity?.subject_area && !doc.domain) issues.push({ severity: "warn", code: "CONCEPTUAL_MISSING_SUBJECT_AREA", path: `/entities/${name}`, message: `${name} should be assigned to a business domain.` });
    });
    relationships.forEach((rel, index) => {
      if (!rel?.verb && !rel?.label) issues.push({ severity: "warn", code: "CONCEPTUAL_WEAK_RELATIONSHIP_VERB", path: `/relationships/${index}`, message: `${rel?.name || "Relationship"} needs a business verb phrase.` });
    });
  }

  if (layer === "logical") {
    const entityNames = new Set(entities.map((entity) => String(entity?.name || entity?.entity || "").toLowerCase()).filter(Boolean));
    entities.forEach((entity, index) => {
      if (entity?.file) return;
      const name = entity?.name || entity?.entity || `Entity ${index + 1}`;
      const fields = Array.isArray(entity?.fields) ? entity.fields : (Array.isArray(entity?.columns) ? entity.columns : []);
      if (!Array.isArray(entity?.candidate_keys) || entity.candidate_keys.length === 0) {
        issues.push({ severity: "warn", code: "LOGICAL_MISSING_CANDIDATE_KEY", path: `/entities/${name}`, message: `${name} needs at least one candidate key.` });
      }
      fields.forEach((field) => {
        if (!field?.type) issues.push({ severity: "warn", code: "LOGICAL_UNRESOLVED_TYPE", path: `/entities/${name}/fields/${field?.name || "field"}`, message: `${name}.${field?.name || "field"} needs a logical data type.` });
      });
    });
    relationships.forEach((rel, index) => {
      const from = String(endpointEntityName(rel?.from)).toLowerCase();
      const to = String(endpointEntityName(rel?.to)).toLowerCase();
      if (String(rel?.cardinality || "").toLowerCase() === "many_to_many") {
        const hasAssociative = entities.some((entity) => {
          const type = String(entity?.type || "").toLowerCase();
          const name = String(entity?.name || "").toLowerCase();
          return type.includes("associative") || type.includes("bridge") || (from && to && name.includes(from) && name.includes(to));
        });
        if (!hasAssociative) issues.push({ severity: "warn", code: "LOGICAL_MANY_TO_MANY_NEEDS_ASSOCIATIVE_ENTITY", path: `/relationships/${index}`, message: `${rel?.name || "Many-to-many relationship"} should be resolved with an associative entity.` });
      }
      if ((from && !entityNames.has(from)) || (to && !entityNames.has(to))) {
        issues.push({ severity: "warn", code: "RELATIONSHIP_REF_NOT_FOUND", path: `/relationships/${index}`, message: `${rel?.name || "Relationship"} points at an entity that is not in this logical diagram.` });
      }
    });
  }

  if (layer === "physical" && isDiagram) {
    const dbtBacked = entities.some((entity) => entity?.file && /(^|\/)(models|sources|seeds|snapshots|analyses)\//i.test(String(entity.file)));
    if (!dbtBacked) issues.push({ severity: "warn", code: "PHYSICAL_MISSING_DBT_SOURCE", path: "/entities", message: "Physical diagram should reference dbt model/source YAML files." });
    const generated = Array.isArray(doc?.dbt?.generated_sql) ? doc.dbt.generated_sql : [];
    if (generated.length === 0) issues.push({ severity: "info", code: "PHYSICAL_MISSING_SQL_OUTPUT", path: "/dbt/generated_sql", message: "No generated SQL is linked for this physical diagram yet." });
  }
  return issues;
}

function groupIssuesByTarget(issues) {
  const groups = new Map();
  (issues || []).forEach((issue) => {
    const target = issueTarget(issue);
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target).push(issue);
  });
  return [...groups.entries()].map(([target, items]) => ({ target, items }));
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
  const entityName = String(entity?.entityName || "Unnamed entity");
  const missing = Array.isArray(entity?.missing) ? entity.missing : [];
  const missingSummary = summarizeCoverageMissing(entity);
  const missingCount = missing.length;

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
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--text-primary)",
              fontFamily: "var(--font-mono)",
            }}
            title={entityName}
          >
            {entityName}
          </span>
          <span
            style={{
              fontSize: 10.5,
              color: "var(--text-tertiary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={missingSummary}
          >
            {missingCount === 0 ? "No coverage gaps" : `${missingCount} gap${missingCount === 1 ? "" : "s"}: ${missingSummary}`}
          </span>
        </div>
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

      {open && missing.length > 0 && (
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
          <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: 4 }}>
            {coverageStatusCopy(entity)}
          </div>
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background: "var(--bg-1)",
              border: "1px solid var(--border-subtle)",
              fontSize: 11,
              color: "var(--text-secondary)",
              lineHeight: 1.45,
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 4 }}>
              What this score means
            </div>
            <div>
              Coverage tracks trust signals like ownership, grain, descriptions, tags, glossary links, and SLA. Low coverage is guidance, not a hard validation failure.
            </div>
          </div>
          <CoverageList
            title="Coverage Missing"
            items={missing}
            emptyLabel="Coverage is complete."
          />
        </div>
      )}

      {open && missing.length === 0 && (
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
function toneIconFor(tone) {
  switch (tone) {
    case "error":
      return AlertCircle;
    case "warning":
      return AlertTriangle;
    case "success":
      return CheckCircle2;
    case "info":
    case "accent":
    case "neutral":
    default:
      return Info;
  }
}

function IssueRow({ issue, toneOverride = "", onAskAi = null }) {
  const { tone: severityTone, Icon: severityIcon } = severityConfig(issue.severity);
  const tone = toneOverride || severityTone;
  const Icon = toneOverride ? toneIconFor(toneOverride) : severityIcon;
  const guidance = issueGuidance(issue);
  const target = issueTarget(issue);
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
            <StatusPill tone={tone}>{target}</StatusPill>
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
            {onAskAi && (
              <button
                type="button"
                className="panel-btn"
                style={{ padding: "2px 7px", fontSize: 10 }}
                onClick={() => onAskAi(issue)}
                title="Ask AI to explain or propose a fix for this validation issue"
              >
                <Wand2 size={10} /> Ask AI
              </button>
            )}
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            {issue.message}
          </p>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--bg-0)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 4 }}>
                Why This Matters
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                {guidance.why}
              </div>
            </div>
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--bg-0)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 4 }}>
                Next Step
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                {guidance.nextStep}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PanelCard>
  );
}

function IssueGroups({ issues, prefix, toneOverride = "", onAskAi = null }) {
  const groups = groupIssuesByTarget(issues);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.map((group, groupIdx) => (
        <div
          key={`${prefix}-${group.target}-${groupIdx}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 10,
            borderRadius: 8,
            background: "var(--bg-1)",
            border: "1px solid var(--border-default)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{group.target}</div>
            <StatusPill tone={toneOverride || "neutral"}>
              {group.items.length} {group.items.length === 1 ? "finding" : "findings"}
            </StatusPill>
          </div>
          {group.items.map((iss, idx) => (
            <IssueRow key={`${prefix}-${group.target}-${idx}`} issue={iss} toneOverride={toneOverride} onAskAi={onAskAi} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CoverageList({ title, items, emptyLabel }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
        {title}
      </div>
      {items.length > 0 ? (
        items.map((item, idx) => (
          <div
            key={`${title}-${idx}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}>•</span>
            <span>{item}</span>
          </div>
        ))
      ) : (
        <div style={{ fontSize: 11, color: "var(--cat-billing)" }}>{emptyLabel}</div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Main panel                                                          */
/* ────────────────────────────────────────────────────────────────── */
export default function ValidationPanel() {
  const { activeFileContent, activeFile, updateContent } = useWorkspaceStore();
  const addToast = useUiStore((s) => s.addToast);
  const openAiPanel = useUiStore((s) => s.openAiPanel);

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

  const handleAskAiIssue = (issue) => {
    openAiPanel({
      source: "validation",
      targetName: issue?.code || "validation issue",
      context: {
        kind: "validation_issue",
        issue,
        filePath: activeFile?.path || activeFile?.fullPath || activeFile?.name || "",
      },
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

  const interfaceFindings = useMemo(() => {
    if (!activeFileContent) return [];
    try {
      const doc = yaml.load(activeFileContent);
      if (!doc || typeof doc !== "object") return [];
      const filePath = activeFile?.fullPath || activeFile?.name || "";
      return lintMeshInterfaces(doc, { filePath });
    } catch (_err) {
      return [];
    }
  }, [activeFileContent, activeFile]);

  const layerFindings = useMemo(() => {
    if (!activeFileContent) return [];
    return runLayerChecks(activeFileContent, activeFile);
  }, [activeFileContent, activeFile]);

  const errors = currentCheck?.errors || [];
  const allNudges = (currentCheck?.warnings || []).filter((w) => NUDGE_CODES.has(w.code));
  const warnings = (currentCheck?.warnings || []).filter((w) => !NUDGE_CODES.has(w.code));
  const dimensionalIssues = allNudges.filter((w) => DIMENSIONAL_CODES.has(w.code));
  const gaps = allNudges.filter((w) => !DIMENSIONAL_CODES.has(w.code));
  const completeness = currentCheck?.completeness || null;
  const interfaceBlockers = interfaceFindings.filter((issue) => issue.severity === "error");
  const interfaceGuidance = interfaceFindings.filter((issue) => issue.severity !== "error");
  const modelQualityIssues = [...warnings, ...dimensionalIssues, ...interfaceBlockers, ...layerFindings.filter((issue) => issue.severity !== "info")];
  const coverageIssues = [...gaps, ...dbtFindings, ...interfaceGuidance, ...layerFindings.filter((issue) => issue.severity === "info")];

  /* Summary cluster shown in the header's `actions` slot. One status
     pill per category; zero-count categories collapse to a single
     "No errors" success pill so the header never feels empty. */
  const totalIssues =
    errors.length + warnings.length + dimensionalIssues.length + gaps.length + dbtFindings.length + interfaceFindings.length + layerFindings.length;
  const blockerCount = errors.length + danglingFindings.length;
  const headerStatus = activeFileContent ? (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {blockerCount > 0 ? (
        <StatusPill tone="error" icon={<AlertCircle size={10} />}>
          {blockerCount} {blockerCount === 1 ? "blocker" : "blockers"}
        </StatusPill>
      ) : (
        <StatusPill tone="success" icon={<CheckCircle2 size={10} />}>
          No blockers
        </StatusPill>
      )}
      {modelQualityIssues.length > 0 && (
        <StatusPill tone="warning" icon={<AlertTriangle size={10} />}>
          {modelQualityIssues.length} model quality
        </StatusPill>
      )}
      {coverageIssues.length > 0 && (
        <StatusPill tone="info" icon={<Info size={10} />}>
          {coverageIssues.length} coverage
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
      <PanelSection
        title="How To Read This"
        icon={<Info size={11} />}
        description="This page now separates blockers from quality guidance and documentation coverage."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}>
          <PanelCard
            dense
            tone={blockerCount > 0 ? "error" : "success"}
            title={blockerCount > 0 ? `${blockerCount} blockers to fix first` : "No blocking issues"}
            subtitle="Start here"
          >
            <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              These findings will break validation, semantic checks, or relationship integrity.
            </div>
          </PanelCard>
          <PanelCard dense tone={modelQualityIssues.length > 0 ? "warning" : "neutral"} title="Model quality issues" subtitle="Design and structure">
            <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              Warnings and dimensional issues highlight modeling choices that can confuse joins, metrics, and downstream use.
            </div>
          </PanelCard>
          <PanelCard dense tone={coverageIssues.length > 0 || completeness ? "info" : "neutral"} title="Coverage missing" subtitle="Trust and discoverability">
            <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              Coverage shows what is still missing for documentation, ownership, testing, and contract clarity. It is not the same as a hard failure.
            </div>
          </PanelCard>
        </div>
      </PanelSection>

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
              <PanelCard key={`dangle-${d.index}`} tone="error" dense title={d.name} subtitle={`${d.from} → ${d.to}`}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 11, color: "#ef4444" }}>{d.reason}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                    This relationship points to an entity or column that no longer exists, so the diagram and semantic checks cannot trust it.
                  </div>
                </div>
              </PanelCard>
            ))}
          </div>
        </PanelSection>
      )}

      {/* Completeness gauge + per-entity list */}
      {completeness && (
        <PanelSection
          title="Documentation & Contract Coverage"
          icon={<Gauge size={11} />}
          description="Coverage scores show how well each entity is documented and governed. Low scores are not blockers by themselves."
          action={
            <StatusPill tone={scoreBand(completeness.modelScore).tone}>
              {completeness.fullyComplete}/{completeness.totalEntities} fully covered
            </StatusPill>
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
            <RingGauge value={completeness.modelScore} />
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                Coverage score {completeness.modelScore}%
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                {completeness.fullyComplete} of {completeness.totalEntities} entities have full documentation and contract coverage
                {completeness.needsAttention.length > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "var(--accent)" }}>
                      {completeness.needsAttention.length} still need coverage work
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
          title="Blocking issues"
          count={errors.length}
          icon={<AlertCircle size={11} style={{ color: "var(--cat-users)" }} />}
          description="These are the findings that can fail validation or semantic gate checks. Fix these first."
        >
          <IssueGroups issues={errors} prefix="err" toneOverride="error" onAskAi={handleAskAiIssue} />
        </PanelSection>
      )}

      {/* Structural / semantic warnings and dimensional issues */}
      {modelQualityIssues.length > 0 && (
        <PanelSection
          title="Model quality issues"
          count={modelQualityIssues.length}
          icon={<Layers size={11} style={{ color: "var(--cat-billing)" }} />}
          description="These issues usually do not hard-fail immediately, but they weaken model design, semantics, and downstream usability."
        >
          <IssueGroups issues={modelQualityIssues} prefix="quality" toneOverride="warning" onAskAi={handleAskAiIssue} />
        </PanelSection>
      )}

      {/* Coverage issues */}
      {coverageIssues.length > 0 && (
        <PanelSection
          title="Coverage missing"
          count={coverageIssues.length}
          icon={<Info size={11} style={{ color: "var(--cat-product)" }} />}
          description="These findings show what is still missing in metadata, descriptions, tests, and contract coverage. They are guidance unless they also appear as blockers above."
        >
          <IssueGroups issues={coverageIssues} prefix="coverage" toneOverride="info" onAskAi={handleAskAiIssue} />
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
