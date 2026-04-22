const BASE = "/api";

// ApiError — thrown by `request()` on any non-2xx response. Carries the
// structured envelope fields (`code`, `details`, HTTP `status`) so callers
// can route on `err.code === "PATH_ESCAPE"` for targeted UX without
// string-matching the message. Legacy routes that still return the old
// `{ error: "string" }` shape produce an ApiError with code UNKNOWN so the
// toast still shows something meaningful during the transition.
export class ApiError extends Error {
  constructor({ code, message, details, status }) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function parseErrorBody(body, status) {
  // New envelope: { error: { code, message, details? } }
  if (body && body.error && typeof body.error === "object") {
    return {
      code: body.error.code || "UNKNOWN",
      message: body.error.message || `HTTP ${status}`,
      details: body.error.details || null,
    };
  }
  // Legacy envelope: { error: "message" }
  if (body && typeof body.error === "string") {
    return { code: "UNKNOWN", message: body.error, details: null };
  }
  return { code: "UNKNOWN", message: `HTTP ${status}`, details: null };
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const parsed = parseErrorBody(body, res.status);
    throw new ApiError({ ...parsed, status: res.status });
  }
  return res.json();
}

export async function fetchProjects() {
  const data = await request("/projects");
  return data.projects || [];
}

export async function fetchConnections() {
  const data = await request("/connections");
  return data.connections || [];
}

export async function addProject(name, path, createIfMissing = false, options = {}) {
  const { scaffoldRepo = false, initializeGit = false, createSubfolder = false } = options || {};
  const data = await request("/projects", {
    method: "POST",
    body: JSON.stringify({
      name,
      path,
      create_if_missing: createIfMissing,
      scaffold_repo: scaffoldRepo,
      initialize_git: initializeGit,
      create_subfolder: createSubfolder,
    }),
  });
  return data.project;
}

export async function removeProject(id) {
  return request(`/projects/${id}`, { method: "DELETE" });
}

export async function updateProject(id, name, path, createIfMissing = false, options = {}) {
  const {
    scaffoldRepo = false,
    initializeGit = false,
    createSubfolder = false,
    githubRepo,
    defaultBranch,
  } = options || {};
  const data = await request(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      name,
      path,
      create_if_missing: createIfMissing,
      scaffold_repo: scaffoldRepo,
      initialize_git: initializeGit,
      create_subfolder: createSubfolder,
      github_repo: githubRepo,
      default_branch: defaultBranch,
    }),
  });
  return data.project;
}

export async function cloneGitRepo(repoUrl, branch = "main", projectName = "", token = "") {
  const data = await request("/git/clone", {
    method: "POST",
    body: JSON.stringify({ repoUrl, branch, projectName, token }),
  });
  return data.project;
}

export async function fetchGitBranches(projectId) {
  const data = await request(`/git/branches?projectId=${encodeURIComponent(projectId)}`);
  return data.branches || [];
}

export async function fetchGitRemote(projectId) {
  return request(`/git/remote?projectId=${encodeURIComponent(projectId)}`);
}

// v0.5.0 — git tag helpers backing the Snapshots dialog.
export async function fetchGitTags(projectId) {
  const data = await request(`/git/tags?projectId=${encodeURIComponent(projectId)}`);
  return data.tags || [];
}

export async function createGitTag(projectId, { name, message, ref } = {}) {
  return request(`/git/tags`, {
    method: "POST",
    body: JSON.stringify({ projectId, name, message, ref }),
  });
}

export async function deleteGitTag(projectId, name) {
  return request(`/git/tags`, {
    method: "DELETE",
    body: JSON.stringify({ projectId, name }),
  });
}

export async function fetchProjectFiles(projectId) {
  const data = await request(`/projects/${projectId}/files`);
  return data;
}

export async function fetchFileContent(fullPath) {
  const data = await request(`/files?path=${encodeURIComponent(fullPath)}`);
  return data;
}

export async function saveFileContent(fullPath, content) {
  return request("/files", {
    method: "PUT",
    body: JSON.stringify({ path: fullPath, content }),
  });
}

export async function createProjectFile(projectId, name, content = "") {
  return request(`/projects/${projectId}/files`, {
    method: "POST",
    body: JSON.stringify({ name, content }),
  });
}

export async function moveProjectFile(targetProjectId, sourcePath, mode = "move") {
  return request(`/projects/${targetProjectId}/move-file`, {
    method: "POST",
    body: JSON.stringify({ sourcePath, mode }),
  });
}

// --- Folder + file CRUD (PR C) -------------------------------------------------
// `path`, `fromPath`, `toPath` are POSIX subpaths relative to the project's
// model root — the same shape the Explorer tree uses for `path` on nodes.

