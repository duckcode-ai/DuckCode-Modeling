/* DomainSwitcher — top-bar dropdown that filters the Explorer and canvas
 * to a single subject area (domain). Reads + writes `activeSchemaFilter`
 * on `diagramStore`, which both the legacy Canvas pipeline (via the
 * Shell) and the newer `DiagramCanvas.jsx` (via `node.data.subject_area`)
 * already honor.
 *
 * Design mirrors the theme menu in Chrome.jsx: a button that opens a
 * click-outside-dismiss popover. The button labels itself with the
 * active domain; "All domains" when no filter is set. Membership
 * counts are pulled from the caller's `domains` prop so the list
 * updates reactively with the active model.
 *
 * The special filter value `__unassigned_subject_area__` matches the
 * SubjectAreasPanel convention (DiagramCanvas.jsx:38) — we surface it
 * here too so users can drill to entities with no domain assigned.
 */
import React from "react";
import Icon from "./icons";
import useDiagramStore from "../stores/diagramStore";

export const UNASSIGNED_FILTER = "__unassigned_subject_area__";

export default function DomainSwitcher({ domains = [], hasUnassigned = false, unassignedCount = 0 }) {
  const I = Icon;
  const activeSchemaFilter = useDiagramStore((s) => s.activeSchemaFilter);
  const setActiveSchemaFilter = useDiagramStore((s) => s.setActiveSchemaFilter);

  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Don't render the switcher if the model has no domains at all — an
  // empty dropdown is just visual noise. The bottom-panel Subject
  // Areas view still handles the "assign domains" flow.
  if (domains.length === 0 && !hasUnassigned) return null;

  const activeLabel = (() => {
    if (!activeSchemaFilter) return "All domains";
    if (activeSchemaFilter === UNASSIGNED_FILTER) return "Unassigned";
    return activeSchemaFilter;
  })();

  const pick = (value) => {
    // Toggle semantics match SubjectAreasPanel: clicking the active
    // domain clears the filter.
    setActiveSchemaFilter(activeSchemaFilter === value ? null : value);
    setOpen(false);
  };

  const totalFiltered = domains.reduce((n, d) => n + (d.count || 0), 0) + (unassignedCount || 0);

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="tool-btn"
        onClick={() => setOpen((v) => !v)}
        title={activeSchemaFilter ? `Domain: ${activeLabel} — click to change` : "Filter canvas by domain"}
        style={{
          height: 28,
          padding: "0 10px 0 8px",
          border: "1px solid var(--border-default)",
          borderRadius: 7,
          gap: 6,
          background: activeSchemaFilter ? "var(--accent-dim)" : undefined,
          color: activeSchemaFilter ? "var(--accent)" : undefined,
        }}
      >
        <I.Layers />
        <span style={{ fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activeLabel}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.6 }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 34,
            right: 0,
            zIndex: 60,
            width: 240,
            padding: 6,
            background: "var(--bg-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: 10,
            boxShadow: "var(--shadow-pop)",
            maxHeight: "70vh",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              padding: "6px 8px 4px",
            }}
          >
            Domain
          </div>

          <MenuItem
            label="All domains"
            hint={`${totalFiltered} entit${totalFiltered === 1 ? "y" : "ies"}`}
            active={!activeSchemaFilter}
            onClick={() => pick(null)}
          />

          {domains.map((d) => (
            <MenuItem
              key={d.name}
              label={d.name}
              hint={`${d.count || 0}`}
              active={activeSchemaFilter === d.name}
              color={d.color}
              onClick={() => pick(d.name)}
            />
          ))}

          {hasUnassigned && (
            <>
              <div style={{ height: 1, background: "var(--border-default)", margin: "6px 4px" }} />
              <MenuItem
                label="Unassigned"
                hint={`${unassignedCount}`}
                active={activeSchemaFilter === UNASSIGNED_FILTER}
                onClick={() => pick(UNASSIGNED_FILTER)}
                muted
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, hint, active, onClick, color, muted }) {
  const I = Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 8px",
        borderRadius: 6,
        background: active ? "var(--accent-dim)" : "transparent",
        color: muted ? "var(--text-tertiary)" : "var(--text-primary)",
        textAlign: "left",
        cursor: "pointer",
        border: "none",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--bg-1)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: color || "var(--border-strong)",
          border: "1px solid var(--border-default)",
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, fontSize: 12, fontWeight: active ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)" }}>
          {hint}
        </span>
      )}
      {active && <I.Check />}
    </button>
  );
}
