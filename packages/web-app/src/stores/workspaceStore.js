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
  generateForwardSql,
  createProjectFolder,
  renameProjectFile,
  renameProjectFolder,
  renameCascadeAtomic,
  commitGit,
  patchProjectConfig,
  deleteProjectFile,
  deleteProjectFolder,
  saveAllProjectFiles,
  fetchModelGraph,
} from "../lib/api";
import { removeEntity } from "../lib/yamlRoundTrip";
import { SAMPLE_MODEL } from "../sampleModel";
import { normalizeImportedModelFileName } from "../lib/importModelName";
import useHistoryStore, { fileKeyOf } from "./historyStore";
// Path matching helpers live in lib/renamePaths so they can be unit
// tested without the full zustand + API surface. See that file for
// normalization rules.
import { matchesRenameSource, rewriteRenameTarget } from "../lib/renamePaths";

// Read a project file and return the names of entities defined inside it.
// Returns [] for non-model files, unreadable files, or parse errors — the
// caller uses this to seed a cascade that must be safe when the source
// file was never a model in the first place (e.g. `.diagram.yaml`, plain
// YAML, or a schema.yml we couldn't parse).
async function collectEntitiesInFile(projectId, subpath) {
  try {
    const { files } = await fetchProjectFiles(projectId);
    const match = (files || []).find((f) => f.path === subpath);
    if (!match?.fullPath) return [];
    const { content } = await fetchFileContent(match.fullPath);
    const doc = parseYamlObjectSafe(content);
    if (!doc || !Array.isArray(doc.entities)) return [];
    return doc.entities.map((e) => e?.name).filter((n) => typeof n === "string" && n);
  } catch (_err) {
    return [];
  }
}

// Variant of `collectEntitiesInFile` for folders — reads every model file
// under the folder and flattens entity names into one list. Deduped so the
// cascade applies each name at most once.
async function collectEntitiesInFolder(projectId, folderSubpath) {
  const prefix = String(folderSubpath).replace(/\/+$/, "") + "/";
  try {
    const { files } = await fetchProjectFiles(projectId);
    const modelFiles = (files || []).filter(
      (f) => f.path && (f.path === folderSubpath || f.path.startsWith(prefix))
        && /\.model\.ya?ml$/.test(f.path)
    );
    const entityNames = new Set();
    for (const f of modelFiles) {
      if (!f.fullPath) continue;
      try {
        const { content } = await fetchFileContent(f.fullPath);
        const doc = parseYamlObjectSafe(content);
        if (doc && Array.isArray(doc.entities)) {
          for (const e of doc.entities) {
            if (typeof e?.name === "string" && e.name) entityNames.add(e.name);
          }
        }
      } catch (_err) {
        // Unreadable file — skip. Cascade runs on best-effort basis.
      }
    }
    return Array.from(entityNames);
  } catch (_err) {
    return [];
  }
}

// For every *other* model file in the project, rewrite it with `removeEntity`
// applied once per deleted-entity name. `skipPaths` optionally excludes more
// than one file (used by `deleteFolder` to skip every file under the deleted
// folder). If any file updates fail, they're reported in `failures` — the
// caller surfaces them so orphans are visible, not silent.
async function cascadeRemoveEntityReferences(projectId, deletedSubpath, entityNames, skipPaths = null) {
  const filesUpdated = [];
  const failures = [];
  let graph;
  try {
    graph = await fetchModelGraph(projectId);
  } catch (err) {
    failures.push({ path: "(model-graph)", error: err?.message || String(err) });
    return { filesUpdated, failures };
  }
  const skip = skipPaths instanceof Set ? skipPaths : new Set();
  if (deletedSubpath) skip.add(deletedSubpath);
  const candidates = (graph?.models || []).filter((m) => m.path && !skip.has(m.path));
  for (const model of candidates) {
    try {
      const { content } = await fetchFileContent(model.file);
      let next = content;
      let mutated = false;
      for (const name of entityNames) {
        const result = removeEntity(next, name);
        if (result.error) continue;
        if (result.yaml !== next) {
          next = result.yaml;
          mutated = true;
        }
      }
      if (mutated) {
        await saveFileContent(model.file, next);
        filesUpdated.push(model.path);
      }
    } catch (err) {
      failures.push({ path: model.path, error: err?.message || String(err) });
    }
  }
  return { filesUpdated, failures };
}

// --- Phase 3.3 rename impact helpers ------------------------------------
// Scan every `.diagram.yaml` in the project for entity entries whose `file:`
// field points at a path about to be renamed, and every `datalex.yaml` /
// model file for `imports[].path:` entries under the same path. Returns a
// structured impact report so the UI can preview + the cascade can rewrite.
//
// `fromPath` / `toPath` are POSIX subpaths relative to the project model
// root (same shape as Explorer node.path values). `matchScope`:
//   - "file"   → rewrites refs where `ref === fromPath`
//   - "folder" → rewrites refs where `ref === fromPath` OR `ref` starts with `fromPath + "/"`
// (helpers imported at top of file from lib/renamePaths)

async function computeRenameImpact(projectId, fromPath, toPath, matchScope) {
  const report = { diagramRefs: [], importRefs: [], filesToRewrite: [] };
  try {
    const { files } = await fetchProjectFiles(projectId);
    const impactByFile = new Map();
    for (const f of files || []) {
      if (!f.path) continue;
      const isDiagram = /\.diagram\.ya?ml$/.test(f.path);
      const isModelOrManifest = /\.model\.ya?ml$|(^|\/)datalex\.ya?ml$/.test(f.path);
      if (!isDiagram && !isModelOrManifest) continue;
      // Skip files under the renamed subtree — they move with the folder,
      // we don't need to rewrite them (the PATCH moves them as-is).
      if (matchScope === "folder" && (f.path === fromPath || f.path.startsWith(fromPath + "/"))) continue;
      if (matchScope === "file" && f.path === fromPath) continue;

      let content;
      try {
        ({ content } = await fetchFileContent(f.fullPath));
      } catch (_err) { continue; }
      const doc = parseYamlObjectSafe(content);
      if (!doc) continue;

      let refs = 0;
      if (isDiagram && Array.isArray(doc.entities)) {
        for (const entry of doc.entities) {
          if (matchesRenameSource(entry?.file, fromPath, matchScope)) {
            refs += 1;
            report.diagramRefs.push({
              diagram: f.path,
              oldRef: String(entry.file).replace(/^\/+/, ""),
              newRef: rewriteRenameTarget(entry.file, fromPath, toPath),
              entity: entry.entity || null,
            });
          }
        }
      }
      if (isModelOrManifest && Array.isArray(doc.imports)) {
        for (const imp of doc.imports) {
          if (!imp || typeof imp !== "object") continue;
          if (matchesRenameSource(imp.path, fromPath, matchScope)) {
            refs += 1;
            report.importRefs.push({
              file: f.path,
              oldRef: String(imp.path).replace(/^\/+/, ""),
              newRef: rewriteRenameTarget(imp.path, fromPath, toPath),
              package: imp.package || null,
            });
          }
        }
      }
      if (refs > 0) {
        impactByFile.set(f.path, { fullPath: f.fullPath, refs });
      }
    }
    report.filesToRewrite = Array.from(impactByFile.entries()).map(([path, v]) => ({
      path,
      fullPath: v.fullPath,
      refs: v.refs,
    }));
  } catch (_err) {
    // Best-effort scan; surface an empty report rather than blocking the rename.
  }
  return report;
}

function formatRenameImpactPrompt(fromPath, toPath, report) {
  const lines = [`Rename "${fromPath}" → "${toPath}"?`, ""];
  if (report.filesToRewrite.length === 0) {
    lines.push("No diagram or import references point at this path.");
  } else {
    const diagramFiles = report.filesToRewrite.filter((f) => /\.diagram\.ya?ml$/.test(f.path));
    const modelFiles = report.filesToRewrite.filter((f) => !/\.diagram\.ya?ml$/.test(f.path));
    lines.push(`This will rewrite ${report.diagramRefs.length + report.importRefs.length} reference(s) across ${report.filesToRewrite.length} file(s):`);
    if (diagramFiles.length) {
      lines.push(`  • ${diagramFiles.length} diagram(s):`);
      for (const f of diagramFiles.slice(0, 6)) lines.push(`      ${f.path} (${f.refs} ref${f.refs === 1 ? "" : "s"})`);
      if (diagramFiles.length > 6) lines.push(`      … and ${diagramFiles.length - 6} more`);
    }
    if (modelFiles.length) {
      lines.push(`  • ${modelFiles.length} model/manifest file(s):`);
      for (const f of modelFiles.slice(0, 6)) lines.push(`      ${f.path} (${f.refs} ref${f.refs === 1 ? "" : "s"})`);
      if (modelFiles.length > 6) lines.push(`      … and ${modelFiles.length - 6} more`);
    }
  }
  lines.push("", "Continue?");
  return lines.join("\n");
}

