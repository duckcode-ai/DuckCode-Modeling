/* SettingsDialog — user-facing workspace settings.
   Ported to the shared `<Modal>` chrome with a Luna-aware sidebar, theme
   tiles (Midnight / Obsidian / Paper / Arctic), and consistent spacing.

   Theme changes are broadcast via a `datalex:theme-change` CustomEvent so
   the shell picks them up without either side knowing about the other. */
import React from "react";
import {
  Sun, Moon, Sparkles, Snowflake,
  Keyboard, Info, SlidersHorizontal, Plug, Check, Compass,
  Bot, KeyRound, RefreshCw, Save, BookOpen,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { THEMES } from "../../design/notation";
import { startOnboardingTour, resetOnboardingSeen } from "../../lib/onboardingTour";
import { resetJourney, emitJourneyEvent } from "../../lib/onboardingJourney";
import { testAiSettings, rebuildAiIndex } from "../../lib/api";
import Modal from "./Modal";

const TABS = [
  { id: "ai",          label: "AI Agent",    icon: Bot },
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
  const { closeModal, modalPayload } = useUiStore();
  const [active, setActive] = React.useState(modalPayload?.initialTab || "ai");
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
      subtitle="Configure provider access, appearance, shortcuts, and connections."
      size="xl"
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
          {active === "ai"          && <AiAgentPane />}
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

/* ─────────────────────────── AI Agent ─────────────────────────── */
function readStorage(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (_err) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    if (value == null || value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (_err) {
    // Browser storage can be unavailable in private profiles.
  }
}

function AiAgentPane() {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const closeModal = useUiStore((s) => s.closeModal);
  const [provider, setProvider] = React.useState(() => readStorage("datalex.ai.provider", "local"));
  const [model, setModel] = React.useState(() => readStorage("datalex.ai.model", ""));
  const [baseUrl, setBaseUrl] = React.useState(() => readStorage("datalex.ai.baseUrl", ""));
  const [apiKey, setApiKey] = React.useState(() => readStorage("datalex.ai.apiKey", ""));
  const [saveKey, setSaveKey] = React.useState(() => Boolean(readStorage("datalex.ai.apiKey", "")));
  const [status, setStatus] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const saveSettings = () => {
    writeStorage("datalex.ai.provider", provider);
    writeStorage("datalex.ai.model", model);
    writeStorage("datalex.ai.baseUrl", baseUrl);
    if (saveKey) writeStorage("datalex.ai.apiKey", apiKey);
    else writeStorage("datalex.ai.apiKey", "");
    setStatus(saveKey ? "Saved AI defaults in this browser." : "Saved AI defaults. API key remains session-only.");
    // Onboarding journey: counts as "configured" when the user has either
    // saved an API key or selected the local provider (which needs no key).
    const configured = (saveKey && apiKey.trim()) || provider === "local";
    if (configured) emitJourneyEvent("ai:settings:saved", { provider });
  };

  const testProvider = async () => {
    setBusy(true);
    setStatus("");
    try {
      saveSettings();
      const res = await testAiSettings({
        provider,
        model: model || undefined,
        baseUrl: baseUrl || undefined,
        apiKey: apiKey || undefined,
      });
      setStatus(res?.ok ? `Provider ready: ${res.provider || provider}` : "Provider test returned no status.");
    } catch (err) {
      setStatus(`Provider test failed: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const rebuildIndex = async () => {
    if (!activeProjectId) {
      setStatus("Open a project before rebuilding the AI index.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const res = await rebuildAiIndex(activeProjectId);
      setStatus(`Indexed ${res?.recordCount ?? res?.count ?? 0} modeling records, dbt facts, and skills.`);
    } catch (err) {
      setStatus(`Index rebuild failed: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dlx-settings-pane ai-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">AI Agent</h3>
        <p className="dlx-settings-pane-sub">
          Configure provider access and refresh the local modeling index. Skills now live in the left sidebar for faster authoring.
        </p>
      </header>

      <section className="ai-settings-card ai-provider-settings-card">
        <div className="ai-settings-card-title"><KeyRound size={13} /> Provider defaults</div>
        <div className="panel-form-grid">
          <label className="panel-form-row">
            <span className="panel-form-label">Provider</span>
            <select className="panel-select" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="local">Local search only</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="gemini">Google Gemini</option>
              <option value="ollama">Ollama</option>
            </select>
          </label>
          <label className="panel-form-row">
            <span className="panel-form-label">Model</span>
            <input className="panel-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="default or model id" />
          </label>
          <label className="panel-form-row">
            <span className="panel-form-label">Base URL</span>
            <input className="panel-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Ollama or gateway URL" />
          </label>
          <label className="panel-form-row">
            <span className="panel-form-label">API key</span>
            <input className="panel-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Prefer env vars for regular use" autoComplete="off" />
          </label>
        </div>
        <label className={`dlx-check ${saveKey ? "on" : ""}`}>
          <input type="checkbox" checked={saveKey} onChange={(e) => setSaveKey(e.target.checked)} />
          <span className="dlx-check-text">Save API key in this browser profile. Leave off to use only environment variables or one chat session.</span>
        </label>
        <div className="panel-btn-row">
          <button className="panel-btn primary" type="button" onClick={saveSettings} disabled={busy}>
            <Save size={12} /> Save defaults
          </button>
          <button className="panel-btn" type="button" onClick={testProvider} disabled={busy}>
            <Check size={12} /> Test provider
          </button>
          <button className="panel-btn" type="button" onClick={rebuildIndex} disabled={busy || !activeProjectId}>
            <RefreshCw size={12} /> Rebuild index
          </button>
        </div>
        <p className="dlx-settings-pane-sub">
          Environment variables also work: <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, <code>GEMINI_API_KEY</code>.
          Ollama defaults to localhost.
        </p>
      </section>

      <section className="ai-settings-card ai-settings-skills-link">
        <div>
          <div className="ai-settings-card-title"><BookOpen size={13} /> Skills moved to sidebar</div>
          <p className="dlx-settings-pane-sub">
            Create business, dbt, governance, and YAML patch skills from the new <code>Skills</code> tab in the left sidebar.
            Skills are still indexed automatically and selected by intent during agent runs.
          </p>
        </div>
        <button
          className="panel-btn primary"
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("datalex:left-tab", { detail: { tab: "SKILLS" } }));
            closeModal?.();
          }}
        >
          <BookOpen size={12} /> Open Skills
        </button>
      </section>

      {status && <div className="dlx-modal-alert info">{status}</div>}
    </div>
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
  const handleReplayJourney = () => {
    // Reset journey state and seen-flags, then reload so the Shell's
    // first-run effect re-mounts the journey panel from step 1.
    resetJourney();
    resetOnboardingSeen();
    onClose?.();
    setTimeout(() => {
      // A reload guarantees the journey re-mounts cleanly even if the
      // user previously dismissed it within this session.
      try { window.location.reload(); } catch { /* noop */ }
    }, 80);
  };
  const handleDeepTour = () => {
    onClose?.();
    // The 13-step driver.js spotlight tour — runs against the underlying
    // shell, so we let the modal close first.
    setTimeout(() => startOnboardingTour(), 120);
  };
  return (
    <div className="dlx-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">Onboarding</h3>
        <p className="dlx-settings-pane-sub">
          Replay the action-oriented six-step journey, or take the deep
          feature tour that spotlights every panel and dialog.
        </p>
      </header>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="panel-btn primary" onClick={handleReplayJourney}>
          <Compass size={12} /> Replay onboarding
        </button>
        <button
          type="button"
          className="panel-btn"
          onClick={handleDeepTour}
          title="Spotlight tour across the import, explorer, modeling, validation, and save flows"
        >
          Deep feature tour
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
        <Row label="License"  value="MIT" />
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
