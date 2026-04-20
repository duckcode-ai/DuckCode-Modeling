/* Project-level modals extracted from App.jsx so the new Luna shell and the
   legacy App root can share identical Add/Edit/New-file dialogs. */
import React, { useEffect, useState } from "react";
import {
  X, FolderPlus, Plus, Pencil, AlertCircle, RefreshCw,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { fetchGitBranches, fetchGitRemote } from "../../lib/api";

function AddProjectModal() {
  const { closeModal } = useUiStore();
  const { addProjectFolder } = useWorkspaceStore();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [createIfMissing, setCreateIfMissing] = useState(true);
  const [scaffoldRepo, setScaffoldRepo] = useState(true);
  const [initializeGit, setInitializeGit] = useState(true);
  const [createSubfolder, setCreateSubfolder] = useState(true);
  const [error, setError] = useState("");

  const sanitizeFolderName = (value) => {
    const raw = String(value || "").trim();
    const cleaned = raw
      .replace(/[\\/]+/g, "-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");
    return cleaned || "datalex-project";
  };

  const joinPath = (basePath, childPath) => {
    const base = String(basePath || "").replace(/[\\/]+$/, "");
    const child = String(childPath || "").replace(/^[\\/]+/, "");
    if (!base) return child;
    if (!child) return base;
    return `${base}/${child}`;
  };

  const derivedSubfolderName = sanitizeFolderName(name);
  const normalizedBase = String(path || "").replace(/[\\/]+$/, "");
  const baseEndsWithDerived = normalizedBase.split("/").filter(Boolean).pop() === derivedSubfolderName;
  const effectivePath = createSubfolder && !baseEndsWithDerived ? joinPath(path, derivedSubfolderName) : path;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError("Both name and path are required");
      return;
    }
    try {
      await addProjectFolder(name.trim(), path.trim(), createIfMissing, {
        scaffoldRepo,
        initializeGit,
        createSubfolder,
      });
      closeModal();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
      <div className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl w-[420px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <FolderPlus size={16} className="text-accent-blue" />
            Add Project Folder
          </h3>
          <button onClick={closeModal} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Project Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. commerce-models"
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Folder Path (absolute)</label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="e.g. /Users/you/projects/models"
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Recommended: run DataLex locally for full file access. In Docker, use mounted container paths like
              {" "}<code>/workspace/host/...</code>.
            </p>
            <p className="mt-1 text-[11px] text-text-muted">
              Final project folder: <code className="font-mono text-[11px]">{effectivePath || "(set a path)"}</code>
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={createSubfolder}
              onChange={(e) => setCreateSubfolder(e.target.checked)}
            />
            Create a subfolder named after the project (recommended for a single Git repo with many projects)
          </label>
          {!createSubfolder && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
              Tip: for “one repo, many projects”, keep this enabled so each project becomes <code className="font-mono">{String(path || "").replace(/[\\/]+$/, "")}/&lt;project&gt;/</code>.
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={createIfMissing}
              onChange={(e) => setCreateIfMissing(e.target.checked)}
            />
            Create folder if it does not exist
          </label>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={scaffoldRepo}
              onChange={(e) => setScaffoldRepo(e.target.checked)}
            />
            Initialize DataLex repo structure (models, migrations, guides, CI template)
          </label>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={initializeGit}
              onChange={(e) => setInitializeGit(e.target.checked)}
              disabled={!scaffoldRepo}
            />
            Initialize git repository if missing
          </label>
          {error && (
            <div className="flex items-center gap-2 text-xs text-status-error">
              <AlertCircle size={12} />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors">
              Add Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewFileModal() {
  const { closeModal } = useUiStore();
  const { createNewFile } = useWorkspaceStore();
  const [name, setName] = useState("new.model.yaml");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    createNewFile(name.trim());
    closeModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
      <div className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl w-[380px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Plus size={16} className="text-accent-blue" />
            New Model File
          </h3>
          <button onClick={closeModal} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">File Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-accent-blue"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditProjectModal() {
  const { closeModal, modalPayload } = useUiStore();
  const { updateProjectFolder } = useWorkspaceStore();
  const project = modalPayload?.project || null;
  const [name, setName] = useState(project?.name || "");
  const [path, setPath] = useState(project?.path || "");
  const [createIfMissing, setCreateIfMissing] = useState(false);
  const [scaffoldRepo, setScaffoldRepo] = useState(false);
  const [initializeGit, setInitializeGit] = useState(false);
  const [createSubfolder, setCreateSubfolder] = useState(false);
  const [githubRepo, setGithubRepo] = useState(project?.githubRepo || "");
  const [defaultBranch, setDefaultBranch] = useState(project?.defaultBranch || "");
  const [branches, setBranches] = useState([]);
  const [detectingRemote, setDetectingRemote] = useState(false);
  const [error, setError] = useState("");

  const sanitizeFolderName = (value) => {
    const raw = String(value || "").trim();
    const cleaned = raw
      .replace(/[\\/]+/g, "-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");
    return cleaned || "datalex-project";
  };

  const joinPath = (basePath, childPath) => {
    const base = String(basePath || "").replace(/[\\/]+$/, "");
    const child = String(childPath || "").replace(/^[\\/]+/, "");
    if (!base) return child;
    if (!child) return base;
    return `${base}/${child}`;
  };

  useEffect(() => {
    setName(project?.name || "");
    setPath(project?.path || "");
    setCreateIfMissing(false);
    setScaffoldRepo(false);
    setInitializeGit(false);
    setCreateSubfolder(false);
    setGithubRepo(project?.githubRepo || "");
    setDefaultBranch(project?.defaultBranch || "");
    setError("");
    if (project?.id) {
      fetchGitBranches(project.id).then(setBranches).catch(() => setBranches([]));
    }
  }, [project?.id]);

  if (!project) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError("Both name and path are required");
      return;
    }
    try {
      await updateProjectFolder(project.id, name.trim(), path.trim(), createIfMissing, {
        scaffoldRepo,
        initializeGit,
        createSubfolder,
        githubRepo: githubRepo.trim() || null,
        defaultBranch: defaultBranch.trim() || null,
      });
      closeModal();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDetectRemote = async () => {
    if (!project?.id) return;
    setDetectingRemote(true);
    try {
      const result = await fetchGitRemote(project.id);
      if (result.githubRepo) setGithubRepo(result.githubRepo);
    } catch (_err) {
      // silently ignore — project may not have a remote
    } finally {
      setDetectingRemote(false);
    }
  };

  const derivedSubfolderName = sanitizeFolderName(name);
  const normalizedBase = String(path || "").replace(/[\\/]+$/, "");
  const baseEndsWithDerived = normalizedBase.split("/").filter(Boolean).pop() === derivedSubfolderName;
  const effectivePath = createSubfolder && !baseEndsWithDerived ? joinPath(path, derivedSubfolderName) : path;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
      <div className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl w-[420px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Pencil size={16} className="text-accent-blue" />
            Edit Project Folder
          </h3>
          <button onClick={closeModal} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Project Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Folder Path (absolute)</label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              In Docker mode, this must be a mounted container path (for example <code>/workspace/host/Models</code>).
            </p>
            <p className="mt-1 text-[11px] text-text-muted">
              Effective project folder: <code className="font-mono text-[11px]">{effectivePath || "(set a path)"}</code>
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={createSubfolder}
              onChange={(e) => setCreateSubfolder(e.target.checked)}
            />
            Use a subfolder named after the project (recommended for one repo, many projects)
          </label>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={createIfMissing}
              onChange={(e) => setCreateIfMissing(e.target.checked)}
            />
            Create folder if it does not exist
          </label>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={scaffoldRepo}
              onChange={(e) => setScaffoldRepo(e.target.checked)}
            />
            Add/repair DataLex repo structure
          </label>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={initializeGit}
              onChange={(e) => setInitializeGit(e.target.checked)}
              disabled={!scaffoldRepo}
            />
            Initialize git repository if missing
          </label>

          {/* GitHub Integration */}
          <div className="border-t border-border-primary/60 pt-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted uppercase tracking-wider font-semibold">
              <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              GitHub Integration
            </div>
            <div>
              <label className="text-xs text-text-muted font-medium block mb-1">
                Repo URL <span className="font-normal">(optional)</span>
              </label>
              <div className="flex gap-1.5">
                <input
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="https://github.com/org/repo"
                  className="flex-1 bg-bg-primary border border-border-primary rounded-md px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue font-mono"
                />
                <button
                  type="button"
                  onClick={handleDetectRemote}
                  disabled={detectingRemote}
                  title="Auto-detect from git remote origin"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs border border-border-primary bg-bg-hover text-text-secondary hover:text-text-primary transition-colors shrink-0 disabled:opacity-50"
                >
                  <RefreshCw size={11} className={detectingRemote ? "animate-spin" : ""} />
                  Detect
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted font-medium block mb-1">Main Branch</label>
              {branches.length > 0 ? (
                <select
                  value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue"
                >
                  <option value="">-- select branch --</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue font-mono"
                />
              )}
              {branches.length === 0 && (
                <p className="text-[10px] text-text-muted mt-0.5">No local git branches found — type a branch name directly.</p>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-status-error">
              <AlertCircle size={12} />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { AddProjectModal, NewFileModal, EditProjectModal };
