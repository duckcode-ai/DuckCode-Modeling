import React, { useEffect, useState } from "react";
import { X, Plug, RefreshCw, ArrowRight, AlertCircle } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import { fetchConnections } from "../../lib/api";
import ConnectorLogo from "../icons/ConnectorLogo";

/**
 * Central connections overview dialog. Reads the server-maintained
 * `.dm-connections.json` and shows every connection grouped by dialect. Add /
 * edit / test flows still live in the Connect activity — clicking a row jumps
 * there with the connector preselected.
 */
const DIALECT_ORDER = [
  "postgres",
  "mysql",
  "snowflake",
  "bigquery",
  "databricks",
  "sqlserver",
  "azure_sql",
  "azure_fabric",
  "redshift",
  "duckdb",
  "dbt_repo",
];

const DIALECT_LABEL = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  snowflake: "Snowflake",
  bigquery: "BigQuery",
  databricks: "Databricks",
  sqlserver: "SQL Server",
  azure_sql: "Azure SQL",
  azure_fabric: "Azure Fabric",
  redshift: "Redshift",
  duckdb: "DuckDB",
  dbt_repo: "dbt",
};

export default function ConnectionsManager() {
  const { closeModal, setActiveActivity, setPendingConnectorType, addToast } = useUiStore();
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await fetchConnections();
      setConnections(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err?.message || "Failed to load connections.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = groupByDialect(connections);

  const openInConnect = (dialect) => {
    if (dialect) setPendingConnectorType(dialect);
    setActiveActivity("connect");
    closeModal();
    addToast?.({ type: "info", message: `Opening ${DIALECT_LABEL[dialect] || dialect} in Connect view.` });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={closeModal}
    >
      <div
        className="w-[720px] max-w-[94vw] h-[540px] max-h-[90vh] rounded-xl border border-border-primary bg-bg-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 border-b border-border-primary bg-bg-secondary shrink-0">
          <div className="flex items-center gap-2">
            <Plug size={16} className="text-text-secondary" />
            <h2 className="t-subtitle text-text-primary">Connections</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              disabled={loading}
              className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={closeModal}
              className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-md border border-accent-red/30 bg-accent-red-soft text-accent-red">
              <AlertCircle size={14} />
              <span className="text-xs">{error}</span>
            </div>
          )}

          {loading && !connections.length && (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <RefreshCw size={16} className="animate-spin mr-2" />
              <span className="text-sm">Loading connections…</span>
            </div>
          )}

          {!loading && !connections.length && !error && (
            <EmptyState onOpenConnect={() => openInConnect(null)} />
          )}

          {grouped.map(({ dialect, items }) => (
            <DialectSection
              key={dialect}
              dialect={dialect}
              items={items}
              onOpen={() => openInConnect(dialect)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 h-12 border-t border-border-primary bg-bg-secondary shrink-0">
          <span className="t-caption text-text-muted">
            {connections.length} {connections.length === 1 ? "connection" : "connections"}
          </span>
          <button
            onClick={() => openInConnect(null)}
            className="dl-toolbar-btn dl-toolbar-btn--primary"
          >
            Add connection
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DialectSection({ dialect, items, onOpen }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center gap-2 px-1 py-1.5">
        <ConnectorLogo type={dialect} size={14} />
        <span className="t-label text-text-primary">{DIALECT_LABEL[dialect] || dialect}</span>
        <span className="t-caption text-text-muted">{items.length}</span>
        <button
          onClick={onOpen}
          className="ml-auto text-xs text-accent-blue hover:underline"
        >
          Manage →
        </button>
      </div>
      <div className="rounded-lg border border-border-primary overflow-hidden">
        {items.map((conn) => (
          <ConnectionRow key={conn.id || conn.fingerprint} conn={conn} />
        ))}
      </div>
    </div>
  );
}

function ConnectionRow({ conn }) {
  const name = conn.connection_name || conn.name || conn.fingerprint || "Connection";
  const updatedAt = conn.updatedAt || conn.lastConnectedAt || conn.createdAt || "";
  const host = conn.params?.host || conn.params?.account || conn.params?.warehouse || "";
  const importCount = Array.isArray(conn.imports) ? conn.imports.length : 0;
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border-primary/60 last:border-b-0 hover:bg-bg-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="t-label text-text-primary truncate">{name}</span>
          {host && <span className="t-caption text-text-muted truncate">· {host}</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {updatedAt && (
            <span className="t-caption text-text-muted">
              Updated {formatDate(updatedAt)}
            </span>
          )}
          {importCount > 0 && (
            <span className="t-caption text-text-muted">
              {importCount} {importCount === 1 ? "import" : "imports"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onOpenConnect }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10">
      <Plug size={28} className="text-text-muted mb-3" />
      <p className="t-label text-text-secondary">No connections yet</p>
      <p className="t-caption text-text-muted mt-1 max-w-[320px]">
        Connect to Postgres, Snowflake, BigQuery, Databricks, or other warehouses
        to import schemas into DataLex.
      </p>
      <button
        onClick={onOpenConnect}
        className="dl-toolbar-btn dl-toolbar-btn--primary mt-4"
      >
        Add your first connection
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

function groupByDialect(connections) {
  const buckets = new Map();
  for (const conn of connections || []) {
    const dialect = String(conn?.connector || "unknown").toLowerCase();
    if (!buckets.has(dialect)) buckets.set(dialect, []);
    buckets.get(dialect).push(conn);
  }
  const ordered = [];
  const seen = new Set();
  for (const d of DIALECT_ORDER) {
    if (buckets.has(d)) {
      ordered.push({ dialect: d, items: buckets.get(d) });
      seen.add(d);
    }
  }
  for (const [d, items] of buckets.entries()) {
    if (!seen.has(d)) ordered.push({ dialect: d, items });
  }
  return ordered;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
