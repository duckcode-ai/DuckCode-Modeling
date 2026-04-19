import { create } from "zustand";

const SETTINGS_KEY = "dm_user_settings";
const DEFAULT_SETTINGS = {
  editor: { wordWrap: true, tabWidth: 2 },
  canvas: { edgeType: "smoothstep", showMinimap: true, snapToGrid: false },
  git: { defaultBranch: "main", commitTemplate: "" },
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      editor: { ...DEFAULT_SETTINGS.editor, ...(parsed.editor || {}) },
      canvas: { ...DEFAULT_SETTINGS.canvas, ...(parsed.canvas || {}) },
      git: { ...DEFAULT_SETTINGS.git, ...(parsed.git || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota errors */
  }
}

const useUiStore = create((set, get) => ({
  // ── Activity bar (left icon rail) ──
  // Primary activity determines what shows in the side panel AND the main content area
  activeActivity: "search", // "model" | "connect" | "validate" | "explore" | "search" | "settings"

  // ── Side panel ──
  sidePanelOpen: false,
  sidePanelWidth: 260,

  // ── Legacy aliases (keep for backward compat during migration) ──
  get sidebarOpen() { return get().sidePanelOpen; },
  get activeView() { return get().activeActivity; },

  // ── Theme ──
  theme: localStorage.getItem("dm_theme") || "dark",

  // ── Bottom panel (slimmed: only contextual panels) ──
  bottomPanelOpen: true,
  bottomPanelTab: "validation", // "validation" | "diff" | "impact"

  // ── YAML editor pane (hidden by default; toggle via Code icon) ──
  yamlPanelOpen: false,

  // ── Right panel (entity properties) — auto-driven by selection, user can force-close ──
  rightPanelOpen: false,

  // ── Unified selection (drives the Right Inspector) ──
  // `kind`: "entity" | "column" | "relationship" | "enum" | "subject_area" | "diagram" | null
  // `entityName` is set for entity + column contexts; `fieldName` for columns; `relId` for rels.
  selection: { kind: null, entityName: null, fieldName: null, relId: null, enumName: null },

  // ── Diagram fullscreen ──
  diagramFullscreen: false,

  // ── Command palette ──
  commandPaletteOpen: false,

  // ── Modals ──
  activeModal: null,
  modalPayload: null,

  // ── Notifications ──
  toasts: [],

  // ── Connector deep-link (sidebar → ConnectorsPanel pre-selection) ──
  pendingConnectorType: null,

  // ── Pending search query (ViewerWelcome → GlobalSearchPanel handoff) ──
  pendingSearchQuery: "",

  // ── User-level settings (persisted to localStorage) ──
  userSettings: loadSettings(),

  // ── Actions ──
  setActiveActivity: (activity) => set({ activeActivity: activity }),
  setPendingConnectorType: (type) => set({ pendingConnectorType: type }),
  setPendingSearchQuery: (q) => set({ pendingSearchQuery: q }),

  toggleTheme: () => set((s) => {
    const next = s.theme === "light" ? "dark" : "light";
    localStorage.setItem("dm_theme", next);
    document.documentElement.setAttribute("data-theme", next);
    return { theme: next };
  }),

  toggleSidebar: () => set((s) => ({ sidePanelOpen: !s.sidePanelOpen })),
  setSidebarOpen: (open) => set({ sidePanelOpen: open }),
  setSidePanelOpen: (open) => set({ sidePanelOpen: open }),

  // Legacy alias
  setActiveView: (view) => set({ activeActivity: view }),

  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab, bottomPanelOpen: true }),

  setSelection: (next) =>
    set({
      selection: {
        kind: next?.kind ?? null,
        entityName: next?.entityName ?? null,
        fieldName: next?.fieldName ?? null,
        relId: next?.relId ?? null,
        enumName: next?.enumName ?? null,
      },
    }),
  clearSelection: () =>
    set({ selection: { kind: null, entityName: null, fieldName: null, relId: null, enumName: null } }),

  toggleYamlPanel: () => set((s) => ({ yamlPanelOpen: !s.yamlPanelOpen })),
  setYamlPanelOpen: (open) => set({ yamlPanelOpen: open }),

  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleDiagramFullscreen: () => set((s) => ({ diagramFullscreen: !s.diagramFullscreen })),
  setDiagramFullscreen: (open) => set({ diagramFullscreen: open }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),

  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  updateUserSetting: (section, key, value) =>
    set((s) => {
      const next = {
        ...s.userSettings,
        [section]: { ...(s.userSettings[section] || {}), [key]: value },
      };
      persistSettings(next);
      return { userSettings: next };
    }),
  resetUserSettings: () => {
    persistSettings(DEFAULT_SETTINGS);
    set({ userSettings: DEFAULT_SETTINGS });
  },

  openModal: (modal, payload = null) => set({ activeModal: modal, modalPayload: payload }),
  closeModal: () => set({ activeModal: null, modalPayload: null }),

  addToast: (toast) => {
    const id = `toast_${Date.now()}`;
    const entry = { id, ...toast };
    set((s) => ({ toasts: [...s.toasts, entry] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, toast.duration || 4000);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export default useUiStore;
