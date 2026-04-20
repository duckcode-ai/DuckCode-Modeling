/* Top bar, project tabs, status bar. Ported from DataLex design prototype. */
import React from "react";
import Icon from "./icons";
import { THEMES } from "./notation";

export function TopBar({
  onOpenCmd, theme, setTheme, onNewTable, onNewFile, onOpenFile, onSave,
  onUndo, onRedo, onRunSql, onSettings, onConnections, onCommit,
  isDirty = false, canSave = true,
  userInitials = "DL", userName = "User",
}) {
  const I = Icon;
  const [open, setOpen] = React.useState(false);
  const current = THEMES.find((t) => t.id === theme) || THEMES[0];
  const menuRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="topbar">
      <div className="traffic-lights"><span /><span /><span /></div>
      <div className="brand">
        <div className="brand-mark">DL</div>
        DataLex
      </div>
      <div className="toolbar">
        <div className="tool-group">
          <button className="tool-btn" title="New file" onClick={onNewFile}><I.Plus /></button>
          <button className="tool-btn" title="Open project" onClick={onOpenFile}><I.Folder /></button>
          <button className="tool-btn"
                  title={isDirty ? "Save (⌘S)" : "Nothing to save"}
                  onClick={onSave}
                  disabled={!canSave}
                  style={{ opacity: canSave ? 1 : 0.4 }}>
            <I.Download />
            {isDirty && <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--accent)", marginLeft: 4 }} />}
          </button>
        </div>
        <div className="tool-group">
          <button className="tool-btn" onClick={onNewTable}><I.Table />Table</button>
          <button className="tool-btn" onClick={onConnections} title="Manage connections"><I.Db />Connect</button>
          <button className="tool-btn"><I.View />View</button>
          <button className="tool-btn"><I.Enum />Enum</button>
        </div>
        <div className="tool-group">
          <button className="tool-btn" title="Undo" onClick={onUndo}><I.Undo /></button>
          <button className="tool-btn" title="Redo" onClick={onRedo}><I.Redo /></button>
        </div>
        <div className="tool-group">
          <button className="tool-btn" onClick={onRunSql}><I.Play />Run SQL</button>
          <button className="tool-btn active"><I.Layers />Diagram</button>
          <button className="tool-btn" title="Commit (git)" onClick={onCommit}><I.Branch /></button>
          <button className="tool-btn" title="Settings" onClick={onSettings}><I.Settings /></button>
        </div>
      </div>
      <button className="search-launcher" onClick={onOpenCmd}>
        <I.Search />
        <span>Search tables, columns, commands…</span>
        <span className="kbd">⌘K</span>
      </button>

      <div ref={menuRef} style={{ position: "relative" }}>
        <button className="tool-btn" onClick={() => setOpen((v) => !v)}
                title={`Theme: ${current?.name} — ⌘⇧T to cycle`}
                style={{ height: 28, padding: "0 10px 0 6px", border: "1px solid var(--border-default)", borderRadius: 7, gap: 7 }}>
          <span style={{ display: "flex", gap: 0, borderRadius: 3, overflow: "hidden", border: "1px solid var(--border-default)" }}>
            {current?.colors.slice(0, 3).map((c, i) => (
              <span key={i} style={{ width: 6, height: 14, background: c, display: "block" }} />
            ))}
          </span>
          <span style={{ fontSize: 11 }}>{current?.name}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.6 }}>
            <path d="M2 4l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div style={{
            position: "absolute", top: 34, right: 0, zIndex: 60, width: 240, padding: 6,
            background: "var(--bg-2)", border: "1px solid var(--border-strong)", borderRadius: 10,
            boxShadow: "var(--shadow-pop)",
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)", padding: "6px 8px 4px" }}>Theme</div>
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => { setTheme(t.id); setOpen(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "7px 8px", borderRadius: 6,
                  background: t.id === theme ? "var(--accent-dim)" : "transparent",
                  color: "var(--text-primary)", textAlign: "left", cursor: "pointer",
                }}>
                <span style={{ display: "flex", gap: 0, borderRadius: 3, overflow: "hidden", border: "1px solid var(--border-default)" }}>
                  {t.colors.map((c, i) => <span key={i} style={{ width: 10, height: 20, background: c, display: "block" }} />)}
                </span>
                <span style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 1 }}>{t.sub}</div>
                </span>
                {t.id === theme && <I.Check />}
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="tool-btn" title="Notifications"><I.Bell /></button>
      <div className="user-chip">
        <div className="avatar">{userInitials}</div>
        <span>{userName}</span>
      </div>
    </div>
  );
}

export function ProjectTabs({ projects = [], activeId, onSelect, onClose, onNew, branchName = "main" }) {
  const I = Icon;
  const fallback = projects.length ? projects : [
    { id: "demo", name: "Subscriptions.dlx", color: "#10b981" },
  ];
  return (
    <div className="tabs">
      {fallback.map((p) => (
        <div key={p.id}
             className={`tab ${p.id === activeId ? "active" : ""} ${p.dirty ? "unsaved" : ""}`}
             onClick={() => onSelect && onSelect(p.id)}>
          <span className="tab-dot" style={{ color: p.color || "#5b8cff" }} />
          {p.name}
          <button className="tab-close" onClick={(e) => { e.stopPropagation(); onClose && onClose(p.id); }}>×</button>
        </div>
      ))}
      <div className="tabs-spacer" />
      <button className="tab-action" onClick={onNew}><I.Plus />New tab</button>
      <button className="tab-action"><I.Branch />{branchName}</button>
    </div>
  );
}

export function StatusBar({ density, setDensity, tableCount, relCount, engine = "PostgreSQL 16.1", saved = "Saved 2m ago", zoom = 100, connectionState = "Connected" }) {
  return (
    <div className="status">
      <div className="status-item"><span className="dot" /> {connectionState}</div>
      <div className="status-item"><span className="k">{engine}</span></div>
      <div className="status-item">public · <span className="k">{tableCount} tables</span> · <span className="k">{relCount} relationships</span></div>
      <div className="status-item">{saved}</div>
      <div className="status-spacer" />
      <div className="status-item">
        <span style={{ color: "var(--text-muted)", marginRight: 6 }}>Density</span>
        <div className="density-toggle">
          {["compact", "comfortable", "detailed"].map((d) => (
            <button key={d} className={density === d ? "active" : ""} onClick={() => setDensity(d)}>
              {d[0].toUpperCase()}{d.slice(1, 4)}
            </button>
          ))}
        </div>
      </div>
      <div className="status-item"><span className="k">Zoom {zoom}%</span></div>
      <div className="status-item"><span className="k">UTF-8</span></div>
    </div>
  );
}
