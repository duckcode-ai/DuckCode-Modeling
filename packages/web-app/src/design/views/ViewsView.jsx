/* ViewsView — manager surface for DB views (type: view / materialized_view).
   Lives in the main canvas cell when the top-bar view switcher selects
   "Views". Lists every view/matview in the active model as a PanelCard
   showing name · source entities · field list. Primary action creates a
   new view via `appendEntity` with a sensible template.

   The app does not currently store custom SQL bodies for views — view
   DDL is regenerated from fields at export time. So this surface focuses
   on the field contract + metadata (subject area, schema, tags, owner). */
import React, { useMemo, useState } from "react";
import { Eye, Plus, Layers, Trash2 } from "lucide-react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import { appendEntity, deleteEntity } from "../yamlPatch";
import {
  PanelFrame,
  PanelCard,
  PanelEmpty,
  PanelToolbar,
  StatusPill,
  KeyValueGrid,
} from "../../components/panels/PanelFrame";

function parseEntities(text) {
  try {
    const doc = yaml.load(text);
    if (!doc || typeof doc !== "object") return [];
    return Array.isArray(doc.entities) ? doc.entities : [];
  } catch (_e) {
    return [];
  }
}

function isViewKind(e) {
  const t = String(e?.type || "").toLowerCase();
  return t === "view" || t === "materialized_view";
}

