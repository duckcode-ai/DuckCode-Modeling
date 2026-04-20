/* InspectorTabs — accessible tab strip used by RightPanel.
   Renders a `role="tablist"` of `.inspector-tab` buttons. ArrowLeft /
   ArrowRight moves the selection; Home / End jump to first / last.
   Selection is controlled by the caller (the tab's persisted in
   uiStore.rightPanelTab so it survives reloads and entity switches). */
import React from "react";

export default function InspectorTabs({ tab, setTab, tabs }) {
  const refs = React.useRef({});

  const move = (delta) => {
    const ids = tabs.map((t) => t.id);
    const idx = ids.indexOf(tab);
    if (idx < 0) return;
    const nextIdx = (idx + delta + ids.length) % ids.length;
    const next = ids[nextIdx];
    setTab(next);
    // Let focus follow the selection so the arrow-nav feels natural.
    requestAnimationFrame(() => refs.current[next]?.focus());
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft")  { e.preventDefault(); move(-1); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); move(+1); return; }
    if (e.key === "Home")       { e.preventDefault(); setTab(tabs[0].id); refs.current[tabs[0].id]?.focus(); return; }
    if (e.key === "End")        { e.preventDefault(); const last = tabs[tabs.length - 1]; setTab(last.id); refs.current[last.id]?.focus(); return; }
  };

  return (
    <div role="tablist" aria-label="Inspector tabs" className="inspector-tabs" onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            ref={(el) => { if (el) refs.current[t.id] = el; }}
            role="tab"
            aria-selected={active}
            aria-controls={`inspector-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            className={`inspector-tab ${active ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
