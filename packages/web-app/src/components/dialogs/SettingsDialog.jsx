/* SettingsDialog — user-facing workspace settings.
   Ported to the shared `<Modal>` chrome with a Luna-aware sidebar, theme
   tiles (Midnight / Obsidian / Paper / Arctic), and consistent spacing.

   Theme changes are broadcast via a `datalex:theme-change` CustomEvent so
   the shell picks them up without either side knowing about the other. */
import React from "react";
import {
  Sun, Moon, Sparkles, Snowflake,
  Keyboard, Info, SlidersHorizontal, Plug, Check, Compass,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";
import { THEMES } from "../../design/notation";
import { startOnboardingTour, resetOnboardingSeen } from "../../lib/onboardingTour";
import Modal from "./Modal";

const TABS = [
  { id: "appearance",  label: "Appearance",  icon: SlidersHorizontal },
  { id: "keyboard",    label: "Keyboard",    icon: Keyboard },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "help",        label: "Help & Tour", icon: Compass },
  { id: "about",       label: "About",       icon: Info },
];

const THEME_STORAGE = "datalex.theme";

const THEME_ICONS = {
  midnight: Moon,
  obsidian: Sparkles,
  paper:    Sun,
  arctic:   Snowflake,
};

export default function SettingsDialog() {
  const { closeModal } = useUiStore();
  const [active, setActive] = React.useState("appearance");
  const [currentTheme, setCurrentTheme] = React.useState(
    () => localStorage.getItem(THEME_STORAGE) || "midnight"
  );

  const pickTheme = (id) => {
    localStorage.setItem(THEME_STORAGE, id);
    document.documentElement.setAttribute("data-theme", id);
    setCurrentTheme(id);
    window.dispatchEvent(
      new CustomEvent("datalex:theme-change", { detail: { theme: id } })
    );
  };

  return (
    <Modal
      title="Settings"
      subtitle="Personalize the workspace — appearance, shortcuts, connections."
      size="lg"
      onClose={closeModal}
      bodyClassName="pad-0"
      cardClassName="dlx-settings-card"
      footer={
        <button type="button" className="panel-btn primary" onClick={closeModal}>
          Done
        </button>
      }
    >
      <div className="dlx-settings-grid">
        {/* Sidebar */}
        <nav className="dlx-settings-nav" role="tablist" aria-label="Settings sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={active === id}
              className={`dlx-settings-nav-item ${active === id ? "active" : ""}`}
              onClick={() => setActive(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="dlx-settings-content">
          {active === "appearance"  && <AppearancePane currentTheme={currentTheme} onPickTheme={pickTheme} />}
          {active === "keyboard"    && <KeyboardPane />}
          {active === "connections" && <ConnectionsPane />}
          {active === "help"        && <HelpPane onClose={closeModal} />}
          {active === "about"       && <AboutPane />}
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────────── Appearance ─────────────────────────── */
function AppearancePane({ currentTheme, onPickTheme }) {
  return (
    <div className="dlx-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">Appearance</h3>
        <p className="dlx-settings-pane-sub">Theme and density for the workspace.</p>
      </header>

      <section>
        <div className="dlx-modal-section-heading" style={{ marginBottom: 8 }}>Theme</div>
        <div className="dlx-theme-grid">
          {THEMES.map((t) => (
            <ThemeTile
              key={t.id}
              theme={t}
              active={currentTheme === t.id}
              onClick={() => onPickTheme(t.id)}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="dlx-modal-section-heading" style={{ marginBottom: 8 }}>Density</div>
        <p className="dlx-settings-pane-sub" style={{ maxWidth: 420 }}>
          Density tuning arrives in a later phase. Defaults currently favor a comfortable
          grid for modeling sessions.
        </p>
      </section>
    </div>
  );
}

function ThemeTile({ theme, active, onClick }) {
  const Icon = THEME_ICONS[theme.id] || Sun;
  const [bg, accent, accent2, ok] = theme.colors || [];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`dlx-theme-tile ${active ? "active" : ""}`}
      aria-pressed={active}
      title={theme.sub}
    >
      <div
        className="dlx-theme-swatch"
        style={{
          background: bg,
          borderColor: active ? accent : "var(--border-default)",
        }}
      >
        <div className="dlx-theme-swatch-dots">
          <span style={{ background: accent }} />
          <span style={{ background: accent2 }} />
          <span style={{ background: ok }} />
        </div>
        {active && (
          <span className="dlx-theme-swatch-check" style={{ background: accent }}>
            <Check size={10} />
          </span>
        )}
      </div>
      <div className="dlx-theme-label">
        <Icon size={12} />
        <span>{theme.name}</span>
      </div>
      <div className="dlx-theme-sub">{theme.sub}</div>
    </button>
  );
}

/* ─────────────────────────── Keyboard ─────────────────────────── */
function KeyboardPane() {
  const shortcuts = [
    ["Save",                "⌘S"],
    ["Global search",       "⌘K"],
    ["Toggle sidebar",      "⌘\\"],
    ["Toggle bottom panel", "⌘J"],
    ["Toggle dark mode",    "⌘D"],
    ["Show shortcuts",      "?"],
    ["Model activity",      "⌘1"],
    ["Connect activity",    "⌘2"],
    ["Settings activity",   "⌘3"],
  ];
  return (
    <div className="dlx-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">Keyboard shortcuts</h3>
        <p className="dlx-settings-pane-sub">Remapping lands in a later phase.</p>
      </header>
      <div className="dlx-shortcut-list">
        {shortcuts.map(([label, key]) => (
          <div key={label} className="dlx-shortcut-row">
            <span>{label}</span>
            <code>{key}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Connections ─────────────────────────── */
function ConnectionsPane() {
  const { openModal } = useUiStore();
  return (
    <div className="dlx-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">Connections</h3>
        <p className="dlx-settings-pane-sub">
          Manage warehouse credentials and schema imports.
        </p>
      </header>
      <button
        className="panel-btn primary"
        onClick={() => openModal("connectionsManager")}
      >
        <Plug size={12} />
        Open connections manager
      </button>
    </div>
  );
}

/* ─────────────────────────── Help & Tour ─────────────────────────── */
function HelpPane({ onClose }) {
  const handleReplay = () => {
    onClose?.();
    // Tour runs against the underlying shell, so we need the modal
    // gone first. A short delay keeps the transition clean.
    setTimeout(() => startOnboardingTour(), 120);
  };
  const handleResetAndReplay = () => {
    resetOnboardingSeen();
    handleReplay();
  };
  return (
    <div className="dlx-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">Onboarding tour</h3>
        <p className="dlx-settings-pane-sub">
          A quick spotlight tour of the icons and panels that matter —
          import, diagram building, relationship validation, dangling
          scan, and merge-safe save. Takes about 60 seconds.
        </p>
      </header>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="panel-btn primary" onClick={handleReplay}>
          <Compass size={12} /> Replay onboarding tour
        </button>
        <button
          type="button"
          className="panel-btn"
          onClick={handleResetAndReplay}
          title="Clear the 'seen' flag so the welcome modal appears again on the next page load"
        >
          Reset + replay from welcome
        </button>
      </div>

      <section style={{ marginTop: 22 }}>
        <div className="dlx-modal-section-heading" style={{ marginBottom: 8 }}>
          Documentation
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "grid",
            gap: 6,
            fontSize: 13,
          }}
        >
          {[
            ["Getting started", "docs/getting-started.md"],
            ["Jaffle-shop walkthrough (3 min)", "docs/tutorials/jaffle-shop-walkthrough.md"],
            ["Import an existing dbt project", "docs/tutorials/import-existing-dbt.md"],
            ["Pull a live warehouse", "docs/tutorials/warehouse-pull.md"],
            ["CLI cheat sheet", "docs/cli.md"],
          ].map(([label, path]) => (
            <li key={path}>
              <code style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{path}</code>
              <span style={{ marginLeft: 8, color: "var(--text-secondary)" }}>— {label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ─────────────────────────── About ─────────────────────────── */
function AboutPane() {
  return (
    <div className="dlx-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">DataLex Visual Studio</h3>
        <p className="dlx-settings-pane-sub">Open-source data modeling workspace.</p>
      </header>
      <div className="dlx-about-card">
        <Row label="Frontend" value="React 18 · Vite · Tailwind 4" />
        <Row label="Canvas"   value="React Flow 12 · ELK.js" />
        <Row label="Editor"   value="CodeMirror 6" />
        <Row label="License"  value="Apache 2.0" />
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="dlx-about-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
