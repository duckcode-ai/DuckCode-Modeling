import { create } from "zustand";

/* ── Bottom-panel persistence ───────────────────────────────────────────
   A single localStorage blob keyed `datalex.bottomPanel` keeps the user's
   drawer preferences (open/closed, active tab, height, maximized) across
   reloads. Loaded once at store init; written on every mutation. */
const BOTTOM_STORAGE = "datalex.bottomPanel";
const DEFAULT_BOTTOM = {
  open: true,
  // Default to Validation so the first thing a user sees on open is
  // "what's broken / missing" rather than a structural panel. The Shell's
  // activeBottomTabs effect falls back to the first tab in the active
  // model-kind list when this id isn't present, which is also Validation
  // across LOGICAL / PHYSICAL / CONCEPTUAL.
  tab: "validation",
  height: 280,
  maximized: false,
};

function loadBottom() {
  try {
    const raw = localStorage.getItem(BOTTOM_STORAGE);
    if (!raw) return { ...DEFAULT_BOTTOM };
    const parsed = JSON.parse(raw);
    return {
      open:      typeof parsed.open === "boolean" ? parsed.open : DEFAULT_BOTTOM.open,
      tab:       typeof parsed.tab === "string" && parsed.tab ? parsed.tab : DEFAULT_BOTTOM.tab,
      height:    typeof parsed.height === "number" ? parsed.height : DEFAULT_BOTTOM.height,
      maximized: typeof parsed.maximized === "boolean" ? parsed.maximized : DEFAULT_BOTTOM.maximized,
    };
  } catch (_e) { return { ...DEFAULT_BOTTOM }; }
}

function saveBottom(state) {
  try {
    localStorage.setItem(BOTTOM_STORAGE, JSON.stringify({
      open:      state.bottomPanelOpen,
      tab:       state.bottomPanelTab,
      height:    state.bottomPanelHeight,
      maximized: state.bottomPanelMaximized,
    }));
  } catch (_e) { /* quota / private mode — ignore */ }
}

function clampHeight(h) {
  const max = typeof window !== "undefined" ? Math.max(240, window.innerHeight - 160) : 900;
  const min = 140;
  return Math.max(min, Math.min(max, Math.round(h)));
}

const initialBottom = loadBottom();

/* ── Shell-level persistence ───────────────────────────────────────────
   Separate blob for shell-wide preferences (view mode, right-panel tab).
   Kept in its own key so the bottom-panel blob stays focused. */
const SHELL_STORAGE = "datalex.shell";
const VALID_SHELL_VIEW_MODES = ["diagram", "docs", "table", "views", "enums"];
const DEFAULT_SHELL = { viewMode: "diagram", rightTab: "COLUMNS", rightWidth: 320 };
const RIGHT_PANEL_MIN = 280;
const RIGHT_PANEL_MAX_RESERVE = 400; // leave this much room for the rest of the shell

function clampRightWidth(w) {
  const n = Math.round(Number(w));
  if (!Number.isFinite(n)) return DEFAULT_SHELL.rightWidth;
  const max = typeof window !== "undefined"
    ? Math.max(RIGHT_PANEL_MIN + 40, window.innerWidth - RIGHT_PANEL_MAX_RESERVE)
    : 720;
  return Math.max(RIGHT_PANEL_MIN, Math.min(max, n));
}

function loadShell() {
  try {
    const raw = localStorage.getItem(SHELL_STORAGE);
    if (!raw) return { ...DEFAULT_SHELL };
    const parsed = JSON.parse(raw);
    const viewMode = VALID_SHELL_VIEW_MODES.includes(parsed.viewMode) ? parsed.viewMode : DEFAULT_SHELL.viewMode;
    const rightTab = typeof parsed.rightTab === "string" && parsed.rightTab ? parsed.rightTab : DEFAULT_SHELL.rightTab;
    const rightWidth = typeof parsed.rightWidth === "number" ? clampRightWidth(parsed.rightWidth) : DEFAULT_SHELL.rightWidth;
    return { viewMode, rightTab, rightWidth };
  } catch (_e) { return { ...DEFAULT_SHELL }; }
}

function saveShell(state) {
  try {
    localStorage.setItem(SHELL_STORAGE, JSON.stringify({
      viewMode: state.shellViewMode,
      rightTab: state.rightPanelTab,
      rightWidth: state.rightPanelWidth,
    }));
  } catch (_e) { /* ignore */ }
}

