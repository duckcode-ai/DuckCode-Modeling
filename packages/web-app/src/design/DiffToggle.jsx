/* DiffToggle — TopBar button that overlays git-diff-vs-branch state onto
 * the ER diagram. When enabled, `uiStore.diffState.entities` is populated
 * with `{ [entityName]: "added" | "modified" | "removed" }`, and the
 * live Canvas + TableView pipelines read that map to color-code cards.
 *
 * The popover offers:
 *   - a branch input (default: `main`)
 *   - an enable button that kicks `setDiffVsRef(ref, {projectId, projectFiles})`
 *   - a summary row ("3 added · 2 modified · 1 removed") once loaded
 *   - a disable button that clears the overlay
 *
 * Design mirrors DomainSwitcher.jsx (same popover dimensions, same
 * click-outside / escape dismiss). Hidden entirely when there's no active
 * project or the active project isn't a git repository — the backend
 * endpoint would 400, so don't even offer the affordance.
 */
import React from "react";
import Icon from "./icons";
import useUiStore from "../stores/uiStore";
import useWorkspaceStore from "../stores/workspaceStore";

export default function DiffToggle() {
  const I = Icon;
  const diffVsRef    = useUiStore((s) => s.diffVsRef);
  const diffLoading  = useUiStore((s) => s.diffLoading);
  const diffError    = useUiStore((s) => s.diffError);
  const diffState    = useUiStore((s) => s.diffState);
  const setDiffVsRef = useUiStore((s) => s.setDiffVsRef);
  const clearDiff    = useUiStore((s) => s.clearDiff);

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const projectFiles    = useWorkspaceStore((s) => s.projectFiles);

  const [open, setOpen]     = React.useState(false);
  const [refName, setRefName] = React.useState("main");
  const menuRef = React.useRef(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Focus the input when the popover opens so users can type a ref
    // immediately without a second click.
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Hide the switcher entirely when there's no project — mirrors the
  // DomainSwitcher's "no data = no noise" rule.
  if (!activeProjectId) return null;

  const active = !!diffVsRef;
  const counts = {
    added: diffState?.files?.added?.length || 0,
    modified: diffState?.files?.modified?.length || 0,
    removed: diffState?.files?.removed?.length || 0,
  };
  const total = counts.added + counts.modified + counts.removed;

  const enable = async () => {
    const ref = refName.trim() || "main";
    await setDiffVsRef(ref, { projectId: activeProjectId, projectFiles });
    // Keep the popover open on error so the user sees the inline message;
    // close on success.
    const err = useUiStore.getState().diffError;
    if (!err) setOpen(false);
  };

  const disable = () => {
    clearDiff();
    setOpen(false);
  };

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="tool-btn"
        onClick={() => setOpen((v) => !v)}
        title={active ? `Diff vs ${diffVsRef} — ${total} changed file${total === 1 ? "" : "s"}` : "Compare canvas against a branch (git diff)"}
        style={{
          height: 28,
          padding: "0 10px 0 8px",
          border: "1px solid var(--border-default)",
          borderRadius: 7,
          gap: 6,
          background: active ? "var(--accent-dim)" : undefined,
          color: active ? "var(--accent)" : undefined,
        }}
      >
        <I.Branch />
        <span style={{ fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {active ? `vs ${diffVsRef}` : "Diff"}
        </span>
        {active && total > 0 && (
          <span style={{
            fontSize: 10,
            padding: "1px 5px",
            borderRadius: 4,
            background: "var(--accent)",
            color: "var(--bg-0, #fff)",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}>{total}</span>
        )}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 34,
            right: 0,
            zIndex: 60,
            width: 260,
            padding: 10,
            background: "var(--bg-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: 10,
            boxShadow: "var(--shadow-pop)",
          }}
        >
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
            textTransform: "uppercase", color: "var(--text-tertiary)",
            padding: "0 2px 6px",
          }}>Compare against</div>

          <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
            <input
              ref={inputRef}
              type="text"
              value={refName}
              onChange={(e) => setRefName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") enable(); }}
              placeholder="main"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              style={{
                flex: 1, fontSize: 12,
                padding: "6px 8px",
                border: "1px solid var(--border-default)",
                borderRadius: 6,
                background: "var(--bg-1)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)",
              }}
            />
            <button
              type="button"
              onClick={enable}
              disabled={diffLoading}
              style={{
                fontSize: 11, fontWeight: 600,
                padding: "0 10px",
                border: "1px solid var(--accent)",
                borderRadius: 6,
                background: diffLoading ? "var(--bg-1)" : "var(--accent)",
                color: diffLoading ? "var(--text-tertiary)" : "var(--bg-0, #fff)",
                cursor: diffLoading ? "wait" : "pointer",
              }}
            >
              {diffLoading ? "…" : active ? "Refresh" : "Enable"}
            </button>
          </div>

          {diffError && (
            <div style={{
              marginTop: 8,
              fontSize: 11, color: "#d63c3c",
              padding: "6px 8px",
              background: "rgba(214,60,60,0.08)",
              border: "1px solid rgba(214,60,60,0.3)",
              borderRadius: 6,
            }}>{diffError}</div>
          )}

          {active && !diffError && (
            <>
              <div style={{ height: 1, background: "var(--border-default)", margin: "10px -2px 8px" }} />
              <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Pill color="#10b981" label="added" count={counts.added} />
                <Pill color="#f59e0b" label="modified" count={counts.modified} />
                <Pill color="#ef4444" label="removed" count={counts.removed} />
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={disable}
                  style={{
                    flex: 1, fontSize: 11,
                    padding: "6px 8px",
                    border: "1px solid var(--border-default)",
                    borderRadius: 6,
                    background: "transparent",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >Disable</button>
              </div>
            </>
          )}

          {!active && !diffError && (
            <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-tertiary)", lineHeight: 1.4 }}>
              Entities changed since the chosen branch will be highlighted
              on the diagram and table views.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Pill({ color, label, count }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11,
      padding: "2px 7px",
      border: `1px solid ${color}`,
      borderRadius: 4,
      background: `${color}1a`, // 10% alpha
      color: "var(--text-primary)",
      fontVariantNumeric: "tabular-nums",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: color }} />
      <span style={{ fontWeight: 600 }}>{count}</span>
      <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
    </span>
  );
}
