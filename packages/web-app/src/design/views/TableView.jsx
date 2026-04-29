/* TableView — spreadsheet-style list of every entity in the active model.
   Swaps in for the diagram when the top-bar view switcher selects "Table".
   Row click selects the entity (populates right panel via `onSelectTable`).
   Toolbar: search, subject-area filter, density toggle. Bulk select →
   bulk-assign subject area using `bulkAssignSubjectArea` from yamlRoundTrip.

   Reuses the shared panel primitives (PanelFrame, PanelToolbar, StatusPill,
   PanelEmpty) + .panel-table/.panel-input/.panel-select/.panel-btn classes
   so it reads as one of the drawer panels, just scaled up to fill the main
   canvas cell. */
import React, { useMemo, useState } from "react";
import { Table as TableIcon, Search as SearchIcon, Layers } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import { bulkAssignSubjectArea } from "../../lib/yamlRoundTrip";
import {
  PanelFrame,
  PanelToolbar,
  PanelEmpty,
  StatusPill,
} from "../../components/panels/PanelFrame";

function formatRowCount(rc) {
  if (rc == null || rc === "") return "—";
  return String(rc);
}

export default function TableView({
  tables = [],
  relationships = [],
  activeTableId = null,
  onSelectTable,
}) {
  const { activeFileContent, updateContent, activeFile } = useWorkspaceStore();
  const addToast = useUiStore((s) => s.addToast);

  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("__all__");
  const [density, setDensity] = useState("comfortable");
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  /* Relationship count per-table (both ends) */
  const relCounts = useMemo(() => {
    const m = new Map();
    for (const r of relationships || []) {
      const f = r?.from?.table;
      const t = r?.to?.table;
      if (f) m.set(f, (m.get(f) || 0) + 1);
      if (t) m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
  }, [relationships]);

  /* Unique subject areas for filter dropdown */
  const subjectAreas = useMemo(() => {
    const s = new Set();
    for (const t of tables) if (t.subject) s.add(t.subject);
    return Array.from(s).sort();
  }, [tables]);

  /* Filtered rows */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tables.filter((t) => {
      if (subject !== "__all__" && (t.subject || "") !== subject) return false;
      if (!q) return true;
      const hay = `${t.name} ${t.schema || ""} ${t.subject || ""} ${t.kind || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tables, query, subject]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id));

  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedIds(() => {
      if (allFilteredSelected) return new Set();
      return new Set(filtered.map((t) => t.id));
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkAssign = () => {
    if (!activeFile) {
      addToast({ type: "error", message: "Open a file first." });
      return;
    }
    if (selectedIds.size === 0) return;
    const area = window.prompt(
      `Assign subject area to ${selectedIds.size} entit${selectedIds.size === 1 ? "y" : "ies"}:\n(leave blank to clear)`
    );
    if (area === null) return;
    const next = bulkAssignSubjectArea(
      activeFileContent,
      Array.from(selectedIds),
      area.trim()
    );
    if (next == null) {
      addToast({ type: "error", message: "Could not update — invalid YAML." });
      return;
    }
    updateContent(next);
    useWorkspaceStore.getState().flushAutosave?.().catch(() => {});
    addToast({
      type: "success",
      message: area.trim()
        ? `Assigned “${area.trim()}” to ${selectedIds.size} entities.`
        : `Cleared subject area on ${selectedIds.size} entities.`,
    });
    clearSelection();
  };

  const toolbar = (
    <PanelToolbar
      left={
        <>
          <div style={{ position: "relative", flex: 1, minWidth: 180, maxWidth: 320 }}>
            <SearchIcon
              size={12}
              style={{
                position: "absolute",
                left: 9,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-tertiary)",
                pointerEvents: "none",
              }}
            />
            <input
              className="panel-input"
              placeholder="Search entities, subject, schema…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 28 }}
            />
          </div>
          <select
            className="panel-select"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={{ width: 180 }}
            title="Filter by subject area"
          >
            <option value="__all__">All subject areas</option>
            {subjectAreas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </>
      }
      right={
        <div className="shell-view-density-toggle" role="tablist" aria-label="Row density">
          {["compact", "comfortable"].map((d) => (
            <button
              key={d}
              className={density === d ? "active" : ""}
              onClick={() => setDensity(d)}
              role="tab"
              aria-selected={density === d}
            >
              {d === "compact" ? "Compact" : "Comfort"}
            </button>
          ))}
        </div>
      }
    />
  );

  const rowPad = density === "compact" ? "3px 10px" : "7px 10px";

  return (
    <div className="shell-view">
      <PanelFrame
        icon={<TableIcon size={14} />}
        eyebrow="Data Model"
        title="All entities"
        subtitle={`${tables.length} entit${tables.length === 1 ? "y" : "ies"} · ${
          subjectAreas.length
        } subject area${subjectAreas.length === 1 ? "" : "s"}`}
        toolbar={toolbar}
      >
        {selectedIds.size > 0 && (
          <div className="shell-view-bulkbar">
            <Layers size={12} style={{ color: "var(--accent)" }} />
            <strong style={{ color: "var(--text-primary)" }}>{selectedIds.size}</strong>
            <span style={{ color: "var(--text-secondary)" }}>selected</span>
            <div className="spacer" />
            <button className="panel-btn primary" onClick={handleBulkAssign}>
              Assign subject area…
            </button>
            <button className="panel-btn" onClick={clearSelection}>
              Clear
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <PanelEmpty
            icon={TableIcon}
            title={tables.length === 0 ? "No entities" : "No matches"}
            description={
              tables.length === 0
                ? "This model has no entities yet. Add one from the top bar or via the Build panel."
                : "Adjust your search or subject-area filter."
            }
          />
        ) : (
          <div className="shell-view-table-wrap">
            <table className="panel-table" role="grid">
              <thead>
                <tr>
                  <th style={{ width: 32, padding: "6px 10px" }}>
                    <input
                      type="checkbox"
                      className="shell-view-checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      aria-label="Select all visible"
                    />
                  </th>
                  <th>Name</th>
                  <th style={{ width: 90 }}>Type</th>
                  <th style={{ width: 140 }}>Subject area</th>
                  <th style={{ width: 70, textAlign: "right" }}>Fields</th>
                  <th style={{ width: 80, textAlign: "right" }}>Relations</th>
                  <th style={{ width: 70 }}>Primary key</th>
                  <th style={{ width: 90, textAlign: "right" }}>Rows</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const pkCols = (t.columns || []).filter((c) => c.pk).map((c) => c.name);
                  const rels = relCounts.get(t.id) || 0;
                  const isActive = t.id === activeTableId;
                  return (
                    <tr
                      key={t.id}
                      className={isActive ? "active" : ""}
                      onClick={() => onSelectTable && onSelectTable(t.id)}
                    >
                      <td
                        style={{ padding: rowPad }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRow(t.id);
                        }}
                      >
                        <input
                          type="checkbox"
                          className="shell-view-checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleRow(t.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${t.name}`}
                        />
                      </td>
                      <td style={{ padding: rowPad }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                          {t.name}
                        </div>
                        <div
                          style={{
                            fontSize: 10.5,
                            color: "var(--text-tertiary)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {t.schema || "public"}.{t.name}
                        </div>
                      </td>
                      <td style={{ padding: rowPad }}>
                        <StatusPill tone={t.kind === "ENUM" ? "warning" : "accent"}>
                          {t.kind === "ENUM" ? "ENUM" : "BASE"}
                        </StatusPill>
                      </td>
                      <td style={{ padding: rowPad, color: "var(--text-secondary)" }}>
                        {t.subject || "—"}
                      </td>
                      <td
                        style={{
                          padding: rowPad,
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {(t.columns || []).length}
                      </td>
                      <td
                        style={{
                          padding: rowPad,
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {rels}
                      </td>
                      <td
                        style={{
                          padding: rowPad,
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          color: "var(--text-secondary)",
                        }}
                      >
                        {pkCols.length ? pkCols.join(", ") : "—"}
                      </td>
                      <td
                        style={{
                          padding: rowPad,
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        {formatRowCount(t.rowCount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PanelFrame>
    </div>
  );
}
