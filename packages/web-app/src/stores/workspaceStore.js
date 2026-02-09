import { create } from "zustand";
import {
  fetchProjects,
  addProject,
  removeProject,
  fetchProjectFiles,
  fetchFileContent,
  saveFileContent,
  createProjectFile,
} from "../lib/api";
import { SAMPLE_MODEL } from "../sampleModel";

const useWorkspaceStore = create((set, get) => ({
  // Projects
  projects: [],
  activeProjectId: null,
  projectFiles: [],
  projectPath: "",

  // Active document
  activeFile: null,
  activeFileContent: "",
  originalContent: "",
  isDirty: false,

  // Baseline for diff
  baselineFile: null,
  baselineContent: "",

  // All open file tabs
  openTabs: [],

  // Loading states
  loading: false,
  error: null,

  // Offline / fallback mode (no API server)
  offlineMode: false,
  localDocuments: [],

  // --- Project actions ---
  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await fetchProjects();
      set({ projects, loading: false, offlineMode: false });
      // Auto-select first project if none active
      if (projects.length > 0 && !get().activeProjectId) {
        await get().selectProject(projects[0].id);
      }
    } catch (err) {
      console.warn("[workspace] API unavailable, entering offline mode:", err.message);
      set({ loading: false, offlineMode: true });
      get().initOfflineMode();
    }
  },

  initOfflineMode: () => {
    const stored = localStorage.getItem("dm_offline_docs");
    let docs;
    try {
      docs = stored ? JSON.parse(stored) : null;
    } catch (_e) {
      docs = null;
    }
    if (!docs || docs.length === 0) {
      docs = [
        { id: "sample", name: "starter-commerce.model.yaml", content: SAMPLE_MODEL },
      ];
    }
    set({
      localDocuments: docs,
      activeFile: docs[0],
      activeFileContent: docs[0].content,
      originalContent: docs[0].content,
      isDirty: false,
      openTabs: [docs[0]],
    });
  },

  saveOfflineDocs: () => {
    const { localDocuments } = get();
    localStorage.setItem("dm_offline_docs", JSON.stringify(localDocuments));
  },

  addProjectFolder: async (name, path) => {
    set({ loading: true, error: null });
    try {
      const project = await addProject(name, path);
      set((s) => ({ projects: [...s.projects, project], loading: false }));
      await get().selectProject(project.id);
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  removeProjectFolder: async (id) => {
    try {
      await removeProject(id);
      set((s) => {
        const projects = s.projects.filter((p) => p.id !== id);
        const newState = { projects };
        if (s.activeProjectId === id) {
          newState.activeProjectId = projects[0]?.id || null;
          newState.projectFiles = [];
          newState.activeFile = null;
          newState.activeFileContent = "";
          newState.openTabs = [];
        }
        return newState;
      });
      const { activeProjectId } = get();
      if (activeProjectId) {
        await get().selectProject(activeProjectId);
      }
    } catch (err) {
      set({ error: err.message });
    }
  },

  selectProject: async (projectId) => {
    set({ activeProjectId: projectId, loading: true, error: null });
    try {
      const data = await fetchProjectFiles(projectId);
      set({
        projectFiles: data.files || [],
        projectPath: data.projectPath || "",
        loading: false,
      });
      // Auto-open first file
      const files = data.files || [];
      if (files.length > 0 && !get().activeFile) {
        await get().openFile(files[0]);
      }
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  // --- File actions ---
  openFile: async (fileInfo) => {
    set({ loading: true, error: null });
    try {
      const data = await fetchFileContent(fileInfo.fullPath);
      const file = { ...fileInfo, content: data.content };
      set((s) => {
        const alreadyOpen = s.openTabs.some((t) => t.fullPath === file.fullPath);
        return {
          activeFile: file,
          activeFileContent: data.content,
          originalContent: data.content,
          isDirty: false,
          openTabs: alreadyOpen ? s.openTabs : [...s.openTabs, file],
          loading: false,
        };
      });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  switchTab: async (fileInfo) => {
    if (get().offlineMode) {
      const doc = get().localDocuments.find((d) => d.id === fileInfo.id);
      if (doc) {
        set({
          activeFile: doc,
          activeFileContent: doc.content,
          originalContent: doc.content,
          isDirty: false,
        });
      }
      return;
    }
    await get().openFile(fileInfo);
  },

  closeTab: (fileInfo) => {
    set((s) => {
      const key = s.offlineMode ? "id" : "fullPath";
      const tabs = s.openTabs.filter((t) => t[key] !== fileInfo[key]);
      const newState = { openTabs: tabs };
      if (s.activeFile && s.activeFile[key] === fileInfo[key]) {
        if (tabs.length > 0) {
          newState.activeFile = tabs[tabs.length - 1];
          newState.activeFileContent = tabs[tabs.length - 1].content || "";
          newState.originalContent = tabs[tabs.length - 1].content || "";
          newState.isDirty = false;
        } else {
          newState.activeFile = null;
          newState.activeFileContent = "";
          newState.originalContent = "";
          newState.isDirty = false;
        }
      }
      return newState;
    });
  },

  updateContent: (content) => {
    const { originalContent, offlineMode, activeFile, localDocuments } = get();
    set({ activeFileContent: content, isDirty: content !== originalContent });

    if (offlineMode && activeFile) {
      const updated = localDocuments.map((d) =>
        d.id === activeFile.id ? { ...d, content } : d
      );
      set({ localDocuments: updated });
      get().saveOfflineDocs();
    }
  },

  saveCurrentFile: async () => {
    const { activeFile, activeFileContent, offlineMode } = get();
    if (!activeFile) return;

    if (offlineMode) {
      set({ originalContent: activeFileContent, isDirty: false });
      get().saveOfflineDocs();
      return;
    }

    set({ loading: true, error: null });
    try {
      await saveFileContent(activeFile.fullPath, activeFileContent);
      set({
        originalContent: activeFileContent,
        isDirty: false,
        loading: false,
      });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  createNewFile: async (name, content = "") => {
    const { activeProjectId, offlineMode, localDocuments } = get();

    if (offlineMode) {
      const doc = {
        id: `doc_${Date.now()}`,
        name,
        content: content || SAMPLE_MODEL,
      };
      const updated = [...localDocuments, doc];
      set({
        localDocuments: updated,
        activeFile: doc,
        activeFileContent: doc.content,
        originalContent: doc.content,
        isDirty: false,
        openTabs: [...get().openTabs, doc],
      });
      get().saveOfflineDocs();
      return;
    }

    if (!activeProjectId) return;
    set({ loading: true, error: null });
    try {
      const file = await createProjectFile(activeProjectId, name, content || SAMPLE_MODEL);
      await get().selectProject(activeProjectId);
      if (file.fullPath) {
        await get().openFile(file);
      }
      set({ loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  setBaselineFile: (fileInfo) => {
    set({ baselineFile: fileInfo, baselineContent: fileInfo?.content || "" });
  },

  setBaselineContent: (content) => {
    set({ baselineContent: content });
  },

  clearError: () => set({ error: null }),
}));

export default useWorkspaceStore;
