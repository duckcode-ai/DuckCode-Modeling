/* ApplyDdlDialog — "Apply to warehouse" surface.
 *
 * Generates forward-engineering DDL for the active model, lets the user
 * pick one of their saved connector profiles, and then either dry-runs or
 * applies the SQL via /api/forward/apply. The server gates the endpoint
 * behind DM_ENABLE_DIRECT_APPLY — if disabled, the dialog shows the
 * GitOps copy ("generate SQL and deploy via CI/CD") instead of the Apply
 * button. */
import React, { useEffect, useMemo, useState } from "react";
import {
  UploadCloud, Play, RefreshCw, AlertCircle, Check, ShieldAlert, FileCode2,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import {
  generateForwardSql, applyForwardSql, fetchConnections,
} from "../../lib/api";
import Modal from "./Modal";

const DIALECTS = [
  { id: "snowflake",  label: "Snowflake" },
  { id: "databricks", label: "Databricks" },
  { id: "bigquery",   label: "BigQuery" },
  { id: "postgres",   label: "PostgreSQL" },
  { id: "duckdb",     label: "DuckDB" },
];

export default function ApplyDdlDialog() {
  const { closeModal, addToast } = useUiStore();
  const { activeFile, projectConfig } = useWorkspaceStore();

  const [dialect, setDialect] = useState(
    () => String(projectConfig?.defaultDialect || "snowflake").toLowerCase()
  );
  const [connections, setConnections] = useState([]);
  const [connectorName, setConnectorName] = useState("");
  const [sql, setSql] = useState("");
  const [applyResult, setApplyResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [error, setError] = useState("");
  const [applyDisabled, setApplyDisabled] = useState(false);
  const [disabledMessage, setDisabledMessage] = useState("");

  const fileLabel = activeFile?.fullPath
    ? String(activeFile.fullPath).split("/").slice(-2).join("/")
    : null;

  useEffect(() => {
    let alive = true;
    fetchConnections().then((list) => {
      if (!alive) return;
      setConnections(list || []);
      if ((list || []).length === 1) setConnectorName(list[0].connection_name || "");
    }).catch(() => { /* surfaced via per-action errors */ });
    return () => { alive = false; };
  }, []);

  const selectedConnection = useMemo(
    () => connections.find((c) => c.connection_name === connectorName) || null,
    [connections, connectorName]
  );

  const generate = async () => {
    if (!activeFile?.fullPath) { setError("Open a .model.yaml file first."); return; }
    setBusy(true); setError(""); setApplyResult(null);
    try {
      const res = await generateForwardSql(activeFile.fullPath, dialect);
      setSql(String(res?.sql || res?.output || "").trim());
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (!sql) { setError("Generate SQL before applying."); return; }
    if (!selectedConnection) { setError("Pick a connector profile first."); return; }
    setBusy(true); setError(""); setApplyResult(null);
    try {
      const result = await applyForwardSql({
        connector: selectedConnection.connector,
        dialect,
        connection_name: selectedConnection.connection_name,
        sql,
        dry_run: dryRun,
        output_json: true,
      });
      setApplyResult(result);
      addToast?.({
        type: "success",
        message: dryRun ? "Dry run succeeded." : "Applied to warehouse.",
      });
    } catch (err) {
      const msg = err?.message || String(err);
      // The server returns 403 when DM_ENABLE_DIRECT_APPLY is off — flip
      // the dialog into GitOps mode so the user sees the reason.
      if (/disabled in gitops/i.test(msg) || /direct apply is disabled/i.test(msg)) {
        setApplyDisabled(true);
        setDisabledMessage(msg);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const hasOutput = !!sql;
  const canGenerate = !!activeFile?.fullPath && !busy;
  const canApply = hasOutput && !!selectedConnection && !busy && !applyDisabled;

  return (
    <Modal
      icon={<UploadCloud size={14} />}
      title="Apply to warehouse"
      subtitle={fileLabel ? `Forward-engineer and apply ${fileLabel}` : "Open a model file to generate SQL."}
      size={hasOutput ? "xl" : "md"}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal}>Close</button>
          {hasOutput && !applyDisabled && (
            <button
              type="button"
              className="panel-btn primary"
              onClick={runApply}
              disabled={!canApply}
              style={{ minWidth: 120, justifyContent: "center" }}
            >
              {busy
                ? <><RefreshCw size={12} className="animate-spin" /> {dryRun ? "Dry-running…" : "Applying…"}</>
                : <><UploadCloud size={12} /> {dryRun ? "Dry run" : "Apply"}</>}
            </button>
          )}
        </>
      }
    >
      {/* Dialect + Generate */}
      <div className="dlx-export-action-row">
        <select
          className="panel-select"
          value={dialect}
          onChange={(e) => { setDialect(e.target.value); setSql(""); setApplyResult(null); }}
          disabled={busy}
        >
          {DIALECTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <button
          type="button"
          className="panel-btn"
          onClick={generate}
          disabled={!canGenerate}
          style={{ minWidth: 120, justifyContent: "center" }}
        >
          {busy && !hasOutput
            ? <><RefreshCw size={12} className="animate-spin" /> Generating…</>
            : <><Play size={12} /> Generate DDL</>}
        </button>
      </div>

      {/* Connector + dry-run toggle — only relevant once DDL exists. */}
      {hasOutput && (
        <div className="dlx-modal-section" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label className="dlx-modal-field-label">Connector profile</label>
          {connections.length === 0 ? (
            <div className="dlx-modal-alert">
              <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>No saved connector profiles — open the Connectors panel to add one.</span>
            </div>
          ) : (
            <select
              className="panel-select"
              value={connectorName}
              onChange={(e) => setConnectorName(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose connector…</option>
              {connections.map((c) => (
                <option key={c.connection_name} value={c.connection_name}>
                  {c.connection_name} · {c.connector}
                </option>
              ))}
            </select>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-primary)" }}>
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} disabled={busy} />
            <span>
              <strong>Dry run</strong> — compile and validate without executing. Recommended for the first pass.
            </span>
          </label>
        </div>
      )}

      {applyDisabled && (
        <div className="dlx-modal-alert" style={{ marginTop: 10 }}>
          <ShieldAlert size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Direct apply disabled in GitOps mode</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              This environment isn't configured for direct apply. Generate the SQL above,
              commit the output alongside your model change, and deploy via your CI/CD pipeline.
              {disabledMessage ? <> Server said: <code>{disabledMessage}</code></> : null}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="dlx-modal-alert" style={{ marginTop: 10 }}>
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {hasOutput && (
        <div className="dlx-export-output">
          <div className="dlx-export-output-header">
            <span className="dlx-export-output-label">
              Generated DDL · <strong>{sql.split("\n").length}</strong> lines · {dialect}
            </span>
            <FileCode2 size={12} style={{ color: "var(--text-tertiary)" }} />
          </div>
          <pre className="dlx-export-output-pre">{sql}</pre>
        </div>
      )}

      {applyResult && (
        <div className="dlx-modal-alert info" style={{ marginTop: 10 }}>
          <Check size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              {dryRun ? "Dry run succeeded" : "Applied to warehouse"}
            </div>
            <pre style={{
              margin: 0, fontSize: 11,
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-mono, Menlo, monospace)",
              color: "var(--text-secondary)",
              maxHeight: 160, overflow: "auto",
            }}>
              {JSON.stringify(applyResult, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {!hasOutput && !error && (
        <p className="dlx-modal-hint" style={{ marginTop: 0 }}>
          Generate DDL for the current model, then pick a connector profile and {" "}
          <strong>Dry run</strong> to validate against the warehouse before applying.
        </p>
      )}
    </Modal>
  );
}
