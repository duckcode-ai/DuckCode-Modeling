/* fileTree — in-memory tree model for a project's file list.
 *
 * Turns a flat list of file descriptors (each with a slash-separated relative
 * path) into a nested folder/file tree suitable for recursive rendering. The
 * Explorer uses it to render `models/staging/stg_customers.yml` as
 * `models ▸ staging ▸ stg_customers.yml` instead of a single long label.
 *
 * Pure functions. No React / no persistence.
 */

/**
 * @typedef {{
 *   name: string,
 *   fullPath?: string,
 *   path?: string,
 *   [key: string]: any,
 * }} FileDescriptor
 */

/**
 * @typedef {{
 *   kind: "folder",
 *   name: string,
 *   path: string,               // slash-joined folder path, empty string at root
 *   children: Array<TreeNode>,
 * } | {
 *   kind: "file",
 *   name: string,
 *   path: string,
 *   file: FileDescriptor,
 * }} TreeNode
 */

/**
 * Group files into a tree. Files with no `/` in their relative path land at
 * the root. Folders are created implicitly as files are inserted.
 *
 * `extraFolderPaths` lets the caller seed empty folder nodes that wouldn't
 * otherwise appear (the server's file walker only returns *.yaml/*.yml).
 * The optimistic "New folder" path relies on this — a user-created empty
 * folder shows up instantly in the Explorer, even before any file lands
 * inside it.
 *
 * @param {FileDescriptor[]} files
 * @param {string[]} [extraFolderPaths] slash-joined folder paths to ensure
 * @returns {TreeNode[]}
 */
export function buildFileTree(files, extraFolderPaths = []) {
  const root = { name: "", path: "", children: new Map() };

  // Seed empty folder branches first so they appear even when no files
  // live under them yet. Files added below will share these branches via
  // the `has(seg)` check.
  for (const raw of extraFolderPaths || []) {
    const rel = normalise(raw).replace(/\/+$/, "");
    if (!rel) continue;
    const parts = rel.split("/").filter(Boolean);
    let cursor = root;
    for (const seg of parts) {
      if (!cursor.children.has(seg)) {
        cursor.children.set(seg, {
          kind: "folder",
          name: seg,
          path: [cursor.path, seg].filter(Boolean).join("/"),
          children: new Map(),
        });
      }
      cursor = cursor.children.get(seg);
    }
  }

  for (const f of files || []) {
    const rel = relPathFor(f);
    if (!rel) continue;
    const parts = rel.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const seg = parts[i];
      if (!cursor.children.has(seg)) {
        cursor.children.set(seg, {
          kind: "folder",
          name: seg,
          path: [cursor.path, seg].filter(Boolean).join("/"),
          children: new Map(),
        });
      }
      cursor = cursor.children.get(seg);
    }
    const fileName = parts[parts.length - 1];
    cursor.children.set(fileName, {
      kind: "file",
      name: fileName,
      path: [cursor.path, fileName].filter(Boolean).join("/"),
      file: f,
    });
  }

  return normaliseNode(root).children;
}

/**
 * Depth-first search for a file node by its slash-joined path.
 * Returns the file descriptor if found, else null.
 */
export function findFile(tree, path) {
  const target = String(path || "").replace(/^\/+/, "");
  if (!target) return null;
  const stack = [...(tree || [])];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (node.kind === "file" && node.path === target) return node.file;
    if (node.kind === "folder") stack.push(...(node.children || []));
  }
  return null;
}

/**
 * Depth-first list of every file descriptor in the tree. Handy when a caller
 * wants the flat list shape back but after tree-building.
 */
export function flattenFiles(tree) {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.kind === "file") out.push(node.file);
      else if (node.kind === "folder") walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * Count files in a subtree (including nested folders). Used by the Explorer
 * row to show per-folder counts: `models/ (14)`.
 */
export function countFiles(node) {
  if (!node) return 0;
  if (node.kind === "file") return 1;
  let n = 0;
  for (const c of node.children || []) n += countFiles(c);
  return n;
}

/* ------------------------ helpers ------------------------ */

function relPathFor(f) {
  // Prefer `path` (relative to project root) over `fullPath` (absolute).
  // Fall back to `name` for flat single-file projects.
  if (!f) return "";
  if (typeof f === "string") return normalise(f);
  if (f.path) return normalise(f.path);
  if (f.fullPath) {
    const m = String(f.fullPath || "").match(/[^/\\]+(\/.+)?$/);
    return normalise(m ? m[0] : f.fullPath);
  }
  return normalise(f.name || "");
}

function normalise(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function normaliseNode(folder) {
  const children = [];
  for (const child of folder.children.values()) {
    if (child.kind === "folder") {
      children.push(normaliseNode(child));
    } else {
      children.push(child);
    }
  }
  // Folders first, each alphabetical; files alphabetical within.
  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
  return { ...folder, children };
}