export default function ViewsView({ onSelectTable }) {
  const { activeFileContent, updateContent, activeFile } = useWorkspaceStore();
  const addToast = useUiStore((s) => s.addToast);
  const [query, setQuery] = useState("");

  const allEntities = useMemo(() => parseEntities(activeFileContent), [activeFileContent]);
  const baseEntityNames = useMemo(
    () => new Set(allEntities.filter((e) => !isViewKind(e)).map((e) => String(e.name || "").toLowerCase())),
    [allEntities]
  );

  const views = useMemo(() => {
    const list = allEntities.filter(isViewKind);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((v) => {
      const hay = `${v.name} ${v.subject_area || ""} ${v.schema || ""} ${v.description || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allEntities, query]);

  /* For each view, infer source entities by looking at its fields' fk refs. */
  const sourceMap = useMemo(() => {
    const m = new Map();
    for (const v of views) {
      const sources = new Set();
      for (const f of v.fields || []) {
        const fkEnt = f.foreign_key?.entity;
        if (fkEnt && baseEntityNames.has(String(fkEnt).toLowerCase())) {
          sources.add(String(fkEnt));
        } else if (typeof f.fk === "string") {
          const [t] = f.fk.split(".");
          if (t && baseEntityNames.has(t.toLowerCase())) sources.add(t);
        }
      }
      m.set(v.name, Array.from(sources));
    }
    return m;
  }, [views, baseEntityNames]);

  const handleNewView = () => {
    if (!activeFile) {
      addToast({ type: "error", message: "Open a file first." });
      return;
    }
    const name = window.prompt(
      "New view name (e.g. ActiveCustomersView)",
      "NewView"
    );
    if (!name || !name.trim()) return;
    const clean = name.trim();
    const spec = {
      name: clean,
      type: "view",
      description: `${clean} — description TBD.`,
      fields: [
        { name: "id", type: "uuid", nullable: false, description: "Primary key" },
      ],
    };
    const next = appendEntity(activeFileContent, spec);
    if (next == null) {
      addToast({
        type: "error",
        message: `Could not add view — invalid YAML or duplicate name.`,
      });
      return;
    }
    updateContent(next);
    addToast({ type: "success", message: `Added view “${clean}”.` });
  };

  const handleNewMatview = () => {
    if (!activeFile) {
      addToast({ type: "error", message: "Open a file first." });
      return;
    }
    const name = window.prompt(
      "New materialized view name (e.g. DailySalesSummary)",
      "NewMatview"
    );
    if (!name || !name.trim()) return;
    const clean = name.trim();
    const spec = {
      name: clean,
      type: "materialized_view",
      description: `${clean} — materialized snapshot.`,
      fields: [
        { name: "id", type: "uuid", nullable: false, description: "Primary key" },
      ],
    };
    const next = appendEntity(activeFileContent, spec);
    if (next == null) {
      addToast({
        type: "error",
        message: `Could not add matview — invalid YAML or duplicate name.`,
      });
      return;
    }
    updateContent(next);
    addToast({ type: "success", message: `Added materialized view “${clean}”.` });
  };

  const handleDelete = (name) => {
    if (!window.confirm(`Delete view “${name}”? This cannot be undone.`)) return;
    const next = deleteEntity(activeFileContent, name);
    if (next == null) {
      addToast({ type: "error", message: "Could not delete — invalid YAML." });
      return;
    }
    updateContent(next);
    addToast({ type: "success", message: `Deleted “${name}”.` });
  };

  const matviewCount = views.filter((v) => String(v.type).toLowerCase() === "materialized_view").length;

  const toolbar = (
    <PanelToolbar
      left={
        <input
          className="panel-input"
          placeholder="Search views…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      }
      right={
        <div style={{ display: "inline-flex", gap: 6 }}>
          <button className="panel-btn" onClick={handleNewMatview} title="Create a new materialized view">
            <Layers size={12} /> New matview
          </button>
          <button className="panel-btn primary" onClick={handleNewView}>
            <Plus size={12} /> New view
          </button>
        </div>
      }
    />
  );

  return (
    <div className="shell-view">
      <PanelFrame
        icon={<Eye size={14} />}
        eyebrow="Data Model"
        title="Views & Materialized Views"
        subtitle={`${views.length} view${views.length === 1 ? "" : "s"}${
          matviewCount ? ` · ${matviewCount} materialized` : ""
        }`}
        toolbar={toolbar}
      >
        {views.length === 0 ? (
          <PanelEmpty
            icon={Eye}
            title={allEntities.filter(isViewKind).length === 0 ? "No views yet" : "No matches"}
            description={
              allEntities.filter(isViewKind).length === 0
                ? "Views are derived surfaces over your base entities. Create one to start shaping a reporting layer."
                : "Adjust your search."
            }
            action={
              allEntities.filter(isViewKind).length === 0 ? (
                <button className="panel-btn primary" onClick={handleNewView}>
                  <Plus size={12} /> New view
                </button>
              ) : null
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {views.map((v) => {
              const isMat = String(v.type).toLowerCase() === "materialized_view";
              const sources = sourceMap.get(v.name) || [];
              const fieldCount = (v.fields || []).length;
              return (
                <PanelCard
                  key={v.name}
                  icon={isMat ? <Layers size={14} /> : <Eye size={14} />}
                  tone={isMat ? "info" : "accent"}
                  title={v.name}
                  eyebrow={v.subject_area || v.schema || (isMat ? "Materialized" : "View")}
                  subtitle={v.description || undefined}
                  actions={
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <StatusPill tone={isMat ? "info" : "accent"}>
                        {isMat ? "MATVIEW" : "VIEW"}
                      </StatusPill>
                      <button
                        className="panel-btn"
                        onClick={() => onSelectTable && onSelectTable(String(v.name).toLowerCase())}
                        title="Inspect in right panel"
                      >
                        Inspect
                      </button>
                      <button
                        className="panel-btn danger"
                        onClick={() => handleDelete(v.name)}
                        title="Delete view"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  }
                >
                  <KeyValueGrid
                    items={[
                      { label: "Schema", value: v.schema || "public" },
                      { label: "Database", value: v.database || "—" },
                      { label: "Owner", value: v.owner || "—" },
                      { label: "Fields", value: fieldCount },
                      {
                        label: "Sources",
                        value:
                          sources.length === 0 ? (
                            <span style={{ color: "var(--text-tertiary)" }}>
                              none detected
                            </span>
                          ) : (
                            <div className="panel-chip-list" style={{ padding: 0 }}>
                              {sources.map((s) => (
                                <span key={s} className="panel-chip">
                                  {s}
                                </span>
                              ))}
                            </div>
                          ),
                      },
                      {
                        label: "Tags",
                        value:
                          Array.isArray(v.tags) && v.tags.length ? (
                            <div className="panel-chip-list" style={{ padding: 0 }}>
                              {v.tags.map((t) => (
                                <span key={t} className="panel-chip">
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: "var(--text-tertiary)" }}>—</span>
                          ),
                      },
                    ]}
                  />
                  {fieldCount > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "var(--text-tertiary)",
                          marginBottom: 6,
                        }}
                      >
                        Fields
                      </div>
                      <div className="panel-chip-list" style={{ padding: 0 }}>
                        {(v.fields || []).slice(0, 12).map((f) => (
                          <span
                            key={f.name}
                            className="panel-chip"
                            title={f.description || ""}
                          >
                            {f.name}
                            <span
                              style={{
                                color: "var(--text-tertiary)",
                                marginLeft: 6,
                                fontSize: 10,
                              }}
                            >
                              {f.type}
                            </span>
                          </span>
                        ))}
                        {fieldCount > 12 && (
                          <span className="panel-chip empty">+{fieldCount - 12} more</span>
                        )}
                      </div>
                    </div>
                  )}
                </PanelCard>
              );
            })}
          </div>
        )}
      </PanelFrame>
    </div>
  );
}
