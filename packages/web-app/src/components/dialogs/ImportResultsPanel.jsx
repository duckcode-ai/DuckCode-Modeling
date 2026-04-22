/* Import Results panel — renders the SyncReport from `POST /api/dbt/import`.
 *
 * The goal is to make the gaps visible in one place instead of the user
 * having to grep the produced YAML to find columns that came back with
 * `type: unknown` or relationships that didn't resolve. We walk the
 * returned tree client-side for the per-file counts since the Python
 * SyncReport only tracks per-table warehouse reachability.
 */
import React from "react";
import yaml from "js-yaml";
import { AlertTriangle, Check, Copy, Info } from "lucide-react";

// Walk the imported YAML tree and count unknown-type columns + unresolved
// relationships. Cheap — each file is <50KB and we parse at most once.
function summarizeTree(tree) {
  let unknownTypeCount = 0;
  let unresolvedRelCount = 0;
  const unknownByFile = new Map();
  const unresolvedByFile = new Map();

  for (const { path, content } of tree || []) {
    if (!content || !/\.ya?ml$/i.test(String(path || ""))) continue;
    let doc;
    try { doc = yaml.load(content); } catch (_err) { continue; }
    if (!doc || typeof doc !== "object") continue;

    const entityList = Array.isArray(doc.entities) ? doc.entities : [];
    for (const e of entityList) {
      const fields = Array.isArray(e?.fields) ? e.fields : [];
      for (const f of fields) {
        const t = String(f?.type || f?.data_type || "").toLowerCase();
        if (!t || t === "unknown") {
          unknownTypeCount += 1;
          unknownByFile.set(path, (unknownByFile.get(path) || 0) + 1);
        }
      }
    }
    // Single-model (kind: model) shape
    if (doc.kind === "model" && Array.isArray(doc.columns)) {
      for (const c of doc.columns) {
        const t = String(c?.type || c?.data_type || "").toLowerCase();
        if (!t || t === "unknown") {
          unknownTypeCount += 1;
          unknownByFile.set(path, (unknownByFile.get(path) || 0) + 1);
        }
      }
    }

    const rels = Array.isArray(doc.relationships) ? doc.relationships : [];
    for (const r of rels) {
      if (r && (r.status === "unresolved" || r.unresolved === true)) {
        unresolvedRelCount += 1;
        unresolvedByFile.set(path, (unresolvedByFile.get(path) || 0) + 1);
      }
    }
  }

  return { unknownTypeCount, unresolvedRelCount, unknownByFile, unresolvedByFile };
}

function buildReportText(report, summary) {
  const lines = [
    `DataLex — dbt import report`,
    ``,
    `Profile:   ${report?.profile_name || "—"} / ${report?.target_name || "—"} (${report?.dialect || "—"})`,
    `Tables:    ${report?.tables?.length ?? 0}`,
    `Unknown types:          ${summary.unknownTypeCount}`,
    `Unresolved relationships: ${summary.unresolvedRelCount}`,
    `Files written:          ${report?.files_written?.length ?? 0}`,
    ``,
  ];
  if (report?.warnings?.length) {
    lines.push("Warnings:");
    for (const w of report.warnings) lines.push(`  - ${w}`);
    lines.push("");
  }
  if (summary.unknownByFile.size) {
    lines.push("Files with unknown-type columns:");
    for (const [p, n] of summary.unknownByFile) lines.push(`  - ${p}: ${n}`);
  }
  return lines.join("\n");
}

export default function ImportResultsPanel({ report, tree, sourceLabel, onClose, onCopyReport }) {
  const summary = React.useMemo(() => summarizeTree(tree), [tree]);

  const warningBanner = React.useMemo(() => {
    if (!report) return null;
    const profileMissing = !report.profile_name || !report.dialect;
    const warnStr = (report.warnings || []).join(" ").toLowerCase();
    if (profileMissing || warnStr.includes("manifest-only") || warnStr.includes("profile lookup")) {
      return "Manifest-only sync — no warehouse profile was resolved, so column types come from the dbt manifest only.";
    }
    return null;
  }, [report]);

  const copyReport = () => {
    const text = buildReportText(report, summary);
    if (onCopyReport) return onCopyReport(text);
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
  };

  const stat = (label, value, tone = "default") => (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        padding: "10px 12px",
        borderRadius: 6,
        border: "1px solid var(--border-default)",
        background: "var(--bg-2)",
      }}
    >
      <div style={{ fontSize: 10, color: "var(--text-tertiary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: tone === "warn" && value > 0 ? "#f59e0b" : "var(--text-primary)",
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div className="dlx-modal-section" data-testid="import-results">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderRadius: 6,
          border: "1px solid var(--accent, #10b981)",
          background: "rgba(16,185,129,0.08)",
          marginBottom: 12,
        }}
      >
        <Check size={14} />
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          Imported {tree?.length ?? 0} file{(tree?.length ?? 0) === 1 ? "" : "s"}
          {sourceLabel ? ` from ${sourceLabel}` : ""}.
        </div>
      </div>

      {warningBanner && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid #f59e0b",
            background: "rgba(245,158,11,0.08)",
            color: "#b45309",
            marginBottom: 12,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{warningBanner}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {stat("Tables", report?.tables?.length ?? 0)}
        {stat("Unknown types", summary.unknownTypeCount, "warn")}
        {stat("Unresolved rels", summary.unresolvedRelCount, "warn")}
        {stat("Files written", report?.files_written?.length ?? tree?.length ?? 0)}
      </div>

      {(report?.warnings || []).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
            Warnings ({report.warnings.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {report.warnings.slice(0, 10).map((w, i) => (
              <li key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 3, color: "#f59e0b" }} />
                <span>{w}</span>
              </li>
            ))}
            {report.warnings.length > 10 && (
              <li style={{ color: "var(--text-tertiary)" }}>…and {report.warnings.length - 10} more.</li>
            )}
          </ul>
        </div>
      )}

      {summary.unknownByFile.size > 0 && (
        <details style={{ marginBottom: 12 }}>
          <summary style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer" }}>
            Files with unknown-type columns ({summary.unknownByFile.size})
          </summary>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
            {[...summary.unknownByFile.entries()].slice(0, 20).map(([p, n]) => (
              <li key={p}>
                <code style={{ fontSize: 11 }}>{p}</code>
                <span style={{ color: "var(--text-tertiary)" }}> — {n} column{n === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="panel-btn" onClick={copyReport} title="Copy the report to the clipboard">
          <Copy size={12} /> Copy report
        </button>
        <button type="button" className="panel-btn primary" onClick={onClose}>
          Open project
        </button>
      </div>
    </div>
  );
}
