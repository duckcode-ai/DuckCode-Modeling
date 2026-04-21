/* Top bar, project tabs, status bar. Ported from DataLex design prototype. */
import React from "react";
import Icon from "./icons";
import { THEMES } from "./notation";
import useUiStore from "../stores/uiStore";
import BellMenu from "./BellMenu";
import DomainSwitcher from "./DomainSwitcher";
import DiffToggle from "./DiffToggle";

/* Segmented view-mode switcher. Drives `uiStore.shellViewMode`, which the
   Shell inspects to decide whether to render the diagram, the table list,
   the views manager, or the enums manager in the main canvas cell. */
const VIEW_MODES = [
  { id: "diagram", label: "Diagram", Icon: Icon.Layers, tooltip: "Visual ER diagram" },
  { id: "table",   label: "Table",   Icon: Icon.Table,  tooltip: "Tabular entity list" },
  { id: "views",   label: "Views",   Icon: Icon.View,   tooltip: "Database views & matviews" },
  { id: "enums",   label: "Enums",   Icon: Icon.Enum,   tooltip: "Enumerations" },
];

function ViewSwitcher() {
  const shellViewMode = useUiStore((s) => s.shellViewMode);
  const setShellViewMode = useUiStore((s) => s.setShellViewMode);
  return (
    <div className="view-switcher" role="tablist" aria-label="Main view">
      {VIEW_MODES.map((m) => {
        const Ico = m.Icon;
        const active = shellViewMode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`view-seg ${active ? "active" : ""}`}
            onClick={() => setShellViewMode(m.id)}
            title={m.tooltip}
          >
            <Ico />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function TopBar({
  onOpenCmd, theme, setTheme, onNewTable, onNewFile, onOpenFile, onSave, onSaveAll,
  onUndo, onRedo, onRunSql, onSettings, onConnections, onCommit,
  onImport, onImportDbt, onSearch,
  isDirty = false, canSave = true, canSaveAll = false,
  domains = [], hasUnassigned = false, unassignedCount = 0,
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
          <button className="tool-btn" title="Import schema (dbt / SQL / DBML)" onClick={onImport}><I.Download style={{ transform: "rotate(180deg)" }} /></button>
          {onImportDbt && (
            <button className="tool-btn" title="Import dbt repo (folder / git / jaffle-shop demo)" onClick={onImportDbt}><I.Dep /></button>
          )}
          <button className="tool-btn"
                  title={isDirty ? "Save (⌘S)" : "Nothing to save"}
                  onClick={onSave}
                  disabled={!canSave}
                  style={{ opacity: canSave ? 1 : 0.4 }}>
            <I.Download />
            {isDirty && <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--accent)", marginLeft: 4 }} />}
          </button>
          {onSaveAll && (
            <button className="tool-btn"
                    title="Save project (flush all edits to disk)"
                    onClick={onSaveAll}
                    disabled={!canSaveAll}
                    style={{ opacity: canSaveAll ? 1 : 0.4 }}>
              <I.Download />
              <span style={{ marginLeft: 4 }}>All</span>
            </button>
          )}
        </div>
        <div className="tool-group">
          <button className="tool-btn" onClick={onNewTable} title="Create a new table / entity"><I.Plus /><I.Table />Table</button>
          <button className="tool-btn" onClick={onConnections} title="Manage connections"><I.Db />Connect</button>
        </div>
        <div className="tool-group">
          <button className="tool-btn" title="Undo" onClick={onUndo}><I.Undo /></button>
          <button className="tool-btn" title="Redo" onClick={onRedo}><I.Redo /></button>
        </div>
        {/* View-mode switcher replaces the old Diagram/View/Enum triple. */}
        <ViewSwitcher />
        <div className="tool-group">
          <DomainSwitcher
            domains={domains}
            hasUnassigned={hasUnassigned}
            unassignedCount={unassignedCount}
          />
          <DiffToggle />
        </div>
        <div className="tool-group">
          <button className="tool-btn" onClick={onRunSql}><I.Play />Run SQL</button>
          <button className="tool-btn" title="Commit (git)" onClick={onCommit}><I.Branch /></button>
          <button className="tool-btn" title="Settings" onClick={onSettings}><I.Settings /></button>
        </div>
      </div>
      <button
        className="search-launcher"
        onClick={onSearch || onOpenCmd}
        title="Search tables, columns, commands (⌘K)"
      >
        <span className="search-launcher-icon"><I.Search /></span>
        <span className="search-launcher-text">Search tables, columns, commands…</span>
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

      <BellMenu />
    </div>
  );
}

export function ProjectTabs({ projects = [], activeId, onSelect, onClose, onNew, branchName = "main", onBranchClick }) {
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
          <span className="tab-dot" style={{ color: p.color || "var(--accent)" }} />
          {p.name}
          <button className="tab-close" onClick={(e) => { e.stopPropagation(); onClose && onClose(p.id); }}>×</button>
        </div>
      ))}
      <div className="tabs-spacer" />
      <button className="tab-action" onClick={onNew}><I.Plus />New tab</button>
      <button className="tab-action" onClick={onBranchClick} title="Switch / create branch">
        <I.Branch />{branchName}
      </button>
    </div>
  );
}

export function StatusBar({
  density, setDensity, tableCount, relCount,
  engine = "PostgreSQL 16.1", saved = "Saved 2m ago",
  zoom = 100, connectionState = "Connected",
  bottomPanelOpen = false, onTogglePanel,
}) {
  const I = Icon;
  return (
    <div className="status">
      <div className="status-item"><span className="dot" /> {connectionState}</div>
      <div className="status-item"><span className="k">{engine}</span></div>
      <div className="status-item">public · <span className="k">{tableCount} tables</span> · <span className="k">{relCount} relationships</span></div>
      <div className="status-item">{saved}</div>
      <div className="status-spacer" />
      {/* Always-visible panel toggle — the belt-and-suspenders way back
          to the drawer when a user hits the close (X) button. */}
      {onTogglePanel && (
        <div className="status-item">
          <button
            type="button"
            className={`status-panel-toggle ${bottomPanelOpen ? "open" : ""}`}
            onClick={onTogglePanel}
            title={bottomPanelOpen ? "Close bottom panel (⌘J)" : "Open bottom panel (⌘J)"}
            aria-label={bottomPanelOpen ? "Close bottom panel" : "Open bottom panel"}
          >
            <span style={{ display: "inline-flex", transform: bottomPanelOpen ? "none" : "rotate(180deg)" }}>
              <I.ChevronDown />
            </span>
            Panel
          </button>
        </div>
      )}
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
