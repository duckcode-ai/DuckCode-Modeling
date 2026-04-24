/* Project-level modals extracted from App.jsx so the new Luna shell and the
   legacy App root can share identical Add/Edit/New-file dialogs.

   Ported to the shared `<Modal>` chrome + `.panel-input` / `.panel-btn`
   primitives so every dialog matches the bottom drawer + right panel in
   tone, spacing, and focus behaviour. Per-dialog Tailwind classes have
   been retired in favour of the `.dlx-modal-*` system. */
import React, { useEffect, useState } from "react";
import {
  FolderPlus, Plus, Pencil, AlertCircle, RefreshCw, Github,
  Boxes, Table2, LayoutDashboard, Layers3,
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

function slugifyName(value, fallback = "new_model") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function displayName(value) {
  return String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

const LAYER_OPTIONS = [
  {
    id: "conceptual",
    label: "Conceptual",
    icon: Boxes,
    description: "Business concepts, definitions, owners, and high-level relationships.",
    color: "#16a34a",
  },
  {
    id: "logical",
    label: "Logical",
    icon: Layers3,
    description: "Attributes, candidate keys, business keys, optionality, and type intent.",
    color: "#0891b2",
  },
  {
    id: "physical",
    label: "Physical",
    icon: Table2,
    description: "Dialect, physical names, columns, constraints, indexes, and SQL readiness.",
    color: "#4f46e5",
  },
];

const ARTIFACT_OPTIONS = [
  { id: "entity", label: "Model YAML", description: "Create a canonical DataLex entity file." },
  { id: "diagram", label: "Diagram YAML", description: "Create a layer-specific DataLex diagram." },
];

function defaultArtifactName(layer, artifact) {
  if (artifact === "diagram") return `${layer}_model`;
  if (layer === "conceptual") return "new_concept";
  if (layer === "logical") return "new_logical_entity";
  return "new_table";
}

function defaultPath(layer, artifact, name, dialect = "postgres") {
  const slug = slugifyName(name, defaultArtifactName(layer, artifact));
  if (artifact === "diagram") return `datalex/diagrams/${layer}_${slug}.diagram.yaml`;
  if (layer === "physical") return `models/physical/${slugifyName(dialect, "postgres")}/${slug}.yaml`;
  return `models/${layer}/${slug}.yaml`;
}

function modelYaml(layer, name, dialect = "postgres") {
  const slug = slugifyName(name, defaultArtifactName(layer, "entity"));
  const label = displayName(name || slug);
  if (layer === "conceptual") {
    return [
      "kind: entity",
      "layer: conceptual",
      `name: ${slug}`,
      `logical_name: ${label}`,
      'description: ""',
      'owner: ""',
      "tags: []",
      "",
    ].join("\n");
  }
  if (layer === "logical") {
    return [
      "kind: entity",
      "layer: logical",
      `name: ${slug}`,
      `logical_name: ${label}`,
      'description: ""',
      "visibility: logical_and_physical",
      "columns:",
      "  - name: id",
      "    type: identifier",
      "    nullable: false",
      "    primary_key: true",
      "candidate_keys:",
      "  - [id]",
      "business_keys: []",
      "",
    ].join("\n");
  }
  const dialectSlug = slugifyName(dialect, "postgres");
  return [
    "kind: entity",
    "layer: physical",
    `name: ${slug}`,
    `logical_name: ${label}`,
    `dialect: ${dialectSlug}`,
    'schema: ""',
    `physical_name: ${slug}`,
    "columns:",
    "  - name: id",
    "    type: bigint",
    "    nullable: false",
    "    primary_key: true",
    "indexes:",
    `  - name: pk_${slug}`,
    "    columns: [id]",
    "    unique: true",
    "",
  ].join("\n");
}

function diagramYaml(layer, name) {
  const slug = slugifyName(name, defaultArtifactName(layer, "diagram"));
  return [
    "kind: diagram",
    `name: ${slug}`,
    `title: ${displayName(name || slug)}`,
    `layer: ${layer}`,
    "entities: []",
    "relationships: []",
    "",
  ].join("\n");
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
  const initialLayer = ["conceptual", "logical", "physical"].includes(modalPayload?.layer)
    ? modalPayload.layer
    : "conceptual";
  const initialArtifact = ["entity", "diagram"].includes(modalPayload?.artifact)
    ? modalPayload.artifact
    : "entity";
  const [layer, setLayer] = useState(initialLayer);
  const [artifact, setArtifact] = useState(initialArtifact);
  const [name, setName] = useState(defaultArtifactName(initialLayer, initialArtifact));
  const [dialect, setDialect] = useState("postgres");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(defaultArtifactName(layer, artifact));
  }, [layer, artifact]);

  const path = defaultPath(layer, artifact, name, dialect);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const content = artifact === "diagram"
        ? diagramYaml(layer, name)
        : modelYaml(layer, name, dialect);
      await createNewFile(path, content);
      closeModal();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      icon={artifact === "diagram" ? <LayoutDashboard size={14} /> : <Plus size={14} />}
      title="New Modeling Asset"
      subtitle="Choose the modeling layer first so the file opens in the right workflow."
      size="lg"
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
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      <form id="new-file-form" onSubmit={handleSubmit} style={{ display: "contents" }}>
        <div className="dlx-modal-section">
          <div className="dlx-modal-section-heading">Layer</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {LAYER_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = layer === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setLayer(option.id)}
                  style={{
                    display: "grid",
                    gap: 6,
                    textAlign: "left",
                    padding: "10px",
                    borderRadius: 8,
                    border: `1px solid ${active ? option.color : "var(--border-default)"}`,
                    background: active ? "color-mix(in srgb, var(--bg-2) 82%, transparent)" : "var(--bg-1)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
                    <Icon size={13} style={{ color: option.color }} />
                    {option.label}
                  </span>
                  <span style={{ fontSize: 10.5, lineHeight: 1.35, color: "var(--text-tertiary)" }}>
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="dlx-modal-section">
          <div className="dlx-modal-section-heading">Artifact</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {ARTIFACT_OPTIONS.map((option) => {
              const active = artifact === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setArtifact(option.id)}
                  style={{
                    display: "grid",
                    gap: 4,
                    textAlign: "left",
                    padding: "10px",
                    borderRadius: 8,
                    border: `1px solid ${active ? "var(--accent)" : "var(--border-default)"}`,
                    background: active ? "var(--accent-dim)" : "var(--bg-1)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{option.label}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{option.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="new-file-name">
            Name
          </label>
          <input
            id="new-file-name"
            className="panel-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {layer === "physical" && artifact === "entity" && (
            <div style={{ marginTop: 8 }}>
              <label className="dlx-modal-field-label" htmlFor="new-file-dialect">
                Dialect
              </label>
              <select
                id="new-file-dialect"
                className="panel-input"
                value={dialect}
                onChange={(e) => setDialect(e.target.value)}
              >
                <option value="postgres">Postgres</option>
                <option value="snowflake">Snowflake</option>
                <option value="bigquery">BigQuery</option>
                <option value="databricks">Databricks</option>
                <option value="sqlserver">SQL Server</option>
              </select>
            </div>
          )}
          <p className="dlx-modal-hint">
            Path: <code>{path}</code>
          </p>
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
