/* Project-level modals extracted from App.jsx so the new Luna shell and the
   legacy App root can share identical Add/Edit/New-file dialogs.

   Ported to the shared `<Modal>` chrome + `.panel-input` / `.panel-btn`
   primitives so every dialog matches the bottom drawer + right panel in
   tone, spacing, and focus behaviour. Per-dialog Tailwind classes have
   been retired in favour of the `.dlx-modal-*` system. */
import React, { useEffect, useState } from "react";
import {
  FolderPlus, Plus, Pencil, AlertCircle, RefreshCw, Github,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { fetchGitBranches, fetchGitRemote } from "../../lib/api";
import Modal, { ModalCheckbox } from "./Modal";

/* Local helpers — shared between Add/Edit. */
function sanitizeFolderName(value) {
  const raw = String(value || "").trim();
  const cleaned = raw
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "datalex-project";
}

function joinPath(basePath, childPath) {
  const base = String(basePath || "").replace(/[\\/]+$/, "");
  const child = String(childPath || "").replace(/^[\\/]+/, "");
  if (!base) return child;
  if (!child) return base;
  return `${base}/${child}`;
}

function resolveEffectivePath({ path, name, createSubfolder }) {
  const derived = sanitizeFolderName(name);
  const normalizedBase = String(path || "").replace(/[\\/]+$/, "");
  const baseEndsWithDerived =
    normalizedBase.split("/").filter(Boolean).pop() === derived;
  return createSubfolder && !baseEndsWithDerived ? joinPath(path, derived) : path;
}

function sanitizePathSegment(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || fallback;
}

function layeredModelPath({ layer, domain, dialect, fileName }) {
  const safeLayer = sanitizePathSegment(layer, "logical");
  const safeDomain = sanitizePathSegment(domain, "shared");
  const safeFile = sanitizePathSegment(fileName, "untitled");
  if (safeLayer === "physical") {
    const safeDialect = sanitizePathSegment(dialect, "postgres");
    return `models/physical/${safeDialect}/${safeDomain}/${safeFile}.model.yaml`;
  }
  return `models/${safeLayer}/${safeDomain}/${safeFile}.model.yaml`;
}

function layeredModelTemplate({ layer, domain, fileName, dialect }) {
  const safeLayer = sanitizePathSegment(layer, "logical");
  const safeDomain = sanitizePathSegment(domain, "shared");
  const safeName = sanitizePathSegment(fileName, "untitled");
  const lines = [
    "model:",
    `  name: ${safeName}`,
    `  kind: ${safeLayer}`,
    `  domain: ${safeDomain}`,
    "  version: 1.0.0",
    "  owners: []",
    "  state: draft",
  ];
  if (safeLayer === "physical") {
    lines.push(`  dialect: ${sanitizePathSegment(dialect, "postgres")}`);
  }
  lines.push("entities: []", "relationships: []", "");
  return `${lines.join("\n")}`;
}

/* ─────────────────────────── Add Project ─────────────────────────── */
function AddProjectModal() {
  const { closeModal } = useUiStore();
  const { addProjectFolder } = useWorkspaceStore();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [createIfMissing, setCreateIfMissing] = useState(true);
  const [scaffoldRepo, setScaffoldRepo] = useState(true);
  const [initializeGit, setInitializeGit] = useState(true);
  const [createSubfolder, setCreateSubfolder] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const effectivePath = resolveEffectivePath({ path, name, createSubfolder });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError("Both name and path are required");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await addProjectFolder(name.trim(), path.trim(), createIfMissing, {
        scaffoldRepo,
        initializeGit,
        createSubfolder,
      });
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      icon={<FolderPlus size={14} />}
      title="Add Project Folder"
      subtitle="Register a local folder as a DataLex project."
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal}>
            Cancel
          </button>
          <button
            type="submit"
            form="add-project-form"
            className="panel-btn primary"
            disabled={submitting || !name.trim() || !path.trim()}
          >
            {submitting ? "Adding…" : "Add Project"}
          </button>
        </>
      }
    >
      <form id="add-project-form" onSubmit={handleSubmit} style={{ display: "contents" }}>
        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="add-project-name">
            Project Name
          </label>
          <input
            id="add-project-name"
            className="panel-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. commerce-models"
            autoFocus
          />
        </div>

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="add-project-path">
            Folder Path (absolute)
          </label>
          <input
            id="add-project-path"
            className="panel-input"
            style={{ fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)", fontSize: 11.5 }}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/you/projects/models"
          />
          <p className="dlx-modal-hint">
            Recommended: run DataLex locally for full file access. In Docker, use mounted container paths like <code>/workspace/host/...</code>.
          </p>
          <p className="dlx-modal-hint">
            Final project folder: <code>{effectivePath || "(set a path)"}</code>
          </p>
        </div>

        <div className="dlx-modal-section">
          <div className="dlx-modal-section-heading">Options</div>
          <ModalCheckbox checked={createSubfolder} onChange={setCreateSubfolder}>
            Create a subfolder named after the project (recommended for a single Git repo with many projects)
          </ModalCheckbox>
          {!createSubfolder && (
            <div className="dlx-modal-alert warn">
              <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>
                Tip: for "one repo, many projects", keep this enabled so each
                project becomes <code>{String(path || "").replace(/[\\/]+$/, "") || "<base>"}/&lt;project&gt;/</code>.
              </span>
            </div>
          )}
          <ModalCheckbox checked={createIfMissing} onChange={setCreateIfMissing}>
            Create folder if it does not exist
          </ModalCheckbox>
          <ModalCheckbox checked={scaffoldRepo} onChange={setScaffoldRepo}>
            Initialize DataLex repo structure (models, migrations, guides, CI template)
          </ModalCheckbox>
          <ModalCheckbox
            checked={initializeGit}
            onChange={setInitializeGit}
            disabled={!scaffoldRepo}
          >
            Initialize git repository if missing
          </ModalCheckbox>
        </div>

        {error && (
          <div className="dlx-modal-alert">
            <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}

/* ─────────────────────────── New File ─────────────────────────── */
function NewFileModal() {
  const { closeModal, modalPayload } = useUiStore();
  const { createNewFile } = useWorkspaceStore();
  const [layer, setLayer] = useState(() => String(modalPayload?.layerHint || "logical").toLowerCase());
  const [domain, setDomain] = useState(() => String(modalPayload?.domainHint || "shared"));
  const [dialect, setDialect] = useState(() => String(modalPayload?.dialectHint || "postgres"));
  const [fileName, setFileName] = useState(() => String(modalPayload?.nameHint || "untitled"));

  useEffect(() => {
    setLayer(String(modalPayload?.layerHint || "logical").toLowerCase());
    setDomain(String(modalPayload?.domainHint || "shared"));
    setDialect(String(modalPayload?.dialectHint || "postgres"));
    setFileName(String(modalPayload?.nameHint || "untitled"));
  }, [modalPayload]);

  const targetPath = layeredModelPath({ layer, domain, dialect, fileName });
  const targetTemplate = layeredModelTemplate({ layer, domain, dialect, fileName });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!fileName.trim()) return;
    createNewFile(targetPath, targetTemplate);
    closeModal();
  };

  return (
    <Modal
      icon={<Plus size={14} />}
      title="New Model File"
      subtitle="Create a layered DataLex model under DataLex/models/."
      size="sm"
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal}>
            Cancel
          </button>
          <button
            type="submit"
            form="new-file-form"
            className="panel-btn primary"
            disabled={!fileName.trim()}
          >
            Create
          </button>
        </>
      }
    >
      <form id="new-file-form" onSubmit={handleSubmit} style={{ display: "contents" }}>
        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="new-file-layer">
            Layer
          </label>
          <select
            id="new-file-layer"
            className="panel-input"
            value={layer}
            onChange={(e) => setLayer(e.target.value)}
            autoFocus
          >
            <option value="conceptual">Conceptual</option>
            <option value="logical">Logical</option>
            <option value="physical">Physical</option>
          </select>
        </div>

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="new-file-domain">
            Domain
          </label>
          <input
            id="new-file-domain"
            className="panel-input"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="customer"
          />
        </div>

        {layer === "physical" && (
          <div className="dlx-modal-section">
            <label className="dlx-modal-field-label" htmlFor="new-file-dialect">
              Dialect
            </label>
            <select
              id="new-file-dialect"
              className="panel-input"
              value={dialect}
              onChange={(e) => setDialect(e.target.value)}
            >
              <option value="postgres">PostgreSQL</option>
              <option value="snowflake">Snowflake</option>
              <option value="bigquery">BigQuery</option>
              <option value="sqlserver">SQL Server</option>
              <option value="redshift">Redshift</option>
            </select>
          </div>
        )}

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="new-file-name">
            Model name
          </label>
          <input
            id="new-file-name"
            className="panel-input"
            style={{ fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)" }}
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
          />
          <p className="dlx-modal-hint">
            Target path: <code>{targetPath}</code>
          </p>
          <p className="dlx-modal-hint">
            Conceptual models stay business-facing; physical models add dialect context later.
          </p>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────────────────── Edit Project ─────────────────────────── */
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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

  const effectivePath = resolveEffectivePath({ path, name, createSubfolder });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError("Both name and path are required");
      return;
    }
    setSubmitting(true);
    setError("");
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
    } finally {
      setSubmitting(false);
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

  return (
    <Modal
      icon={<Pencil size={14} />}
      title="Edit Project Folder"
      subtitle={project.name || "Update project metadata & GitHub binding."}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal}>
            Cancel
          </button>
          <button
            type="submit"
            form="edit-project-form"
            className="panel-btn primary"
            disabled={submitting || !name.trim() || !path.trim()}
          >
            {submitting ? "Saving…" : "Save Changes"}
          </button>
        </>
      }
    >
      <form id="edit-project-form" onSubmit={handleSubmit} style={{ display: "contents" }}>
        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="edit-project-name">
            Project Name
          </label>
          <input
            id="edit-project-name"
            className="panel-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="edit-project-path">
            Folder Path (absolute)
          </label>
          <input
            id="edit-project-path"
            className="panel-input"
            style={{ fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)", fontSize: 11.5 }}
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <p className="dlx-modal-hint">
            In Docker mode, this must be a mounted container path (for example <code>/workspace/host/Models</code>).
          </p>
          <p className="dlx-modal-hint">
            Effective project folder: <code>{effectivePath || "(set a path)"}</code>
          </p>
        </div>

        <div className="dlx-modal-section">
          <div className="dlx-modal-section-heading">Options</div>
          <ModalCheckbox checked={createSubfolder} onChange={setCreateSubfolder}>
            Use a subfolder named after the project (recommended for one repo, many projects)
          </ModalCheckbox>
          <ModalCheckbox checked={createIfMissing} onChange={setCreateIfMissing}>
            Create folder if it does not exist
          </ModalCheckbox>
          <ModalCheckbox checked={scaffoldRepo} onChange={setScaffoldRepo}>
            Add / repair DataLex repo structure
          </ModalCheckbox>
          <ModalCheckbox
            checked={initializeGit}
            onChange={setInitializeGit}
            disabled={!scaffoldRepo}
          >
            Initialize git repository if missing
          </ModalCheckbox>
        </div>

        <div className="dlx-modal-section">
          <div className="dlx-modal-section-heading">
            <Github size={11} /> GitHub Integration
          </div>
          <label className="dlx-modal-field-label" htmlFor="edit-project-github">
            Repo URL <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(optional)</span>
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              id="edit-project-github"
              className="panel-input"
              style={{ flex: 1, fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)", fontSize: 11 }}
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="https://github.com/org/repo"
            />
            <button
              type="button"
              className="panel-btn"
              onClick={handleDetectRemote}
              disabled={detectingRemote}
              title="Auto-detect from git remote origin"
            >
              <RefreshCw size={11} className={detectingRemote ? "animate-spin" : ""} />
              Detect
            </button>
          </div>

          <label className="dlx-modal-field-label" htmlFor="edit-project-branch" style={{ marginTop: 8 }}>
            Main Branch
          </label>
          {branches.length > 0 ? (
            <select
              id="edit-project-branch"
              className="panel-select"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
            >
              <option value="">-- select branch --</option>
              {branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          ) : (
            <input
              id="edit-project-branch"
              className="panel-input"
              style={{ fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)" }}
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              placeholder="main"
            />
          )}
          {branches.length === 0 && (
            <p className="dlx-modal-hint">No local git branches found — type a branch name directly.</p>
          )}
        </div>

        {error && (
          <div className="dlx-modal-alert">
            <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}

export { AddProjectModal, NewFileModal, EditProjectModal };
