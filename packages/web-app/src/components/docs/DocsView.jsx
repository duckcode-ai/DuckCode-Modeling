/* DocsView — top-level "readable docs" view of the active YAML model.
 *
 * Mounted as the `docs` workspace view-mode (alongside Diagram, Table,
 * Views, Enums). Full-width surface, not a side-panel widget.
 *
 * Responsibilities:
 *   1. Render the active file as readable docs: header chips, model
 *      description, mermaid ER diagram, per-entity sections with field
 *      tables.
 *   2. Surface dbt readiness chips per entity — "3 missing descriptions",
 *      "missing not-null tests", etc. — sourced from /api/dbt/review.
 *   3. Inline editing — click any description to edit; saves dispatch a
 *      yamlPatch op + updateContent so the same change shows up in the
 *      Code editor and any AI agent that reads activeFileContent.
 *   4. AI assistance — every empty description gets a "Suggest with AI"
 *      button that opens the existing AI assistant with a focused
 *      prompt prefilled. Uses the same surface as Cmd+K → Ask AI; no
 *      new infra.
 *
 * No file is ever written to disk by this view. YAML stays the single
 * source of truth.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import { Sparkles, FileText, AlertTriangle, Loader2, Download } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import {
  setModelDescription,
  setEntityDescription,
  patchField,
} from "../../design/yamlPatch";
import { classifyYamlDocument, YAML_DOCUMENT_KINDS } from "../../lib/yamlDocumentKind";
import {
  fetchDbtReadinessReview,
  runDbtReadinessReview,
  suggestAiDescription,
  osiDownloadUrl,
} from "../../lib/api";
import EditableDescription from "./EditableDescription";
import MermaidERD from "./MermaidERD";
import { buildEventStormingFlow } from "../../design/views/eventStormingFlow";

/* EventStorming sticky-note palette for the docs narrative. The canvas
 * (EntityNode.jsx, Phase 4a) renders the same five types in the same
 * five colors as Tailwind utility classes; here we use plain inline
 * styles, so the hex values are copied verbatim from the Tailwind
 * palette to keep the reading experience consistent across surfaces. */
const ES_TYPE_STYLES = {
  event:     { bg: "#FED7AA", border: "#FB923C", text: "#9A3412", label: "event" },
  command:   { bg: "#BFDBFE", border: "#60A5FA", text: "#1E40AF", label: "command" },
  actor:     { bg: "#FEF08A", border: "#FACC15", text: "#854D0E", label: "actor" },
  policy:    { bg: "#FBCFE8", border: "#F472B6", text: "#9D174D", label: "policy" },
  aggregate: { bg: "#FEF3C7", border: "#FCD34D", text: "#92400E", label: "aggregate" },
};

/* AI provider gating.
 *
 * The Suggest endpoint refuses to call the LLM when no real provider is
 * configured (it 503's with code "NO_PROVIDER"). Mirror that check on
 * the client so the inline ✨ AI buttons can render disabled-with-tooltip
 * instead of clicking through to a confusing error.
 *
 * Provider config lives in localStorage (set by SettingsDialog → AI):
 *   datalex.ai.provider  ∈ { "local", "openai", "anthropic", "gemini", "ollama" }
 *   datalex.ai.apiKey    (the key, if applicable)
 *
 * "local" and unset both mean "no real LLM" — gate the button. The
 * `local` provider passes through the readiness gate's `aiConfigured`
 * check (which counts local as "configured"), but for actual one-shot
 * generation we need a real LLM.
 */
function readAiProviderForSuggest() {
  try {
    const provider = (localStorage.getItem("datalex.ai.provider") || "").trim().toLowerCase();
    if (!provider || provider === "local") return null;
    return {
      provider,
      apiKey: localStorage.getItem("datalex.ai.apiKey") || "",
      model: localStorage.getItem("datalex.ai.model") || "",
      baseUrl: localStorage.getItem("datalex.ai.baseUrl") || "",
    };
  } catch {
    return null;
  }
}

function flagsCellFor(field) {
  const flags = [];
  if (field.primary_key) flags.push("PK");
  if (field.foreign_key && field.foreign_key.entity) {
    const target = field.foreign_key.field || "?";
    flags.push(`FK→${field.foreign_key.entity}.${target}`);
  }
  if (field.unique) flags.push("unique");
  if (field.nullable === false) flags.push("not-null");
  return flags.length ? flags.join(" ") : "—";
}

/**
 * AiActionButtons — renders the inline ✨ AI controls next to a description.
 *
 *  - Empty description → single "Suggest" button (mode=suggest)
 *  - Existing description → two compact buttons: "Rewrite" + "Tighter"
 *  - All disabled (with tooltip) when no AI provider is configured
 *  - Per-button spinner when that exact (target, mode) is in flight
 *
 * Three sizes for the three call sites (model = lg, entity = md, field = sm).
 */
function AiActionButtons({
  aiEnabled,
  aiDisabledHint,
  hasDescription,
  busyKey,         // current global busy key from DocsView state
  baseKey,         // unique-per-target prefix (e.g. "model:foo.yml" or "entity:Customer")
  size = "md",     // "lg" | "md" | "sm"
  onAsk,           // (mode) => void
}) {
  const sz = size === "lg"
    ? { icon: 11, fs: 11.5, py: 4, px: 9 }
    : size === "sm"
    ? { icon: 9, fs: 10.5, py: 2, px: 6 }
    : { icon: 11, fs: 11.5, py: 4, px: 9 };

  const baseStyle = (active) => ({
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: `${sz.py}px ${sz.px}px`,
    borderRadius: size === "sm" ? 4 : 6,
    border: `1px solid ${aiEnabled ? "var(--accent, #3b82f6)" : "var(--border-default)"}`,
    background: aiEnabled
      ? (active ? "var(--accent, #3b82f6)" : "rgba(59,130,246,0.12)")
      : "var(--bg-2)",
    color: aiEnabled
      ? (active ? "#fff" : "var(--accent, #3b82f6)")
      : "var(--text-tertiary)",
    fontSize: sz.fs,
    fontWeight: 600,
    cursor: aiEnabled ? "pointer" : "not-allowed",
    whiteSpace: "nowrap",
    opacity: aiEnabled ? 1 : 0.7,
  });

  const renderBtn = (mode, label, primary = false) => {
    const busy = busyKey === `${baseKey}:${mode}`;
    return (
      <button
        key={mode}
        type="button"
        onClick={() => onAsk(mode)}
        disabled={!aiEnabled || busy}
        title={aiEnabled
          ? (busy ? "Generating…" : `${label} with AI`)
          : aiDisabledHint}
        style={{
          ...baseStyle(primary),
          cursor: aiEnabled && !busy ? "pointer" : "not-allowed",
        }}
      >
        {busy
          ? <Loader2 size={sz.icon} style={{ animation: "spin 0.9s linear infinite" }} />
          : <Sparkles size={sz.icon} />}
        {size === "sm" && busy ? "…" : label}
      </button>
    );
  };

  if (!hasDescription) {
    return renderBtn("suggest", size === "sm" ? "AI" : "Suggest with AI", true);
  }
  return (
    <>
      {renderBtn("rewrite", size === "sm" ? "AI" : "Rewrite", false)}
      {size !== "sm" && renderBtn("tighter", "Tighter", false)}
    </>
  );
}

