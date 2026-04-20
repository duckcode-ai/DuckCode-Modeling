/* Export DDL dialog — streamlined.

   The previous iteration bundled dialect selector + file path + Generate
   button + output area + save-to-disk + copy into one wide surface, which
   felt noisy for what is fundamentally a "pick dialect → press Run" task.

   This version keeps the Run button as the primary action up top, hides
   the output pane until there's actually something to show, and routes
   chrome through the shared `<Modal>`. Save-to-disk stays available once
   generation succeeds. */
import React, { useState } from "react";
import {
  Download, Play, RefreshCw, AlertCircle, Copy, Check, FileCode2,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { generateForwardSql, saveFileContent } from "../../lib/api";
import Modal from "./Modal";

const DIALECTS = [
  { id: "snowflake",  label: "Snowflake" },
  { id: "databricks", label: "Databricks" },
  { id: "bigquery",   label: "BigQuery" },
  { id: "postgres",   label: "PostgreSQL" },
  { id: "duckdb",     label: "DuckDB" },
];

export default function ExportDdlDialog() {
  const { closeModal } = useUiStore();
  const { activeFile, projectPath, projectConfig } = useWorkspaceStore();
  const [dialect, setDialect] = useState(
    () => String(projectConfig?.defaultDialect || "snowflake").toLowerCase()
  );
  const [sql, setSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [copied, setCopied] = useState(false);

  const fileLabel = activeFile?.fullPath
    ? String(activeFile.fullPath).split("/").slice(-2).join("/")
    : null;
  const canRun = !!activeFile?.fullPath && !busy;

  const run = async () => {
    if (!activeFile?.fullPath) { setError("Open a .model.yaml file first."); return; }
    setBusy(true); setError(""); setSavedPath(""); setCopied(false);
    try {
      const res = await generateForwardSql(activeFile.fullPath, dialect);
      setSql(String(res?.sql || res?.output || "").trim());
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveToDisk = async () => {
    if (!sql || !activeFile?.fullPath || !projectPath) return;
    setBusy(true); setError("");
    try {
      const fileName = String(activeFile.fullPath)
        .split("/").pop()
        .replace(/\.model\.ya?ml$/i, "") || "model";
      const configured = projectConfig?.ddlDialects?.[dialect] || `ddl/${dialect}`;
      const folder = String(configured).replace(/^\/+|\/+$/g, "");
      const outPath = `${String(projectPath).replace(/\/+$/, "")}/${folder}/${fileName}.sql`;
      await saveFileContent(outPath, `${sql}\n`);
      setSavedPath(outPath);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const lineCount = sql ? sql.split("\n").length : 0;
  const hasOutput = !!sql;

  return (
    <Modal
      icon={<FileCode2 size={14} />}
      title="Export DDL"
      subtitle={fileLabel ? `Forward-engineer ${fileLabel}` : "Open a model file to generate SQL."}
      size={hasOutput ? "xl" : "md"}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal}>
            Close
          </button>
          {hasOutput && (
            <button
              type="button"
              className="panel-btn"
              onClick={saveToDisk}
              disabled={busy}
            >
              <Download size={11} />
              Save to disk
            </button>
          )}
        </>
      }
    >
      {/* Primary action row — dialect picker + Run, nothing else. */}
      <div className="dlx-export-action-row">
        <select
          className="panel-select"
          value={dialect}
          onChange={(e) => setDialect(e.target.value)}
          disabled={busy}
        >
          {DIALECTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <button
          type="button"
          className="panel-btn primary"
          onClick={run}
          disabled={!canRun}
          style={{ minWidth: 96, justifyContent: "center" }}
        >
          {busy
            ? <><RefreshCw size={12} className="animate-spin" /> Running…</>
            : <><Play size={12} /> Run</>}
        </button>
      </div>

      {error && (
        <div className="dlx-modal-alert">
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {savedPath && (
        <div className="dlx-modal-alert info">
          <Check size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Saved to <code>{savedPath}</code></span>
        </div>
      )}

      {hasOutput && (
        <div className="dlx-export-output">
          <div className="dlx-export-output-header">
            <span className="dlx-export-output-label">
              Output · <strong>{lineCount}</strong> line{lineCount === 1 ? "" : "s"} · {dialect}
            </span>
            <button
              type="button"
              className="panel-btn"
              onClick={copy}
              style={{ padding: "3px 8px" }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="dlx-export-output-pre">{sql}</pre>
        </div>
      )}

      {!hasOutput && !error && (
        <p className="dlx-modal-hint" style={{ marginTop: 0 }}>
          Pick a SQL dialect and press <strong>Run</strong> to generate forward DDL for the current model.
          Nothing is written to disk until you click <strong>Save to disk</strong>.
        </p>
      )}
    </Modal>
  );
}
