/* UserMenu — account-chip dropdown anchored to the top-bar avatar. Wraps
   the existing chip presentation (avatar gradient + name) in a button so
   it becomes interactive. Menu items:
     • User header (avatar + name + role)
     • Account / Profile (stub → toast; backing page is a future surface)
     • Keyboard shortcuts (triggers parent's shortcut panel via callback)
     • Theme submenu (lists THEMES, same as the neighbouring theme chip —
       provided here for parity with macOS conventions so the avatar is a
       single "everything about me" entry point)
     • Sign out (calls authStore.logout)

   Outside-click closes the popover. Keeps the submenu state local. */
import React from "react";
import { User, LogOut, Keyboard, Palette, Check as CheckIcon, ChevronRight } from "lucide-react";
import useAuthStore from "../stores/authStore";
import useUiStore from "../stores/uiStore";
import { THEMES } from "./notation";

export default function UserMenu({
  userInitials = "DL",
  userName = "DataLex",
  theme,
  setTheme,
  onOpenShortcuts,
}) {
  const { user, logout, isAdmin } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);

  const [open, setOpen] = React.useState(false);
  const [themeOpen, setThemeOpen] = React.useState(false);
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setThemeOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setThemeOpen(false);
  };

  const handleSignOut = async () => {
    close();
    try {
      await logout();
      addToast({ type: "success", message: "Signed out." });
    } catch (err) {
      addToast({ type: "error", message: `Sign out failed: ${err?.message || err}` });
    }
  };

  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Viewer";
  const currentTheme = THEMES.find((t) => t.id === theme) || THEMES[0];

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        className="user-chip-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open user menu"
        aria-expanded={open}
      >
        <div className="avatar">{userInitials}</div>
        <span>{userName}</span>
      </button>

      {open && (
        <div
          className="chrome-popover"
          style={{ top: 38, right: 0, width: 260 }}
          role="menu"
        >
          {/* Identity header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 12px 10px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
              {userInitials}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {userName}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>
                {roleLabel}
                {user?.username && user.username !== userName ? ` · ${user.username}` : ""}
              </div>
            </div>
          </div>

          <div className="chrome-popover-body" style={{ maxHeight: "none", padding: 6 }}>
            <button
              className="chrome-popover-row"
              onClick={() => {
                close();
                addToast({ type: "info", message: "Account page is coming soon." });
              }}
              role="menuitem"
            >
              <User size={13} />
              Account
            </button>
            <button
              className="chrome-popover-row"
              onClick={() => {
                close();
                onOpenShortcuts && onOpenShortcuts();
              }}
              role="menuitem"
            >
              <Keyboard size={13} />
              Keyboard shortcuts
              <span className="meta">?</span>
            </button>

            {/* Theme submenu (inline expand) */}
            <button
              className="chrome-popover-row"
              onClick={() => setThemeOpen((v) => !v)}
              role="menuitem"
              aria-expanded={themeOpen}
            >
              <Palette size={13} />
              Theme
              <span className="meta" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {currentTheme?.name}
                <ChevronRight
                  size={11}
                  style={{
                    transition: "transform 120ms var(--ease)",
                    transform: themeOpen ? "rotate(90deg)" : "none",
                  }}
                />
              </span>
            </button>
            {themeOpen && (
              <div style={{ padding: "2px 0 6px" }}>
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className="chrome-popover-row"
                    onClick={() => {
                      setTheme && setTheme(t.id);
                      setThemeOpen(false);
                    }}
                    style={{
                      paddingLeft: 28,
                      background: t.id === theme ? "var(--accent-dim)" : "transparent",
                    }}
                    role="menuitemradio"
                    aria-checked={t.id === theme}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        borderRadius: 3,
                        overflow: "hidden",
                        border: "1px solid var(--border-default)",
                      }}
                    >
                      {t.colors.slice(0, 3).map((c, i) => (
                        <span
                          key={i}
                          style={{ width: 6, height: 12, background: c, display: "block" }}
                        />
                      ))}
                    </span>
                    <span style={{ flex: 1 }}>{t.name}</span>
                    {t.id === theme && <CheckIcon size={12} />}
                  </button>
                ))}
              </div>
            )}

            <div className="chrome-popover-divider" />

            {isAdmin && isAdmin() && (
              <button
                className="chrome-popover-row"
                onClick={() => {
                  close();
                  addToast({
                    type: "info",
                    message: "Role switching is admin-only and stubbed for now.",
                  });
                }}
                role="menuitem"
              >
                <User size={13} />
                Switch role
                <span className="meta">admin</span>
              </button>
            )}

            <button
              className="chrome-popover-row danger"
              onClick={handleSignOut}
              role="menuitem"
            >
              <LogOut size={13} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
