import React from "react";
import ConnectorLogo from "../icons/ConnectorLogo";
import useUiStore from "../../stores/uiStore";
import {
  fetchConnections,
  fetchConnectionSchemas,
  fetchConnectionTables,
} from "../../lib/api";

const CONNECTOR_LABELS = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  snowflake: "Snowflake",
  snowflake_password: "Snowflake",
  snowflake_keypair: "Snowflake",
  bigquery: "BigQuery",
  databricks: "Databricks",
  sqlserver: "SQL Server",
  azure_sql: "Azure SQL",
  azure_fabric: "Azure Fabric",
  redshift: "Redshift",
  dbt_repo: "dbt Repo",
};

function connectionSummary(connection) {
  const details = connection?.details || {};
  return [
    details.host || details.project || details.catalog || null,
    details.database || details.dataset || details.warehouse || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function schemaCount(schema) {
  return schema?.table_count ?? schema?.count ?? schema?.tables ?? schema?.tableCount ?? null;
}

export default function DatabaseBrowserPanel({ I, onOpenConnectors, onManageConnections }) {
  const setPendingConnectorType = useUiStore((s) => s.setPendingConnectorType);
  const setPendingConnectionId = useUiStore((s) => s.setPendingConnectionId);

  const [query, setQuery] = React.useState("");
  const [connections, setConnections] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [expandedConnections, setExpandedConnections] = React.useState({});
  const [expandedSchemas, setExpandedSchemas] = React.useState({});
  const [schemasByConnection, setSchemasByConnection] = React.useState({});
  const [tablesBySchema, setTablesBySchema] = React.useState({});

  const loadConnections = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await fetchConnections();
      setConnections(Array.isArray(list) ? list : []);
    } catch (err) {
      setConnections([]);
      setError(err?.message || "Could not load saved connections.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const openPullFlow = React.useCallback((connection) => {
    if (!connection) return;
    setPendingConnectorType(connection.connector || null);
    setPendingConnectionId(connection.id || null);
    onOpenConnectors?.();
  }, [onOpenConnectors, setPendingConnectionId, setPendingConnectorType]);

  const loadSchemasForConnection = React.useCallback(async (connection, force = false) => {
    if (!connection?.id || !connection?.connector) return;
    const existing = schemasByConnection[connection.id];
    if (!force && existing?.loaded) return;
    setSchemasByConnection((state) => ({
      ...state,
      [connection.id]: { ...(state[connection.id] || {}), loading: true, error: "" },
    }));
    try {
      const items = await fetchConnectionSchemas({
        connectionId: connection.id,
        connector: connection.connector,
      });
      setSchemasByConnection((state) => ({
        ...state,
        [connection.id]: { loading: false, loaded: true, error: "", items: Array.isArray(items) ? items : [] },
      }));
    } catch (err) {
      setSchemasByConnection((state) => ({
        ...state,
        [connection.id]: {
          loading: false,
          loaded: false,
          error: err?.message || "Could not load schemas.",
          items: [],
        },
      }));
    }
  }, [schemasByConnection]);

  const loadTablesForSchema = React.useCallback(async (connection, schemaName, force = false) => {
    if (!connection?.id || !connection?.connector || !schemaName) return;
    const key = `${connection.id}::${schemaName}`;
    const existing = tablesBySchema[key];
    if (!force && existing?.loaded) return;
    setTablesBySchema((state) => ({
      ...state,
      [key]: { ...(state[key] || {}), loading: true, error: "" },
    }));
    try {
      const items = await fetchConnectionTables({
        connectionId: connection.id,
        connector: connection.connector,
        schemaName,
      });
      setTablesBySchema((state) => ({
        ...state,
        [key]: { loading: false, loaded: true, error: "", items: Array.isArray(items) ? items : [] },
      }));
    } catch (err) {
      setTablesBySchema((state) => ({
        ...state,
        [key]: {
          loading: false,
          loaded: false,
          error: err?.message || "Could not load tables.",
          items: [],
        },
      }));
    }
  }, [tablesBySchema]);

  const toggleConnection = React.useCallback(async (connection) => {
    const nextOpen = !expandedConnections[connection.id];
    setExpandedConnections((state) => ({ ...state, [connection.id]: nextOpen }));
    if (nextOpen) await loadSchemasForConnection(connection);
  }, [expandedConnections, loadSchemasForConnection]);

  const toggleSchema = React.useCallback(async (connection, schemaName) => {
    const key = `${connection.id}::${schemaName}`;
    const nextOpen = !expandedSchemas[key];
    setExpandedSchemas((state) => ({ ...state, [key]: nextOpen }));
    if (nextOpen) await loadTablesForSchema(connection, schemaName);
  }, [expandedSchemas, loadTablesForSchema]);

  const filteredConnections = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return connections;
    return connections.filter((connection) => {
      const haystack = [
        connection?.name,
        connection?.connector,
        connectionSummary(connection),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [connections, query]);

  return (
    <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Database Browser</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
            Browse warehouse objects from saved connections without leaving the canvas.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button className="icon-btn" title="Refresh connections" onClick={loadConnections}><I.Redo /></button>
          <button className="icon-btn" title="Manage connections" onClick={() => onManageConnections?.()}><I.Settings /></button>
          <button className="icon-btn" title="Add connection" onClick={() => onOpenConnectors?.()}><I.Plus /></button>
        </div>
      </div>

      <div className="left-search">
        <div className="search-field">
          <I.Search />
          <input placeholder="Filter connections or objects…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="tree" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {loading && (
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", padding: "8px 2px" }}>Loading saved connections…</div>
        )}

        {!loading && error && (
          <div style={{ fontSize: 11, color: "var(--status-danger, #dc2626)", padding: "8px 2px", lineHeight: 1.5 }}>{error}</div>
        )}

        {!loading && !error && filteredConnections.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", padding: "8px 2px", lineHeight: 1.5 }}>
            {connections.length === 0
              ? "No saved warehouse connections yet. Add one from the Connect flow."
              : "No connections or objects match this filter."}
          </div>
        )}

        {filteredConnections.map((connection) => {
          const schemaState = schemasByConnection[connection.id] || { items: [], loading: false, loaded: false, error: "" };
          const isOpen = !!expandedConnections[connection.id];
          return (
            <div key={connection.id} className={`tree-section ${isOpen ? "" : "collapsed"}`}>
              <div className="tree-section-header" onClick={() => toggleConnection(connection)} title={connectionSummary(connection) || connection.connector}>
                <svg className="tree-caret" viewBox="0 0 10 10" style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 120ms var(--ease)" }}>
                  <path d="M3 2l4 3-4 3" fill="currentColor" />
                </svg>
                <ConnectorLogo type={connection.connector} size={14} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {connection.name || CONNECTOR_LABELS[connection.connector] || connection.connector}
                </span>
                <span className="badge">{schemaState.items?.length || 0}</span>
                <button className="add" title="Open pull flow" onClick={(e) => { e.stopPropagation(); openPullFlow(connection); }}>
                  <I.Download />
                </button>
              </div>
              <div style={{ padding: "0 12px 8px 28px", fontSize: 10, color: "var(--text-tertiary)", lineHeight: 1.4 }}>
                {CONNECTOR_LABELS[connection.connector] || connection.connector}
                {connectionSummary(connection) ? ` · ${connectionSummary(connection)}` : ""}
              </div>
              {isOpen && (
                <div className="tree-items">
                  {schemaState.loading && (
                    <div className="tree-item" style={{ paddingLeft: 26, color: "var(--text-tertiary)" }}>Loading schemas…</div>
                  )}
                  {!schemaState.loading && schemaState.error && (
                    <div className="tree-item" style={{ paddingLeft: 26, color: "var(--status-danger, #dc2626)", whiteSpace: "normal", lineHeight: 1.4 }}>
                      {schemaState.error}
                    </div>
                  )}
                  {!schemaState.loading && !schemaState.error && schemaState.loaded && schemaState.items.length === 0 && (
                    <div className="tree-item" style={{ paddingLeft: 26, color: "var(--text-tertiary)" }}>No schemas found.</div>
                  )}
                  {schemaState.items.map((schema) => {
                    const name = schema?.name || schema?.schema || "schema";
                    const key = `${connection.id}::${name}`;
                    const tableState = tablesBySchema[key] || { items: [], loading: false, loaded: false, error: "" };
                    const isSchemaOpen = !!expandedSchemas[key];
                    return (
                      <div key={key}>
                        <div className="tree-item" style={{ paddingLeft: 26 }} onClick={() => toggleSchema(connection, name)}>
                          <svg className="tree-caret" viewBox="0 0 10 10" style={{ transform: isSchemaOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 120ms var(--ease)", flex: "0 0 10px" }}>
                            <path d="M3 2l4 3-4 3" fill="currentColor" />
                          </svg>
                          <I.Folder />
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                          {schemaCount(schema) != null && <span className="badge">{schemaCount(schema)}</span>}
                        </div>
                        {isSchemaOpen && (
                          <div>
                            {tableState.loading && (
                              <div className="tree-item" style={{ paddingLeft: 48, color: "var(--text-tertiary)" }}>Loading tables…</div>
                            )}
                            {!tableState.loading && tableState.error && (
                              <div className="tree-item" style={{ paddingLeft: 48, color: "var(--status-danger, #dc2626)", whiteSpace: "normal", lineHeight: 1.4 }}>
                                {tableState.error}
                              </div>
                            )}
                            {!tableState.loading && !tableState.error && tableState.loaded && tableState.items.length === 0 && (
                              <div className="tree-item" style={{ paddingLeft: 48, color: "var(--text-tertiary)" }}>No tables found.</div>
                            )}
                            {tableState.items.map((table) => (
                              <div key={`${key}::${table.name || table.table || "table"}`} className="tree-item" style={{ paddingLeft: 48 }}>
                                <I.Table />
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {table.name || table.table || "table"}
                                </span>
                                {table.columns?.length ? <span className="badge">{table.columns.length}</span> : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
