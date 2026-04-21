// Test harness: boots the api-server app in-process against a tmp REPO_ROOT
// so each test run operates on an isolated projects registry + on-disk tree.
//
// Tests must import `getApp` from here, not from ../../index.js directly —
// this module sets REPO_ROOT + DATALEX_NO_LISTEN before the app is loaded.

import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

// Shared tmp REPO_ROOT for the whole test process. We allocate one
// tmpdir per node --test invocation; individual fixtures live in
// per-test subfolders so suites don't collide.
const TEST_REPO_ROOT = mkdtempSync(join(tmpdir(), "datalex-apitest-"));
process.env.REPO_ROOT = TEST_REPO_ROOT;
process.env.DATALEX_NO_LISTEN = "1";

let appPromise = null;

export async function getApp() {
  if (!appPromise) {
    appPromise = import("../../index.js").then((mod) => mod.default || mod.app);
  }
  return appPromise;
}

export function repoRoot() {
  return TEST_REPO_ROOT;
}

function projectsFile() {
  return join(TEST_REPO_ROOT, ".dm-projects.json");
}

// Read the current projects array from disk. Returns [] if the file
// doesn't exist yet.
function readProjects() {
  if (!existsSync(projectsFile())) return [];
  const raw = readFileSync(projectsFile(), "utf-8");
  try { return JSON.parse(raw); } catch { return []; }
}

function writeProjects(list) {
  writeFileSync(projectsFile(), JSON.stringify(list, null, 2), "utf-8");
}

// Create a project on disk + register it in .dm-projects.json, mirroring
// what POST /api/projects would do. Returns { id, path, cleanup }.
//
// opts.modelsDir — if set, writes .datalex/project.json pointing at that
// subfolder (mirroring loadProjectStructure's config path). Default: none,
// so modelPath === project root.
//
// opts.seed — { [relpath]: contents } files to pre-populate.
export function createProject({ modelsDir, seed } = {}) {
  const id = `proj_test_${randomBytes(4).toString("hex")}`;
  const projectPath = join(TEST_REPO_ROOT, `project_${id}`);
  mkdirSync(projectPath, { recursive: true });

  if (modelsDir) {
    const configDir = join(projectPath, ".datalex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "project.json"),
      JSON.stringify({ version: 1, modelsDir }, null, 2),
      "utf-8",
    );
    mkdirSync(join(projectPath, modelsDir), { recursive: true });
  }

  const modelRoot = modelsDir ? join(projectPath, modelsDir) : projectPath;
  if (seed) {
    for (const [rel, content] of Object.entries(seed)) {
      const full = join(modelRoot, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf-8");
    }
  }

  const projects = readProjects();
  projects.push({ id, name: `test-${id}`, path: projectPath });
  writeProjects(projects);

  return {
    id,
    path: projectPath,
    modelPath: modelRoot,
    cleanup() {
      rmSync(projectPath, { recursive: true, force: true });
      writeProjects(readProjects().filter((p) => p.id !== id));
    },
  };
}
