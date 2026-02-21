import { create } from "zustand";
import useWorkspaceStore from "./workspaceStore";
import useDiagramStore from "./diagramStore";

const API_BASE = "";

const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  restoreSession: async () => {
    const token = localStorage.getItem("dm_token");
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { "x-dm-token": token },
      });
      if (res.ok) {
        const { user } = await res.json();
        set({ user, token, isAuthenticated: true, isLoading: false });
      } else {
        localStorage.removeItem("dm_token");
        set({ isLoading: false });
      }
    } catch (_) {
      set({ isLoading: false });
    }
  },

  login: async (username, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Login failed");
    }
    const { token, user } = await res.json();
    localStorage.setItem("dm_token", token);
    set({ user, token, isAuthenticated: true });
  },

  logout: async () => {
    const token = get().token;
    if (token) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "x-dm-token": token },
      }).catch(() => {});
    }
    localStorage.removeItem("dm_token");
    // Reset workspace and diagram state so re-login gets a clean slate
    useWorkspaceStore.setState({
      projects: [],
      activeProjectId: null,
      projectFiles: [],
      activeFile: null,
      activeFileContent: "",
      openTabs: [],
      isDirty: false,
      offlineMode: false,
    });
    useDiagramStore.setState({
      model: null,
      selectedEntityId: null,
      selectedEntity: null,
      centerEntityId: null,
    });
    set({ user: null, token: null, isAuthenticated: false });
  },

  isAdmin:  () => get().user?.role === "admin",
  isViewer: () => get().user?.role === "viewer",
  canEdit:  () => get().user?.role === "admin",
}));

export default useAuthStore;
