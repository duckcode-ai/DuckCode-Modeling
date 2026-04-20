/* Left panel — Object List / Explorer / Themes. Ported from DataLex design prototype. */
import React from "react";
import Icon from "./icons";
import { THEMES } from "./notation";

export default function LeftPanel({ activeTable, onSelectTable, tables, theme, setTheme, subjectAreas = [], connectionLabel = "prod-analytics-01", connectionDsn = "postgres://…5432/subscriptions", schemas = [], onAddEntity }) {
  const I = Icon;
  const [tab, setTab] = React.useState("OBJECTS");
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState({});
  const toggle = (k) => setCollapsed((s) => ({ ...s, [k]: !s[k] }));

  const filteredTables = tables.filter((t) => !query || t.name.toLowerCase().includes(query.toLowerCase()));

  const byKind = {
    TABLES:    filteredTables.filter((t) => t.kind !== "ENUM"),
    VIEWS:     [],
    ENUMS:     filteredTables.filter((t) => t.kind === "ENUM"),
    FUNCTIONS: [],
    SEQUENCES: [],
    TRIGGERS:  [],
  };

  const section = (key, label, items, renderItem) => (
    <div key={key} className={`tree-section ${collapsed[key] ? "collapsed" : ""}`}>
      <div className="tree-section-header" onClick={() => toggle(key)}>
        <svg className="tree-caret" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="currentColor" /></svg>
        <span>{label}</span>
        <span className="count">({items.length})</span>
        <button className="add" onClick={(e) => { e.stopPropagation(); onAddEntity && onAddEntity(key); }}><I.Plus /></button>
      </div>
      <div className="tree-items">{items.map(renderItem)}</div>
    </div>
  );

  const schemaList = schemas.length ? schemas : [{ name: "public", count: tables.length }];

  return (
    <div className="left">
      <div className="left-tabs">
        {["OBJECTS", "EXPLORER", "THEMES"].map((t) => (
          <button key={t} className={`left-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "OBJECTS" && (
        <>
          <div className="left-search">
            <div className="search-field">
              <I.Search />
              <input placeholder="Filter objects…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button className="icon-btn" title="Filter"><I.Filter /></button>
          </div>
          <div className="tree">
            {section("TABLES", "Tables", byKind.TABLES, (t) => (
              <div key={t.id}
                   className={`tree-item ${activeTable === t.id ? "active" : ""}`}
                   onClick={() => onSelectTable(t.id)}>
                <I.Table />
                <span>{t.name}</span>
                <span className="badge">{t.columns.length}</span>
              </div>
            ))}
            {byKind.VIEWS.length > 0 && section("VIEWS", "Views", byKind.VIEWS, (v) => (
              <div key={v.id} className="tree-item"><I.View /><span>{v.name}</span></div>
            ))}
            {byKind.ENUMS.length > 0 && section("ENUMS", "Enums", byKind.ENUMS, (e) => (
              <div key={e.id}
                   className={`tree-item ${activeTable === e.id ? "active" : ""}`}
                   onClick={() => onSelectTable(e.id)}>
                <I.Enum /><span>{e.name}</span>
              </div>
            ))}
            {subjectAreas.length > 0 && (
              <div className="tree-section">
                <div className="tree-section-header">
                  <svg className="tree-caret" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="currentColor" /></svg>
                  <span>Subject Areas</span><span className="count">({subjectAreas.length})</span>
                </div>
                <div className="tree-items">
                  {subjectAreas.map((s) => (
                    <div key={s.id || s.label} className="tree-item">
                      <span className="swatch" style={{ background: s.color || `var(--cat-${s.cat})` }} />
                      <span>{s.label}</span>
                      <I.Eye />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "EXPLORER" && (
        <div className="tree" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>Connection</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--border-default)", borderRadius: 6, marginBottom: 12 }}>
            <I.Db />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{connectionLabel}</div>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{connectionDsn}</div>
            </div>
            <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-success)" }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>Schemas</div>
          {schemaList.map((s, i) => (
            <div key={s.name} className={`tree-item ${i === 0 ? "active" : ""}`}>
              <I.Layers /><span>{s.name}</span>
              <span className="badge">{s.count}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "THEMES" && (
        <div style={{ padding: "14px 16px", overflowY: "auto" }}>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Appearance</div>
          {THEMES.map((t) => {
            const active = t.id === theme;
            return (
              <button key={t.id} onClick={() => setTheme(t.id)}
                style={{
                  width: "100%", textAlign: "left",
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 10px", marginBottom: 6,
                  border: `1px solid ${active ? "var(--accent)" : "var(--border-default)"}`,
                  borderRadius: 8,
                  background: active ? "var(--accent-dim)" : "var(--bg-2)",
                  cursor: "pointer", transition: "all 120ms var(--ease)",
                }}>
                <div style={{ display: "flex", gap: 0, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border-default)" }}>
                  {t.colors.map((c, i) => <div key={i} style={{ width: 12, height: 28, background: c }} />)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                    {t.name}
                    <span style={{
                      fontSize: 9, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase",
                      padding: "1px 5px", borderRadius: 3, background: "var(--bg-3)", color: "var(--text-tertiary)",
                    }}>{t.mode}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>{t.sub}</div>
                </div>
                {active && <I.Check />}
              </button>
            );
          })}
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", margin: "18px 0 8px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Keyboard</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 2px" }}>
            <span>Cycle themes</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, padding: "2px 6px", background: "var(--bg-3)", borderRadius: 4, border: "1px solid var(--border-default)" }}>⌘⇧T</span>
          </div>
        </div>
      )}
    </div>
  );
}