const initialShell = loadShell();
const ACTIVITY_CAP = 20; // rolling tail of activity entries shown in the bell popover

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
  bottomPanelOpen:      initialBottom.open,
  bottomPanelTab:       initialBottom.tab,    // "properties" | "validation" | "history" | …
  bottomPanelHeight:    initialBottom.height, // px, drag-resized via top edge strip
  bottomPanelMaximized: initialBottom.maximized,

  // ── Right panel (entity properties) ──
  rightPanelOpen: true,
  rightPanelTab: initialShell.rightTab, // "COLUMNS" | "RELATIONS" | "INDEXES" | "SQL" | "YAML"
  rightPanelWidth: initialShell.rightWidth, // px; persisted across reloads
  aiPanelPayload: null,
  aiReviewDocument: null,

  // ── Shell view mode (swaps the main canvas surface) ──
  shellViewMode: initialShell.viewMode, // "diagram" | "table" | "views" | "enums"

  // ── Activity feed (bell popover) ──
  // Rolling list of recent notable events (toasts, saves, commits). Separate
  // from `toasts` which auto-dismiss in 4s; these persist for the session.
  activityFeed: [],
  unreadActivity: 0,

  // ── Unified selection (drives the Right Inspector) ──
  // `kind`: "entity" | "column" | "relationship" | "enum" | "subject_area" | "diagram" | null
  // `entityName` is set for entity + column contexts; `fieldName` for columns; `relId` for rels.
  selection: { kind: null, entityName: null, fieldName: null, relId: null },

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
  pendingConnectionId: null,

  // ── Pending search query (ViewerWelcome → GlobalSearchPanel handoff) ──
  pendingSearchQuery: "",

  // ── Git-diff canvas overlay (v0.4.2) ──
  // When `diffVsRef` is a branch name, `diffState.entities` holds a
  // { [entityName]: "added" | "modified" | "removed" } map driven by the
  // `/api/git/diff-files` endpoint, mapped through `workspace.projectFiles`
  // to turn file paths into entity names. `diffLoading` gates the TopBar
  // toggle spinner; `diffError` surfaces refresh failures inline.
  diffVsRef: null,
  diffState: { entities: {}, files: { added: [], modified: [], removed: [] } },
  diffLoading: false,
  diffError: null,

  // ── Actions ──
  setActiveActivity: (activity) => set({ activeActivity: activity }),
  setPendingConnectorType: (type) => set({ pendingConnectorType: type }),
  setPendingConnectionId: (id) => set({ pendingConnectionId: id }),
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

  toggleBottomPanel: () => {
    set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen }));
    saveBottom(get());
  },
  setBottomPanelOpen: (open) => {
    set({ bottomPanelOpen: !!open });
    saveBottom(get());
  },
  setBottomPanelTab: (tab) => {
    set({ bottomPanelTab: tab, bottomPanelOpen: true });
    saveBottom(get());
  },
  setBottomPanelHeight: (h) => {
    set({ bottomPanelHeight: clampHeight(h) });
    saveBottom(get());
  },
  toggleBottomPanelMax: () => {
    set((s) => ({ bottomPanelMaximized: !s.bottomPanelMaximized }));
    saveBottom(get());
  },
  setBottomPanelMaximized: (v) => {
    set({ bottomPanelMaximized: !!v });
    saveBottom(get());
  },

  setSelection: (next) =>
    set({
      selection: {
        kind: next?.kind ?? null,
        entityName: next?.entityName ?? null,
        fieldName: next?.fieldName ?? null,
        relId: next?.relId ?? null,
      },
    }),
  clearSelection: () =>
    set({ selection: { kind: null, entityName: null, fieldName: null, relId: null } }),

  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleDiagramFullscreen: () => set((s) => ({ diagramFullscreen: !s.diagramFullscreen })),
  setDiagramFullscreen: (open) => set({ diagramFullscreen: open }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setRightPanelTab: (tab) => {
    set({ rightPanelTab: tab });
    saveShell(get());
  },
  openAiPanel: (payload = null) => {
    set({ rightPanelOpen: true, rightPanelTab: "AI", aiPanelPayload: payload });
    saveShell(get());
  },
  setAiPanelPayload: (payload = null) => set({ aiPanelPayload: payload }),
  openAiReviewDocument: (document = null) => set({ aiReviewDocument: document }),
  closeAiReviewDocument: () => set({ aiReviewDocument: null }),
  setRightPanelWidth: (w) => {
    set({ rightPanelWidth: clampRightWidth(w) });
    saveShell(get());
  },

  setShellViewMode: (mode) => {
    if (!VALID_SHELL_VIEW_MODES.includes(mode)) return;
    set({ shellViewMode: mode });
    saveShell(get());
  },

  pushActivity: (entry) => {
    const stamped = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: entry?.type || "info",
      message: entry?.message || "",
      createdAt: Date.now(),
      ...entry,
    };
    set((s) => ({
      activityFeed: [stamped, ...s.activityFeed].slice(0, ACTIVITY_CAP),
      unreadActivity: s.unreadActivity + 1,
    }));
  },
  markActivityRead: () => set({ unreadActivity: 0 }),
  clearActivity: () => set({ activityFeed: [], unreadActivity: 0 }),

  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  openModal: (modal, payload = null) => set({ activeModal: modal, modalPayload: payload }),
  closeModal: () => set({ activeModal: null, modalPayload: null }),

  addToast: (toast) => {
    const id = `toast_${Date.now()}`;
    const entry = { id, ...toast };
    set((s) => {
      // Mirror the toast into the rolling activity feed so the bell popover
      // retains it after the toast auto-dismisses. Skip "info" spam if the
      // caller opts out via { activity: false }.
      const shouldLogActivity = toast?.activity !== false && toast?.message;
      const activityEntry = shouldLogActivity ? {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: toast.type || "info",
        message: toast.message,
        createdAt: Date.now(),
      } : null;
      return {
        toasts: [...s.toasts, entry],
        activityFeed: activityEntry ? [activityEntry, ...s.activityFeed].slice(0, ACTIVITY_CAP) : s.activityFeed,
        unreadActivity: activityEntry ? s.unreadActivity + 1 : s.unreadActivity,
      };
    });
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, toast.duration || 4000);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  // ── Git-diff overlay actions (v0.4.2) ──
  // Callers pass the live `projectFiles` tree so the store can map file
  // paths back to entity names without importing workspaceStore here (that
  // would invert the dependency direction).
  setDiffVsRef: async (ref, { projectId, projectFiles } = {}) => {
    if (!ref) {
      set({
        diffVsRef: null,
        diffState: { entities: {}, files: { added: [], modified: [], removed: [] } },
        diffError: null,
        diffLoading: false,
      });
      return;
    }
    if (!projectId) {
      set({ diffError: "No active project for diff", diffVsRef: null });
      return;
    }
    set({ diffVsRef: ref, diffLoading: true, diffError: null });
    try {
      const q = new URLSearchParams({ projectId, ref });
      const resp = await fetch(`/api/git/diff-files?${q.toString()}`);
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      // Walk the projectFiles tree once and build a path→entityName map.
      // Entity names live on `node.yamlData.entities[0].name` for the
      // dbt-model shape and `node.yamlData.name` for single-entity docs.
      const pathToEntity = {};
      const walk = (nodes) => {
        for (const n of nodes || []) {
          if (n.type === "file" && n.path) {
            const y = n.yamlData || {};
            const ents = Array.isArray(y.entities) ? y.entities : [];
            const names = ents.map((e) => e?.name).filter(Boolean);
            if (typeof y.name === "string" && y.name && (y.kind === "model" || names.length === 0)) {
              names.push(y.name);
            }
            for (const nm of names) pathToEntity[n.path] = nm;
          }
          if (n.children) walk(n.children);
        }
      };
      walk(projectFiles || []);

      const entities = {};
      const applyStatus = (paths, status) => {
        for (const p of paths || []) {
          const name = pathToEntity[p];
          if (!name) continue;
          // Preserve strongest signal: added > removed > modified.
          const prev = entities[name];
          if (prev === "added") continue;
          if (status === "added") entities[name] = "added";
          else if (status === "removed" && prev !== "added") entities[name] = "removed";
          else if (status === "modified" && !prev) entities[name] = "modified";
        }
      };
      applyStatus(data.added, "added");
      applyStatus(data.removed, "removed");
      applyStatus(data.modified, "modified");

      set({
        diffLoading: false,
        diffError: null,
        diffState: {
          entities,
          files: {
            added: data.added || [],
            modified: data.modified || [],
            removed: data.removed || [],
          },
        },
      });
    } catch (err) {
      set({
        diffLoading: false,
        diffError: String(err?.message || err),
        diffState: { entities: {}, files: { added: [], modified: [], removed: [] } },
      });
    }
  },

  clearDiff: () => set({
    diffVsRef: null,
    diffState: { entities: {}, files: { added: [], modified: [], removed: [] } },
    diffError: null,
    diffLoading: false,
  }),
}));

export default useUiStore;
