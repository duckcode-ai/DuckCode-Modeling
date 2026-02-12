import { create } from "zustand";
import yaml from "js-yaml";
import {
  fetchProjects,
  addProject,
  updateProject,
  removeProject,
  fetchProjectFiles,
  fetchFileContent,
  saveFileContent,
  createProjectFile,
  moveProjectFile,
  importSchemaContent,
} from "../lib/api";
import { SAMPLE_MODEL } from "../sampleModel";
import { normalizeImportedModelFileName } from "../lib/importModelName";

function parseYamlObjectSafe(text) {
  try {
    const doc = yaml.load(text);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    return doc;
  } catch (_err) {
    return null;
  }
}

function isLikelyDbtSchema(text, sourceName = "") {
  const doc = parseYamlObjectSafe(text);
  if (!doc) return false;
  const hasDbtSections = Array.isArray(doc.models) || Array.isArray(doc.sources);
  if (!hasDbtSections) return false;
  const version = String(doc.version ?? "").trim();
  const looksLikeSchemaFile = /(^|\/)schema\.ya?ml$/i.test(String(sourceName || ""));
  return version === "2" || version === "2.0" || looksLikeSchemaFile;
}

function deriveModelNameFromPath(pathOrName) {
  const raw = String(pathOrName || "imported_model").replace(/\.ya?ml$/i, "");
  const normalizedPath = raw.replace(/\\/g, "/");
  const parts = normalizedPath.split("/").filter(Boolean);

  // Common dbt pattern: <folder>/schema.yml -> use folder name for model stem.
  if (parts.length >= 2 && /^schema$/i.test(parts[parts.length - 1])) {
    const folder = parts[parts.length - 2];
    if (folder) {
      return `${folder.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}_dbt`;
    }
  }

  const cleaned = normalizedPath
    .replace(/[^a-zA-Z0-9/]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/\//g, "_")
    .toLowerCase();
  return cleaned || "imported_model";
}

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

  loadImportedYaml: async (name, yamlContent) => {
    const fileName = name.endsWith(".model.yaml") ? name : `${name}.model.yaml`;
    const { offlineMode, localDocuments, projectPath, activeProjectId } = get();

    // Online mode with an active project: save to disk and open from project
    if (!offlineMode && projectPath && activeProjectId) {
      try {
        const fullPath = `${projectPath}/${fileName}`;
        await saveFileContent(fullPath, yamlContent);
        // Refresh project file list
        const data = await fetchProjectFiles(activeProjectId);
        set({ projectFiles: data.files || [] });
        // Find the saved file and open it
        const savedFile = (data.files || []).find((f) => f.name === fileName);
        if (savedFile) {
          const file = { ...savedFile, content: yamlContent };
          set((s) => ({
            activeFile: file,
            activeFileContent: yamlContent,
            originalContent: yamlContent,
            isDirty: false,
            openTabs: [...s.openTabs.filter((t) => t.fullPath !== fullPath), file],
          }));
        }
        return;
      } catch (err) {
        console.warn("[workspace] Failed to save imported model to disk:", err.message);
        // Fall through to in-memory tab
      }
    }

    // Offline or fallback: in-memory tab only
    const doc = {
      id: `imported-${Date.now()}`,
      name: fileName,
      content: yamlContent,
    };
    if (offlineMode) {
      const updated = [...localDocuments, doc];
      set({
        localDocuments: updated,
        activeFile: doc,
        activeFileContent: yamlContent,
        originalContent: yamlContent,
        isDirty: false,
        openTabs: [...get().openTabs.filter((t) => t.id !== doc.id), doc],
      });
      localStorage.setItem("dm_offline_docs", JSON.stringify(updated));
    } else {
      set({
        activeFile: doc,
        activeFileContent: yamlContent,
        originalContent: yamlContent,
        isDirty: false,
        openTabs: [...get().openTabs.filter((t) => t.id !== doc.id), doc],
      });
    }
  },

  loadMultipleImportedYaml: async (files) => {
    if (!files || files.length === 0) return;
    const { offlineMode, localDocuments, openTabs, projectPath, activeProjectId } = get();

    // Online mode with an active project: save all files to disk
    if (!offlineMode && projectPath && activeProjectId) {
      try {
        for (const f of files) {
          const fileName = f.name.endsWith(".model.yaml") ? f.name : `${f.name}.model.yaml`;
          const fullPath = `${projectPath}/${fileName}`;
          await saveFileContent(fullPath, f.yaml);
        }
        // Refresh project file list
        const data = await fetchProjectFiles(activeProjectId);
        set({ projectFiles: data.files || [] });
        // Open saved files as tabs
        const savedFiles = (data.files || []).filter((df) =>
          files.some((f) => {
            const fn = f.name.endsWith(".model.yaml") ? f.name : `${f.name}.model.yaml`;
            return df.name === fn;
          })
        );
        if (savedFiles.length > 0) {
          const fileTabs = savedFiles.map((sf) => {
            const match = files.find((f) => {
              const fn = f.name.endsWith(".model.yaml") ? f.name : `${f.name}.model.yaml`;
              return sf.name === fn;
            });
            return { ...sf, content: match?.yaml || "" };
          });
          const savedPaths = new Set(fileTabs.map((ft) => ft.fullPath));
          const filteredTabs = openTabs.filter((t) => !savedPaths.has(t.fullPath));
          const newTabs = [...filteredTabs, ...fileTabs];
          const activeFile = fileTabs[0];
          set({
            activeFile,
            activeFileContent: activeFile.content,
            originalContent: activeFile.content,
            isDirty: false,
            openTabs: newTabs,
          });
        }
        return;
      } catch (err) {
        console.warn("[workspace] Failed to save imported files to disk:", err.message);
        // Fall through to in-memory mode
      }
    }

    // Offline or fallback: in-memory tabs only
    const docs = files.map((f, i) => ({
      id: `imported-${Date.now()}-${i}`,
      name: f.name.endsWith(".model.yaml") ? f.name : `${f.name}.model.yaml`,
      content: f.yaml,
    }));
    const existingIds = new Set(docs.map((d) => d.name));
    const filteredTabs = openTabs.filter((t) => !existingIds.has(t.name));
    const newTabs = [...filteredTabs, ...docs];
    const activeDoc = docs[0];
    if (offlineMode) {
      const existingDocs = localDocuments.filter((d) => !existingIds.has(d.name));
      const updated = [...existingDocs, ...docs];
      set({
        localDocuments: updated,
        activeFile: activeDoc,
        activeFileContent: activeDoc.content,
        originalContent: activeDoc.content,
        isDirty: false,
        openTabs: newTabs,
      });
      localStorage.setItem("dm_offline_docs", JSON.stringify(updated));
    } else {
      set({
        activeFile: activeDoc,
        activeFileContent: activeDoc.content,
        originalContent: activeDoc.content,
        isDirty: false,
        openTabs: newTabs,
      });
    }
  },

  saveOfflineDocs: () => {
    const { localDocuments } = get();
    localStorage.setItem("dm_offline_docs", JSON.stringify(localDocuments));
  },

  addProjectFolder: async (name, path, createIfMissing = false) => {
    set({ loading: true, error: null });
    try {
      const project = await addProject(name, path, createIfMissing);
      set((s) => ({ projects: [...s.projects, project], loading: false }));
      await get().selectProject(project.id);
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  updateProjectFolder: async (id, name, path, createIfMissing = false) => {
    set({ loading: true, error: null });
    try {
      const updated = await updateProject(id, name, path, createIfMissing);
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? updated : p)),
        loading: false,
      }));
      if (get().activeProjectId === id) {
        await get().selectProject(id);
      }
      return updated;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
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
      const sourceName = fileInfo.path || fileInfo.name || "";
      let renderedContent = data.content;
      let convertedFromDbt = false;

      if (isLikelyDbtSchema(data.content, sourceName)) {
        try {
          const modelName = deriveModelNameFromPath(sourceName);
          const imported = await importSchemaContent({
            format: "dbt",
            content: data.content,
            filename: fileInfo.name || "schema.yml",
            modelName,
          });
          if (imported?.yaml) {
            renderedContent = imported.yaml;
            convertedFromDbt = true;
          }
        } catch (_err) {
          // Keep original content if conversion fails.
        }
      }

      let autoSavedConvertedContent = false;
      if (convertedFromDbt && renderedContent && renderedContent !== data.content) {
        try {
          await saveFileContent(fileInfo.fullPath, renderedContent);
          autoSavedConvertedContent = true;
        } catch (_err) {
          autoSavedConvertedContent = false;
        }
      }

      const file = { ...fileInfo, content: renderedContent };
      set((s) => {
        const alreadyOpen = s.openTabs.some((t) => t.fullPath === file.fullPath);
        return {
          activeFile: file,
          activeFileContent: renderedContent,
          originalContent: autoSavedConvertedContent
            ? renderedContent
            : (convertedFromDbt ? data.content : renderedContent),
          isDirty: !autoSavedConvertedContent && convertedFromDbt && renderedContent !== data.content,
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

  importModelFilesToProject: async (projectId, files) => {
    const { offlineMode } = get();
    if (offlineMode) {
      throw new Error("Drag-and-drop project import requires API mode.");
    }
    if (!projectId) {
      throw new Error("Select a target project first.");
    }

    const dropped = Array.from(files || []);
    const yamlFiles = dropped.filter((f) => /\.ya?ml$/i.test(f.name || ""));
    if (yamlFiles.length === 0) {
      throw new Error("Only .yaml/.yml files are supported for project drop import.");
    }

    set({ loading: true, error: null });
    try {
      const current = await fetchProjectFiles(projectId);
      const existingNames = new Set((current.files || []).map((f) => f.name));
      const created = [];

      for (const file of yamlFiles) {
        const sourcePath = file.webkitRelativePath || file.name || "";
        const text = await file.text();

        let normalized = normalizeImportedModelFileName(file.name);
        let outContent = text;
        if (isLikelyDbtSchema(text, sourcePath)) {
          const modelName = deriveModelNameFromPath(sourcePath);
          const imported = await importSchemaContent({
            format: "dbt",
            content: text,
            filename: file.name,
            modelName,
          });
          if (!imported?.yaml) {
            throw new Error(`Failed to import dbt schema from ${file.name}`);
          }
          normalized = normalizeImportedModelFileName(`${modelName}.model.yaml`);
          outContent = imported.yaml;
        }

        const ext = normalized.endsWith(".model.yml") ? ".model.yml" : ".model.yaml";
        const rootName = normalized.slice(0, -ext.length);
        let candidate = normalized;
        let suffix = 1;
        while (existingNames.has(candidate)) {
          candidate = `${rootName}_${suffix}${ext}`;
          suffix += 1;
        }

        const createdFile = await createProjectFile(projectId, candidate, outContent);
        existingNames.add(candidate);
        created.push(createdFile);
      }

      await get().selectProject(projectId);
      if (created.length > 0) {
        await get().openFile(created[0]);
      }
      set({ loading: false });
      return created;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  moveProjectFileToProject: async (targetProjectId, sourcePath, mode = "move") => {
    const { offlineMode } = get();
    if (offlineMode) {
      throw new Error("File move requires API mode.");
    }
    if (!targetProjectId) {
      throw new Error("Select a target project first.");
    }
    if (!sourcePath) {
      throw new Error("Missing source file path.");
    }

    set({ loading: true, error: null });
    try {
      const result = await moveProjectFile(targetProjectId, sourcePath, mode);
      await get().selectProject(targetProjectId);
      if (result?.targetFile?.fullPath) {
        await get().openFile(result.targetFile);
      }
      set({ loading: false });
      return result;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
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
