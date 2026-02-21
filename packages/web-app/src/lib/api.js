const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
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