function parseYaml(text) {
  try {
    const doc = yaml.load(text);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch {
    return null;
  }
}

function ReadinessChip({ status, count, label }) {
  const tone =
    status === "red" ? { bg: "rgba(239,68,68,0.16)", color: "#fca5a5", border: "rgba(239,68,68,0.4)" }
    : status === "yellow" ? { bg: "rgba(234,179,8,0.16)", color: "#fde68a", border: "rgba(234,179,8,0.4)" }
    : { bg: "rgba(34,197,94,0.14)", color: "#86efac", border: "rgba(34,197,94,0.35)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.color,
        border: `1px solid ${tone.border}`,
        fontSize: 11,
        fontWeight: 600,
      }}
      title={`${count} ${label} from the readiness gate`}
    >
      {count} {label}
    </span>
  );
}

/* DbtShapeSections — renders dbt-native YAML shapes that DocsView used to
 * skip past silently. A real-world dbt project file (e.g. fct_orders.yml)
 * typically contains:
 *
 *   semantic_models:  one-or-more semantic models with entities/dimensions/measures
 *   metrics:          simple/ratio/derived/cumulative metrics
 *   saved_queries:    pre-baked metric queries with group_by + exports
 *
 * Plus dbt schema.yml shapes:
 *
 *   models:    each with columns[]
 *   sources:   each with tables[] each with columns[]
 *   exposures: dashboards / downstream consumers
 *   snapshots: SCD-2 snapshot tables
 *
 * Each sub-renderer is read-only (no inline editing yet) — the goal here
 * is to close the "DocsView renders blank for dbt files" gap; editing
 * support can come later if the user asks for it.
 */
function pillStyle(extra = {}) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 8px",
    borderRadius: 999,
    background: "var(--bg-2)",
    border: "1px solid var(--border-default)",
    color: "var(--text-secondary)",
    fontSize: 11,
    fontWeight: 600,
    ...extra,
  };
}

