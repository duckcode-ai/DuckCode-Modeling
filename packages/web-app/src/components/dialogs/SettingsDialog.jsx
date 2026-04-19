import React, { useState } from "react";
import {
  X,
  Sun,
  Moon,
  Monitor,
  Keyboard,
  Info,
  SlidersHorizontal,
  Plug,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";

/**
 * Consolidated Settings dialog. Sections are lightweight and mostly surface
 * existing store state — deeper tools (Editor / Canvas / Git / Keymap remap)
 * land in later phases.
 */
const TABS = [
  { id: "appearance", label: "Appearance", icon: SlidersHorizontal },
  { id: "keyboard", label: "Keyboard", icon: Keyboard },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "about", label: "About", icon: Info },
];

export default function SettingsDialog() {
  const { closeModal } = useUiStore();
  const [active, setActive] = useState("appearance");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={closeModal}
    >
      <div
        className="w-[760px] max-w-[94vw] h-[520px] max-h-[90vh] rounded-xl border border-border-primary bg-bg-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 border-b border-border-primary bg-bg-secondary shrink-0">
          <h2 className="t-subtitle text-text-primary">Settings</h2>
          <button onClick={closeModal} className="dl-toolbar-btn dl-toolbar-btn--ghost-icon" title="Close">
            <X size={14} />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <nav className="w-[180px] shrink-0 border-r border-border-primary bg-bg-secondary/50 py-2">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  active === id
                    ? "bg-bg-active text-text-accent font-medium"
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {active === "appearance" && <AppearancePane />}
            {active === "keyboard" && <KeyboardPane />}
            {active === "connections" && <ConnectionsPane />}
            {active === "about" && <AboutPane />}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppearancePane() {
  const { theme, toggleTheme } = useUiStore();
  const current = theme || "light";
  return (
    <div className="space-y-5">
      <header>
        <h3 className="t-title text-text-primary">Appearance</h3>
        <p className="t-caption text-text-muted">Theme and density for the workspace.</p>
      </header>

      <section>
        <div className="t-overline text-text-muted mb-2">Theme</div>
        <div className="grid grid-cols-3 gap-2 max-w-[420px]">
          <ThemeCard
            label="Light"
            icon={Sun}
            active={current === "light"}
            onClick={() => {
              if (current !== "light") toggleTheme();
            }}
          />
          <ThemeCard
            label="Dark"
            icon={Moon}
            active={current === "dark"}
            onClick={() => {
              if (current !== "dark") toggleTheme();
            }}
          />
          <ThemeCard label="System" icon={Monitor} disabled />
        </div>
      </section>

      <section>
        <div className="t-overline text-text-muted mb-2">Density</div>
        <p className="t-caption text-text-muted max-w-[420px]">
          Density tuning arrives in a later phase. Defaults currently favor a comfortable
          grid for modeling sessions.
        </p>
      </section>
    </div>
  );
}

function ThemeCard({ label, icon: Icon, active, disabled, onClick }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-2 px-3 py-4 rounded-lg border transition-all ${
        active
          ? "border-accent-blue bg-accent-blue-soft text-text-accent"
          : "border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <Icon size={18} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function KeyboardPane() {
  const shortcuts = [
    ["Save", "⌘S"],
    ["Global search", "⌘K"],
    ["Toggle sidebar", "⌘\\"],
    ["Toggle bottom panel", "⌘J"],
    ["Toggle dark mode", "⌘D"],
    ["Show shortcuts", "?"],
    ["Model activity", "⌘1"],
    ["Connect activity", "⌘2"],
    ["Settings activity", "⌘3"],
  ];
  return (
    <div className="space-y-4">
      <header>
        <h3 className="t-title text-text-primary">Keyboard shortcuts</h3>
        <p className="t-caption text-text-muted">Remapping lands in Phase E.</p>
      </header>
      <div className="rounded-lg border border-border-primary overflow-hidden">
        {shortcuts.map(([label, key]) => (
          <div
            key={label}
            className="flex items-center justify-between px-3 py-2 border-b border-border-primary/60 last:border-b-0"
          >
            <span className="text-sm text-text-secondary">{label}</span>
            <code className="px-2 py-0.5 rounded bg-bg-tertiary border border-border-subtle font-mono text-xs text-text-primary">
              {key}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectionsPane() {
  const { openModal } = useUiStore();
  return (
    <div className="space-y-4">
      <header>
        <h3 className="t-title text-text-primary">Connections</h3>
        <p className="t-caption text-text-muted">
          Manage warehouse credentials and schema imports.
        </p>
      </header>
      <button
        onClick={() => openModal("connectionsManager")}
        className="dl-toolbar-btn dl-toolbar-btn--primary"
      >
        <Plug size={14} />
        Open connections manager
      </button>
    </div>
  );
}

function AboutPane() {
  return (
    <div className="space-y-4">
      <header>
        <h3 className="t-title text-text-primary">DataLex Visual Studio</h3>
        <p className="t-caption text-text-muted">Open-source data modeling workspace.</p>
      </header>
      <div className="rounded-lg border border-border-primary p-3 space-y-2">
        <Row label="Frontend" value="React 18 · Vite · Tailwind 4" />
        <Row label="Canvas" value="React Flow 12 · ELK.js" />
        <Row label="Editor" value="CodeMirror 6" />
        <Row label="License" value="Apache 2.0" />
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}
