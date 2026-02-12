import { create } from "zustand";

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
  theme: localStorage.getItem("dm_theme") || "light",

  // ── Bottom panel (slimmed: only contextual panels) ──
  bottomPanelOpen: true,
  bottomPanelTab: "properties", // "properties" | "validation" | "history"

  // ── Right panel (entity properties) ──
  rightPanelOpen: false,

  // ── Diagram fullscreen ──
  diagramFullscreen: false,

  // ── Command palette ──
  commandPaletteOpen: false,

  // ── Modals ──
  activeModal: null,
  modalPayload: null,

  // ── Notifications ──
  toasts: [],

  // ── Actions ──
  setActiveActivity: (activity) => set({ activeActivity: activity }),

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

  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleDiagramFullscreen: () => set((s) => ({ diagramFullscreen: !s.diagramFullscreen })),
  setDiagramFullscreen: (open) => set({ diagramFullscreen: open }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),

  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

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
