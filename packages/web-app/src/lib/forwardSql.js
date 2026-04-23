import { adaptDiagramYaml } from "../design/schemaAdapter.js";
import { generateSchemaDDL } from "./ddl.js";

function normalizeWorkspaceFileRef(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^DataLex\//i, "")
    .replace(/^datalex\//i, "")
    .trim();
}

export function buildFilesWithContent(projectFiles = [], fileContentCache = {}) {
  const cache = fileContentCache || {};
  return (projectFiles || []).map((file) => {
    const key = normalizeWorkspaceFileRef(file?.fullPath || file?.path || "");
    if (typeof file?.content === "string") return file;
    if (key && typeof cache[key] === "string") return { ...file, content: cache[key] };
    return file;
  });
}

export function buildForwardSqlForActiveFile({
  activeFile,
  activeFileContent,
  projectFiles = [],
  fileContentCache = {},
}) {
  if (!activeFile || typeof activeFileContent !== "string" || !activeFileContent.trim()) {
    return { kind: "none", isDiagram: false, sql: "", schema: null };
  }

  const fileName = String(activeFile?.name || activeFile?.fullPath || "");
  const isDiagram = /\.diagram\.ya?ml$/i.test(fileName);
  if (!isDiagram) {
    return { kind: "model", isDiagram: false, sql: "", schema: null };
  }

  const hydrated = buildFilesWithContent(projectFiles, fileContentCache);
  const schema = adaptDiagramYaml(activeFileContent, hydrated);
  const sql = schema ? generateSchemaDDL(schema) : "";
  return { kind: "diagram", isDiagram: true, sql, schema };
}

export function forwardSqlStem(filePath = "") {
  const base = String(filePath || "").split("/").pop() || "model";
  return (
    base
      .replace(/\.diagram\.ya?ml$/i, "")
      .replace(/\.model\.ya?ml$/i, "")
      .replace(/\.ya?ml$/i, "")
      || "model"
  );
}