function SubTable({ headers, rows }) {
  if (!rows.length) return null;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 8 }}>
      <thead>
        <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 11 }}>
          {headers.map((h) => (
            <th
              key={h}
              style={{
                padding: "6px 10px",
                borderBottom: "1px solid var(--border-default)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 700,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, idx) => (
          <tr key={idx} style={{ verticalAlign: "top" }}>
            {cells.map((cell, cIdx) => (
              <td
                key={cIdx}
                style={{
                  padding: "6px 10px",
                  borderBottom: "1px solid var(--border-subtle, var(--border-default))",
                  color: "var(--text-secondary)",
                }}
              >
                {cell == null || cell === "" ? <span style={{ color: "var(--text-tertiary)" }}>—</span> : cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SemanticModelCard({ sm }) {
  const name = String(sm?.name || "(unnamed semantic model)");
  const entities = Array.isArray(sm?.entities) ? sm.entities : [];
  const dimensions = Array.isArray(sm?.dimensions) ? sm.dimensions : [];
  const measures = Array.isArray(sm?.measures) ? sm.measures : [];
  const modelRef = sm?.model ? String(sm.model) : null;
  return (
    <section className="dlx-docs-card" id={`semantic-${name}`}>
      <header className="dlx-docs-card-header">
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.005em" }}>{name}</h3>
        <span className="dlx-docs-pill" style={{ background: "rgba(168,85,247,0.12)", borderColor: "rgba(168,85,247,0.3)", color: "var(--text-primary)" }}>
          semantic model
        </span>
        {modelRef && (
          <span className="dlx-docs-pill" title="dbt model this semantic layer wraps">
            <strong style={{ opacity: 0.6 }}>model</strong> <code>{modelRef}</code>
          </span>
        )}
        {entities.length > 0 && <span className="dlx-docs-pill">{entities.length} entit{entities.length === 1 ? "y" : "ies"}</span>}
        {dimensions.length > 0 && <span className="dlx-docs-pill">{dimensions.length} dimension{dimensions.length === 1 ? "" : "s"}</span>}
        {measures.length > 0 && <span className="dlx-docs-pill">{measures.length} measure{measures.length === 1 ? "" : "s"}</span>}
      </header>
      {sm?.description && (
        <p style={{ margin: "10px 0 4px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-primary)" }}>
          {String(sm.description)}
        </p>
      )}
      {entities.length > 0 && (
        <>
          <p className="dlx-docs-eyebrow" style={{ margin: "16px 0 4px" }}>Entities</p>
          <SubTable
            headers={["Name", "Type", "Expression"]}
            rows={entities.map((e) => [
              <code key="n">{String(e?.name || "")}</code>,
              <code key="t">{String(e?.type || "")}</code>,
              e?.expr ? <code key="e">{String(e.expr)}</code> : null,
            ])}
          />
        </>
      )}
      {dimensions.length > 0 && (
        <>
          <p className="dlx-docs-eyebrow" style={{ margin: "16px 0 4px" }}>Dimensions</p>
          <SubTable
            headers={["Name", "Type", "Expression / Granularity"]}
            rows={dimensions.map((d) => {
              const grain = d?.type_params?.time_granularity ? `granularity: ${d.type_params.time_granularity}` : null;
              const expr = d?.expr ? <code>{String(d.expr)}</code> : grain ? <span>{grain}</span> : null;
              return [
                <code key="n">{String(d?.name || "")}</code>,
                <code key="t">{String(d?.type || "")}</code>,
                expr,
              ];
            })}
          />
        </>
      )}
      {measures.length > 0 && (
        <>
          <p className="dlx-docs-eyebrow" style={{ margin: "16px 0 4px" }}>Measures</p>
          <SubTable
            headers={["Name", "Aggregation", "Expression"]}
            rows={measures.map((m) => [
              <code key="n">{String(m?.name || "")}</code>,
              <code key="a">{String(m?.agg || "")}</code>,
              m?.expr ? <code key="e">{String(m.expr)}</code> : null,
            ])}
          />
        </>
      )}
    </section>
  );
}

function metricSummaryCell(metric) {
  const type = String(metric?.type || "").toLowerCase();
  const tp = metric?.type_params || {};
  if (type === "simple" && tp.measure) {
    const measure = typeof tp.measure === "object" ? tp.measure?.name : tp.measure;
    return <code>measure: {String(measure)}</code>;
  }
  if (type === "ratio" && (tp.numerator || tp.denominator)) {
    const num = typeof tp.numerator === "object" ? tp.numerator?.name : tp.numerator;
    const den = typeof tp.denominator === "object" ? tp.denominator?.name : tp.denominator;
    return <code>{String(num)} / {String(den)}</code>;
  }
  if (type === "derived" && tp.expr) {
    return <code>{String(tp.expr)}</code>;
  }
  if (type === "cumulative" && tp.measure) {
    const measure = typeof tp.measure === "object" ? tp.measure?.name : tp.measure;
    const window = tp.window ? ` · window: ${tp.window}` : "";
    return <code>cumulative({String(measure)}){window}</code>;
  }
  return null;
}

function MetricsBlock({ metrics }) {
  if (!metrics.length) return null;
  const grouped = metrics.reduce((acc, m) => {
    const t = String(m?.type || "other").toLowerCase();
    (acc[t] = acc[t] || []).push(m);
    return acc;
  }, {});
  const order = ["simple", "ratio", "derived", "cumulative", "conversion"];
  const groups = [
    ...order.filter((k) => grouped[k]).map((k) => [k, grouped[k]]),
    ...Object.entries(grouped).filter(([k]) => !order.includes(k)),
  ];
  return (
    <section className="dlx-docs-card">
      <header className="dlx-docs-card-header">
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Metrics</h3>
        <span className="dlx-docs-pill" style={{ background: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.3)", color: "var(--text-primary)" }}>
          {metrics.length} total
        </span>
        {groups.map(([type, list]) => (
          <span key={type} className="dlx-docs-pill" title={`${list.length} ${type} metric${list.length === 1 ? "" : "s"}`}>
            <strong style={{ opacity: 0.6 }}>{type}</strong> <code>{list.length}</code>
          </span>
        ))}
      </header>
      {groups.map(([type, list]) => (
        <div key={type} style={{ marginTop: 12 }}>
          <p className="dlx-docs-eyebrow" style={{ margin: "8px 0 4px" }}>{type} metrics</p>
          <SubTable
            headers={["Name", "Label", "Definition", "Description"]}
            rows={list.map((m) => [
              <code key="n">{String(m?.name || "")}</code>,
              m?.label ? String(m.label) : null,
              metricSummaryCell(m),
              m?.description ? String(m.description) : null,
            ])}
          />
        </div>
      ))}
    </section>
  );
}

function SavedQueryCard({ sq }) {
  const name = String(sq?.name || "(unnamed saved query)");
  const params = sq?.query_params || {};
  const metricsList = Array.isArray(params.metrics) ? params.metrics : [];
  const groupBy = Array.isArray(params.group_by) ? params.group_by : [];
  const where = Array.isArray(params.where) ? params.where : (params.where ? [params.where] : []);
  const exports = Array.isArray(sq?.exports) ? sq.exports : [];
  return (
    <section className="dlx-docs-card" id={`saved-${name}`}>
      <header className="dlx-docs-card-header">
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{name}</h3>
        <span className="dlx-docs-pill" style={{ background: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.3)", color: "var(--text-primary)" }}>
          saved query
        </span>
        {sq?.label && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>label</strong> <code>{String(sq.label)}</code></span>}
        {exports.length > 0 && <span className="dlx-docs-pill">{exports.length} export{exports.length === 1 ? "" : "s"}</span>}
      </header>
      {sq?.description && (
        <p style={{ margin: "10px 0 4px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-primary)" }}>
          {String(sq.description)}
        </p>
      )}
      {(metricsList.length > 0 || groupBy.length > 0 || where.length > 0) && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {metricsList.length > 0 && (
            <div>
              <span style={pillStyle({ marginRight: 6 })}>metrics</span>
              {metricsList.map((m, i) => (
                <code key={i} style={{ marginRight: 6, fontSize: 12 }}>{String(m)}</code>
              ))}
            </div>
          )}
          {groupBy.length > 0 && (
            <div>
              <span style={pillStyle({ marginRight: 6 })}>group_by</span>
              {groupBy.map((g, i) => (
                <code key={i} style={{ marginRight: 6, fontSize: 12 }}>{String(g)}</code>
              ))}
            </div>
          )}
          {where.length > 0 && (
            <div>
              <span style={pillStyle({ marginRight: 6 })}>where</span>
              {where.map((w, i) => (
                <code key={i} style={{ marginRight: 6, fontSize: 12 }}>{String(w)}</code>
              ))}
            </div>
          )}
        </div>
      )}
      {exports.length > 0 && (
        <>
          <p className="dlx-docs-eyebrow" style={{ margin: "16px 0 4px" }}>Exports</p>
          <SubTable
            headers={["Name", "Type", "Schema", "Alias"]}
            rows={exports.map((e) => [
              <code key="n">{String(e?.name || "")}</code>,
              <code key="t">{String(e?.config?.export_as || "")}</code>,
              e?.config?.schema ? <code>{String(e.config.schema)}</code> : null,
              e?.config?.alias ? <code>{String(e.config.alias)}</code> : null,
            ])}
          />
        </>
      )}
    </section>
  );
}

function ColumnsTable({ columns }) {
  if (!columns?.length) return null;
  return (
    <SubTable
      headers={["Column", "Type", "Tests", "Description"]}
      rows={columns.map((c) => {
        const tests = Array.isArray(c?.tests) ? c.tests : Array.isArray(c?.data_tests) ? c.data_tests : [];
        const testNames = tests.map((t) => (typeof t === "string" ? t : Object.keys(t || {})[0] || "")).filter(Boolean);
        return [
          <code key="n">{String(c?.name || "")}</code>,
          c?.data_type ? <code>{String(c.data_type)}</code> : null,
          testNames.length ? <span style={{ fontSize: 11.5 }}>{testNames.join(", ")}</span> : null,
          c?.description ? String(c.description) : null,
        ];
      })}
    />
  );
}

function DbtModelCard({ m }) {
  const name = String(m?.name || "(unnamed model)");
  const columns = Array.isArray(m?.columns) ? m.columns : [];
  return (
    <section className="dlx-docs-card" id={`dbt-model-${name}`}>
      <header className="dlx-docs-card-header">
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{name}</h3>
        <span className="dlx-docs-pill" style={{ background: "rgba(59,130,246,0.12)", borderColor: "rgba(59,130,246,0.3)", color: "var(--text-primary)" }}>
          dbt model
        </span>
        {columns.length > 0 && <span className="dlx-docs-pill">{columns.length} column{columns.length === 1 ? "" : "s"}</span>}
      </header>
      {m?.description && (
        <p style={{ margin: "10px 0 4px", fontSize: 13.5, lineHeight: 1.6 }}>{String(m.description)}</p>
      )}
      <ColumnsTable columns={columns} />
    </section>
  );
}

function DbtSourceCard({ s }) {
  const name = String(s?.name || "(unnamed source)");
  const tables = Array.isArray(s?.tables) ? s.tables : [];
  return (
    <section className="dlx-docs-card" id={`dbt-source-${name}`}>
      <header className="dlx-docs-card-header">
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{name}</h3>
        <span className="dlx-docs-pill" style={{ background: "rgba(20,184,166,0.12)", borderColor: "rgba(20,184,166,0.3)", color: "var(--text-primary)" }}>
          source
        </span>
        {s?.database && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>db</strong> <code>{String(s.database)}</code></span>}
        {s?.schema && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>schema</strong> <code>{String(s.schema)}</code></span>}
        <span className="dlx-docs-pill">{tables.length} table{tables.length === 1 ? "" : "s"}</span>
      </header>
      {s?.description && (
        <p style={{ margin: "10px 0 8px", fontSize: 13.5, lineHeight: 1.6 }}>{String(s.description)}</p>
      )}
      {tables.map((t, i) => (
        <div key={(t?.name || i) + ""} style={{ marginTop: 12 }}>
          <p className="dlx-docs-eyebrow" style={{ margin: "8px 0 2px" }}>table · {String(t?.name || `#${i + 1}`)}</p>
          {t?.description && (
            <p style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--text-secondary)" }}>{String(t.description)}</p>
          )}
          <ColumnsTable columns={Array.isArray(t?.columns) ? t.columns : []} />
        </div>
      ))}
    </section>
  );
}

function ExposureCard({ e }) {
  const name = String(e?.name || "(unnamed exposure)");
  const dependsOn = Array.isArray(e?.depends_on) ? e.depends_on : [];
  return (
    <section className="dlx-docs-card" id={`exposure-${name}`}>
      <header className="dlx-docs-card-header">
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{name}</h3>
        <span className="dlx-docs-pill" style={{ background: "rgba(236,72,153,0.12)", borderColor: "rgba(236,72,153,0.3)", color: "var(--text-primary)" }}>
          exposure
        </span>
        {e?.type && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>type</strong> <code>{String(e.type)}</code></span>}
        {e?.maturity && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>maturity</strong> <code>{String(e.maturity)}</code></span>}
        {e?.owner?.name && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>owner</strong> <code>{String(e.owner.name)}</code></span>}
      </header>
      {e?.description && (
        <p style={{ margin: "10px 0 4px", fontSize: 13.5, lineHeight: 1.6 }}>{String(e.description)}</p>
      )}
      {e?.url && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
          <strong style={{ opacity: 0.6 }}>url</strong> <code>{String(e.url)}</code>
        </p>
      )}
      {dependsOn.length > 0 && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
          <strong style={{ opacity: 0.6 }}>depends_on</strong>{" "}
          {dependsOn.map((d, i) => <code key={i} style={{ marginRight: 6 }}>{String(d)}</code>)}
        </p>
      )}
    </section>
  );
}

function SnapshotCard({ s }) {
  const name = String(s?.name || "(unnamed snapshot)");
  const cfg = s?.config || {};
  const columns = Array.isArray(s?.columns) ? s.columns : [];
  return (
    <section className="dlx-docs-card" id={`snapshot-${name}`}>
      <header className="dlx-docs-card-header">
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{name}</h3>
        <span className="dlx-docs-pill" style={{ background: "rgba(99,102,241,0.12)", borderColor: "rgba(99,102,241,0.3)", color: "var(--text-primary)" }}>
          snapshot
        </span>
        {cfg.strategy && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>strategy</strong> <code>{String(cfg.strategy)}</code></span>}
        {cfg.unique_key && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>unique_key</strong> <code>{String(cfg.unique_key)}</code></span>}
        {cfg.updated_at && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>updated_at</strong> <code>{String(cfg.updated_at)}</code></span>}
      </header>
      {s?.description && (
        <p style={{ margin: "10px 0 4px", fontSize: 13.5, lineHeight: 1.6 }}>{String(s.description)}</p>
      )}
      <ColumnsTable columns={columns} />
    </section>
  );
}

function DbtShapeSections({
  kind,
  semanticModels,
  metrics,
  savedQueries,
  models,
  sources,
  exposures,
  snapshots,
}) {
  const kindLabel =
    kind === YAML_DOCUMENT_KINDS.DBT_SEMANTIC ? "dbt semantic layer"
    : kind === YAML_DOCUMENT_KINDS.DBT_SAVED_QUERIES ? "dbt saved queries"
    : kind === YAML_DOCUMENT_KINDS.DBT_PROPERTIES ? "dbt schema.yml"
    : "dbt yaml";
  return (
    <>
      <h2 style={{
        fontSize: 13,
        fontWeight: 700,
        margin: "8px 0 12px",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--text-tertiary)",
      }}>
        {kindLabel} · {semanticModels.length + metrics.length + savedQueries.length + models.length + sources.length + exposures.length + snapshots.length} entries
      </h2>
      {semanticModels.map((sm, i) => <SemanticModelCard key={(sm?.name || i) + ""} sm={sm} />)}
      <MetricsBlock metrics={metrics} />
      {savedQueries.map((sq, i) => <SavedQueryCard key={(sq?.name || i) + ""} sq={sq} />)}
      {models.map((m, i) => <DbtModelCard key={(m?.name || i) + ""} m={m} />)}
      {sources.map((s, i) => <DbtSourceCard key={(s?.name || i) + ""} s={s} />)}
      {exposures.map((e, i) => <ExposureCard key={(e?.name || i) + ""} e={e} />)}
      {snapshots.map((s, i) => <SnapshotCard key={(s?.name || i) + ""} s={s} />)}
    </>
  );
}

/* EventStormingFlowSection — Phase 4b. Renders any EventStorming-typed
 * entities (event/command/actor/policy/aggregate) in the active model
 * as a numbered narrative grouped by Brandolini's canonical order
 * (actors → commands → aggregates → events → policies). Pure read view:
 * the entities are still authored in YAML and shown in the per-entity
 * tables below, this just gives PMs and architects the workshop-style
 * "story" of the model.
 *
 * Renders nothing if the model has zero EventStorming entities, so the
 * section stays out of the way for plain ER models.
 */
function EventStormingFlowSection({ entities }) {
  const groups = buildEventStormingFlow(entities);
  if (groups.length === 0) return null;

  return (
    <section
      className="dlx-docs-card"
      style={{
        marginBottom: 24,
        borderColor: "color-mix(in srgb, #FB923C 40%, var(--border-default))",
      }}
    >
      <p className="dlx-docs-eyebrow">EventStorming flow</p>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
        The pieces of this domain laid out in workshop order — actors trigger commands,
        aggregates handle them, events record what happened, policies react.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {groups.map((g) => {
          const palette = ES_TYPE_STYLES[g.type];
          return (
            <div key={g.type} id={`eventstorming-${g.type}`}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: palette.bg,
                    border: `1px solid ${palette.border}`,
                  }}
                />
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                  {g.label}
                </h3>
                <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                  ({g.items.length})
                </span>
              </div>
              <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, lineHeight: 1.7 }}>
                {g.items.map((e, idx) => {
                  const name = String(e?.name || `${g.label.slice(0, -1)} ${idx + 1}`);
                  const desc = String(e?.description || "").trim();
                  return (
                    <li key={name + idx} style={{ marginBottom: 6, color: "var(--text-primary)" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "1px 7px",
                          marginRight: 8,
                          borderRadius: 4,
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          background: palette.bg,
                          border: `1px solid ${palette.border}`,
                          color: palette.text,
                        }}
                      >
                        {palette.label}
                      </span>
                      <strong>{name}</strong>
                      {desc && (
                        <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>
                          {" — "}{desc}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ConceptualNarrative — renders a `kind: diagram` / conceptual model as
 * a readable docs page rather than a fields table. Three blocks:
 *
 *   - Domain table-of-contents : counts of concepts per domain so a PM
 *     can scan the file at a glance.
 *   - Business flow            : numbered list of relationship sentences
 *     ("Customer **places** Order.", "Order **generates** Revenue.")
 *     using the verb populated by Phase 1C's conceptualizer.
 *   - Per-concept paragraphs   : title + definition (editable) + meta
 *     pills (owner, domain, terms, tags, visibility).
 *
 * Read-only-ish: definitions are inline-editable via EditableDescription,
 * but nothing else mutates here — the Build tab is the authoring surface.
 */
function endpointEntity(value) {
  if (!value) return "";
  if (typeof value === "string") return value.split(".")[0];
  return String(value.entity || value.dataset || value.name || "");
}

function humanizeVerb(verb) {
  return String(verb || "").replace(/_/g, " ").trim();
}

function ConceptualNarrative({
  entities,
  relationships,
  onEntityDescription,
  aiEnabled,
  aiDisabledHint,
  busyKey,
  askAi,
}) {
  // Group concepts by domain for the TOC.
  const byDomain = new Map();
  for (const e of entities) {
    const d = String(e?.domain || e?.subject_area || "Uncategorized").trim() || "Uncategorized";
    const list = byDomain.get(d) || [];
    list.push(e);
    byDomain.set(d, list);
  }
  const domainEntries = Array.from(byDomain.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      {domainEntries.length > 1 && (
        <section style={{ marginBottom: 24 }}>
          <h2 className="dlx-docs-eyebrow" style={{ marginBottom: 10 }}>Domains in this model</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {domainEntries.map(([d, list]) => (
              <a
                key={d}
                href={`#domain-${d.replace(/\s+/g, "_")}`}
                style={{
                  display: "block",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-1)",
                  color: "var(--text-primary)",
                  textDecoration: "none",
                  fontSize: 12.5,
                  fontWeight: 600,
                  transition: "border-color 0.15s",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700 }}>{d}</div>
                <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-tertiary)" }}>
                  {list.length} concept{list.length === 1 ? "" : "s"}
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {relationships.length > 0 && (
        <section className="dlx-docs-card" style={{ borderColor: "color-mix(in srgb, var(--accent, #3b82f6) 35%, var(--border-default))" }}>
          <p className="dlx-docs-eyebrow">Business flow</p>
          <ol style={{ margin: 0, paddingLeft: 22, fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)" }}>
            {relationships.map((r, idx) => {
              const fromName = endpointEntity(r?.from);
              const toName = endpointEntity(r?.to);
              const verb = humanizeVerb(r?.verb) || "is associated with";
              if (!fromName || !toName) return null;
              return (
                <li key={(r?.name || idx) + ""} style={{ marginBottom: 4 }}>
                  <strong>{fromName}</strong>{" "}
                  <em style={{ color: "var(--accent, #3b82f6)", fontStyle: "normal", fontWeight: 600 }}>{verb}</em>{" "}
                  <strong>{toName}</strong>.
                  {r?.description && (
                    <span style={{ color: "var(--text-tertiary)", fontWeight: 500 }}> — {r.description}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {domainEntries.map(([d, list]) => (
        <section key={d} id={`domain-${d.replace(/\s+/g, "_")}`} style={{ marginBottom: 22 }}>
          <h2 style={{
            fontSize: 16,
            fontWeight: 700,
            margin: "8px 0 12px",
            color: "var(--text-primary)",
            borderBottom: "1px solid var(--border-default)",
            paddingBottom: 6,
          }}>
            {d} · <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500 }}>{list.length} concept{list.length === 1 ? "" : "s"}</span>
          </h2>
          {list.map((ent) => {
            const entName = String(ent?.name || ent?.entity || "");
            if (!entName) return null;
            const tags = Array.isArray(ent?.tags) ? ent.tags : [];
            const terms = Array.isArray(ent?.terms) ? ent.terms : [];
            const visibility = String(ent?.visibility || "shared").toLowerCase();
            return (
              <article
                key={entName}
                id={`concept-${entName}`}
                className="dlx-docs-card"
                style={{ marginBottom: 14 }}
              >
                <header className="dlx-docs-card-header">
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.005em" }}>{entName}</h3>
                  <span className="dlx-docs-pill" style={{ background: "rgba(59,130,246,0.10)", borderColor: "rgba(59,130,246,0.30)", color: "var(--text-primary)" }}>
                    {ent?.type || "concept"}
                  </span>
                  {ent?.owner && (
                    <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>owner</strong> <code>{ent.owner}</code></span>
                  )}
                  {visibility !== "shared" && (
                    <span className="dlx-docs-pill" style={{ background: visibility === "internal" ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.12)", borderColor: visibility === "internal" ? "rgba(245,158,11,0.4)" : "rgba(34,197,94,0.4)" }}>
                      {visibility}
                    </span>
                  )}
                </header>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 10 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.65 }}>
                    <EditableDescription
                      value={ent?.description || ""}
                      placeholder={`Describe what ${entName} means in your business.`}
                      onSave={onEntityDescription(entName)}
                      ariaLabel={`${entName} definition`}
                    />
                  </div>
                  {askAi && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 4 }}>
                      <AiActionButtons
                        aiEnabled={aiEnabled}
                        aiDisabledHint={aiDisabledHint}
                        hasDescription={Boolean(ent?.description)}
                        busyKey={busyKey}
                        baseKey={`entity:${entName}`}
                        size="md"
                        onAsk={(mode) => askAi("entity", entName, mode)}
                      />
                    </div>
                  )}
                </div>
                {(terms.length > 0 || tags.length > 0) && (
                  <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {terms.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginRight: 4 }}>
                          Glossary
                        </span>
                        {terms.map((t, i) => (
                          <code
                            key={i}
                            style={{
                              fontSize: 11, padding: "1px 7px", borderRadius: 999,
                              background: "rgba(168,85,247,0.14)", border: "1px solid rgba(168,85,247,0.35)",
                              color: "var(--text-primary)", fontFamily: "var(--font-mono, inherit)",
                            }}
                          >
                            {t}
                          </code>
                        ))}
                      </div>
                    )}
                    {tags.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginRight: 4 }}>
                          Tags
                        </span>
                        {tags.map((t, i) => (
                          <code
                            key={i}
                            style={{
                              fontSize: 11, padding: "1px 7px", borderRadius: 999,
                              background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)",
                              color: "var(--text-primary)", fontFamily: "var(--font-mono, inherit)",
                            }}
                          >
                            {t}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ))}
    </>
  );
}

export default function DocsView() {
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const updateContent = useWorkspaceStore((s) => s.updateContent);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);

  // Refresh the provider snapshot whenever the file changes — covers the
  // case where the user just saved their AI key in Settings and clicks
  // back into the Docs view. This is cheap (a localStorage read).
  const [aiProvider, setAiProvider] = useState(() => readAiProviderForSuggest());
  useEffect(() => {
    setAiProvider(readAiProviderForSuggest());
  }, [activeFile?.path]);
  const aiEnabled = Boolean(aiProvider);
  const aiDisabledHint = "Add an OpenAI / Anthropic / Gemini / Ollama provider in Settings → AI to enable inline suggestions.";

  // In-flight requests, keyed by a deterministic signature so we can show
  // a per-button spinner without coupling to a global loading flag.
  const [aiBusyKey, setAiBusyKey] = useState(null);
  const [aiError, setAiError] = useState("");

  const doc = useMemo(() => parseYaml(activeFileContent || ""), [activeFileContent]);

  // -------- readiness review (per file) --------
  const [reviewByPath, setReviewByPath] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");

  // Cheap cache pull on mount + project change.
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    fetchDbtReadinessReview(activeProjectId)
      .then((res) => {
        if (cancelled) return;
        setReviewByPath(res?.byPath || {});
      })
      .catch(() => { /* cached review may not exist yet — that's fine */ });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  const runReview = async () => {
    if (!activeProjectId) return;
    setReviewing(true);
    setReviewError("");
    try {
      const res = await runDbtReadinessReview({ projectId: activeProjectId, scope: "all" });
      setReviewByPath(res?.byPath || {});
    } catch (err) {
      setReviewError(err?.message || String(err));
    } finally {
      setReviewing(false);
    }
  };

  // -------- One-shot inline AI suggestion / rewrite --------
  // useCallback MUST live above the early returns below — otherwise
  // when activeFile is null or YAML parse fails, the early return
  // skips this hook and React throws "Rendered more hooks than during
  // the previous render" on the next valid render.
  //
  // The body itself short-circuits when `activeFile` is missing.
  //
  // `mode` ∈ "suggest" | "rewrite" | "tighter":
  //   - suggest  → empty descriptions; produces a fresh one-shot
  //   - rewrite  → existing descriptions; produces a clearer replacement
  //   - tighter  → existing descriptions; compresses while keeping meaning
  const askAiToSuggest = useCallback(async (kind, target, mode = "suggest") => {
    if (!aiEnabled || !activeFile) return;
    const filePath = activeFile.path || activeFile.fullPath || activeFile.name;
    const key = (kind === "model"
      ? `model:${filePath}`
      : kind === "entity"
      ? `entity:${target}`
      : `field:${target.entity}.${target.field}`) + `:${mode}`;
    setAiBusyKey(key);
    setAiError("");
    try {
      const resp = await suggestAiDescription({
        projectId: activeProjectId,
        provider: aiProvider,
        mode,
        target: {
          kind,
          path: filePath,
          entity: kind === "entity" ? String(target) : kind === "field" ? target.entity : undefined,
          field: kind === "field" ? target.field : undefined,
        },
      });
      const text = String(resp?.description || "").trim();
      if (!text) {
        setAiError("AI returned an empty suggestion. Try again or write the description by hand.");
        return;
      }
      const yamlNow = activeFileContent || "";
      // Write back through the same patch helpers an inline edit would use.
      let next = null;
      if (kind === "model") next = setModelDescription(yamlNow, text);
      else if (kind === "entity") next = setEntityDescription(yamlNow, String(target), text);
      else next = patchField(yamlNow, target.entity, target.field, { description: text });
      if (next && next !== yamlNow) updateContent(next);
    } catch (err) {
      // The server uses a known code when no real provider is configured.
      // Refresh our local snapshot so the buttons disable themselves on
      // the next render.
      if (err?.code === "NO_PROVIDER") {
        setAiProvider(null);
        setAiError(err.message || aiDisabledHint);
      } else {
        setAiError(err?.message || "AI suggestion failed.");
      }
    } finally {
      setAiBusyKey(null);
    }
  }, [aiEnabled, activeFile, activeProjectId, aiProvider, activeFileContent, updateContent]);

  if (!activeFile) {
    return (
      <div className="shell-view" style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 14 }}>
        <FileText size={28} style={{ opacity: 0.5, marginBottom: 10 }} />
        <div style={{ fontSize: 16, marginBottom: 6, color: "var(--text-secondary)" }}>No file open</div>
        <div>Click any YAML file in the Explorer to see its readable docs view here.</div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="shell-view" style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 14 }}>
        <AlertTriangle size={22} style={{ color: "var(--warn, #f59e0b)" }} />
        <div style={{ marginTop: 10 }}>
          Could not parse <code>{activeFile.path || activeFile.name}</code> as YAML. Switch to{" "}
          <strong>Diagram</strong> or open it in the right panel's YAML tab to fix the syntax.
        </div>
      </div>
    );
  }

  // Classify the YAML so we know which shape-renderer to invoke. The
  // DataLex-native path (entities + relationships) is the rich one;
  // the dbt-native paths (semantic_models / metrics / saved_queries /
  // dbt models[] / sources[]) used to render as a blank page because
  // the renderer didn't know how to surface them.
  const yamlKind = classifyYamlDocument(doc);
  const meta = (doc.model && typeof doc.model === "object") ? doc.model : doc;
  const title = doc.title || meta.title || meta.name || activeFile.name;
  const layer = doc.layer || meta.layer || null;
  const domain = meta.domain || doc.domain || null;
  const owners = Array.isArray(meta.owners) ? meta.owners : [];
  const entities = Array.isArray(doc.entities) ? doc.entities : [];
  const relationships = Array.isArray(doc.relationships) ? doc.relationships : [];

  /* Conceptual-layer detection. When the active file is a conceptual
     diagram or model the per-entity field-tables are noise (concepts
     usually have no fields). Phase 2b's narrative renderer takes over
     instead — concept paragraphs grouped by domain, plus a "Business
     flow" section with verb-driven relationship sentences. The
     existing physical / logical / dbt renderers stay unchanged. */
  const isConceptual = (
    String(layer || "").toLowerCase() === "conceptual" ||
    String(doc.kind || "").toLowerCase() === "conceptual" ||
    String(meta.kind || "").toLowerCase() === "conceptual" ||
    entities.some((e) => String(e?.type || "").toLowerCase() === "concept")
  );

  // dbt-shape sections (rendered below the DataLex entities block).
  const dbtSemanticModels = Array.isArray(doc.semantic_models) ? doc.semantic_models : [];
  const dbtMetrics = Array.isArray(doc.metrics) ? doc.metrics : [];
  const dbtSavedQueries = Array.isArray(doc.saved_queries) ? doc.saved_queries : [];
  const dbtModels = Array.isArray(doc.models) ? doc.models : [];
  const dbtSources = Array.isArray(doc.sources) ? doc.sources : [];
  const dbtExposures = Array.isArray(doc.exposures) ? doc.exposures : [];
  const dbtSnapshots = Array.isArray(doc.snapshots) ? doc.snapshots : [];
  const hasDbtContent =
    dbtSemanticModels.length || dbtMetrics.length || dbtSavedQueries.length ||
    dbtModels.length || dbtSources.length || dbtExposures.length || dbtSnapshots.length;

  // Pull this file's readiness summary out of the cached review.
  const fileReview = (() => {
    const path = activeFile.path || activeFile.fullPath;
    if (!path || !reviewByPath) return null;
    return reviewByPath[path] || reviewByPath[path.replace(/^\/+/, "")] || null;
  })();

  // -------- patch dispatchers --------
  const writeIfChanged = (next) => {
    if (next && next !== activeFileContent) updateContent(next);
  };
  const handleModelDescription = (text) => {
    writeIfChanged(setModelDescription(activeFileContent || "", text));
  };
  const handleEntityDescription = (entityName) => (text) => {
    writeIfChanged(setEntityDescription(activeFileContent || "", entityName, text));
  };
  const handleFieldDescription = (entityName, fieldName) => (text) => {
    writeIfChanged(patchField(activeFileContent || "", entityName, fieldName, { description: text }));
  };

  const renderEntityReadiness = (entityName) => {
    if (!fileReview || !Array.isArray(fileReview.findings)) return null;
    // The readiness review's `findings` are file-scoped; filter by entity if present.
    const matched = fileReview.findings.filter((f) => {
      if (!f) return false;
      const path = String(f.path || "");
      return path.includes(entityName) || (f.entity && f.entity === entityName);
    });
    if (matched.length === 0) return null;
    const errors = matched.filter((f) => f.severity === "error" || f.severity === "high").length;
    const warnings = matched.filter((f) => f.severity === "warning" || f.severity === "medium").length;
    return (
      <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
        {errors > 0 && <ReadinessChip status="red" count={errors} label="errors" />}
        {warnings > 0 && <ReadinessChip status="yellow" count={warnings} label="warnings" />}
      </div>
    );
  };

  return (
    <div
      className="shell-view"
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "24px 32px 40px",
        fontSize: 13.5,
        lineHeight: 1.6,
        color: "var(--text-primary)",
      }}
    >
      {/* Inline `@keyframes spin` once for the AI Loader2 icons + a couple
          of utility classes so the prose surface feels like a real docs
          page, not a YAML dump. Scoped via a single <style> so we don't
          touch the global stylesheet. */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .dlx-docs-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.01em;
          background: var(--bg-2);
          border: 1px solid var(--border-default);
          color: var(--text-secondary);
        }
        .dlx-docs-pill code { font-size: 11px; color: var(--text-primary); background: transparent; padding: 0; }
        .dlx-docs-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-tertiary);
          margin: 0 0 8px;
        }
        .dlx-docs-card {
          padding: 18px 20px 20px;
          border-radius: 12px;
          border: 1px solid var(--border-default);
          background: var(--bg-1);
          margin-bottom: 18px;
          transition: border-color 0.15s;
        }
        .dlx-docs-card:hover { border-color: var(--border-strong); }
        .dlx-docs-card-header {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 6px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-subtle, var(--border-default));
        }
        .dlx-docs-fields-table tr:hover td {
          background: var(--bg-2);
        }
        .dlx-docs-fields-table td { transition: background 0.1s; }
      `}</style>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Hero header */}
        <header style={{ marginBottom: 24 }}>
          <p className="dlx-docs-eyebrow" style={{ marginBottom: 4 }}>
            {layer ? `${layer} model` : "Model"}{domain ? ` · ${domain}` : ""}
          </p>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
            <h1 style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.015em",
              lineHeight: 1.15,
              flex: 1,
              minWidth: 0,
            }}>
              {title}
            </h1>
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              {/* "Run readiness gate" — same scan that the GitHub Action
                  enforces in CI. Runs across the whole project and writes
                  the per-file score back into the Validation tab's
                  "dbt Readiness" section. Distinct from the per-file
                  Validation tab itself, which always runs locally as you
                  type. The label was previously "Run readiness check"
                  which sounded like a different *kind* of check than
                  the Validation tab; renamed for clarity. */}
              <button
                type="button"
                onClick={runReview}
                disabled={reviewing || !activeProjectId}
                title="Re-runs the dbt readiness gate (same one CI enforces). Per-file scores show in the Validation tab's 'dbt Readiness' section."
                style={{
                  padding: "7px 13px",
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-2)",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: reviewing || !activeProjectId ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {reviewing ? "Running CI gate…" : "Run CI readiness gate"}
              </button>
              {/* Export OSI bundle — Open Semantic Interchange v0.1.1 (Jan 2026
                  vendor-neutral context format). Browser hits the api-server
                  endpoint with download=1 so the response is a JSON file
                  attachment named after the project id. Honors the
                  visibility: field on entities and relationships. */}
              <a
                href={activeProjectId ? osiDownloadUrl(activeProjectId) : undefined}
                aria-disabled={!activeProjectId}
                onClick={(e) => { if (!activeProjectId) e.preventDefault(); }}
                title="Export this project as an Open Semantic Interchange (OSI) v0.1.1 bundle, ready to share with AI agents and external semantic layers."
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "7px 13px",
                  borderRadius: 8,
                  border: "1px solid color-mix(in srgb, var(--accent, #3b82f6) 60%, var(--border-default))",
                  background: activeProjectId ? "rgba(59,130,246,0.08)" : "var(--bg-2)",
                  color: activeProjectId ? "var(--accent, #3b82f6)" : "var(--text-tertiary)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: activeProjectId ? "pointer" : "not-allowed",
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                }}
              >
                <Download size={12} /> Export OSI
              </a>
            </div>
          </div>
          {/* Meta pills row */}
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {fileReview && fileReview.status && (
              <ReadinessChip
                status={fileReview.status}
                count={fileReview.score ?? 0}
                label={`/100 · ${(fileReview.counts?.total ?? 0)} findings`}
              />
            )}
            {layer && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>Layer</strong> <code>{layer}</code></span>}
            {domain && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>Domain</strong> <code>{domain}</code></span>}
            {meta.version && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>Version</strong> <code>{meta.version}</code></span>}
            {owners.length > 0 && (
              <span className="dlx-docs-pill" title={owners.join(", ")}>
                <strong style={{ opacity: 0.6 }}>Owners</strong> <code>{owners[0]}{owners.length > 1 ? ` +${owners.length - 1}` : ""}</code>
              </span>
            )}
            <span className="dlx-docs-pill" title={activeFile.path || activeFile.name}>
              <strong style={{ opacity: 0.6 }}>Source</strong> <code>{(activeFile.path || activeFile.name).split("/").slice(-2).join("/")}</code>
            </span>
          </div>
          {reviewError && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-tertiary)" }}>
              Readiness check failed: {reviewError}
            </div>
          )}
        </header>

        {/* Model description card */}
        <section className="dlx-docs-card" style={{ marginBottom: 24 }}>
          <p className="dlx-docs-eyebrow">Overview</p>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", minWidth: 0, fontSize: 14, lineHeight: 1.65 }}>
              <EditableDescription
                value={meta.description || ""}
                placeholder="Add a short summary of what this model represents."
                onSave={handleModelDescription}
                ariaLabel="model description"
              />
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 4 }}>
            <AiActionButtons
              aiEnabled={aiEnabled}
              aiDisabledHint={aiDisabledHint}
              hasDescription={Boolean(meta.description)}
              busyKey={aiBusyKey}
              baseKey={`model:${activeFile.path || activeFile.fullPath || activeFile.name}`}
              size="lg"
              onAsk={(mode) => askAiToSuggest("model", null, mode)}
            />
            </div>
          </div>
          {aiError && (
            <div style={{
              marginTop: 8,
              padding: "6px 10px",
              fontSize: 12,
              color: "var(--text-secondary)",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 6,
            }}>
              {aiError}
            </div>
          )}
        </section>

        {/* Mermaid ERD — useful for both narrative (conceptual) and
            tabular (logical/physical) renderers. */}
        {entities.length > 0 && (
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
              Entity-relationship diagram
            </h2>
            <MermaidERD entities={entities} />
          </section>
        )}

        {/* Phase 4b — EventStorming narrative. Self-hides when no
            EventStorming entities are present, so plain data models
            don't grow an empty section. */}
        <EventStormingFlowSection entities={entities} />

        {/* Phase 2b — narrative renderer for conceptual files. The
            existing field-table layout below renders only when the file
            is NOT conceptual; concepts usually have no fields, so the
            narrative + business-flow surface fits the use case better. */}
        {isConceptual && entities.length > 0 && (
          <ConceptualNarrative
            entities={entities}
            relationships={relationships}
            onEntityDescription={handleEntityDescription}
            aiEnabled={aiEnabled}
            aiDisabledHint={aiDisabledHint}
            busyKey={aiBusyKey}
            askAi={askAiToSuggest}
          />
        )}

        {/* Per-entity sections (tabular field renderer) — physical /
            logical / dbt only. Conceptual files use ConceptualNarrative
            above instead. */}
        {!isConceptual && entities.map((ent, idx) => {
          if (!ent || typeof ent !== "object") return null;
          const entName = String(ent.name || `Entity ${idx + 1}`);
          const fields = Array.isArray(ent.fields) ? ent.fields : [];
          return (
            <section
              key={entName + idx}
              className="dlx-docs-card"
              id={`entity-${entName}`}
            >
              <header className="dlx-docs-card-header">
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.005em" }}>{entName}</h3>
                <span className="dlx-docs-pill" style={{ background: "var(--bg-3, rgba(59,130,246,0.08))", borderColor: "rgba(59,130,246,0.25)", color: "var(--text-primary)" }}>
                  {ent.type || "entity"}
                </span>
                {fields.length > 0 && (
                  <span className="dlx-docs-pill" style={{ opacity: 0.8 }}>
                    {fields.length} field{fields.length === 1 ? "" : "s"}
                  </span>
                )}
                {renderEntityReadiness(entName)}
              </header>

              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <div style={{ flex: "1 1 240px", minWidth: 0, fontSize: 13.5, lineHeight: 1.6 }}>
                  <EditableDescription
                    value={ent.description || ""}
                    placeholder={`Describe the ${entName} entity.`}
                    onSave={handleEntityDescription(entName)}
                    ariaLabel={`${entName} description`}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 4 }}>
                  <AiActionButtons
                    aiEnabled={aiEnabled}
                    aiDisabledHint={aiDisabledHint}
                    hasDescription={Boolean(ent.description)}
                    busyKey={aiBusyKey}
                    baseKey={`entity:${entName}`}
                    size="md"
                    onAsk={(mode) => askAiToSuggest("entity", entName, mode)}
                  />
                </div>
              </div>

              {fields.length > 0 && (
                <>
                <p className="dlx-docs-eyebrow" style={{ margin: "16px 0 6px" }}>Fields</p>
                <table
                  className="dlx-docs-fields-table"
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12.5,
                  }}
                >
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 11 }}>
                      <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)", width: "22%", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Field</th>
                      <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)", width: "14%", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Type</th>
                      <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)", width: "20%", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Flags</th>
                      <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((fld, fIdx) => {
                      if (!fld || typeof fld !== "object") return null;
                      const fname = String(fld.name || "");
                      if (!fname) return null;
                      const isPk = !!fld.primary_key;
                      return (
                        <tr key={fname + fIdx} style={{ verticalAlign: "top" }}>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-subtle, var(--border-default))" }}>
                            <code style={{ fontWeight: isPk ? 700 : 500 }}>{fname}</code>
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-subtle, var(--border-default))", color: "var(--text-secondary)" }}>
                            <code>{String(fld.type || "string")}</code>
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-subtle, var(--border-default))", color: "var(--text-secondary)", fontSize: 11.5 }}>
                            {flagsCellFor(fld)}
                          </td>
                          <td style={{ padding: "4px 10px", borderBottom: "1px solid var(--border-subtle, var(--border-default))" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <EditableDescription
                                  value={fld.description || ""}
                                  placeholder="Add a description"
                                  onSave={handleFieldDescription(entName, fname)}
                                  multiline={false}
                                  ariaLabel={`${entName}.${fname} description`}
                                />
                              </div>
                              <AiActionButtons
                                aiEnabled={aiEnabled}
                                aiDisabledHint={aiDisabledHint}
                                hasDescription={Boolean(fld.description)}
                                busyKey={aiBusyKey}
                                baseKey={`field:${entName}.${fname}`}
                                size="sm"
                                onAsk={(mode) => askAiToSuggest("field", { entity: entName, field: fname }, mode)}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </>
              )}
            </section>
          );
        })}

        {/* dbt-native shapes — semantic_models, metrics, saved_queries,
            schema-yml models[], sources[], exposures[], snapshots[].
            Rendered when the file is dbt-shaped (yamlKind detected as
            DBT_PROPERTIES / DBT_SEMANTIC / DBT_SAVED_QUERIES) so the
            DocsView no longer renders empty for these files. */}
        {hasDbtContent && (
          <DbtShapeSections
            kind={yamlKind}
            semanticModels={dbtSemanticModels}
            metrics={dbtMetrics}
            savedQueries={dbtSavedQueries}
            models={dbtModels}
            sources={dbtSources}
            exposures={dbtExposures}
            snapshots={dbtSnapshots}
          />
        )}

        {/* Relationships table (read-only for now). Conceptual files
            already get a narrative "Business flow" inside
            ConceptualNarrative — don't duplicate the data here. */}
        {!isConceptual && relationships.length > 0 && (
          <section style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
              Relationships
            </h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-secondary)" }}>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>From</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>To</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>Cardinality</th>
                </tr>
              </thead>
              <tbody>
                {relationships.map((r, idx) => (
                  <tr key={(r?.name || idx) + ""}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}><code>{r?.from || "?"}</code></td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}><code>{r?.to || "?"}</code></td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}><code>{r?.cardinality || "?"}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
