/* BellMenu — notifications / activity popover anchored to the top-bar bell.
   Reads the rolling activityFeed from uiStore (populated automatically
   whenever `addToast` fires with a non-info message). Shows an unread dot
   when `unreadActivity > 0`; clicking the bell opens the popover AND calls
   `markActivityRead` so the dot clears.

   Empty state uses PanelEmpty. Outside-click closes the popover, matching
   the theme-menu pattern next door. */
import React from "react";
import { Bell, CheckCircle2, AlertTriangle, Info, XCircle, Trash2 } from "lucide-react";
import useUiStore from "../stores/uiStore";
import { PanelEmpty } from "../components/panels/PanelFrame";

function toneIcon(type) {
  switch (type) {
    case "success": return <CheckCircle2 size={12} style={{ color: "var(--status-success)" }} />;
    case "error":   return <XCircle size={12} style={{ color: "var(--status-error)" }} />;
    case "warning": return <AlertTriangle size={12} style={{ color: "var(--status-warning)" }} />;
    case "info":
    default:        return <Info size={12} style={{ color: "var(--accent)" }} />;
  }
}

function formatTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function BellMenu() {
  const activityFeed = useUiStore((s) => s.activityFeed);
  const unreadActivity = useUiStore((s) => s.unreadActivity);
  const markActivityRead = useUiStore((s) => s.markActivityRead);
  const clearActivity = useUiStore((s) => s.clearActivity);

  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next && unreadActivity > 0) markActivityRead();
      return next;
    });
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        className="tool-btn bell-btn"
        onClick={toggle}
        title={unreadActivity > 0 ? `${unreadActivity} new notification${unreadActivity === 1 ? "" : "s"}` : "Notifications"}
        aria-label="Notifications"
      >
        <Bell size={14} />
        {unreadActivity > 0 && <span className="unread-dot" />}
      </button>

      {open && (
        <div
          className="chrome-popover"
          style={{ top: 34, right: 0, width: 340 }}
          role="dialog"
          aria-label="Notifications"
        >
          <div className="chrome-popover-header">
            <Bell size={12} />
            <span>Notifications</span>
            <div className="spacer" />
            {activityFeed.length > 0 && (
              <button
                onClick={() => clearActivity()}
                title="Clear all"
                style={{
                  border: 0,
                  background: "transparent",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                <Trash2 size={11} /> Clear
              </button>
            )}
          </div>
          <div className="chrome-popover-body">
            {activityFeed.length === 0 ? (
              <div style={{ padding: "24px 12px" }}>
                <PanelEmpty
                  icon={Bell}
                  title="No recent activity"
                  description="Saves, errors, and model changes will show up here."
                />
              </div>
            ) : (
              activityFeed.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 6,
                  }}
                >
                  <span style={{ flexShrink: 0, marginTop: 2 }}>{toneIcon(a.type)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-primary)",
                        wordBreak: "break-word",
                      }}
                    >
                      {a.message}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "var(--text-tertiary)",
                        marginTop: 2,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {formatTime(a.createdAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