export async function createProjectFolder(projectId, path) {
  return request(`/projects/${projectId}/folders`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function renameProjectFile(projectId, fromPath, toPath) {
  return request(`/projects/${projectId}/files`, {
    method: "PATCH",
    body: JSON.stringify({ fromPath, toPath }),
  });
}

export async function renameProjectFolder(projectId, fromPath, toPath) {
  return request(`/projects/${projectId}/folders`, {
    method: "PATCH",
    body: JSON.stringify({ fromPath, toPath }),
  });
}

/* Atomic rename + cascade. Server snapshots rewrites, writes them all, then
 * performs the move. Any failure rewinds the rewrites and skips/undoes the
 * move, so the workspace is left in the pre-call state on partial failure. */
export async function renameCascadeAtomic(projectId, { fromPath, toPath, kind, rewrites }) {
  return request(`/projects/${projectId}/rename-cascade`, {
    method: "POST",
    body: JSON.stringify({ fromPath, toPath, kind, rewrites }),
  });
}

export async function patchProjectConfig(projectId, patch) {
  return request(`/projects/${projectId}/config`, {
    method: "PATCH",
    body: JSON.stringify({ patch }),
  });
}

export async function deleteProjectFile(projectId, path) {
  return request(`/projects/${projectId}/files`, {
    method: "DELETE",
    body: JSON.stringify({ path }),
  });
}

export async function deleteProjectFolder(projectId, path) {
  return request(`/projects/${projectId}/folders`, {
    method: "DELETE",
    body: JSON.stringify({ path }),
  });
}

export async function saveAllProjectFiles(projectId, files) {
  return request(`/projects/${projectId}/save-all`, {
    method: "POST",
    body: JSON.stringify({ files }),
  });
}

export async function importSchemaContent({ format, content, filename, modelName }) {
  return request("/import", {
    method: "POST",
    body: JSON.stringify({ format, content, filename, modelName }),
  });
}

export async function generateForwardSql(modelPath, dialect = "snowflake") {
  const data = await request("/forward/generate-sql", {
    method: "POST",
    body: JSON.stringify({
      model_path: modelPath,
      dialect,
    }),
  });
  return data;
}

/* Dry-run or apply DDL via the core engine's connector runtime. Gated by
 * DM_ENABLE_DIRECT_APPLY on the server — a 403 there surfaces as the
 * "disabled in GitOps mode" copy in the dialog. */
export async function applyForwardSql(body) {
  return request("/forward/apply", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function transformActiveModel({ modelContent, modelPath, transform, dialect = "postgres" }) {
  return request("/model/transform", {
    method: "POST",
    body: JSON.stringify({
      model_content: modelContent,
      model_path: modelPath || undefined,
      transform,
      dialect,
    }),
  });
}

export async function standardsFixModel({ modelContent, modelPath }) {
  return request("/model/standards/fix", {
    method: "POST",
    body: JSON.stringify({
      model_content: modelContent,
      model_path: modelPath || undefined,
    }),
  });
}

export async function fetchModelGraph(projectId) {
  return request(`/projects/${projectId}/model-graph`);
}

export async function fetchGitStatus(projectId) {
  return request(`/git/status?projectId=${encodeURIComponent(projectId)}`);
}

export async function fetchGitDiff(projectId, { path = "", staged = false } = {}) {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  if (path) params.set("path", path);
  if (staged) params.set("staged", "1");
  return request(`/git/diff?${params.toString()}`);
}

export async function commitGit(projectId, { message, paths = [] }) {
  return request("/git/commit", {
    method: "POST",
    body: JSON.stringify({ projectId, message, paths }),
  });
}

export async function stageGitFiles(projectId, paths) {
  return request("/git/stage", {
    method: "POST",
    body: JSON.stringify({ projectId, paths }),
  });
}

export async function unstageGitFiles(projectId, paths) {
  return request("/git/unstage", {
    method: "POST",
    body: JSON.stringify({ projectId, paths }),
  });
}

export async function fetchGitLog(projectId, limit = 20) {
  return request(`/git/log?projectId=${encodeURIComponent(projectId)}&limit=${encodeURIComponent(limit)}`);
}
export async function createGitBranch(projectId, { branch, from = "" } = {}) {
  return request("/git/branch/create", {
    method: "POST",
    body: JSON.stringify({ projectId, branch, from: from || undefined }),
  });
}

export async function pushGitBranch(projectId, { remote = "origin", branch = "", setUpstream = true } = {}) {
  return request("/git/push", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      remote,
      branch: branch || undefined,
      set_upstream: Boolean(setUpstream),
    }),
  });
}

export async function pullGitBranch(projectId, { remote = "origin", branch = "", ffOnly = true } = {}) {
  return request("/git/pull", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      remote,
      branch: branch || undefined,
      ff_only: Boolean(ffOnly),
    }),
  });
}

/**
 * Import a full dbt project (local folder or git URL) into a folder-preserving
 * DataLex YAML tree. Returns `{ tree: Array<{path, content}>, report, outDir }`.
 *
 * @param {object} body
 * @param {string} [body.projectDir]      Local dbt project path (containing dbt_project.yml).
 * @param {string} [body.gitUrl]          Public git URL to clone.
 * @param {string} [body.gitRef]          Branch / tag / commit (default: main).
 * @param {string} [body.out]             Override output directory.
 * @param {boolean} [body.skipWarehouse]  Skip live warehouse introspection.
 * @param {string}  [body.target]         Pick a non-default dbt target.
 * @param {string}  [body.manifest]       Override manifest.json path.
 */
export async function importDbtProject(body) {
  return request("/dbt/import", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export async function createGitHubPr(projectId, { token, title, body = "", base = "main", head = "", draft = false, remote = "origin" } = {}) {
  return request("/git/github/pr", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      token,
      title,
      body,
      base,
      head: head || undefined,
      draft: Boolean(draft),
      remote,
    }),
  });
}
