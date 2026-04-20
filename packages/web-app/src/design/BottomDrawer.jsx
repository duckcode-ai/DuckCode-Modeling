/* BottomDrawer — owns the bottom-drawer grid row for the DataLex shell.

   Responsibilities:
     • Render the tab strip (from `tabs` prop) plus a right-aligned action
       cluster (Minimize / Maximize–Restore / Close).
     • Draggable top-edge strip that resizes the drawer, writing live to
       the `--bottom-h` CSS variable on `<html>` so the grid row reflows
       in real time. On mouseup the final height commits to the uiStore.
     • Maximize toggle: applies `.maximized` class → expands drawer to
       nearly full viewport height via CSS. Restore snaps back to the
       persisted drag-set height.
     • Body renders whatever children are passed (Shell wires the
       per-tab panel component here).

   The drawer height + maximized state live in uiStore and persist via
   `datalex.bottomPanel` localStorage blob. The drag gesture only touches
   the store on `mouseup` — during the drag we mutate a single CSS var
   per rAF tick to keep React re-renders out of the hot path. */
import React, { useCallback, useEffect, useRef } from "react";
import { X, Minus, Maximize2, Minimize2 } from "lucide-react";
import useUiStore from "../stores/uiStore";

const MIN_H = 140;
const VIEWPORT_MARGIN = 160; // keep at least 160px above the drawer for the canvas

function getMaxH() {
  return Math.max(240, (typeof window !== "undefined" ? window.innerHeight : 900) - VIEWPORT_MARGIN);
}

function clamp(h) {
  return Math.max(MIN_H, Math.min(getMaxH(), Math.round(h)));
}

export default function BottomDrawer({ tabs, children }) {
  const {
    bottomPanelTab, setBottomPanelTab,
    toggleBottomPanel,
    bottomPanelHeight, setBottomPanelHeight,
    bottomPanelMaximized, toggleBottomPanelMax,
  } = useUiStore();

  const dragStateRef = useRef({ dragging: false, startY: 0, startH: 0, pendingH: 0, rafId: 0 });

  /* Apply the persisted height to the CSS var on mount + whenever it changes
     externally (e.g. after a reload or programmatic resize). We skip this
     during a live drag because the drag loop is already driving the var. */
  useEffect(() => {
    if (dragStateRef.current.dragging) return;
    if (bottomPanelMaximized) return; // maximized class takes precedence via CSS
    document.documentElement.style.setProperty("--bottom-h", `${bottomPanelHeight}px`);
  }, [bottomPanelHeight, bottomPanelMaximized]);

  /* Drag-resize handlers ─────────────────────────────────────────────── */
  const onDragMove = useCallback((e) => {
    const st = dragStateRef.current;
    if (!st.dragging) return;
    // Drawer grows UPWARD as cursor moves up (clientY decreases).
    const nextH = clamp(st.startH - (e.clientY - st.startY));
    st.pendingH = nextH;
    if (!st.rafId) {
      st.rafId = requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--bottom-h", `${st.pendingH}px`);
        st.rafId = 0;
      });
    }
  }, []);

  const onDragEnd = useCallback(() => {
    const st = dragStateRef.current;
    if (!st.dragging) return;
    st.dragging = false;
    if (st.rafId) { cancelAnimationFrame(st.rafId); st.rafId = 0; }
    document.body.classList.remove("drawer-resizing");
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    // Commit final height to store (persisted).
    setBottomPanelHeight(st.pendingH || st.startH);
  }, [onDragMove, setBottomPanelHeight]);

  const onDragStart = useCallback((e) => {
    if (bottomPanelMaximized) return; // don't allow resize while maximized
    e.preventDefault();
    const st = dragStateRef.current;
    st.dragging = true;
    st.startY = e.clientY;
    st.startH = bottomPanelHeight;
    st.pendingH = bottomPanelHeight;
    document.body.classList.add("drawer-resizing");
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
  }, [bottomPanelHeight, bottomPanelMaximized, onDragMove, onDragEnd]);

  /* Double-click on the handle → reset to default 280px. */
  const onResizeDblClick = useCallback(() => {
    if (bottomPanelMaximized) return;
    setBottomPanelHeight(280);
  }, [bottomPanelMaximized, setBottomPanelHeight]);

  /* Viewport resize — clamp stored height to new viewport. */
  useEffect(() => {
    const onResize = () => {
      const clamped = clamp(bottomPanelHeight);
      if (clamped !== bottomPanelHeight) setBottomPanelHeight(clamped);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bottomPanelHeight, setBottomPanelHeight]);

  return (
    <div className={`bottom-drawer ${bottomPanelMaximized ? "maximized" : ""}`}>
      <div
        className="bottom-drawer-resize"
        onMouseDown={onDragStart}
        onDoubleClick={onResizeDblClick}
        title={bottomPanelMaximized ? "Restore to resize" : "Drag to resize · double-click to reset"}
        aria-label="Resize bottom drawer"
        role="separator"
      >
        <span className="bottom-drawer-resize-grip" />
      </div>

      <div className="bottom-drawer-tabs">
        <div className="bottom-drawer-tabs-scroller">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`bottom-drawer-tab ${bottomPanelTab === id ? "active" : ""}`}
              onClick={() => setBottomPanelTab(id)}
              title={label}
            >
              {Icon && <Icon size={12} />}
              <span className="bottom-drawer-tab-label">{label}</span>
            </button>
          ))}
        </div>
        <div className="bottom-drawer-actions">
          <button
            className="bottom-drawer-action-btn"
            onClick={() => {
              // "Minimize" = collapse the drawer to a small height (or close
              // if already small). Gives the user a quick way to reclaim
              // canvas space without fully hiding the drawer.
              if (bottomPanelMaximized) toggleBottomPanelMax();
              else if (bottomPanelHeight > 180) setBottomPanelHeight(160);
              else toggleBottomPanel();
            }}
            title="Minimize panel"
            aria-label="Minimize panel"
          >
            <Minus size={14} />
          </button>
          <button
            className="bottom-drawer-action-btn"
            onClick={toggleBottomPanelMax}
            title={bottomPanelMaximized ? "Restore panel" : "Maximize panel"}
            aria-label={bottomPanelMaximized ? "Restore panel" : "Maximize panel"}
          >
            {bottomPanelMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            className="bottom-drawer-action-btn close"
            onClick={toggleBottomPanel}
            title="Close panel (⌘J)"
            aria-label="Close panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="bottom-drawer-body">
        <div className="legacy-panel-root">{children}</div>
      </div>
    </div>
  );
}
