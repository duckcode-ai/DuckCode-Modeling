/* WarehouseTablePickerDialog — a focused picker UI for warehouse pulls.
 *
 * The flow today is "select schemas, pull everything". This dialog gives
 * users the finer-grained "pick the exact tables per schema, preview
 * what'll be imported, then commit" experience that matches SQLDBM /
 * dbt Cloud.
 *
 * Contract:
 *   <WarehouseTablePickerDialog
 *     open={bool}
 *     connector={"postgres"|"snowflake"|...}
 *     connectionParams={formValues + auth}   // passed to /api/connectors/tables
 *     schemas={[{name, table_count}]}        // already fetched by the outer flow
 *     initialSelections={{[schemaName]: Set<tableName>}}
 *     onCancel={() => void}
 *     onConfirm={({selections}) => void}     // selections is a plain object of arrays
 *   />
 *
 * Internals:
 *   - Left column: schema list, click to expand one at a time
 *   - Right column: table list for the expanded schema (checkbox per row)
 *   - Row-count column comes straight from the `/tables` response
 *     (`row_count` is computed server-side when the connector supports it)
 *   - Inferred PK chip comes from `primary_key: [...]` if present
 *     (sqlalchemy/Snowflake connectors populate this; for connectors that
 *     don't, we just show "—")
 *   - Jaffle-shop shortcut: when the connector is snowflake and a schema
 *     called `JAFFLE_SHOP` exists, a single button selects the canonical
 *     demo tables (customers, orders, order_items, products, etc.)
 *
 * Errors are shown inline in the right pane; confirmation is disabled
 * when the selection is empty. We do NOT perform the pull here — the
 * parent is responsible for kicking off `/pull-multi` or `/pull/stream`
 * with the chosen subset.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckSquare,
  ChevronRight,
  Database,
  Key,
  Loader2,
  Square,
  Table2,
  Sparkles,
} from "lucide-react";
import Modal from "./Modal";

const API = "http://localhost:3001";

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function formatRowCount(n) {
  if (n === null || n === undefined) return "—";
  if (typeof n !== "number" || Number.isNaN(n)) return String(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const JAFFLE_DEFAULT_TABLES = [
  "customers",
  "orders",
  "order_items",
  "products",
  "stores",
  "supplies",
  "items",
];

export default function WarehouseTablePickerDialog({
  open,
  connector,
  connectionParams = {},
  schemas = [],
  initialSelections = {},
  onCancel,
  onConfirm,
}) {
  const [expandedSchema, setExpandedSchema] = useState(null);
  const [tablesBySchema, setTablesBySchema] = useState({}); // {schema: Table[]}
  const [loadingSchema, setLoadingSchema] = useState(null);
  const [error, setError] = useState("");
  const [selections, setSelections] = useState(() => {
    // Seed from initialSelections (which arrives as Set<string>).
    const out = {};
    for (const [k, v] of Object.entries(initialSelections || {})) {
      out[k] = new Set(Array.isArray(v) ? v : [...v]);
    }
    return out;
  });

  // Reset state whenever the dialog re-opens so we never show stale data
  // from a previous connection.
  useEffect(() => {
    if (!open) return;
    setExpandedSchema(schemas[0]?.name || null);
    setTablesBySchema({});
    setLoadingSchema(null);
    setError("");
    const out = {};
    for (const [k, v] of Object.entries(initialSelections || {})) {
      out[k] = new Set(Array.isArray(v) ? v : [...v]);
    }
    setSelections(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fetch tables for the expanded schema (once).
  useEffect(() => {
    if (!open || !expandedSchema) return;
    if (tablesBySchema[expandedSchema]) return;
    let cancelled = false;
    setLoadingSchema(expandedSchema);
    setError("");
    (async () => {
      try {
        const params = { connector, ...connectionParams, db_schema: expandedSchema };
        if (connector === "bigquery") params.dataset = expandedSchema;
        const data = await apiPost("/api/connectors/tables", params);
        if (cancelled) return;
        setTablesBySchema((prev) => ({ ...prev, [expandedSchema]: Array.isArray(data) ? data : [] }));
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load tables");
          setTablesBySchema((prev) => ({ ...prev, [expandedSchema]: [] }));
        }
      } finally {
        if (!cancelled) setLoadingSchema(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, expandedSchema, connector, connectionParams, tablesBySchema]);

  const tablesForActive = tablesBySchema[expandedSchema] || [];
  const activeSelection = selections[expandedSchema] || new Set();

  const toggleTable = useCallback((tableName) => {
    setSelections((prev) => {
      const next = { ...prev };
      const set = new Set(next[expandedSchema] || []);
      if (set.has(tableName)) set.delete(tableName);
      else set.add(tableName);
      next[expandedSchema] = set;
      return next;
    });
  }, [expandedSchema]);

  const toggleAllTables = useCallback(() => {
    setSelections((prev) => {
      const next = { ...prev };
      const all = tablesForActive.map((t) => t.name);
      const current = new Set(next[expandedSchema] || []);
      next[expandedSchema] = current.size === all.length ? new Set() : new Set(all);
      return next;
    });
  }, [expandedSchema, tablesForActive]);

  const pickJaffleDefaults = useCallback(() => {
    if (!expandedSchema) return;
    setSelections((prev) => {
      const next = { ...prev };
      const available = new Set(tablesForActive.map((t) => t.name.toLowerCase()));
      const picks = JAFFLE_DEFAULT_TABLES.filter((name) => available.has(name.toLowerCase()));
      next[expandedSchema] = new Set(
        tablesForActive
          .filter((t) => picks.includes(t.name.toLowerCase()))
          .map((t) => t.name),
      );
      return next;
    });
  }, [expandedSchema, tablesForActive]);

  const totalSelected = useMemo(
    () => Object.values(selections).reduce((sum, s) => sum + (s?.size || 0), 0),
    [selections],
  );

  const jaffleShortcutVisible = useMemo(() => {
    if (connector !== "snowflake") return false;
    return (schemas || []).some((s) => String(s.name || "").toUpperCase() === "JAFFLE_SHOP");
  }, [connector, schemas]);

  const handleConfirm = () => {
    const plain = {};
    for (const [schema, set] of Object.entries(selections)) {
      if (set && set.size > 0) plain[schema] = [...set];
    }
    if (Object.keys(plain).length === 0) {
      setError("Select at least one table before confirming.");
      return;
    }
    onConfirm?.({ selections: plain });
  };

  if (!open) return null;

  return (
    <Modal
      icon={<Database size={14} />}
      title="Pick warehouse tables"
      subtitle="Select the exact tables to import. Inferred primary keys and row counts preview here."
      size="xl"
      onClose={onCancel}
      footerStatus={`${totalSelected} table${totalSelected === 1 ? "" : "s"} selected`}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="panel-btn primary"
            onClick={handleConfirm}
            disabled={totalSelected === 0}
          >
            Confirm selection
          </button>
        </>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gap: 14,
          minHeight: 320,
        }}
      >
        {/* Schema list */}
        <div
          style={{
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            background: "var(--bg-1)",
            overflow: "hidden",
            maxHeight: 440,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              padding: "8px 10px",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              borderBottom: "1px solid var(--border-default)",
              background: "var(--bg-2)",
            }}
          >
            Schemas ({schemas.length})
          </div>
          {schemas.length === 0 && (
            <div style={{ padding: 12, fontSize: 11, color: "var(--text-muted)" }}>
              No schemas available. Connect first.
            </div>
          )}
          {schemas.map((s) => {
            const active = s.name === expandedSchema;
            const pickedCount = selections[s.name]?.size || 0;
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => setExpandedSchema(s.name)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  textAlign: "left",
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <ChevronRight
                    size={11}
                    style={{
                      transform: active ? "rotate(90deg)" : "none",
                      transition: "transform 120ms var(--ease)",
                      color: "var(--text-tertiary)",
                    }}
                  />
                  {s.name}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
                  {pickedCount > 0 ? (
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>{pickedCount}</span>
                  ) : (
                    s.table_count ?? ""
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table pane */}
        <div
          style={{
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            background: "var(--bg-1)",
            maxHeight: 440,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 10px",
              fontSize: 11,
              borderBottom: "1px solid var(--border-default)",
              background: "var(--bg-2)",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Table2 size={12} style={{ color: "var(--text-tertiary)" }} />
              <strong style={{ color: "var(--text-primary)" }}>{expandedSchema || "—"}</strong>
              {loadingSchema === expandedSchema && (
                <Loader2 size={11} className="animate-spin" style={{ color: "var(--text-tertiary)" }} />
              )}
              <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
                {tablesForActive.length} tables
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {jaffleShortcutVisible && String(expandedSchema || "").toUpperCase() === "JAFFLE_SHOP" && (
                <button
                  type="button"
                  className="panel-btn"
                  onClick={pickJaffleDefaults}
                  title="Select the canonical jaffle-shop demo tables"
                  style={{ fontSize: 10 }}
                >
                  <Sparkles size={10} style={{ marginRight: 4 }} />
                  Pick demo tables
                </button>
              )}
              <button
                type="button"
                className="panel-btn"
                onClick={toggleAllTables}
                disabled={tablesForActive.length === 0}
                style={{ fontSize: 10 }}
              >
                {activeSelection.size === tablesForActive.length && tablesForActive.length > 0 ? (
                  <><CheckSquare size={10} style={{ marginRight: 4 }} /> Deselect all</>
                ) : (
                  <><Square size={10} style={{ marginRight: 4 }} /> Select all</>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="dlx-modal-alert" style={{ margin: 10 }}>
              <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {loadingSchema === expandedSchema && tablesForActive.length === 0 && (
            <div style={{ padding: 16, fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
              <Loader2 size={11} className="animate-spin" />
              Loading tables…
            </div>
          )}

          {loadingSchema !== expandedSchema && tablesForActive.length === 0 && !error && (
            <div style={{ padding: 16, fontSize: 11, color: "var(--text-muted)" }}>
              No tables in this schema.
            </div>
          )}

          {tablesForActive.length > 0 && (
            <div style={{ padding: 4 }}>
              {tablesForActive.map((t) => {
                const checked = activeSelection.has(t.name);
                const inferredPks = Array.isArray(t.primary_key) ? t.primary_key : [];
                return (
                  <label
                    key={t.name}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto auto",
                      gap: 10,
                      alignItems: "center",
                      padding: "6px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background: checked ? "var(--accent-dim)" : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTable(t.name)}
                    />
                    <span style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)" }}>
                      {t.name}
                      {t.type && t.type !== "table" && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-tertiary)" }}>
                          ({t.type})
                        </span>
                      )}
                    </span>
                    <span
                      title={inferredPks.length > 0 ? `Inferred PK: ${inferredPks.join(", ")}` : "No primary key inferred"}
                      style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: inferredPks.length ? "var(--accent)" : "var(--text-tertiary)" }}
                    >
                      <Key size={10} />
                      {inferredPks.length > 0 ? inferredPks.join(",") : "—"}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", minWidth: 40, textAlign: "right" }}>
                      {formatRowCount(t.row_count)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
