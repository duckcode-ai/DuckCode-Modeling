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

export async function addProject(name, path) {
  const data = await request("/projects", {
    method: "POST",
    body: JSON.stringify({ name, path }),
  });
  return data.project;
}

export async function removeProject(id) {
  return request(`/projects/${id}`, { method: "DELETE" });
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
