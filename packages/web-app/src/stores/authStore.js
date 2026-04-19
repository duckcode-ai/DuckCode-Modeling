import { create } from "zustand";

// Auth is a no-op stub. The product ships as admin-only — every consumer
// still calls `canEdit()` / `isAuthenticated` / etc., so we keep the shape
// but always return admin=true.
const useAuthStore = create(() => ({
  user: { username: "admin", role: "admin" },
  token: null,
  isAuthenticated: true,
  isLoading: false,

  restoreSession: async () => {},
  login: async () => {},
  logout: async () => {},

  isAdmin:  () => true,
  isViewer: () => false,
  canEdit:  () => true,
}));

export default useAuthStore;
