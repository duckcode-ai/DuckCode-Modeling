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
  FileCode,
  LayoutGrid,
  GitBranch,
  RotateCcw,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";

/**
 * Consolidated Settings dialog. Sections read + write to uiStore.userSettings,
 * which is mirrored to localStorage so preferences persist across sessions.
 */
const TABS = [
  { id: "appearance", label: "Appearance", icon: SlidersHorizontal },
  { id: "editor", label: "Editor", icon: FileCode },
  { id: "canvas", label: "Canvas", icon: LayoutGrid },
  { id: "git", label: "Git", icon: GitBranch },
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
        className="w-[760px] max-w-[94vw] h-[560px] max-h-[90vh] rounded-xl border border-border-primary bg-bg-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-border-primary bg-bg-secondary shrink-0">
          <h2 className="t-subtitle text-text-primary">Settings</h2>
          <button onClick={closeModal} className="dl-toolbar-btn dl-toolbar-btn--ghost-icon" title="Close">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
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

          <div className="flex-1 overflow-y-auto p-5">
            {active === "appearance" && <AppearancePane />}
            {active === "editor" && <EditorPane />}
            {active === "canvas" && <CanvasPane />}
            {active === "git" && <GitPane />}
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
  const { theme, toggleTheme, resetUserSettings } = useUiStore();
  const current = theme || "dark";
  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between">
        <div>
          <h3 className="t-title text-text-primary">Appearance</h3>
          <p className="t-caption text-text-muted">Theme and density for the workspace.</p>
        </div>
        <button
          onClick={() => {
            if (window.confirm("Reset all settings to defaults?")) resetUserSettings();
          }}
          className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1"
          title="Reset all settings"
        >
          <RotateCcw size={12} /> Reset
        </button>
      </header>

      <section>
        <div className="t-overline text-text-muted mb-2">Theme</div>
        <div className="grid grid-cols-3 gap-2 max-w-[420px]">
          <ThemeCard label="Light" icon={Sun} active={current === "light"} onClick={() => current !== "light" && toggleTheme()} />
          <ThemeCard label="Dark" icon={Moon} active={current === "dark"} onClick={() => current !== "dark" && toggleTheme()} />
          <ThemeCard label="System" icon={Monitor} disabled />
        </div>
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

function EditorPane() {
  const { userSettings, updateUserSetting } = useUiStore();
  const editor = userSettings.editor;
  return (
    <div className="space-y-5">
      <header>
        <h3 className="t-title text-text-primary">Editor</h3>
        <p className="t-caption text-text-muted">YAML editor behavior.</p>
      </header>

      <ToggleRow
        label="Word wrap"
        hint="Wrap long lines to the next row instead of scrolling horizontally."
        checked={editor.wordWrap}
        onChange={(v) => updateUserSetting("editor", "wordWrap", v)}
      />

      <SelectRow
        label="Tab width"
        hint="Number of spaces inserted for a tab."
        value={String(editor.tabWidth)}
        onChange={(v) => updateUserSetting("editor", "tabWidth", parseInt(v, 10))}
        options={[
          { value: "2", label: "2 spaces" },
          { value: "4", label: "4 spaces" },
        ]}
      />
    </div>
  );
}

function CanvasPane() {
  const { userSettings, updateUserSetting } = useUiStore();
  const canvas = userSettings.canvas;
  return (
    <div className="space-y-5">
      <header>
        <h3 className="t-title text-text-primary">Canvas</h3>
        <p className="t-caption text-text-muted">Diagram rendering and interaction.</p>
      </header>

      <SelectRow
        label="Relationship style"
        hint="Edge routing between entity nodes."
        value={canvas.edgeType}
        onChange={(v) => updateUserSetting("canvas", "edgeType", v)}
        options={[
          { value: "smoothstep", label: "Smooth step" },
          { value: "step", label: "Step" },
          { value: "straight", label: "Straight" },
          { value: "bezier", label: "Bezier" },
        ]}
      />

      <ToggleRow
        label="Show minimap"
        hint="Display the mini overview in the bottom-right corner."
        checked={canvas.showMinimap}
        onChange={(v) => updateUserSetting("canvas", "showMinimap", v)}
      />

      <ToggleRow
        label="Snap to grid"
        hint="Align nodes to a 16-px grid while dragging."
        checked={canvas.snapToGrid}
        onChange={(v) => updateUserSetting("canvas", "snapToGrid", v)}
      />
    </div>
  );
}

function GitPane() {
  const { userSettings, updateUserSetting } = useUiStore();
  const git = userSettings.git;
  return (
    <div className="space-y-5">
      <header>
        <h3 className="t-title text-text-primary">Git</h3>
        <p className="t-caption text-text-muted">Defaults for commits and branches.</p>
      </header>

      <TextRow
        label="Default branch"
        hint="Used when a new repository is initialized."
        value={git.defaultBranch}
        onChange={(v) => updateUserSetting("git", "defaultBranch", v)}
        placeholder="main"
      />

      <TextareaRow
        label="Commit template"
        hint="Pre-filled text for the commit message in the Commit dialog."
        value={git.commitTemplate}
        onChange={(v) => updateUserSetting("git", "commitTemplate", v)}
        placeholder="chore: update model"
      />
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 max-w-[520px]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary font-medium">{label}</div>
        {hint && <div className="t-caption text-text-muted mt-0.5">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${
          checked ? "bg-accent-blue" : "bg-bg-tertiary"
        }`}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function SelectRow({ label, hint, value, onChange, options }) {
  return (
    <div className="flex items-start justify-between gap-4 max-w-[520px]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary font-medium">{label}</div>
        {hint && <div className="t-caption text-text-muted mt-0.5">{hint}</div>}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 px-2 rounded-md border border-border-primary bg-bg-primary text-sm text-text-primary outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/20 shrink-0 min-w-[140px]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextRow({ label, hint, value, onChange, placeholder }) {
  return (
    <div className="flex items-start justify-between gap-4 max-w-[520px]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary font-medium">{label}</div>
        {hint && <div className="t-caption text-text-muted mt-0.5">{hint}</div>}
      </div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 px-2 rounded-md border border-border-primary bg-bg-primary text-sm text-text-primary outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/20 shrink-0 w-[200px]"
      />
    </div>
  );
}

function TextareaRow({ label, hint, value, onChange, placeholder }) {
  return (
    <div className="max-w-[520px] space-y-2">
      <div>
        <div className="text-sm text-text-primary font-medium">{label}</div>
        {hint && <div className="t-caption text-text-muted mt-0.5">{hint}</div>}
      </div>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full px-2 py-1.5 rounded-md border border-border-primary bg-bg-primary text-sm text-text-primary outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/20 font-mono"
      />
    </div>
  );
}

function KeyboardPane() {
  const shortcuts = [
    ["Save", "⌘S"],
    ["Command palette", "⌘K"],
    ["Toggle sidebar", "⌘\\"],
    ["Toggle bottom panel", "⌘J"],
    ["Toggle dark mode", "⌘D"],
    ["Cycle projects", "⌘Tab"],
    ["Close project tab", "⌘W"],
    ["Fit diagram", "⇧F"],
    ["Show shortcuts", "?"],
  ];
  return (
    <div className="space-y-4">
      <header>
        <h3 className="t-title text-text-primary">Keyboard shortcuts</h3>
        <p className="t-caption text-text-muted">Remapping lands in a later phase.</p>
      </header>
      <div className="rounded-lg border border-border-primary overflow-hidden max-w-[520px]">
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
      <div className="rounded-lg border border-border-primary p-3 space-y-2 max-w-[520px]">
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
