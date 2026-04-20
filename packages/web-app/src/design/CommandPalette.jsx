/* Command palette — Cmd+K. Ported from DataLex design prototype. */
import React from "react";
import Icon from "./icons";

export default function CommandPalette({ open, onClose, tables, onSelectTable, extraCommands = [] }) {
  const I = Icon;
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const commands = [
    { id: "new-table", section: "Actions", label: "New table…",          meta: "⌘N",  icon: <I.Plus /> },
    { id: "new-rel",   section: "Actions", label: "New relationship…",   meta: "⌘R",  icon: <I.Relation /> },
    { id: "auto",      section: "Actions", label: "Auto-layout diagram", meta: "⌘⇧L", icon: <I.Grid /> },
    { id: "export",    section: "Actions", label: "Export SQL…",         meta: "⌘E",  icon: <I.Download /> },
    { id: "theme",     section: "Actions", label: "Toggle theme",        meta: "⌘⇧T", icon: <I.Layers /> },
    ...extraCommands,
    ...tables.map((t) => ({
      id: `t-${t.id}`, section: "Tables", label: t.name, meta: `${t.columns.length} cols`,
      icon: t.kind === "ENUM" ? <I.Enum /> : <I.Table />, tableId: t.id,
    })),
    { id: "help", section: "Help", label: "Keyboard shortcuts", meta: "⌘/", icon: <I.Cmd /> },
  ];

  const filtered = commands.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));

  const onKey = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") {
      const c = filtered[idx];
      if (c?.tableId) { onSelectTable(c.tableId); onClose(); }
      else if (c?.run) { c.run(); onClose(); }
      else onClose();
    }
  };

  if (!open) return null;

  let lastSection = null;
  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <I.Search />
          <input ref={inputRef} className="cmd-input" placeholder="Search tables, commands, columns…"
                 value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey} />
          <span className="kbd">ESC</span>
        </div>
        <div className="cmd-list">
          {filtered.length === 0 && (
            <div style={{ padding: "30px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
              No results for “{q}”
            </div>
          )}
          {filtered.map((c, i) => {
            const header = c.section !== lastSection;
            lastSection = c.section;
            return (
              <React.Fragment key={c.id}>
                {header && <div className="cmd-section">{c.section}</div>}
                <div className={`cmd-item ${i === idx ? "selected" : ""}`}
                     onMouseEnter={() => setIdx(i)}
                     onClick={() => {
                       if (c.tableId) { onSelectTable(c.tableId); onClose(); }
                       else if (c.run) { c.run(); onClose(); }
                       else onClose();
                     }}>
                  <div className="cmd-icon">{c.icon}</div>
                  <span>{c.label}</span>
                  <span className="cmd-meta">{c.meta}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <div className="cmd-footer">
          <div className="hint"><span className="kbd">↑↓</span> Navigate</div>
          <div className="hint"><span className="kbd">↵</span> Select</div>
          <div className="hint"><span className="kbd">ESC</span> Close</div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <I.Sparkle style={{ width: 12, height: 12, color: "var(--accent)" }} />
            Ask DataLex anything
          </div>
        </div>
      </div>
    </div>
  );
}