// Build the rewrites list (without writing) for a pre-computed rename
// impact. Each entry is `{ path, fullPath, newContent }` so callers can
// either POST them to /rename-cascade (atomic) or write them one-at-a-time.
async function buildRenameCascadeRewrites(report, fromPath, toPath, matchScope) {
  const rewrites = [];
  const failures = [];
  for (const target of report.filesToRewrite) {
    try {
      const { content } = await fetchFileContent(target.fullPath);
      const doc = parseYamlObjectSafe(content);
      if (!doc) continue;
      let mutated = false;
      if (Array.isArray(doc.entities)) {
        for (const entry of doc.entities) {
          if (matchesRenameSource(entry?.file, fromPath, matchScope)) {
            entry.file = rewriteRenameTarget(entry.file, fromPath, toPath);
            mutated = true;
          }
        }
      }
      if (Array.isArray(doc.imports)) {
        for (const imp of doc.imports) {
          if (imp && typeof imp === "object" && matchesRenameSource(imp.path, fromPath, matchScope)) {
            imp.path = rewriteRenameTarget(imp.path, fromPath, toPath);
            mutated = true;
          }
        }
      }
      if (mutated) {
        const next = yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
        rewrites.push({ path: target.path, fullPath: target.fullPath, newContent: next });
      }
    } catch (err) {
      failures.push({ path: target.path, error: err?.message || String(err) });
    }
  }
  return { rewrites, failures };
}


// --- Phase 3.4 delete impact helpers ------------------------------------
// Compute how many diagrams / relationships reference the entities defined
// in the file (or folder) about to be deleted. Powers the confirmation
// dialog so users don't silently lose references.
async function computeDeleteImpact(projectId, subpath, scope) {
  const report = { entities: [], diagrams: [], relationships: [], files: [] };
  try {
    const { files } = await fetchProjectFiles(projectId);
    const allPaths = (files || []).filter((f) => f.path);

    // Collect entity names defined in the doomed path(s).
    let entityNames = [];
    let doomedPaths = new Set();
    if (scope === "folder") {
      entityNames = await collectEntitiesInFolder(projectId, subpath);
      const prefix = subpath.replace(/\/+$/, "") + "/";
      for (const f of allPaths) {
        if (f.path === subpath || f.path.startsWith(prefix)) doomedPaths.add(f.path);
      }
    } else {
      entityNames = await collectEntitiesInFile(projectId, subpath);
      doomedPaths.add(subpath);
    }
    report.entities = entityNames;
    report.files = Array.from(doomedPaths);
    if (entityNames.length === 0) return report;

    const entityLower = new Set(entityNames.map((n) => String(n).toLowerCase()));

    // Scan every surviving diagram for entity refs and every model file for
    // relationship endpoints that reference one of the doomed entities.
    for (const f of allPaths) {
      if (doomedPaths.has(f.path)) continue;
      const isDiagram = /\.diagram\.ya?ml$/.test(f.path);
      const isModel = /\.model\.ya?ml$/.test(f.path);
      if (!isDiagram && !isModel) continue;
      let content;
      try {
        ({ content } = await fetchFileContent(f.fullPath));
      } catch (_err) { continue; }
      const doc = parseYamlObjectSafe(content);
      if (!doc) continue;

      if (isDiagram && Array.isArray(doc.entities)) {
        const refs = [];
        for (const entry of doc.entities) {
          const fileRef = String(entry?.file || "").replace(/^\/+/, "");
          const hitsDoomedFile = doomedPaths.has(fileRef);
          const hitsDoomedName = entityLower.has(String(entry?.entity || "").toLowerCase());
          if (hitsDoomedFile || hitsDoomedName) {
            refs.push({ file: fileRef, entity: entry.entity || null });
          }
        }
        if (refs.length) report.diagrams.push({ path: f.path, refs });
      }
      if (isModel && Array.isArray(doc.relationships)) {
        for (const rel of doc.relationships) {
          const fromEntity = String(rel?.from || "").split(".")[0] || "";
          const toEntity = String(rel?.to || "").split(".")[0] || "";
          if (entityLower.has(fromEntity.toLowerCase()) || entityLower.has(toEntity.toLowerCase())) {
            report.relationships.push({
              file: f.path,
              name: rel.name || null,
              from: rel.from || null,
              to: rel.to || null,
            });
          }
        }
      }
    }
  } catch (_err) {
    // Best-effort — fall back to an empty report rather than blocking delete.
  }
  return report;
}

function formatDeleteImpactPrompt(subpath, scope, report) {
  const isFolder = scope === "folder";
  const lines = [
    isFolder
      ? `Delete folder "${subpath}" and everything inside it?`
      : `Delete "${subpath}"?`,
    "",
  ];
  if (isFolder && report.files.length > 1) {
    lines.push(`Removes ${report.files.length} file(s) from disk.`);
  }
  if (report.entities.length === 0) {
    lines.push("No entities defined — nothing to cascade.");
  } else {
    lines.push(`${report.entities.length} entity name(s) will be removed:`);
    const shown = report.entities.slice(0, 8);
    for (const n of shown) lines.push(`  • ${n}`);
    if (report.entities.length > 8) lines.push(`  … and ${report.entities.length - 8} more`);
    lines.push("");
    if (report.diagrams.length === 0 && report.relationships.length === 0) {
      lines.push("No diagram or relationship references point at these entities.");
    } else {
      if (report.diagrams.length) {
        const totalDiagramRefs = report.diagrams.reduce((acc, d) => acc + d.refs.length, 0);
        lines.push(`${totalDiagramRefs} reference(s) in ${report.diagrams.length} diagram(s) will be removed.`);
      }
      if (report.relationships.length) {
        lines.push(`${report.relationships.length} relationship(s) will be unwired.`);
      }
    }
  }
  lines.push("", "This cannot be undone. Continue?");
  return lines.join("\n");
}

function parseYamlObjectSafe(text) {
  try {
    const doc = yaml.load(text);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    return doc;
  } catch (_err) {
    return null;
  }
}

function isDataLexModelObject(doc) {
  return !!doc && typeof doc === "object" && !Array.isArray(doc) && !!doc.model && Array.isArray(doc.entities);
}

function ensurePlaceholderEntityForEmptyModel(yamlText) {
  const doc = parseYamlObjectSafe(yamlText);
  if (!isDataLexModelObject(doc)) return { content: yamlText, changed: false };
  if ((doc.entities || []).length > 0) return { content: yamlText, changed: false };
  doc.entities = [
    {
      name: "DbtSchemaInfo",
      type: "view",
      description: "Placeholder entity generated because dbt schema did not define importable models/sources.",
      fields: [
        {
          name: "row_id",
          type: "string",
          nullable: true,
          description: "Placeholder field inferred because dbt schema did not define columns.",
        },
      ],
    },
  ];
  return {
    content: yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false }),
    changed: true,
  };
}

function isLikelyDbtSchema(text, sourceName = "") {
  const doc = parseYamlObjectSafe(text);
  if (!doc) return false;
  const hasDbtSections =
    Array.isArray(doc.models) ||
    Array.isArray(doc.sources) ||
    Array.isArray(doc.semantic_models) ||
    Array.isArray(doc.metrics);
  if (!hasDbtSections) return false;
  const version = String(doc.version ?? "").trim();
  const looksLikeSchemaFile = /(^|\/)schema\.ya?ml$/i.test(String(sourceName || ""));
  return version === "2" || version === "2.0" || looksLikeSchemaFile;
}

function joinPath(basePath, childPath) {
  const base = String(basePath || "").replace(/[\/]+$/, "");
  const child = String(childPath || "").replace(/^[\/]+/, "");
  if (!base) return child;
  if (!child) return base;
  return `${base}/${child}`;
}

function sanitizeModelStem(name, fallback = "model") {
  const text = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!text) return fallback;
  return /^[0-9]/.test(text) ? `m_${text}` : text;
}

function buildDefaultDdlPath(projectPath, projectConfig, modelFullPath, dialect) {
  const base = String(projectPath || "").replace(/[\\/]+$/, "");
  const fileName = String(modelFullPath || "").replace(/\\/g, "/").split("/").pop() || "model.model.yaml";
  const stem = sanitizeModelStem(fileName.replace(/\.model\.ya?ml$/i, ""), "model");

  const configured = projectConfig?.ddlDialects?.[dialect] || "";
  const ddlFolder = configured ? String(configured).replace(/^\/+|\/+$/g, "") : `ddl/${dialect}`;
  return joinPath(base, `${ddlFolder}/${stem}.sql`);
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

// ---------------------------------------------------------------------------
// Autosave machinery
// ---------------------------------------------------------------------------
// Every `updateContent` call schedules a debounced save keyed by the active
// file's stable identity (fullPath in project mode, id offline). A key-scoped
// timer lets the user hop between tabs without losing pending writes — each
// tab's edit queue is independent.
//
// The module-scope `saveInFlight` set prevents a manual Ctrl+S from racing a
// scheduled autosave for the same file: whoever starts first wins, and any
// still-pending timer will coalesce into that save.
const AUTOSAVE_DEBOUNCE_MS = 800;
const autosaveTimers = new Map(); // key -> timeout id
const saveInFlight = new Set();    // keys currently being persisted

// Auto-commit debounce: coalesce bursty autosaves into a single commit per
// project. Keyed by project id so edits in one project don't trigger a
// commit in another. Cancelled on project switch so half-scheduled commits
// don't fire against the wrong working tree.
const AUTOCOMMIT_DEBOUNCE_MS = 2000;
const autocommitTimers = new Map(); // projectId -> timeout id

function cancelAutocommit(projectId) {
  if (!projectId) return;
  const t = autocommitTimers.get(projectId);
  if (t) {
    clearTimeout(t);
    autocommitTimers.delete(projectId);
  }
}

function renderCommitMessage(template, { file }) {
  const fallback = "DataLex: autosave";
  const base = typeof template === "string" && template.trim() ? template : "DataLex: autosave {path}";
  const path = file?.path || file?.fullPath || "";
  const name = file?.name || (path ? path.split("/").pop() : "");
  const msg = base.replace(/\{path\}/g, path).replace(/\{name\}/g, name).trim();
  return msg || fallback;
}

function autosaveKeyOf(file, offlineMode) {
  if (!file) return null;
  return offlineMode ? (file.id ? `id:${file.id}` : null) : (file.fullPath ? `fp:${file.fullPath}` : null);
}

function cancelAutosave(key) {
  if (!key) return;
  const t = autosaveTimers.get(key);
  if (t) {
    clearTimeout(t);
    autosaveTimers.delete(key);
  }
}

// Cheap structural signature used to decide whether a text edit changed
// the *shape* of the model (entities, fields, relationships, imports)
// vs. a pure description/comment tweak. Keyed by field presence only —
// exact values don't matter, only whether a name/type/fk appears. Same
// signature → skip the graph-version bump (avoids React Flow rerender
// churn while the user types a description).
function modelShapeSignature(content) {
  if (typeof content !== "string" || !content) return "";
  let doc;
  try { doc = yaml.load(content); } catch (_err) { return "__parse_error__"; }
  if (!doc || typeof doc !== "object") return "__not_object__";
  const parts = [];
  const entities = Array.isArray(doc.entities) ? doc.entities : [];
  for (const e of entities) {
    if (!e || typeof e !== "object") { parts.push("E?"); continue; }
    parts.push(`E:${e.name || ""}`);
    const fields = Array.isArray(e.fields) ? e.fields : Array.isArray(e.columns) ? e.columns : [];
    for (const f of fields) {
      if (!f || typeof f !== "object") { parts.push("f?"); continue; }
      parts.push(`f:${f.name || ""}:${f.type || f.data_type || ""}:${f.primary_key ? "P" : ""}${f.unique ? "U" : ""}${f.required ? "R" : ""}${f.foreign_key ? "K" : ""}`);
    }
  }
  // dbt-importer shape: single top-level `{kind: model, columns: [...]}`
  if (!entities.length && doc.kind && Array.isArray(doc.columns)) {
    parts.push(`M:${doc.name || ""}`);
    for (const c of doc.columns) {
      if (!c || typeof c !== "object") { parts.push("c?"); continue; }
      parts.push(`c:${c.name || ""}:${c.type || c.data_type || ""}`);
    }
  }
  const rels = Array.isArray(doc.relationships) ? doc.relationships : [];
  for (const r of rels) {
    if (!r || typeof r !== "object") { parts.push("r?"); continue; }
    parts.push(`r:${r.from || ""}->${r.to || ""}`);
  }
  const imports = Array.isArray(doc.imports) ? doc.imports : [];
  for (const imp of imports) {
    if (!imp) { parts.push("i?"); continue; }
    parts.push(`i:${imp?.path || imp?.file || ""}`);
  }
  return parts.join("|");
}

const useWorkspaceStore = create((set, get) => ({
  // Projects
  projects: [],
  activeProjectId: null,
  projectFiles: [],
  // Empty folders created via the "New folder" action that don't yet contain
  // any .yaml/.yml file — the server's `walkYamlFiles` won't return them, so
  // we track them client-side as POSIX subpaths and merge them into the tree
  // at render time. Auto-pruned on the next `fetchProjectFiles` if a real
  // file lands under the same path.
  optimisticFolders: [],
  projectPath: "",
  projectModelPath: "",
  projectConfig: null,
  lastAutoGeneratedDdl: null,
  lastAutoGenerateError: null,

  // Open-project tabs: ordered list of project ids with a parallel cache of
  // per-project file state so switching tabs feels instant and preserves
  // unsaved edits across projects.
  openProjects: [],
  projectCache: {}, // { [projectId]: { projectFiles, projectPath, projectModelPath, projectConfig, openTabs, activeFile, activeFileContent, originalContent, isDirty } }

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

  // Bumped any time a write happens that could affect the model graph
  // (entity delete / rename, save, file delete). Read-only panels that
  // fetch on demand (ModelGraphPanel, lineage overlays) subscribe to this
  // counter so they refresh instead of going stale. Bump rather than
  // push data: the graph endpoint is cheap and we don't want the store
  // to mirror the model-graph payload.
  modelGraphVersion: 0,

  // Summary of the most recent delete cascade — consumed by toast/UX to
  // surface "we also rewrote N files to remove M dangling references".
  // Null when no delete has happened yet; reset on every deleteFile call.
  lastDeleteCascade: null,

  // Summary of the most recent rename cascade (Phase 3.3) — consumed by
  // toast/UX to surface "we also rewrote N files to point at the new
  // path". Null when no rename has happened yet.
  lastRenameCascade: null,

  // Loading states
  loading: false,
  error: null,

  // Offline / fallback mode (no API server)
  offlineMode: false,
  localDocuments: [],

  // dbt editInPlace import: list of destination paths where multiple models
  // collide on the same file (e.g. shared `schema.yml`). Populated by
  // `loadDbtImportTreeAsProject` and used by the UI to warn the user that
  // save will overwrite sibling models in those files.
  dbtImportCollisions: [],

  // Content cache keyed by full-path, used by the .diagram.yaml adapter
  // so Canvas can render entities from files the user hasn't opened as a
  // tab. Filled lazily by `ensureFilesLoaded`. Eagerly populated entries
  // from `loadDbtImportTreeAsProject` also land here.
  fileContentCache: {},

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
    const { offlineMode, localDocuments, projectPath, projectModelPath, activeProjectId } = get();
    const targetModelPath = projectModelPath || projectPath;

    // Online mode with an active project: save to disk and open from project
    if (!offlineMode && targetModelPath && activeProjectId) {
      try {
        const fullPath = joinPath(targetModelPath, fileName);
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
          return savedFile.fullPath || fullPath;
        }
        return fullPath;
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
    return null;
  },

  loadMultipleImportedYaml: async (files) => {
    if (!files || files.length === 0) return;
    const { offlineMode, localDocuments, openTabs, projectPath, projectModelPath, activeProjectId } = get();
    const targetModelPath = projectModelPath || projectPath;

    // Online mode with an active project: save all files to disk
    if (!offlineMode && targetModelPath && activeProjectId) {
      try {
        for (const f of files) {
          const fileName = f.name.endsWith(".model.yaml") ? f.name : `${f.name}.model.yaml`;
          const fullPath = joinPath(targetModelPath, fileName);
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
          return fileTabs.map((ft) => ft.fullPath).filter(Boolean);
        }
        return [];
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
    return [];
  },

  saveOfflineDocs: () => {
    const { localDocuments } = get();
    localStorage.setItem("dm_offline_docs", JSON.stringify(localDocuments));
  },

  /* Ingest a `POST /api/dbt/import` response into the workspace so the
     Explorer shows the full folder tree and every file is openable.
     Runs entirely in-memory — nothing touches disk until the user wires up
     PR C (file/folder CRUD). Enters offline mode so subsequent save / open
     calls stay local rather than racing against whatever real project was
     previously active.

     Shape of `tree` is Array<{path, content}> as returned by the api route.
     `sourceLabel` is a human-readable label for the Explorer connection chip
     ("jaffle-shop demo", "github.com/dbt-labs/jaffle-shop", etc). */
  loadDbtImportTree: async (tree, { sourceLabel = "dbt import" } = {}) => {
    if (!Array.isArray(tree) || tree.length === 0) {
      throw new Error("loadDbtImportTree: empty tree — nothing to load.");
    }

    // Synthesise a file descriptor per entry. `id` lets offline `switchTab`
    // look the doc up; `fullPath` + `path` power the Explorer tree.
    const ts = Date.now();
    const docs = tree.map((entry, i) => {
      const rel = String(entry.path || entry.fullPath || "").replace(/^[/\\]+/, "");
      const name = rel.split("/").pop() || `file-${i}.yaml`;
      return {
        id: `dbt-import-${ts}-${i}`,
        name,
        fullPath: rel,
        path: rel,
        content: String(entry.content || ""),
      };
    });

    // Prefer an empty `.diagram.yaml` overview as the landing tab so the
    // user sees a blank "build your first diagram" canvas instead of
    // whichever source file happens to parse first. The api-server
    // seeds `datalex/diagrams/overview.diagram.yaml` when none exists.
    // Falls back to the previous staging → marts → anything ordering.
    const firstModel =
      docs.find((d) => /\.diagram\.ya?ml$/i.test(d.fullPath)) ||
      docs.find((d) => /models\/staging\/.*\.ya?ml$/i.test(d.fullPath)) ||
      docs.find((d) => /models\/.*\.ya?ml$/i.test(d.fullPath)) ||
      docs[0];

    // Snapshot the outgoing active project (if any) so a later project
    // switch still restores that workspace exactly as it was.
    get()._snapshotActiveProject();

    set({
      offlineMode: true,
      activeProjectId: null,
      projectFiles: docs,
      projectPath: sourceLabel,
      projectModelPath: "",
      projectConfig: null,
      localDocuments: docs,
      openTabs: firstModel ? [firstModel] : [],
      activeFile: firstModel || null,
      activeFileContent: firstModel?.content || "",
      originalContent: firstModel?.content || "",
      isDirty: false,
      loading: false,
      error: null,
    });

    // Keep the offline localStorage snapshot current so a page refresh
    // replays the same import instead of resetting to the starter sample.
    try {
      localStorage.setItem("dm_offline_docs", JSON.stringify(docs));
    } catch (_err) {
      // Safari private mode etc. — don't fail the import on storage errors.
    }
  },

  /**
   * Variant of `loadDbtImportTree` that binds the imported tree to a real,
   * registered DataLex project (`editInPlace` flow). Unlike the in-memory
   * variant above:
   *   - `offlineMode` stays false
   *   - `activeProjectId` is set; `projects` list is refreshed
   *   - each doc's `fullPath` is derived from `meta.datalex.dbt.source_path`
   *     so Save All writes back to the *original* dbt file path (with
   *     the original `.yml` extension), not a parallel `.yaml`
   *   - every file is dirty (differs from disk) and localDocuments holds
   *     the in-memory edit buffer until the user clicks Save All
   *
   * Known limitation: if the dbt project uses shared `schema.yml` files with
   * multiple models, the save path will clobber sibling models in that file.
   * Detected and warned; Phase 2 will route through `datalex generate dbt`
   * for merge-safe writes.
   */
  loadDbtImportTreeAsProject: async (tree, project) => {
    if (!Array.isArray(tree) || tree.length === 0) {
      throw new Error("loadDbtImportTreeAsProject: empty tree — nothing to load.");
    }
    if (!project || !project.id || !project.path) {
      throw new Error("loadDbtImportTreeAsProject: requires { id, path } project record.");
    }

    // Rewrite each imported doc's path to match its original dbt file:
    // `models/staging/stg_customers.yaml` (importer convention) →
    // `models/staging/stg_customers.yml` (what's actually in the dbt repo).
    // Source-path metadata is carried under `meta.datalex.dbt.source_path`
    // when available; otherwise we fall back to the importer-written path.
    const rewritePath = (rawPath, yamlText) => {
      let preferred = String(rawPath || "").replace(/^[/\\]+/, "");
      try {
        const doc = parseYamlObjectSafe(yamlText);
        const srcPath =
          doc?.meta?.datalex?.dbt?.source_path ||
          doc?.meta?.datalex?.dbt?.original_file_path;
        if (srcPath && typeof srcPath === "string") {
          preferred = srcPath.replace(/^[/\\]+/, "");
        }
      } catch (_) { /* fall through */ }
      // dbt repos almost always use `.yml`; the importer emits `.yaml`.
      // Normalise so the save destination matches what `git diff` expects.
      // `.diagram.yaml` is a DataLex convention — keep the full extension.
      if (/\.diagram\.ya?ml$/i.test(preferred)) return preferred;
      return preferred.replace(/\.yaml$/i, ".yml");
    };

    // Shape-B detector: count models per destination path. Any path that
    // ends up with >1 doc is a multi-model schema.yml collision.
    const destCounts = new Map();
    const ts = Date.now();
    const docs = tree.map((entry, i) => {
      const content = String(entry.content || "");
      const fullPath = rewritePath(entry.path || entry.fullPath, content);
      destCounts.set(fullPath, (destCounts.get(fullPath) || 0) + 1);
      const name = fullPath.split("/").pop() || `file-${i}.yml`;
      return {
        id: `dbt-import-${ts}-${i}`,
        name,
        fullPath,
        path: fullPath,
        content,
      };
    });

    const collisions = Array.from(destCounts.entries()).filter(([, n]) => n > 1);

    // Prefer an empty `.diagram.yaml` overview (seeded by the api-server
    // when the import didn't produce one) so the user lands on a blank
    // canvas to build, not on whichever source file parses first.
    const firstModel =
      docs.find((d) => /\.diagram\.ya?ml$/i.test(d.fullPath)) ||
      docs.find((d) => /models\/staging\/.*\.ya?ml$/i.test(d.fullPath)) ||
      docs.find((d) => /models\/.*\.ya?ml$/i.test(d.fullPath)) ||
      docs[0];

    // Ensure the project is in the store. Refresh from the server to pick up
    // any record we just created via /api/dbt/import.
    const serverProjects = await fetchProjects().catch(() => []);
    const mergedProjects = serverProjects.length
      ? serverProjects
      : [...(get().projects || []), project];

    get()._snapshotActiveProject();

    // Seed the content cache so .diagram.yaml files can render entities
    // from dbt-imported sources without an extra fetch round-trip.
    const contentCache = {};
    docs.forEach((d) => { contentCache[d.fullPath] = d.content; });

    set({
      offlineMode: false,
      projects: mergedProjects,
      activeProjectId: project.id,
      openProjects: Array.from(new Set([...(get().openProjects || []), project.id])),
      projectFiles: docs,
      projectPath: project.path,
      projectModelPath: "",
      projectConfig: null,
      // We still populate `localDocuments` so the edit buffer survives tab
      // switches before the first save. Once Save All lands files on disk,
      // subsequent reads come from the server like any other project.
      localDocuments: docs,
      fileContentCache: { ...(get().fileContentCache || {}), ...contentCache },
      openTabs: firstModel ? [firstModel] : [],
      activeFile: firstModel || null,
      activeFileContent: firstModel?.content || "",
      originalContent: "", // empty so every file shows as dirty vs. "disk"
      isDirty: !!firstModel,
      loading: false,
      error: null,
      dbtImportCollisions: collisions.map(([p]) => p),
    });
  },

  addProjectFolder: async (name, path, createIfMissing = false, options = {}) => {
    set({ loading: true, error: null });
    try {
      const project = await addProject(name, path, createIfMissing, options);
      set((s) => ({ projects: [...s.projects, project], loading: false }));
      await get().selectProject(project.id);
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  updateProjectFolder: async (id, name, path, createIfMissing = false, options = {}) => {
    set({ loading: true, error: null });
    try {
      const updated = await updateProject(id, name, path, createIfMissing, options);
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
        const openProjects = s.openProjects.filter((pid) => pid !== id);
        const projectCache = { ...s.projectCache };
        delete projectCache[id];
        const newState = { projects, openProjects, projectCache };
        if (s.activeProjectId === id) {
          newState.activeProjectId = openProjects[0] || projects[0]?.id || null;
          newState.projectFiles = [];
          newState.projectPath = "";
          newState.projectModelPath = "";
          newState.projectConfig = null;
          newState.activeFile = null;
          newState.activeFileContent = "";
          newState.openTabs = [];
        }
        return newState;
      });
      const { activeProjectId } = get();
      if (activeProjectId) {
        // Force a fresh selection (bypass same-id guard).
        set({ activeProjectId: null });
        await get().selectProject(activeProjectId);
      }
    } catch (err) {
      set({ error: err.message });
    }
  },

  // Snapshot the current project's file state into the cache. Called before
  // switching away so edits / open tabs survive a tab switch.
  _snapshotActiveProject: () => {
    const s = get();
    const id = s.activeProjectId;
    if (!id) return;
    const snapshot = {
      projectFiles: s.projectFiles,
      optimisticFolders: s.optimisticFolders || [],
      projectPath: s.projectPath,
      projectModelPath: s.projectModelPath,
      projectConfig: s.projectConfig,
      openTabs: s.openTabs,
      activeFile: s.activeFile,
      activeFileContent: s.activeFileContent,
      originalContent: s.originalContent,
      isDirty: s.isDirty,
    };
    set((prev) => ({ projectCache: { ...prev.projectCache, [id]: snapshot } }));
  },

  _hydrateFromCache: (projectId) => {
    const cached = get().projectCache[projectId];
    if (!cached) return false;
    set({
      activeProjectId: projectId,
      projectFiles: cached.projectFiles || [],
      optimisticFolders: cached.optimisticFolders || [],
      projectPath: cached.projectPath || "",
      projectModelPath: cached.projectModelPath || "",
      projectConfig: cached.projectConfig || null,
      openTabs: cached.openTabs || [],
      activeFile: cached.activeFile || null,
      activeFileContent: cached.activeFileContent || "",
      originalContent: cached.originalContent || "",
      isDirty: cached.isDirty || false,
      loading: false,
      error: null,
    });
    return true;
  },

  selectProject: async (projectId) => {
    const { activeProjectId, openProjects } = get();
    if (activeProjectId === projectId) return;

    // Cancel any pending auto-commit for the outgoing project — switching
    // projects invalidates its working-tree assumption.
    if (activeProjectId) cancelAutocommit(activeProjectId);

    // Snapshot outgoing project so switching back restores state.
    get()._snapshotActiveProject();

    // Ensure tab exists in openProjects ordered list.
    if (!openProjects.includes(projectId)) {
      set({ openProjects: [...openProjects, projectId] });
    }

    // Selecting a real project always exits offline/demo mode. A prior
    // `loadProjects` failure or an offline dbt import may have stuck this
    // flag true; leaving it set here is what made the UI keep rendering
    // DEMO_SCHEMA even after a successful project switch.
    set({ offlineMode: false });

    // Try hydrating from cache first — instant switch.
    if (get()._hydrateFromCache(projectId)) return;

    // Cold load from server.
    set({
      activeProjectId: projectId,
      loading: true,
      error: null,
      openTabs: [],
      activeFile: null,
      activeFileContent: "",
      originalContent: "",
      isDirty: false,
    });
    try {
      const data = await fetchProjectFiles(projectId);
      set({
        projectFiles: data.files || [],
        // Project switch invalidates client-only empty-folder entries —
        // the new project has its own tree and any stale optimisticFolders
        // would otherwise leak across project boundaries.
        optimisticFolders: [],
        projectPath: data.projectPath || "",
        projectModelPath: data.projectModelPath || data.projectPath || "",
        projectConfig: data.projectConfig || null,
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

  // Close a project tab. If the tab was active, move to the neighbor.
  closeProject: async (projectId) => {
    const { openProjects, activeProjectId, projectCache } = get();
    const idx = openProjects.indexOf(projectId);
    if (idx === -1) return;

    const nextOpen = openProjects.filter((id) => id !== projectId);
    const nextCache = { ...projectCache };
    delete nextCache[projectId];
    set({ openProjects: nextOpen, projectCache: nextCache });

    if (activeProjectId !== projectId) return;

    if (nextOpen.length === 0) {
      set({
        activeProjectId: null,
        projectFiles: [],
        projectPath: "",
        projectModelPath: "",
        projectConfig: null,
        openTabs: [],
        activeFile: null,
        activeFileContent: "",
        originalContent: "",
        isDirty: false,
      });
      return;
    }

    const fallbackId = nextOpen[Math.max(0, idx - 1)] || nextOpen[0];
    // Force a fresh selection path without the early-return guard.
    set({ activeProjectId: null });
    await get().selectProject(fallbackId);
  },

  // Cycle to the next / previous open project tab. Used by Cmd+Tab.
  cycleProject: async (direction = 1) => {
    const { openProjects, activeProjectId } = get();
    if (openProjects.length < 2) return;
    const idx = openProjects.indexOf(activeProjectId);
    if (idx === -1) {
      await get().selectProject(openProjects[0]);
      return;
    }
    const len = openProjects.length;
    const nextIdx = (idx + direction + len) % len;
    await get().selectProject(openProjects[nextIdx]);
  },

  // --- File actions ---
  openFile: async (fileInfo) => {
    // Guard: if the requested file is already the active file AND has
    // unsaved in-memory edits, do NOT refetch. Fetching would overwrite
    // the user's changes with the disk version — exactly the data-loss
    // path that made diagram edits "suddenly disappear."
    const existing = get();
    if (
      existing.activeFile &&
      fileInfo &&
      existing.activeFile.fullPath === fileInfo.fullPath &&
      existing.isDirty
    ) {
      return;
    }
    set({ loading: true, error: null });
    try {
      const data = await fetchFileContent(fileInfo.fullPath);
      const sourceName = fileInfo.path || fileInfo.name || "";
      let renderedContent = data.content;

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
          }
        } catch (_err) {
          // Keep original content if conversion fails.
        }
      }

      const placeholderFix = ensurePlaceholderEntityForEmptyModel(renderedContent);
      renderedContent = placeholderFix.content;

      const file = { ...fileInfo, content: renderedContent };
      set((s) => {
        const alreadyOpen = s.openTabs.some((t) => t.fullPath === file.fullPath);
        return {
          activeFile: file,
          activeFileContent: renderedContent,
          originalContent: renderedContent,
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
    // Before we repoint activeFile to a different tab, flush any pending
    // autosave on the outgoing file so its edits land on disk. Without
    // this, the 800ms debounce timer would still reference the previous
    // activeFile when it fires and the `autosaveKeyOf(current) !== key`
    // guard would cancel the save entirely.
    try { await get().flushAutosave(); } catch (_err) { /* save error already in store */ }

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

    // Switching to the currently active file is a no-op. Without this
    // guard, clicking the same tab (or a cascade of re-renders that
    // re-invoke switchTab for the same file) would call openFile, which
    // refetches from disk — clobbering any in-memory edits that haven't
    // been Saved yet. This was the root cause of relationships built on
    // a diagram "suddenly disappearing" between actions.
    const { activeFile } = get();
    if (activeFile && activeFile.fullPath === fileInfo.fullPath) return;

    // Switching to another already-open tab: rehydrate from its cached
    // content (updated on every updateContent via this path — see below)
    // rather than refetching from disk. Preserves unsaved edits on a
    // file the user left open and comes back to. Falls through to
    // openFile when the tab's cache is missing (cold tab).
    const cached = get().openTabs.find((t) => t.fullPath === fileInfo.fullPath);
    if (cached && typeof cached.content === "string") {
      set({
        activeFile: cached,
        activeFileContent: cached.content,
        originalContent: cached.originalContent != null ? cached.originalContent : cached.content,
        isDirty: cached.originalContent != null && cached.content !== cached.originalContent,
      });
      return;
    }
    await get().openFile(fileInfo);
  },

  closeTab: (fileInfo) => {
    // Flush the outgoing tab's pending autosave (same reason as switchTab).
    // We kick it off without awaiting because closeTab is synchronous in
    // its existing contract — callers don't await it. The write still
    // lands; the active file only changes after this turn.
    const { activeFile, offlineMode } = get();
    const key = offlineMode ? "id" : "fullPath";
    if (activeFile && activeFile[key] === fileInfo[key]) {
      get().flushAutosave(fileInfo).catch(() => {});
    } else {
      // Cancel any pending timer for a non-active closing tab so it
      // doesn't fire against a file that's about to be closed.
      cancelAutosave(autosaveKeyOf(fileInfo, offlineMode));
    }

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

  updateContent: (content, options = {}) => {
    const { originalContent, offlineMode, activeFile, activeFileContent, localDocuments } = get();
    const prev = activeFileContent;

    // Every user-visible mutation passes through this setter; push a
    // history entry unless the caller asked to skip (undo/redo themselves
    // call `updateContent` and must not re-record the inverse operation).
    if (!options.skipHistory && activeFile) {
      const key = fileKeyOf(activeFile);
      if (key) useHistoryStore.getState().push(key, prev, content);
    }

    set((s) => {
      const nextState = {
        activeFileContent: content,
        isDirty: content !== originalContent,
      };
      // Keep the active file's openTabs cache in sync so switching away
      // and back preserves unsaved edits. Without this, switchTab would
      // fall back to openFile (disk fetch) and wipe the in-memory
      // relationship / entity-move the user just made.
      if (activeFile && Array.isArray(s.openTabs)) {
        const key = s.offlineMode ? "id" : "fullPath";
        const lookup = activeFile[key];
        let mutated = false;
        const nextTabs = s.openTabs.map((t) => {
          if (!t || t[key] !== lookup) return t;
          mutated = true;
          return {
            ...t,
            content,
            // Remember the disk baseline on the tab so switchTab can
            // recompute isDirty correctly when rehydrating from cache.
            originalContent: t.originalContent != null ? t.originalContent : originalContent,
          };
        });
        if (mutated) nextState.openTabs = nextTabs;
      }
      return nextState;
    });

    if (offlineMode && activeFile) {
      const updated = localDocuments.map((d) =>
        d.id === activeFile.id ? { ...d, content } : d
      );
      set({ localDocuments: updated });
      get().saveOfflineDocs();
    }

    // If the structural shape changed (new/removed entity, field, FK,
    // relationship, import), bump modelGraphVersion so the read-only
    // diagram adapter rebuilds. Pure description/comment edits land on
    // the same signature and don't trigger a rebuild.
    if (activeFile && typeof content === "string") {
      const prevSig = modelShapeSignature(prev);
      const nextSig = modelShapeSignature(content);
      if (prevSig !== nextSig) {
        set((s) => ({ modelGraphVersion: (s.modelGraphVersion || 0) + 1 }));
      }
    }

    // Debounced autosave: schedule a save for this file after an idle
    // window. Every subsequent `updateContent` for the same key resets
    // the timer so bursts of edits collapse into one write. We skip the
    // schedule entirely when content matches disk (nothing to save) and
    // when the caller opts out explicitly (e.g. offline mode already
    // persists via saveOfflineDocs, or tests mutating raw state).
    if (!options.skipAutosave && activeFile && !offlineMode && content !== originalContent) {
      const key = autosaveKeyOf(activeFile, false);
      if (key) {
        cancelAutosave(key);
        const timer = setTimeout(() => {
          autosaveTimers.delete(key);
          const state = get();
          const current = state.activeFile;
          // Only fire if we're still looking at the same file and it
          // still has unsaved changes. Otherwise the user switched tabs
          // (handled by switchTab flush) or a manual save already landed.
          if (!current || autosaveKeyOf(current, state.offlineMode) !== key) return;
          if (!state.isDirty) return;
          get().saveCurrentFile().catch(() => {
            // saveCurrentFile already writes `error` into store state;
            // swallow here so an unhandled rejection doesn't leak.
          });
        }, AUTOSAVE_DEBOUNCE_MS);
        autosaveTimers.set(key, timer);
      }
    }
  },

  // Force any pending autosave for `file` (defaults to the active file)
  // to fire now. Used by inspector inputs on blur, by tab switch / close,
  // and by Ctrl+S so manual saves coalesce with scheduled ones.
  flushAutosave: async (file) => {
    const { activeFile, offlineMode, isDirty } = get();
    const target = file || activeFile;
    if (!target) return;
    const key = autosaveKeyOf(target, offlineMode);
    if (!key) return;
    const hadTimer = autosaveTimers.has(key);
    cancelAutosave(key);
    // Only flush-to-disk if there's actually pending dirty state for the
    // active file — flushAutosave for an inactive tab just cancels its
    // timer (we don't have that file's content in hand to write).
    if (!hadTimer) return;
    if (activeFile && autosaveKeyOf(activeFile, offlineMode) === key && isDirty) {
      await get().saveCurrentFile();
    }
  },

  // Bump the model-graph revision so subscribers (e.g. ModelGraphPanel)
  // know the underlying YAML changed and can refetch. Callers: entity
  // delete (Shell, ViewsView, EntityPanel), save, file delete — anywhere
  // we mutate model shape and want the read-only graph to catch up.
  bumpModelGraphVersion: () => {
    set((s) => ({ modelGraphVersion: (s.modelGraphVersion || 0) + 1 }));
  },

  // Persist a partial update to the active project's config (merges with a
  // one-level deep merge server-side). Used by the auto-commit toggle and
  // any other "sticky project preference" surface.
  updateProjectConfig: async (patch) => {
    const { activeProjectId } = get();
    if (!activeProjectId || !patch || typeof patch !== "object") return null;
    const res = await patchProjectConfig(activeProjectId, patch);
    const nextConfig = res?.projectConfig ?? null;
    set((s) => {
      const cache = { ...(s.projectCache || {}) };
      const entry = cache[activeProjectId];
      if (entry) cache[activeProjectId] = { ...entry, projectConfig: nextConfig };
      return { projectConfig: nextConfig, projectCache: cache };
    });
    // Cancel any pending auto-commit if the user just disabled the toggle.
    if (patch.autoCommit && patch.autoCommit.enabled === false) {
      cancelAutocommit(activeProjectId);
    }
    return nextConfig;
  },

  undo: () => {
    const { activeFile } = get();
    if (!activeFile) return false;
    const key = fileKeyOf(activeFile);
    const snapshot = useHistoryStore.getState().undo(key);
    if (snapshot == null) return false;
    get().updateContent(snapshot, { skipHistory: true });
    return true;
  },

  redo: () => {
    const { activeFile } = get();
    if (!activeFile) return false;
    const key = fileKeyOf(activeFile);
    const snapshot = useHistoryStore.getState().redo(key);
    if (snapshot == null) return false;
    get().updateContent(snapshot, { skipHistory: true });
    return true;
  },

  saveCurrentFile: async () => {
    const { activeFile, activeFileContent, offlineMode, projectPath, projectConfig } = get();
    if (!activeFile) return;

    // Cancel any pending autosave for this file — we're saving now, so
    // the queued timer would at best be a no-op and at worst race with
    // a subsequent edit the user is about to make.
    const saveKey = autosaveKeyOf(activeFile, offlineMode);
    if (saveKey) cancelAutosave(saveKey);

    if (offlineMode) {
      set({ originalContent: activeFileContent, isDirty: false });
      get().saveOfflineDocs();
      return;
    }

    // Guard against concurrent saves of the same file: if one is already
    // in flight, skip the second call. The pending write will either
    // include the later edit (if updateContent fired before the network
    // request) or the next autosave tick will catch it.
    if (saveKey && saveInFlight.has(saveKey)) return;
    if (saveKey) saveInFlight.add(saveKey);

    set({ loading: true, error: null, lastAutoGeneratedDdl: null, lastAutoGenerateError: null });
    try {
      await saveFileContent(activeFile.fullPath, activeFileContent);

      // Auto-generate baseline DDL on save (GitOps mode). We only do this for .model.yaml files
      // and only when the project has a default dialect set (from the connector pull flow).
      try {
        const isModelYaml = /\.model\.ya?ml$/i.test(String(activeFile.name || activeFile.fullPath || ""));
        // Prefer project-configured dialect, but default to snowflake so new projects still
        // get baseline DDL generation without extra setup.
        const dialect = String(projectConfig?.defaultDialect || "snowflake").trim().toLowerCase();
        const supported = new Set(["snowflake", "databricks", "bigquery"]);
        if (isModelYaml && supported.has(dialect) && projectPath) {
          const ddlOutPath = buildDefaultDdlPath(projectPath, projectConfig, activeFile.fullPath, dialect);
          const generated = await generateForwardSql(activeFile.fullPath, dialect);
          const sqlText = String(generated?.sql || generated?.output || "").trim();
          if (sqlText) {
            await saveFileContent(ddlOutPath, `${sqlText}\n`);
            set({ lastAutoGeneratedDdl: ddlOutPath, lastAutoGenerateError: null });
          }
        }
      } catch (autoErr) {
        // Never fail the YAML save due to DDL generation issues.
        set({ lastAutoGenerateError: String(autoErr?.message || autoErr), lastAutoGeneratedDdl: null });
      }

      set((s) => {
        // Also update the cached tab entry so switchTab's rehydrate
        // path sees the new disk baseline (originalContent) and doesn't
        // spuriously report isDirty after a clean save.
        const key = s.offlineMode ? "id" : "fullPath";
        const lookup = activeFile[key];
        const openTabs = (s.openTabs || []).map((t) =>
          t && t[key] === lookup
            ? { ...t, content: activeFileContent, originalContent: activeFileContent }
            : t,
        );
        return {
          originalContent: activeFileContent,
          isDirty: false,
          loading: false,
          openTabs,
          // Save may have changed entity shape / relationships — invalidate
          // the read-only graph panel so it reflects the new persisted state.
          modelGraphVersion: (s.modelGraphVersion || 0) + 1,
        };
      });

      // Auto-commit (opt-in, debounced). We schedule the commit rather
      // than firing immediately so a burst of autosaves collapses into a
      // single commit. `projectConfig.autoCommit.messageTemplate` may use
      // `{path}` / `{name}` placeholders.
      const autoCfg = projectConfig?.autoCommit;
      const { activeProjectId } = get();
      if (autoCfg?.enabled && activeProjectId) {
        cancelAutocommit(activeProjectId);
        const message = renderCommitMessage(autoCfg.messageTemplate, { file: activeFile });
        const timer = setTimeout(async () => {
          autocommitTimers.delete(activeProjectId);
          // Re-check the flag at fire time — the user may have toggled it
          // off while the debounce was pending.
          const cur = get();
          if (cur.activeProjectId !== activeProjectId) return;
          if (!cur.projectConfig?.autoCommit?.enabled) return;
          try {
            await commitGit(activeProjectId, { message, paths: [] });
            set({ lastAutoCommit: { projectId: activeProjectId, message, at: Date.now() } });
          } catch (err) {
            set({ lastAutoCommitError: err?.message || String(err) });
          }
        }, AUTOCOMMIT_DEBOUNCE_MS);
        autocommitTimers.set(activeProjectId, timer);
      }
    } catch (err) {
      set({ error: err.message, loading: false });
    } finally {
      if (saveKey) saveInFlight.delete(saveKey);
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
    // Optimistic: don't flip the full-screen `loading` spinner — the file
    // appears in the Explorer instantly on POST resolve. selectProject()
    // used to fire a GET and stall the UI for 1–2s before anything
    // rendered; now we splice the returned descriptor into projectFiles
    // and open it, no round-trip.
    set({ error: null });
    try {
      const file = await createProjectFile(activeProjectId, name, content || SAMPLE_MODEL);
      const desc = {
        name: file.name,
        path: file.path,
        fullPath: file.fullPath,
        size: file.size,
        modifiedAt: file.modifiedAt,
      };
      set((s) => {
        // Dedupe by fullPath — if the user triggered the same create twice
        // the POST would 409, but belt-and-braces for refresh races.
        const already = (s.projectFiles || []).some(
          (f) => (f.fullPath || f.path) === (desc.fullPath || desc.path)
        );
        const nextFiles = already ? s.projectFiles : [...(s.projectFiles || []), desc];
        // Prune any optimistic empty-folder entries that this new file
        // now lives inside — they're no longer "empty".
        const parentDir = String(desc.path || "").split("/").slice(0, -1).join("/");
        const nextFolders = (s.optimisticFolders || []).filter(
          (p) => p !== parentDir && !(parentDir + "/").startsWith(p + "/")
        );
        return { projectFiles: nextFiles, optimisticFolders: nextFolders };
      });
      if (file.fullPath) {
        await get().openFile(desc);
      }
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  /* Create a new .diagram.yaml file. Defaults to `datalex/diagrams/` to
     match the conventional layout, but accepts `targetFolder` so the
     Explorer context-menu "New diagram here" can land it in the clicked
     folder instead. Target folder is a POSIX subpath relative to the
     project model root — same shape as Explorer node `path` values. */
  createNewDiagram: async (slug, targetFolder = "") => {
    const clean = String(slug || "untitled")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "untitled";
    const folder = String(targetFolder || "").replace(/^\/+|\/+$/g, "");
    const subpath = folder
      ? `${folder}/${clean}.diagram.yaml`
      : `datalex/diagrams/${clean}.diagram.yaml`;
    const content =
      `kind: diagram\n` +
      `name: ${clean}\n` +
      `title: ${clean.replace(/_/g, " ")}\n` +
      `entities: []\n`;
    await get().createNewFile(subpath, content);
    return subpath;
  },

  /* Prefetch file contents into `fileContentCache`. Skips entries that
     are already cached or that don't appear in `projectFiles`. No-op in
     offline mode (content is already in `localDocuments`). */
  ensureFilesLoaded: async (paths) => {
    const { projectFiles, fileContentCache, offlineMode, localDocuments } = get();
    if (!Array.isArray(paths) || paths.length === 0) return;

    // Offline: mirror localDocuments into the cache so adaptDiagramYaml
    // sees the same content on either path.
    if (offlineMode) {
      const next = { ...fileContentCache };
      let changed = false;
      (localDocuments || []).forEach((d) => {
        const key = (d.fullPath || d.path || d.name || "").replace(/^[/\\]+/, "");
        if (key && !(key in next) && typeof d.content === "string") {
          next[key] = d.content;
          changed = true;
        }
      });
      if (changed) set({ fileContentCache: next });
      return;
    }

    const byPath = new Map();
    (projectFiles || []).forEach((f) => {
      const key = (f?.fullPath || f?.path || "").replace(/^[/\\]+/, "");
      if (key) byPath.set(key, f);
    });

    const toFetch = paths
      .map((p) => String(p || "").replace(/^[/\\]+/, ""))
      .filter((p) => p && !(p in fileContentCache) && byPath.has(p));
    if (toFetch.length === 0) return;

    const results = await Promise.all(
      toFetch.map(async (p) => {
        const file = byPath.get(p);
        try {
          const data = await fetchFileContent(file.fullPath);
          return [p, String(data?.content ?? "")];
        } catch (_err) {
          return [p, ""];
        }
      })
    );
    set((s) => {
      const next = { ...s.fileContentCache };
      results.forEach(([k, v]) => { next[k] = v; });
      return { fileContentCache: next };
    });
  },

  /* Append one or more file references to the active diagram buffer.
     `entries` = [{file, entity, x?, y?}]. Routes through updateContent
     so the file is flagged dirty and Save All picks it up. */
  addDiagramReferences: async (entries) => {
    const { activeFile, activeFileContent } = get();
    if (!activeFile || !/\.diagram\.ya?ml$/i.test(activeFile.name || "")) {
      throw new Error("addDiagramReferences: active file is not a diagram.");
    }
    // Lazy-import to avoid a circular import with yamlPatch if any.
    const { addDiagramEntries } = await import("../design/yamlPatch");
    const next = addDiagramEntries(activeFileContent || "", entries || []);
    if (next && next !== activeFileContent) {
      get().updateContent(next);
      // Make sure the referenced files' contents are cached for rendering.
      const paths = (entries || []).map((e) => e.file).filter(Boolean);
      await get().ensureFilesLoaded(paths);
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

  // --- PR C: folder + file CRUD -------------------------------------------
  // These only operate in online mode against an active project. `path`
  // values are POSIX subpaths relative to the project's model root —
  // the same shape the Explorer tree uses for node.path.

  createFolder: async (subpath) => {
    const { activeProjectId, offlineMode } = get();
    if (offlineMode) throw new Error("Folder creation requires API mode.");
    if (!activeProjectId) throw new Error("No active project.");
    if (!subpath) throw new Error("Folder path is required.");
    // Optimistic: push the new folder into `optimisticFolders` immediately
    // so the Explorer shows it without waiting for the disk write + GET
    // round-trip. If the POST fails we roll back.
    const norm = String(subpath).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    set((s) => ({
      optimisticFolders: (s.optimisticFolders || []).includes(norm)
        ? s.optimisticFolders
        : [...(s.optimisticFolders || []), norm],
      error: null,
    }));
    try {
      await createProjectFolder(activeProjectId, subpath);
    } catch (err) {
      // Rollback the optimistic entry on disk-write failure.
      set((s) => ({
        optimisticFolders: (s.optimisticFolders || []).filter((p) => p !== norm),
        error: err.message,
      }));
      throw err;
    }
  },

  // Compute a rename impact report without mutating anything on disk.
  // Thin wrapper around the module-level `computeRenameImpact` so callers
  // (LeftPanel preview dialog) don't need to import the helper directly.
  previewRenameImpact: async (fromPath, toPath, matchScope = "file") => {
    const { activeProjectId, offlineMode } = get();
    if (offlineMode || !activeProjectId) return { diagramRefs: [], importRefs: [], filesToRewrite: [] };
    return computeRenameImpact(activeProjectId, fromPath, toPath, matchScope);
  },

  formatRenameImpactPrompt,

  // Phase 3.4 — delete impact preview. Called by the Explorer context
  // menu before the confirmation modal so users see which diagrams and
  // relationships they're about to invalidate.
  previewDeleteImpact: async (subpath, scope = "file") => {
    const { activeProjectId, offlineMode } = get();
    if (offlineMode || !activeProjectId) {
      return { entities: [], diagrams: [], relationships: [], files: [] };
    }
    return computeDeleteImpact(activeProjectId, subpath, scope);
  },

  formatDeleteImpactPrompt,

  // Rename OR move a file — server treats both the same (it's just a rename
  // to a different subpath). If the file was open in a tab it's closed; if
  // it was the active file we re-open it at its new location.
  renameFile: async (fromPath, toPath) => {
    const { activeProjectId, offlineMode, activeFile } = get();
    if (offlineMode) throw new Error("Rename requires API mode.");
    if (!activeProjectId) throw new Error("No active project.");
    if (!fromPath || !toPath) throw new Error("fromPath and toPath are required.");
    if (fromPath === toPath) return;
    const wasActive = !!(activeFile && activeFile.path === fromPath);
    set({ loading: true, error: null, lastRenameCascade: null });
    // Scan for diagram/import references BEFORE the PATCH — we need the
    // old path's references to know what to rewrite.
    const impact = await computeRenameImpact(activeProjectId, fromPath, toPath, "file");
    try {
      // Pre-build rewrites so we can submit them atomically with the move.
      // Older servers without /rename-cascade (or clients that prefer the
      // per-file path) fall back to PATCH + per-file saves.
      const { rewrites, failures: buildFailures } = impact.filesToRewrite.length
        ? await buildRenameCascadeRewrites(impact, fromPath, toPath, "file")
        : { rewrites: [], failures: [] };

      let result;
      let cascadeFailures = buildFailures;
      let filesUpdated = [];
      if (rewrites.length > 0) {
        const atomic = await renameCascadeAtomic(activeProjectId, {
          fromPath, toPath, kind: "file",
          rewrites: rewrites.map((r) => ({ path: r.path, newContent: r.newContent })),
        });
        filesUpdated = atomic.written || [];
        // PATCH /files returns {file.fullPath}; the atomic endpoint returns
        // {toPath}. Stub a matching shape so the reopen logic below finds
        // the moved file by relative path.
        result = { file: { path: atomic.toPath || toPath } };
      } else {
        result = await renameProjectFile(activeProjectId, fromPath, toPath);
      }
      // Drop any tab pointing at the old path.
      set((s) => ({
        openTabs: s.openTabs.filter((t) => t.path !== fromPath),
        activeFile: wasActive ? null : s.activeFile,
        activeFileContent: wasActive ? "" : s.activeFileContent,
        originalContent: wasActive ? "" : s.originalContent,
        isDirty: wasActive ? false : s.isDirty,
      }));
      const data = await fetchProjectFiles(activeProjectId);
      const cascade = { filesUpdated, failures: cascadeFailures };
      set((s) => ({
        projectFiles: data.files || [],
        modelGraphVersion: (s.modelGraphVersion || 0) + 1,
        lastRenameCascade: {
          fromPath, toPath,
          impact,
          filesUpdated: cascade.filesUpdated,
          failures: cascade.failures,
        },
      }));
      if (wasActive) {
        const moved = (data.files || []).find((f) =>
          (result?.file?.fullPath && f.fullPath === result.file.fullPath) ||
          (result?.file?.path && f.path === result.file.path)
        );
        if (moved) await get().openFile(moved);
      }
      set({ loading: false });
      return result;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  // Alias — semantically identical to rename.
  moveFile: async (fromPath, toPath) => get().renameFile(fromPath, toPath),

  // Rename / move a folder. Any open tabs under the old folder get their
  // `path` / `fullPath` rewritten so users keep their scroll + cursor.
  renameFolder: async (fromPath, toPath) => {
    const { activeProjectId, offlineMode } = get();
    if (offlineMode) throw new Error("Folder rename requires API mode.");
    if (!activeProjectId) throw new Error("No active project.");
    if (!fromPath || !toPath) throw new Error("fromPath and toPath are required.");
    if (fromPath === toPath) return;
    const normalize = (p) => String(p).replace(/\/+$/, "");
    const fromNorm = normalize(fromPath);
    const toNorm = normalize(toPath);
    set({ loading: true, error: null, lastRenameCascade: null });
    // Scan references BEFORE the PATCH moves files — afterwards the old
    // paths don't exist so refs that still target them would be dangling.
    const impact = await computeRenameImpact(activeProjectId, fromNorm, toNorm, "folder");
    try {
      const { rewrites, failures: buildFailures } = impact.filesToRewrite.length
        ? await buildRenameCascadeRewrites(impact, fromNorm, toNorm, "folder")
        : { rewrites: [], failures: [] };
      let atomicResult = null;
      if (rewrites.length > 0) {
        atomicResult = await renameCascadeAtomic(activeProjectId, {
          fromPath: fromNorm, toPath: toNorm, kind: "folder",
          rewrites: rewrites.map((r) => ({ path: r.path, newContent: r.newContent })),
        });
      } else {
        await renameProjectFolder(activeProjectId, fromNorm, toNorm);
      }
      const data = await fetchProjectFiles(activeProjectId);
      const prefix = fromNorm + "/";
      const rewritePath = (p) => (p === fromNorm || p?.startsWith?.(prefix)) ? toNorm + p.slice(fromNorm.length) : p;
      set((s) => {
        const newTabs = s.openTabs
          .map((t) => {
            if (!t.path || !t.path.startsWith(prefix)) return t;
            const newRel = rewritePath(t.path);
            const match = (data.files || []).find((f) => f.path === newRel);
            return match ? { ...t, ...match, content: t.content } : t;
          })
          .filter((t) => !t.path || (data.files || []).some((f) => f.path === t.path));
        const activeMoved = s.activeFile && s.activeFile.path && s.activeFile.path.startsWith(prefix);
        let newActive = s.activeFile;
        if (activeMoved) {
          const newRel = rewritePath(s.activeFile.path);
          newActive = (data.files || []).find((f) => f.path === newRel) || null;
        }
        return {
          projectFiles: data.files || [],
          openTabs: newTabs,
          activeFile: newActive,
          loading: false,
        };
      });
      const cascade = {
        filesUpdated: atomicResult?.written || [],
        failures: buildFailures || [],
      };
      set((s) => ({
        modelGraphVersion: (s.modelGraphVersion || 0) + 1,
        lastRenameCascade: {
          fromPath: fromNorm, toPath: toNorm,
          impact,
          filesUpdated: cascade.filesUpdated,
          failures: cascade.failures,
        },
      }));
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  deleteFile: async (subpath) => {
    const { activeProjectId, offlineMode, activeFile } = get();
    if (offlineMode) throw new Error("Delete requires API mode.");
    if (!activeProjectId) throw new Error("No active project.");
    if (!subpath) throw new Error("path is required.");
    set({ loading: true, error: null });
    try {
      // Read the file first so we know which entities it defines. This has
      // to happen before the disk delete — after the file is gone we can't
      // recover the entity list and the cascade would silently skip.
      // Non-model files (plain YAML, `.diagram.yaml`) just yield an empty
      // entity list and the cascade below is a no-op.
      const deletedEntities = await collectEntitiesInFile(activeProjectId, subpath);

      await deleteProjectFile(activeProjectId, subpath);

      // Cascade: for every *other* model file in the project, remove any
      // relationships / governance / index / metric entries that reference
      // the entities that just disappeared. Without this, dangling FK edges
      // persist and the canvas renders zombies.
      const cascadeResult = deletedEntities.length
        ? await cascadeRemoveEntityReferences(activeProjectId, subpath, deletedEntities)
        : { filesUpdated: [], failures: [] };

      const data = await fetchProjectFiles(activeProjectId);
      set((s) => {
        const tabs = s.openTabs.filter((t) => t.path !== subpath);
        const deletedActive = activeFile && activeFile.path === subpath;
        const newState = {
          projectFiles: data.files || [],
          openTabs: tabs,
          loading: false,
          modelGraphVersion: (s.modelGraphVersion || 0) + 1,
          lastDeleteCascade: {
            deletedPath: subpath,
            entities: deletedEntities,
            filesUpdated: cascadeResult.filesUpdated,
            failures: cascadeResult.failures,
          },
        };
        if (deletedActive) {
          const next = tabs[tabs.length - 1] || null;
          newState.activeFile = next;
          newState.activeFileContent = next?.content || "";
          newState.originalContent = next?.content || "";
          newState.isDirty = false;
        }
        return newState;
      });
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  deleteFolder: async (subpath) => {
    const { activeProjectId, offlineMode, activeFile } = get();
    if (offlineMode) throw new Error("Delete requires API mode.");
    if (!activeProjectId) throw new Error("No active project.");
    if (!subpath) throw new Error("path is required.");
    const prefix = String(subpath).replace(/\/+$/, "") + "/";
    set({ loading: true, error: null });
    try {
      // Pre-collect entity names from every model file that lives under the
      // folder — same rationale as `deleteFile`, but spread across many files.
      const deletedEntities = await collectEntitiesInFolder(activeProjectId, subpath);
      const deletedPathSet = new Set(); // paths we'll skip when cascading
      const { files } = await fetchProjectFiles(activeProjectId);
      for (const f of files || []) {
        if (f.path && (f.path === subpath || f.path.startsWith(prefix))) {
          deletedPathSet.add(f.path);
        }
      }

      await deleteProjectFolder(activeProjectId, subpath);

      const cascadeResult = deletedEntities.length
        ? await cascadeRemoveEntityReferences(activeProjectId, null, deletedEntities, deletedPathSet)
        : { filesUpdated: [], failures: [] };

      const data = await fetchProjectFiles(activeProjectId);
      set((s) => {
        const tabs = s.openTabs.filter((t) => !t.path || !t.path.startsWith(prefix));
        const activeRemoved = activeFile && activeFile.path && activeFile.path.startsWith(prefix);
        const newState = {
          projectFiles: data.files || [],
          openTabs: tabs,
          loading: false,
          modelGraphVersion: (s.modelGraphVersion || 0) + 1,
          lastDeleteCascade: {
            deletedPath: subpath,
            entities: deletedEntities,
            filesUpdated: cascadeResult.filesUpdated,
            failures: cascadeResult.failures,
          },
        };
        if (activeRemoved) {
          const next = tabs[tabs.length - 1] || null;
          newState.activeFile = next;
          newState.activeFileContent = next?.content || "";
          newState.originalContent = next?.content || "";
          newState.isDirty = false;
        }
        return newState;
      });
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  // Batch-save every dirty tab plus the active buffer. Useful when the
  // user clicks "Save project" in the top bar. No-op in offline mode.
  saveAllDirty: async () => {
    const { activeProjectId, offlineMode, openTabs, activeFile, activeFileContent, originalContent } = get();
    if (offlineMode) {
      // Offline: persist all localDocuments to localStorage.
      get().saveOfflineDocs();
      set({ originalContent: activeFileContent, isDirty: false });
      return { ok: true, saved: 0, total: 0, results: [] };
    }
    if (!activeProjectId) throw new Error("No active project.");
    // Build a dedup'd list keyed by path. Always include the active buffer
    // (so in-memory edits on the active file are included even if the tab
    // wasn't independently flagged dirty).
    const payload = [];
    const seen = new Set();
    const pushIf = (path, content) => {
      if (!path || seen.has(path) || typeof content !== "string") return;
      seen.add(path);
      payload.push({ path, content });
    };
    if (activeFile && activeFileContent !== originalContent) {
      pushIf(activeFile.path, activeFileContent);
    }
    // Include every other open tab whose cached content diverges from its
    // disk baseline. `updateContent` keeps `tab.content` and
    // `tab.originalContent` in sync per tab — see the openTabs mutation
    // block there. Before v1.0.5 this loop was a no-op ("skip non-active
    // tabs"), which meant Save All only persisted the currently-focused
    // file; e.g. dragging entities on a `.diagram.yaml` then switching to
    // another tab before Save All silently dropped the diagram edits.
    for (const tab of openTabs) {
      if (!tab?.path) continue;
      if (activeFile && tab.path === activeFile.path) continue;
      const content = tab.content;
      if (typeof content !== "string") continue;
      // A tab is "dirty" when we recorded a disk baseline for it and the
      // cached content has drifted. If we never recorded a baseline
      // (openTabs entry came from a cold load without an edit yet), there's
      // nothing to save — skip it.
      if (tab.originalContent == null) continue;
      if (content === tab.originalContent) continue;
      pushIf(tab.path, content);
    }
    if (payload.length === 0) return { ok: true, saved: 0, total: 0, results: [] };
    set({ loading: true, error: null });
    try {
      const result = await saveAllProjectFiles(activeProjectId, payload);
      // Refresh project file metadata (mtimes) + reset active dirty flag.
      const data = await fetchProjectFiles(activeProjectId);
      set({ projectFiles: data.files || [] });
      // Reset the disk baseline on every tab that was successfully saved,
      // so `isDirty` collapses to false across the whole workspace — not
      // only the currently-focused tab. Without this the other dirty tabs
      // stay visually dirty and a re-click on Save All would re-send them.
      const savedPaths = new Set(
        (result?.results || [])
          .filter((r) => r && r.ok && typeof r.path === "string")
          .map((r) => r.path),
      );
      if (savedPaths.size > 0) {
        set((s) => {
          const openTabs = (s.openTabs || []).map((t) => {
            if (!t || !t.path || !savedPaths.has(t.path)) return t;
            return { ...t, originalContent: t.content };
          });
          return { openTabs };
        });
      }
      if (activeFile) {
        set({ originalContent: activeFileContent, isDirty: false });
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
