import express from "express";
import cors from "cors";
import { readdir, readFile, writeFile, mkdir, stat, rename, copyFile, unlink as unlinkFile } from "fs/promises";
import { join, relative, extname, basename, resolve, isAbsolute, dirname } from "path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const app = express();
const PORT = process.env.PORT || 3006;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`[duckcodemodeling] ${req.method} ${req.url}`);
  next();
});

// Project root defaults to the monorepo root (two levels up from packages/api-server)
const REPO_ROOT = process.env.REPO_ROOT || join(process.cwd(), "../..");
const PROJECTS_FILE = join(REPO_ROOT, ".dm-projects.json");
const CONNECTIONS_FILE = join(REPO_ROOT, ".dm-connections.json");
const WEB_DIST = process.env.WEB_DIST || join(REPO_ROOT, "packages", "web-app", "dist");

// Use venv Python if available, otherwise fall back to system python3
const VENV_PYTHON = join(REPO_ROOT, ".venv", "bin", "python3");
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
const IS_DOCKER_RUNTIME = existsSync("/.dockerenv");
const DIRECT_APPLY_ENABLED = ["1", "true", "yes", "on"].includes(String(process.env.DM_ENABLE_DIRECT_APPLY || "").toLowerCase());
const DUCKCODE_CONFIG_DIRNAME = ".duckcodemodeling";
const DUCKCODE_PROJECT_CONFIG = join(DUCKCODE_CONFIG_DIRNAME, "project.json");
const DUCKCODE_DEFAULT_STRUCTURE = {
  version: 1,
  // Default to snowflake so baseline DDL generation works for new projects without extra config.
  // Connector pulls can still set this explicitly based on the chosen connector.
  defaultDialect: "snowflake",
  modelsDir: "models",
  migrationsDir: "migrations",
  ddlDir: "ddl",
  migrationDialects: {
    snowflake: "migrations/snowflake",
    databricks: "migrations/databricks",
    bigquery: "migrations/bigquery",
  },
  ddlDialects: {
    snowflake: "ddl/snowflake",
    databricks: "ddl/databricks",
    bigquery: "ddl/bigquery",
  },
};

async function loadProjects() {
  try {
    if (existsSync(PROJECTS_FILE)) {
      const raw = await readFile(PROJECTS_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (_err) {
    // ignore
  }
  // Default: include model-examples as a starter project
  const defaultProjects = [
    {
      id: "default",
      name: "model-examples",
      path: join(REPO_ROOT, "model-examples"),
    },
  ];
  return defaultProjects;
}

async function saveProjects(projects) {
  await writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function resolveProjectPath(projectId) {
  if (!projectId) return null;
  const projects = await loadProjects();
  const project = projects.find((p) => p.id === projectId);
  return project?.path || null;
}

function parseGitStatus(output) {
  const lines = output.split("\n").filter(Boolean);
  const summaryLine = lines.find((line) => line.startsWith("## ")) || "";
  const fileLines = lines.filter((line) => !line.startsWith("## "));

  let branch = "";
  let detached = false;
  let ahead = 0;
  let behind = 0;
  if (summaryLine) {
    const summary = summaryLine.slice(3);
    if (summary.includes("HEAD (no branch)")) {
      branch = "HEAD";
      detached = true;
    } else {
      const branchPart = summary.split("...")[0].split(" ")[0].trim();
      branch = branchPart || "HEAD";
    }
    const aheadMatch = summary.match(/ahead (\d+)/);
    const behindMatch = summary.match(/behind (\d+)/);
    ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
    behind = behindMatch ? Number(behindMatch[1]) : 0;
  }

  const files = [];
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;

  for (const line of fileLines) {
    if (line.startsWith("?? ")) {
      const path = line.slice(3).trim();
      files.push({
        path,
        status: "untracked",
        stagedStatus: "?",
        unstagedStatus: "?",
      });
      untrackedCount += 1;
      continue;
    }

    const stagedStatus = line[0] || " ";
    const unstagedStatus = line[1] || " ";
    const rawPath = line.slice(3).trim();
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ")[1] : rawPath;
    files.push({
      path,
      status: `${stagedStatus}${unstagedStatus}`.trim() || "clean",
      stagedStatus,
      unstagedStatus,
    });
    if (stagedStatus !== " ") stagedCount += 1;
    if (unstagedStatus !== " ") unstagedCount += 1;
  }

  return {
    branch,
    detached,
    ahead,
    behind,
    isClean: files.length === 0,
    stagedCount,
    unstagedCount,
    untrackedCount,
    files,
  };
}

function gitRefExists(cwd, ref) {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", ref], {
      cwd,
      encoding: "utf-8",
      timeout: 8000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch (_err) {
    return false;
  }
}

function parseGitHubRemote(remoteUrl) {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return null;

  const patterns = [
    /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/i,
    /^git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
      };
    }
  }
  return null;
}


function normalizeRelativeSubpath(value, fallback = "") {
  const text = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!text || text === ".") return fallback;
  return text;
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sanitizeFolderName(value, fallback = "duckcodemodeling-project") {
  const raw = String(value || "").trim();
  const cleaned = raw
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || fallback;
}

async function writeFileIfMissing(filePath, content) {
  if (existsSync(filePath)) return false;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  return true;
}

function tryGetGitRoot(cwd) {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const trimmed = String(root || "").trim();
    return trimmed || null;
  } catch (_err) {
    return null;
  }
}

async function bootstrapProjectStructure(projectPath, { initializeGit = false } = {}) {
  const absoluteProjectPath = resolve(projectPath);
  await mkdir(absoluteProjectPath, { recursive: true });

  // If the project lives inside an existing git repo, avoid creating a nested .git folder.
  // Also, GitHub Actions only loads workflows from the repo root .github/workflows.
  const gitRoot = tryGetGitRoot(absoluteProjectPath);
  const isInsideExistingRepo = Boolean(gitRoot) && isPathInside(gitRoot, absoluteProjectPath);

  const dirs = [
    "models",
    "migrations/snowflake",
    "migrations/databricks",
    "migrations/bigquery",
    "ddl/snowflake",
    "ddl/databricks",
    "ddl/bigquery",
    "guides/setup",
    "guides/gitops",
    "guides/testing",
    DUCKCODE_CONFIG_DIRNAME,
  ];
  for (const relDir of dirs) {
    await mkdir(join(absoluteProjectPath, relDir), { recursive: true });
  }

  const readme = [
    `# ${basename(absoluteProjectPath)}` ,
    "",
    "Programmable data modeling repository managed by DuckCodeModeling.",
    "",
    "## Structure",
    "",
    "- models/: source .model.yaml files",
    "- migrations/: generated SQL artifacts by connector",
    "- guides/: team onboarding and runbooks",
    "- .github/workflows/: CI/CD automation templates",
    "",
  ].join("\n");

  const gitignore = [
    "# DuckCodeModeling",
    ".secrets/",
    "*.pem",
    "*.p8",
    "*.key",
    ".env",
    ".env.*",
    "",
    "# Python",
    ".venv/",
    "__pycache__/",
    "*.pyc",
    "",
    "# macOS",
    ".DS_Store",
    "",
  ].join("\n");

  const workflow = [
    "name: validate-models",
    "",
    "on:",
    "  pull_request:",
    "    branches: [main]",
    "",
    "jobs:",
    "  validate:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - name: Placeholder",
    "        run: echo \"Add dm validate/migrate checks here\"",
    "",
  ].join("\n");

  await writeFileIfMissing(join(absoluteProjectPath, "README.md"), readme);
  await writeFileIfMissing(join(absoluteProjectPath, ".gitignore"), gitignore);
  await writeFileIfMissing(
    join(absoluteProjectPath, DUCKCODE_PROJECT_CONFIG),
    `${JSON.stringify(DUCKCODE_DEFAULT_STRUCTURE, null, 2)}\n`
  );
  await writeFileIfMissing(join(absoluteProjectPath, "models", ".gitkeep"), "");
  await writeFileIfMissing(
    join(absoluteProjectPath, "guides", "README.md"),
    "# Guides\n\nAdd setup, GitOps, and testing playbooks for your team.\n"
  );

  const workflowRoot = isInsideExistingRepo ? gitRoot : absoluteProjectPath;
  await mkdir(join(workflowRoot, ".github", "workflows"), { recursive: true });
  await writeFileIfMissing(join(workflowRoot, ".github", "workflows", "validate-models.yml"), workflow);

  if (initializeGit && !isInsideExistingRepo && !existsSync(join(absoluteProjectPath, ".git"))) {
    try {
      execFileSync("git", ["init", "-b", "main"], {
        cwd: absoluteProjectPath,
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (_err) {
      execFileSync("git", ["init"], {
        cwd: absoluteProjectPath,
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
  }
}

async function loadProjectStructure(projectPath) {
  const absoluteProjectPath = resolve(projectPath);
  const configPath = join(absoluteProjectPath, DUCKCODE_PROJECT_CONFIG);

  let projectConfig = null;
  if (existsSync(configPath)) {
    try {
      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        projectConfig = parsed;
      }
    } catch (_err) {
      projectConfig = null;
    }
  }

  const configuredModelsDir = normalizeRelativeSubpath(projectConfig?.modelsDir, "");
  const candidateModelPath = configuredModelsDir
    ? resolve(absoluteProjectPath, configuredModelsDir)
    : absoluteProjectPath;
  const modelPath = isPathInside(absoluteProjectPath, candidateModelPath)
    ? candidateModelPath
    : absoluteProjectPath;

  return {
    projectConfig,
    modelPath,
  };
}

const SECRET_KEYS = new Set(["password", "token", "private_key_content", "private_key_path"]);

function sanitizeModelStem(name, fallback = "dbt_model") {
  const text = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!text) return fallback;
  return /^[0-9]/.test(text) ? `m_${text}` : text;
}

function deriveDbtRepoName(repoPath) {
  const token = basename(String(repoPath || "").replace(/[\\\/]+$/, "")) || "dbt";
  return token.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "dbt";
}

function parseDbtDocSummary(text, relPath) {
  let loaded;
  try {
    loaded = yaml.load(text);
  } catch (_err) {
    return null;
  }
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return null;

  // Skip files already in DuckCodeModeling model format
  if (loaded.model && typeof loaded.model === "object" && Array.isArray(loaded.entities)) {
    return null;
  }

  const models = Array.isArray(loaded.models) ? loaded.models : [];
  const sources = Array.isArray(loaded.sources) ? loaded.sources : [];
  const semanticModels = Array.isArray(loaded.semantic_models) ? loaded.semantic_models : [];
  const metrics = Array.isArray(loaded.metrics) ? loaded.metrics : [];
  const sectionCount = models.length + sources.length + semanticModels.length + metrics.length;
  const looksLikeDbtFile = /(^|\/)(schema|sources)\.ya?ml$/i.test(String(relPath || ""));

  if (sectionCount === 0 && !looksLikeDbtFile) {
    return null;
  }

  const version = String(loaded.version ?? "").trim();
  if (!looksLikeDbtFile && version && !["2", "2.0"].includes(version)) {
    return null;
  }

  return {
    models: models.length,
    sources: sources.length,
    semantic_models: semanticModels.length,
    metrics: metrics.length,
    version: version || null,
  };
}

function isPathInside(basePath, candidatePath) {
  const rel = relative(resolve(basePath), resolve(candidatePath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function loadConnections() {
  try {
    if (existsSync(CONNECTIONS_FILE)) {
      const raw = await readFile(CONNECTIONS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.connections)) return parsed.connections;
    }
  } catch (_err) {
    // ignore
  }
  return [];
}

async function saveConnections(connections) {
  const payload = { version: 1, connections };
  await writeFile(CONNECTIONS_FILE, JSON.stringify(payload, null, 2), "utf-8");
}

function inferSnowflakeAuth(params) {
  if (params.private_key_content || params.private_key_path) return "keypair";
  return "password";
}

function buildConnectionFingerprint(connector, params = {}) {
  const schemaScope = params.db_schema || params.dataset || "";
  return [
    connector || "",
    params.host || "",
    params.user || "",
    params.database || "",
    params.project || "",
    params.catalog || "",
    params.warehouse || "",
    schemaScope,
  ]
    .map((p) => String(p).trim().toLowerCase())
    .join("|");
}

function splitConnectionDetails(connector, params = {}) {
  const details = {};
  const secrets = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (SECRET_KEYS.has(key)) {
      secrets[key] = String(value);
      continue;
    }
    details[key] = value;
  }
  if (connector === "snowflake" || connector === "snowflake_password" || connector === "snowflake_keypair") {
    details.auth = inferSnowflakeAuth(params);
  }
  return { details, secrets };
}

function buildConnectionName(connector, params = {}) {
  const hostish = params.host || params.project || params.database || params.catalog || "connection";
  return `${connector}:${hostish}`;
}

async function upsertConnectionProfile({ connector, params = {}, connectionName }) {
  const connections = await loadConnections();
  const fingerprint = buildConnectionFingerprint(connector, params);
  const now = new Date().toISOString();
  const { details, secrets } = splitConnectionDetails(connector, params);
  const normalizedName = connectionName || buildConnectionName(connector, params);

  let conn = connections.find((c) => c.fingerprint === fingerprint);
  if (!conn) {
    conn = {
      id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      connector,
      fingerprint,
      name: normalizedName,
      details,
      secrets,
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: now,
      imports: [],
    };
    connections.push(conn);
  } else {
    conn.connector = connector;
    conn.name = normalizedName;
    conn.details = details;
    conn.secrets = { ...(conn.secrets || {}), ...secrets };
    if (details.auth === "password") {
      delete conn.secrets.private_key_content;
      delete conn.secrets.private_key_path;
    }
    conn.updatedAt = now;
    conn.lastConnectedAt = now;
    if (!Array.isArray(conn.imports)) conn.imports = [];
  }
  await saveConnections(connections);
  return conn;
}

async function appendConnectionImportEvent({ connectionId, connector, params = {}, event }) {
  const connections = await loadConnections();
  const fingerprint = buildConnectionFingerprint(connector, params);
  const now = new Date().toISOString();
  const { details, secrets } = splitConnectionDetails(connector, params);

  let conn =
    connections.find((c) => c.id === connectionId) ||
    connections.find((c) => c.fingerprint === fingerprint);

  if (!conn) {
    conn = {
      id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      connector,
      fingerprint,
      name: buildConnectionName(connector, params),
      details,
      secrets,
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: now,
      imports: [],
    };
    connections.push(conn);
  }

  conn.details = details;
  conn.secrets = { ...(conn.secrets || {}), ...secrets };
  if (details.auth === "password") {
    delete conn.secrets.private_key_content;
    delete conn.secrets.private_key_path;
  }

  if (!Array.isArray(conn.imports)) conn.imports = [];
  conn.imports.unshift({
    id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now,
    ...event,
  });
  conn.imports = conn.imports.slice(0, 200);
  conn.updatedAt = now;
  conn.lastConnectedAt = now;

  await saveConnections(connections);
  return conn;
}

// List all registered projects
app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await loadProjects();
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a project folder
app.post("/api/projects", async (req, res) => {
  try {
    const {
      name,
      path: folderPath,
      create_if_missing,
      scaffold_repo,
      initialize_git,
      create_subfolder,
    } = req.body || {};
    if (!name || !folderPath) {
      return res.status(400).json({ error: "name and path are required" });
    }

    const absoluteBasePath = resolve(String(folderPath));
    const wantsSubfolder = Boolean(create_subfolder);
    const derivedSubfolder = wantsSubfolder ? sanitizeFolderName(name) : "";
    const absoluteFolderPath =
      wantsSubfolder && basename(absoluteBasePath) !== derivedSubfolder
        ? resolve(absoluteBasePath, derivedSubfolder)
        : absoluteBasePath;
    if (!existsSync(absoluteFolderPath)) {
      if (create_if_missing) {
        await mkdir(absoluteFolderPath, { recursive: true });
      } else {
        return res.status(400).json({ error: `Path does not exist: ${absoluteFolderPath}` });
      }
    }

    if (scaffold_repo) {
      await bootstrapProjectStructure(absoluteFolderPath, { initializeGit: Boolean(initialize_git) });
    }

    const projects = await loadProjects();
    const id = `proj_${Date.now()}`;
    const project = { id, name, path: absoluteFolderPath };
    projects.push(project);
    await saveProjects(projects);
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update an existing project folder
app.put("/api/projects/:id", async (req, res) => {
  try {
    const {
      name,
      path: folderPath,
      create_if_missing,
      scaffold_repo,
      initialize_git,
      create_subfolder,
    } = req.body || {};
    if (!name || !folderPath) {
      return res.status(400).json({ error: "name and path are required" });
    }

    const absoluteBasePath = resolve(String(folderPath));
    const wantsSubfolder = Boolean(create_subfolder);
    const derivedSubfolder = wantsSubfolder ? sanitizeFolderName(name) : "";
    const absoluteFolderPath =
      wantsSubfolder && basename(absoluteBasePath) !== derivedSubfolder
        ? resolve(absoluteBasePath, derivedSubfolder)
        : absoluteBasePath;
    if (!existsSync(absoluteFolderPath)) {
      if (create_if_missing) {
        await mkdir(absoluteFolderPath, { recursive: true });
      } else {
        return res.status(400).json({ error: `Path does not exist: ${absoluteFolderPath}` });
      }
    }

    if (scaffold_repo) {
      await bootstrapProjectStructure(absoluteFolderPath, { initializeGit: Boolean(initialize_git) });
    }

    const projects = await loadProjects();
    const idx = projects.findIndex((p) => p.id === req.params.id);
    if (idx < 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const updated = {
      ...projects[idx],
      name,
      path: absoluteFolderPath,
    };
    projects[idx] = updated;
    await saveProjects(projects);
    res.json({ project: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a project
app.delete("/api/projects/:id", async (req, res) => {
  try {
    let projects = await loadProjects();
    projects = projects.filter((p) => p.id !== req.params.id);
    await saveProjects(projects);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List YAML files in a project folder (recursive, *.yaml / *.yml)
app.get("/api/projects/:id/files", async (req, res) => {
  try {
    const projects = await loadProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const pathErr = await assertReadableDirectory(project.path);
    if (pathErr) {
      const dockerHint = IS_DOCKER_RUNTIME
        ? " Running in Docker: mount the host parent path (for example -v /Users/<you>:/workspace/host) and use /workspace/host/... in DuckCodeModeling."
        : "";
      return res.status(400).json({
        error:
          `Project path is not accessible: ${project.path}. ` +
          "Check path permissions and existence." +
          dockerHint,
      });
    }

    const structure = await loadProjectStructure(project.path);
    if (!existsSync(structure.modelPath)) {
      await mkdir(structure.modelPath, { recursive: true });
    }

    const files = await walkYamlFiles(structure.modelPath);
    res.json({
      projectId: project.id,
      projectPath: project.path,
      projectModelPath: structure.modelPath,
      projectConfig: structure.projectConfig,
      files,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Git: repository status for a project
app.get("/api/git/status", async (req, res) => {
  try {
    const projectId = String(req.query.projectId || "").trim();
    if (!projectId) {
      return res.status(400).json({ error: "projectId query param required" });
    }
    const projectPath = await resolveProjectPath(projectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }
    const repoRoot = runGit(["rev-parse", "--show-toplevel"], projectPath).trim();
    const porcelain = runGit(["status", "--porcelain=1", "--branch"], projectPath);
    const parsed = parseGitStatus(porcelain);
    res.json({
      ok: true,
      projectId,
      projectPath,
      repoRoot,
      ...parsed,
    });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    if (stderr.includes("not a git repository")) {
      return res.status(400).json({ error: "Selected project is not a git repository" });
    }
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// Git: unified diff (working tree or staged)
app.get("/api/git/diff", async (req, res) => {
  try {
    const projectId = String(req.query.projectId || "").trim();
    if (!projectId) {
      return res.status(400).json({ error: "projectId query param required" });
    }
    const projectPath = await resolveProjectPath(projectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }
    const filePath = String(req.query.path || "").trim();
    const staged = String(req.query.staged || "").trim() === "1";
    const args = ["diff"];
    if (staged) args.push("--cached");
    if (filePath) args.push("--", filePath);
    const diff = runGit(args, projectPath);
    res.json({
      ok: true,
      projectId,
      path: filePath || null,
      staged,
      diff,
    });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    if (stderr.includes("not a git repository")) {
      return res.status(400).json({ error: "Selected project is not a git repository" });
    }
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// Git: commit changes (optionally only selected paths)
app.post("/api/git/commit", express.json(), async (req, res) => {
  try {
    const { projectId, message, paths } = req.body || {};
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return res.status(400).json({ error: "projectId is required" });
    }
    const commitMessage = String(message || "").trim();
    if (!commitMessage) {
      return res.status(400).json({ error: "commit message is required" });
    }

    const projectPath = await resolveProjectPath(normalizedProjectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }

    const pathList = Array.isArray(paths)
      ? paths.map((p) => String(p || "").trim()).filter(Boolean)
      : [];

    if (pathList.length > 0) {
      runGit(["add", "--", ...pathList], projectPath);
    } else {
      runGit(["add", "-A"], projectPath);
    }

    const stagedCount = Number(runGit(["diff", "--cached", "--name-only"], projectPath).trim().split("\n").filter(Boolean).length);
    if (!stagedCount) {
      return res.status(400).json({ error: "No staged changes to commit" });
    }

    runGit(["commit", "-m", commitMessage], projectPath);
    const commitHash = runGit(["rev-parse", "HEAD"], projectPath).trim();
    const summary = runGit(["show", "--stat", "--oneline", "--no-color", "-1", "HEAD"], projectPath);
    res.json({
      ok: true,
      projectId: normalizedProjectId,
      commitHash,
      summary,
    });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// Git: stage files
app.post("/api/git/stage", express.json(), async (req, res) => {
  try {
    const { projectId, paths } = req.body || {};
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return res.status(400).json({ error: "projectId is required" });
    }
    const pathList = Array.isArray(paths)
      ? paths.map((p) => String(p || "").trim()).filter(Boolean)
      : [];
    if (pathList.length === 0) {
      return res.status(400).json({ error: "paths array is required" });
    }

    const projectPath = await resolveProjectPath(normalizedProjectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }

    runGit(["add", "--", ...pathList], projectPath);
    const status = parseGitStatus(runGit(["status", "--porcelain=1", "--branch"], projectPath));
    res.json({ ok: true, projectId: normalizedProjectId, ...status });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// Git: unstage files
app.post("/api/git/unstage", express.json(), async (req, res) => {
  try {
    const { projectId, paths } = req.body || {};
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return res.status(400).json({ error: "projectId is required" });
    }
    const pathList = Array.isArray(paths)
      ? paths.map((p) => String(p || "").trim()).filter(Boolean)
      : [];
    if (pathList.length === 0) {
      return res.status(400).json({ error: "paths array is required" });
    }

    const projectPath = await resolveProjectPath(normalizedProjectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }

    runGit(["reset", "HEAD", "--", ...pathList], projectPath);
    const status = parseGitStatus(runGit(["status", "--porcelain=1", "--branch"], projectPath));
    res.json({ ok: true, projectId: normalizedProjectId, ...status });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// Git: recent commits
app.get("/api/git/log", async (req, res) => {
  try {
    const projectId = String(req.query.projectId || "").trim();
    if (!projectId) {
      return res.status(400).json({ error: "projectId query param required" });
    }
    const projectPath = await resolveProjectPath(projectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }
    const limitRaw = Number(req.query.limit || 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
    const format = "%H%x1f%h%x1f%an%x1f%ad%x1f%s";
    const output = runGit(["log", `-${limit}`, `--pretty=format:${format}`, "--date=iso"], projectPath).trim();
    const commits = output
      ? output.split("\n").map((line) => {
          const [hash, shortHash, author, date, subject] = line.split("\x1f");
          return { hash, shortHash, author, date, subject };
        })
      : [];
    res.json({
      ok: true,
      projectId,
      commits,
    });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    if (stderr.includes("does not have any commits yet")) {
      return res.json({ ok: true, projectId: String(req.query.projectId || "").trim(), commits: [] });
    }
    if (stderr.includes("not a git repository")) {
      return res.status(400).json({ error: "Selected project is not a git repository" });
    }
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});


// Git: create or checkout branch
app.post("/api/git/branch/create", express.json(), async (req, res) => {
  try {
    const { projectId, branch, from } = req.body || {};
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const branchName = String(branch || "").trim();
    if (!branchName) {
      return res.status(400).json({ error: "branch is required" });
    }
    if (/\s/.test(branchName)) {
      return res.status(400).json({ error: "branch name cannot include spaces" });
    }

    const fromRef = String(from || "").trim();
    const projectPath = await resolveProjectPath(normalizedProjectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }

    const branchRef = `refs/heads/${branchName}`;
    const exists = gitRefExists(projectPath, branchRef);

    if (exists) {
      runGit(["checkout", branchName], projectPath);
    } else {
      const args = fromRef
        ? ["checkout", "-b", branchName, fromRef]
        : ["checkout", "-b", branchName];
      runGit(args, projectPath);
    }

    const status = parseGitStatus(runGit(["status", "--porcelain=1", "--branch"], projectPath));
    res.json({
      ok: true,
      projectId: normalizedProjectId,
      branch: status.branch,
      existed: exists,
      ...status,
    });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    if (stderr.includes("not a git repository")) {
      return res.status(400).json({ error: "Selected project is not a git repository" });
    }
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// Git: push current branch (or provided branch)
app.post("/api/git/push", express.json(), async (req, res) => {
  try {
    const { projectId, remote = "origin", branch, set_upstream = true } = req.body || {};
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const projectPath = await resolveProjectPath(normalizedProjectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }

    const status = parseGitStatus(runGit(["status", "--porcelain=1", "--branch"], projectPath));
    const branchName = String(branch || "").trim() || status.branch;
    if (!branchName || branchName === "HEAD") {
      return res.status(400).json({ error: "Unable to determine branch to push (detached HEAD)." });
    }

    const args = ["push"];
    if (set_upstream) args.push("-u");
    args.push(String(remote || "origin"), branchName);

    const output = execFileSync("git", args, {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const refreshed = parseGitStatus(runGit(["status", "--porcelain=1", "--branch"], projectPath));
    res.json({
      ok: true,
      projectId: normalizedProjectId,
      branch: branchName,
      remote: String(remote || "origin"),
      output: String(output || "").trim(),
      ...refreshed,
    });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    if (stderr.includes("not a git repository")) {
      return res.status(400).json({ error: "Selected project is not a git repository" });
    }
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// Git: pull (fast-forward only by default)
app.post("/api/git/pull", express.json(), async (req, res) => {
  try {
    const { projectId, remote = "origin", branch, ff_only = true } = req.body || {};
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const projectPath = await resolveProjectPath(normalizedProjectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }

    const status = parseGitStatus(runGit(["status", "--porcelain=1", "--branch"], projectPath));
    const branchName = String(branch || "").trim() || status.branch;
    if (!branchName || branchName === "HEAD") {
      return res.status(400).json({ error: "Unable to determine branch to pull (detached HEAD)." });
    }

    const args = ["pull"];
    if (ff_only) args.push("--ff-only");

    // If a branch is explicitly provided, use remote+branch; otherwise rely on upstream tracking.
    if (String(branch || "").trim()) {
      args.push(String(remote || "origin"), branchName);
    }

    const output = execFileSync("git", args, {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const refreshed = parseGitStatus(runGit(["status", "--porcelain=1", "--branch"], projectPath));
    res.json({
      ok: true,
      projectId: normalizedProjectId,
      branch: branchName,
      remote: String(remote || "origin"),
      ffOnly: Boolean(ff_only),
      output: String(output || "").trim(),
      ...refreshed,
    });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    if (stderr.includes("not a git repository")) {
      return res.status(400).json({ error: "Selected project is not a git repository" });
    }
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// GitHub: create pull request for current branch
app.post("/api/git/github/pr", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const {
      projectId,
      token,
      title,
      body = "",
      base = "main",
      head,
      draft = false,
      remote = "origin",
    } = req.body || {};

    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return res.status(400).json({ error: "projectId is required" });
    }
    const ghToken = String(token || "").trim();
    if (!ghToken) {
      return res.status(400).json({ error: "token is required" });
    }
    const prTitle = String(title || "").trim();
    if (!prTitle) {
      return res.status(400).json({ error: "title is required" });
    }

    const projectPath = await resolveProjectPath(normalizedProjectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }

    const status = parseGitStatus(runGit(["status", "--porcelain=1", "--branch"], projectPath));
    const headBranch = String(head || "").trim() || status.branch;
    if (!headBranch || headBranch === "HEAD") {
      return res.status(400).json({ error: "Unable to determine head branch for PR." });
    }

    const remoteUrl = runGit(["remote", "get-url", String(remote || "origin")], projectPath).trim();
    const ghRepo = parseGitHubRemote(remoteUrl);
    if (!ghRepo) {
      return res.status(400).json({ error: "Remote is not a supported GitHub URL." });
    }

    const payload = {
      title: prTitle,
      body: String(body || ""),
      head: headBranch,
      base: String(base || "main"),
      draft: Boolean(draft),
    };

    const resp = await fetch(`https://api.github.com/repos/${ghRepo.owner}/${ghRepo.repo}/pulls`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ghToken}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const message = String(data?.message || `GitHub API request failed (${resp.status})`).trim();
      if (message.toLowerCase().includes("a pull request already exists")) {
        return res.status(409).json({ error: message });
      }
      return res.status(resp.status).json({ error: message });
    }

    res.json({
      ok: true,
      projectId: normalizedProjectId,
      repository: `${ghRepo.owner}/${ghRepo.repo}`,
      pullRequest: {
        number: data.number,
        title: data.title,
        state: data.state,
        url: data.html_url,
        head: data?.head?.ref,
        base: data?.base?.ref,
      },
    });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

async function walkYamlFiles(dir, base = dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (_err) {
    return results;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const sub = await walkYamlFiles(fullPath, base);
      results.push(...sub);
    } else if (entry.name.toLowerCase().endsWith(".yaml") || entry.name.toLowerCase().endsWith(".yml")) {
      const relPath = relative(base, fullPath);
      const stats = await stat(fullPath);
      results.push({
        name: entry.name,
        path: relPath,
        fullPath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    }
  }
  return results;
}

async function assertReadableDirectory(dirPath) {
  try {
    const st = await stat(dirPath);
    if (!st.isDirectory()) {
      throw new Error(`Path is not a directory: ${dirPath}`);
    }
    await readdir(dirPath, { withFileTypes: true });
    return null;
  } catch (err) {
    return err;
  }
}

// Read a file's content
app.get("/api/files", async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: "path query param required" });
    }
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    const content = await readFile(filePath, "utf-8");
    const stats = await stat(filePath);
    res.json({
      path: filePath,
      name: basename(filePath),
      content,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Write/update a file
app.put("/api/files", async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || typeof content !== "string") {
      return res.status(400).json({ error: "path and content are required" });
    }
    // Ensure directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (dir && !existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filePath, content, "utf-8");
    const stats = await stat(filePath);
    res.json({
      path: filePath,
      name: basename(filePath),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new file in a project
app.post("/api/projects/:id/files", async (req, res) => {
  try {
    const projects = await loadProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { name, content = "" } = req.body;
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const structure = await loadProjectStructure(project.path);
    if (!existsSync(structure.modelPath)) {
      await mkdir(structure.modelPath, { recursive: true });
    }

    const relativeName = toPosixPath(String(name));
    const filePath = resolve(structure.modelPath, relativeName);
    if (!isPathInside(structure.modelPath, filePath)) {
      return res.status(400).json({ error: "name must stay inside project model path" });
    }

    if (existsSync(filePath)) {
      return res.status(409).json({ error: "File already exists" });
    }

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
    const stats = await stat(filePath);
    res.json({
      path: relative(project.path, filePath),
      fullPath: filePath,
      name: basename(filePath),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move or copy an existing model/policy file into another project
app.post("/api/projects/:id/move-file", async (req, res) => {
  try {
    const targetProjectId = req.params.id;
    const { sourcePath, mode = "move" } = req.body || {};
    if (!sourcePath) {
      return res.status(400).json({ error: "sourcePath is required" });
    }
    if (!["move", "copy"].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'move' or 'copy'" });
    }

    const projects = await loadProjects();
    const targetProject = projects.find((p) => p.id === targetProjectId);
    if (!targetProject) {
      return res.status(404).json({ error: "Target project not found" });
    }

    const sourceFullPath = resolve(String(sourcePath));
    if (!existsSync(sourceFullPath)) {
      return res.status(404).json({ error: "Source file not found" });
    }

    const sourceProject = projects.find((p) => isPathInside(p.path, sourceFullPath));
    if (!sourceProject) {
      return res.status(400).json({ error: "Source file is not inside a registered project" });
    }
    if (sourceProject.id === targetProject.id) {
      return res.status(400).json({ error: "Source and target project are the same" });
    }

    const sourceName = basename(sourceFullPath);
    const ext = extname(sourceName).toLowerCase();
    if (![".yaml", ".yml"].includes(ext)) {
      return res.status(400).json({ error: "Only .yaml/.yml files can be moved" });
    }

    const targetStructure = await loadProjectStructure(targetProject.path);
    if (!existsSync(targetStructure.modelPath)) {
      await mkdir(targetStructure.modelPath, { recursive: true });
    }

    let targetFullPath = join(targetStructure.modelPath, sourceName);
    if (existsSync(targetFullPath)) {
      const stem = sourceName.slice(0, -ext.length);
      let i = 1;
      while (existsSync(targetFullPath)) {
        targetFullPath = join(targetStructure.modelPath, `${stem}_${i}${ext}`);
        i += 1;
      }
    }
    await mkdir(dirname(targetFullPath), { recursive: true });

    if (mode === "copy") {
      await copyFile(sourceFullPath, targetFullPath);
    } else {
      try {
        await rename(sourceFullPath, targetFullPath);
      } catch (err) {
        if (err?.code === "EXDEV") {
          await copyFile(sourceFullPath, targetFullPath);
          await unlinkFile(sourceFullPath);
        } else {
          throw err;
        }
      }
    }

    const stats = await stat(targetFullPath);
    res.json({
      ok: true,
      mode,
      sourceProjectId: sourceProject.id,
      sourcePath: relative(sourceProject.path, sourceFullPath),
      targetProjectId: targetProject.id,
      targetFile: {
        path: relative(targetProject.path, targetFullPath),
        fullPath: targetFullPath,
        name: basename(targetFullPath),
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List saved connector profiles and recent imports
app.get("/api/connections", async (_req, res) => {
  try {
    const connections = await loadConnections();
    connections.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    res.json({ connections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually save/update a connector profile
app.post("/api/connections", async (req, res) => {
  try {
    const { connector, connection_name, ...params } = req.body || {};
    if (!connector) {
      return res.status(400).json({ error: "Missing connector type" });
    }
    const profile = await upsertConnectionProfile({
      connector,
      params,
      connectionName: connection_name,
    });
    res.json({ ok: true, connection: profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve cross-model imports for a project
app.get("/api/projects/:id/model-graph", async (req, res) => {
  try {
    const projects = await loadProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const pathErr = await assertReadableDirectory(project.path);
    if (pathErr) {
      const dockerHint = IS_DOCKER_RUNTIME
        ? " Running in Docker: mount the host parent path (for example -v /Users/<you>:/workspace/host) and use /workspace/host/... in DuckCodeModeling."
        : "";
      return res.status(400).json({
        error:
          `Project path is not accessible: ${project.path}. ` +
          "Check path permissions and existence." +
          dockerHint,
      });
    }

    // Find all model files and parse their imports
    const files = await walkYamlFiles(project.path);
    const modelFiles = files.filter(
      (f) => f.name.endsWith(".model.yaml") || f.name.endsWith(".model.yml")
    );

    const models = [];
    const crossModelRels = [];

    // Parse each model file for its name, entities, and imports
    for (const file of modelFiles) {
      try {
        const content = await readFile(file.fullPath, "utf-8");
        // Simple YAML-like parsing for model metadata
        const nameMatch = content.match(/^\s*name:\s*(.+)$/m);
        const modelName = nameMatch ? nameMatch[1].trim() : file.name;

        // Extract entity names
        const entityNames = [];
        const entityRegex = /^\s*-\s*name:\s*(\S+)\s*$/gm;
        let match;
        while ((match = entityRegex.exec(content)) !== null) {
          entityNames.push(match[1]);
        }

        // Extract imports
        const imports = [];
        const importSection = content.match(/imports:\s*\n((?:\s+-[^\n]+\n?)*)/);
        if (importSection) {
          const importModelRegex = /model:\s*(\S+)/g;
          let im;
          while ((im = importModelRegex.exec(importSection[1])) !== null) {
            imports.push(im[1]);
          }
        }

        models.push({
          name: modelName,
          file: file.fullPath,
          path: file.path,
          entities: entityNames,
          entity_count: entityNames.length,
          imports,
        });
      } catch (_err) {
        // Skip unparseable files
      }
    }

    // Build entity-to-model map
    const entityToModel = {};
    for (const m of models) {
      for (const e of m.entities) {
        entityToModel[e] = m.name;
      }
    }

    // Find cross-model relationships by scanning relationship sections
    for (const file of modelFiles) {
      try {
        const content = await readFile(file.fullPath, "utf-8");
        const nameMatch = content.match(/^\s*name:\s*(.+)$/m);
        const modelName = nameMatch ? nameMatch[1].trim() : file.name;

        // Find relationship from/to references
        const relRegex = /from:\s*(\S+)\.(\w+)\s*\n\s*to:\s*(\S+)\.(\w+)/g;
        let rm;
        while ((rm = relRegex.exec(content)) !== null) {
          const fromEntity = rm[1];
          const toEntity = rm[3];
          const fromModel = entityToModel[fromEntity] || modelName;
          const toModel = entityToModel[toEntity] || modelName;
          if (fromModel !== toModel) {
            crossModelRels.push({
              from_model: fromModel,
              to_model: toModel,
              from_entity: fromEntity,
              to_entity: toEntity,
            });
          }
        }
      } catch (_err) {
        // skip
      }
    }

    res.json({
      projectId: project.id,
      model_count: models.length,
      total_entities: models.reduce((sum, m) => sum + m.entity_count, 0),
      models,
      cross_model_relationships: crossModelRels,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import schema files (SQL, DBML, Spark Schema)
app.post("/api/import", express.json({ limit: "10mb" }), async (req, res) => {
  try {
    const { format, content, filename, modelName } = req.body;
    if (!format || !content) {
      return res.status(400).json({ error: "Missing format or content" });
    }

    const formatMap = {
      sql: "sql",
      dbml: "dbml",
      "spark-schema": "spark-schema",
      dbt: "dbt",
    };
    const importFormat = formatMap[format];
    if (!importFormat) {
      return res.status(400).json({ error: `Unsupported format: ${format}. Supported: sql, dbml, spark-schema, dbt` });
    }

    // Write content to temp file
    const tmpDir = join(REPO_ROOT, ".tmp-import");
    mkdirSync(tmpDir, { recursive: true });
    const ext = { sql: ".sql", dbml: ".dbml", "spark-schema": ".json", dbt: ".yml" }[format];
    const tmpFile = join(tmpDir, `import_${Date.now()}${ext}`);
    writeFileSync(tmpFile, content, "utf-8");

    const args = [
      join(REPO_ROOT, "dm"),
      "import",
      importFormat,
      tmpFile,
      "--model-name",
      modelName || "imported_model",
    ];

    let commandOutput = "";
    let commandError = "";
    let hadCliIssues = false;
    try {
      commandOutput = execFileSync(PYTHON, args, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: REPO_ROOT,
      });
    } catch (err) {
      hadCliIssues = true;
      commandOutput = String(err?.stdout || "");
      commandError = String(err?.stderr || err?.message || "");
    } finally {
      try { unlinkSync(tmpFile); } catch (_) {}
      try { rmdirSync(tmpDir); } catch (_) {}
    }

    const yamlStart = commandOutput.indexOf("model:");
    if (yamlStart < 0) {
      const fallbackErr = commandError || "Import failed: CLI did not return a model YAML payload.";
      return res.status(500).json({ error: fallbackErr.trim() });
    }
    const yamlText = commandOutput.substring(yamlStart);
    const preface = commandOutput.substring(0, yamlStart).trim();
    const cliWarnings = preface
      ? preface.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];

    let model;
    try {
      // The output may contain issue lines before the YAML
      model = yaml.load(yamlText);
    } catch (_) {
      model = null;
    }

    const entities = model?.entities || [];
    const relationships = model?.relationships || [];
    const indexes = model?.indexes || [];
    const fieldCount = entities.reduce((sum, e) => sum + (e.fields || []).length, 0);

    res.json({
      success: true,
      entityCount: entities.length,
      fieldCount,
      relationshipCount: relationships.length,
      indexCount: indexes.length,
      yaml: yamlText,
      hadCliIssues,
      cliWarnings,
      cliError: hadCliIssues ? (commandError.trim() || null) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forward engineering: generate SQL from model YAML
app.post("/api/forward/generate-sql", express.json(), async (req, res) => {
  try {
    const { model_path, dialect = "postgres", out } = req.body || {};
    if (!model_path) {
      return res.status(400).json({ error: "model_path is required" });
    }

    const args = [join(REPO_ROOT, "dm"), "generate", "sql", String(model_path), "--dialect", String(dialect)];
    if (out) args.push("--out", String(out));

    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 120000, cwd: REPO_ROOT });
    res.json({
      success: true,
      dialect: String(dialect),
      modelPath: String(model_path),
      out: out ? String(out) : null,
      sql: out ? null : output,
      output: output.trim(),
    });
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: String(stderr).trim() });
  }
});

// Forward engineering: generate migration SQL from old/new model YAML
app.post("/api/forward/migrate", express.json(), async (req, res) => {
  try {
    const { old_model, new_model, dialect = "postgres", out } = req.body || {};
    if (!old_model || !new_model) {
      return res.status(400).json({ error: "old_model and new_model are required" });
    }

    const args = [join(REPO_ROOT, "dm"), "migrate", String(old_model), String(new_model), "--dialect", String(dialect)];
    if (out) args.push("--out", String(out));

    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 120000, cwd: REPO_ROOT });
    res.json({
      success: true,
      dialect: String(dialect),
      oldModel: String(old_model),
      newModel: String(new_model),
      out: out ? String(out) : null,
      sql: out ? null : output,
      output: output.trim(),
    });
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: String(stderr).trim() });
  }
});

// Forward engineering: apply SQL/migration to live warehouse
app.post("/api/forward/apply", express.json({ limit: "10mb" }), async (req, res) => {
  if (!DIRECT_APPLY_ENABLED) {
    return res.status(403).json({
      error: "Direct apply is disabled in GitOps product mode. Generate migration SQL and deploy via CI/CD.",
    });
  }

  let conn = { args: [], cleanup: () => {} };
  let tempSqlFile = null;
  try {
    const {
      connector,
      dialect,
      sql_file,
      sql,
      old_model,
      new_model,
      model_schema,
      migration_name,
      ledger_table,
      dry_run,
      skip_ledger,
      policy_pack,
      skip_policy_check,
      allow_destructive,
      write_sql,
      report_json,
      output_json,
      ...params
    } = req.body || {};

    if (!connector) {
      return res.status(400).json({ error: "connector is required" });
    }

    const hasSqlFile = Boolean(sql_file);
    const hasInlineSql = Boolean(sql);
    const hasOldNew = Boolean(old_model && new_model);
    const inputModes = [hasSqlFile, hasInlineSql, hasOldNew].filter(Boolean).length;
    if (inputModes !== 1) {
      return res.status(400).json({ error: "Provide exactly one input mode: sql_file, sql, or old_model+new_model" });
    }

    conn = buildConnArgs(params);
    const args = [join(REPO_ROOT, "dm"), "apply", String(connector), "--dialect", String(dialect || connector), ...conn.args];

    if (model_schema) args.push("--model-schema", String(model_schema));
    if (migration_name) args.push("--migration-name", String(migration_name));
    if (ledger_table) args.push("--ledger-table", String(ledger_table));
    if (dry_run) args.push("--dry-run");
    if (skip_ledger) args.push("--skip-ledger");
    if (policy_pack) args.push("--policy-pack", String(policy_pack));
    if (skip_policy_check) args.push("--skip-policy-check");
    if (allow_destructive) args.push("--allow-destructive");
    if (write_sql) args.push("--write-sql", String(write_sql));
    if (report_json) args.push("--report-json", String(report_json));
    const wantsOutputJson = output_json !== false;
    if (wantsOutputJson) args.push("--output-json");

    if (hasSqlFile) {
      args.push("--sql-file", String(sql_file));
    } else if (hasInlineSql) {
      const tmpDir = join(REPO_ROOT, ".tmp");
      if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
      tempSqlFile = join(tmpDir, `apply_${Date.now()}.sql`);
      writeFileSync(tempSqlFile, String(sql), "utf-8");
      args.push("--sql-file", tempSqlFile);
    } else {
      args.push("--old", String(old_model), "--new", String(new_model));
    }

    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 300000, cwd: REPO_ROOT });
    const trimmed = output.trim();
    let summary = null;
    if (output_json !== false) {
      try {
        summary = JSON.parse(trimmed);
      } catch (_) {
        summary = null;
      }
    }
    res.json({
      success: true,
      connector: String(connector),
      summary,
      output: summary ? null : trimmed,
    });
  } catch (err) {
    const stderr = err.stderr || err.message;
    const stdout = err.stdout || "";
    res.status(500).json({ error: String(stderr).trim(), output: String(stdout).trim() || null });
  } finally {
    try { if (tempSqlFile) unlinkSync(tempSqlFile); } catch (_) {}
    conn.cleanup();
  }
});

/**
 * Normalize a PEM private key string so it is valid PKCS8 format.
 * Handles literal \\n strings, missing headers, or stripped newlines
 * that can occur when pasting into a textarea.
 */
function normalizePemKey(raw) {
  if (!raw || typeof raw !== "string") return raw;

  // Replace literal \n sequences with real newlines
  let key = raw.replace(/\\n/g, "\n").trim();

  // Detect the header type
  const isEncrypted = key.includes("ENCRYPTED PRIVATE KEY");
  const headerTag = isEncrypted ? "ENCRYPTED PRIVATE KEY" : "PRIVATE KEY";
  const header = `-----BEGIN ${headerTag}-----`;
  const footer = `-----END ${headerTag}-----`;

  // Strip existing headers/footers and all whitespace to get raw base64
  let body = key
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");

  if (!body) return key;

  // Re-wrap base64 at 64 chars per line (PEM standard)
  const lines = [];
  for (let i = 0; i < body.length; i += 64) {
    lines.push(body.substring(i, i + 64));
  }

  return `${header}\n${lines.join("\n")}\n${footer}\n`;
}

// Helper: build connection args array from request params
// Returns { args, cleanup } — call cleanup() after the CLI command finishes
function buildConnArgs(params) {
  const args = [];
  let cleanup = () => {};
  if (params.host) { args.push("--host", params.host); }
  if (params.port) { args.push("--port", String(params.port)); }
  if (params.database) { args.push("--database", params.database); }
  if (params.db_schema) { args.push("--db-schema", params.db_schema); }
  if (params.user) { args.push("--user", params.user); }
  if (params.password) { args.push("--password", params.password); }
  if (params.warehouse) { args.push("--warehouse", params.warehouse); }
  if (params.project) { args.push("--project", params.project); }
  if (params.dataset) { args.push("--dataset", params.dataset); }
  if (params.catalog) { args.push("--catalog", params.catalog); }
  if (params.token) { args.push("--token", params.token); }
  if (params.http_path) { args.push("--http-path", params.http_path); }
  if (params.odbc_driver) { args.push("--odbc-driver", params.odbc_driver); }
  if (params.encrypt !== undefined && params.encrypt !== null && params.encrypt !== "") { args.push("--encrypt", String(params.encrypt)); }
  if (params.trust_server_certificate !== undefined && params.trust_server_certificate !== null && params.trust_server_certificate !== "") {
    args.push("--trust-server-certificate", String(params.trust_server_certificate));
  }
  if (params.private_key_path) { args.push("--private-key-path", params.private_key_path); }
  // If raw PEM key content is provided, normalize and write to a temp file
  if (params.private_key_content) {
    const normalizedKey = normalizePemKey(params.private_key_content);
    const tmpDir = join(REPO_ROOT, ".tmp");
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    const tmpFile = join(tmpDir, `pk_${Date.now()}.pem`);
    writeFileSync(tmpFile, normalizedKey, { mode: 0o600 });
    args.push("--private-key-path", tmpFile);
    cleanup = () => { try { unlinkSync(tmpFile); } catch (_) {} };
  }
  return { args, cleanup };
}

// List available database connectors
app.get("/api/connectors", (req, res) => {
  try {
    const output = execFileSync(PYTHON, [
      join(REPO_ROOT, "dm"), "connectors", "--output-json",
    ], { encoding: "utf-8", timeout: 10000, cwd: REPO_ROOT });
    const connectors = JSON.parse(output);
    res.json(connectors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan a local dbt repo path and return dbt YAML file candidates for import
app.post("/api/connectors/dbt-repo/scan", express.json(), async (req, res) => {
  try {
    const repoPath = String(req.body?.repo_path || "").trim();
    if (!repoPath) {
      return res.status(400).json({ error: "repo_path is required" });
    }

    const pathErr = await assertReadableDirectory(repoPath);
    if (pathErr) {
      const dockerHint = IS_DOCKER_RUNTIME
        ? " Running in Docker: mount the host parent path (for example -v /Users/<you>:/workspace/host) and use /workspace/host/... in DuckCodeModeling."
        : "";
      return res.status(400).json({
        error:
          `Repository path is not accessible: ${repoPath}. ` +
          "Check path permissions and existence." +
          dockerHint,
      });
    }

    const yamlFiles = await walkYamlFiles(repoPath);
    const dbtFiles = [];

    for (const file of yamlFiles) {
      let content = "";
      try {
        content = await readFile(file.fullPath, "utf-8");
      } catch (_err) {
        continue;
      }
      const summary = parseDbtDocSummary(content, file.path);
      if (!summary) continue;
      dbtFiles.push({
        name: file.name,
        path: file.path,
        fullPath: file.fullPath,
        size: file.size,
        modifiedAt: file.modifiedAt,
        sections: summary,
      });
    }

    dbtFiles.sort((a, b) => a.path.localeCompare(b.path));
    const repoName = deriveDbtRepoName(repoPath);
    const totalSections = dbtFiles.reduce(
      (acc, f) => {
        acc.models += f.sections.models || 0;
        acc.sources += f.sections.sources || 0;
        acc.semantic_models += f.sections.semantic_models || 0;
        acc.metrics += f.sections.metrics || 0;
        return acc;
      },
      { models: 0, sources: 0, semantic_models: 0, metrics: 0 }
    );

    return res.json({
      success: true,
      repoPath,
      repoName,
      yamlFileCount: yamlFiles.length,
      dbtFiles,
      dbtFileCount: dbtFiles.length,
      totals: totalSections,
      suggestedSubfolder: "duckcodemodeling-models",
      suggestedTargetPath: join(repoPath, "duckcodemodeling-models"),
      suggestedProjectName: `${repoName}-duckcodemodeling`,
      suggestedModelName: sanitizeModelStem(`${repoName}_dbt`, "dbt_model"),
      warnings: dbtFiles.length === 0
        ? ["No dbt schema/source/semantic/metrics YAML files found under this path."]
        : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test database connection
app.post("/api/connectors/test", express.json(), async (req, res) => {
  let conn = { args: [], cleanup: () => {} };
  try {
    const { connector, connection_name, connection_id: _connectionId, ...params } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    conn = buildConnArgs(params);
    const args = [join(REPO_ROOT, "dm"), "pull", connector, "--test", ...conn.args];

    try {
      const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 30000, cwd: REPO_ROOT });
      const ok = output.startsWith("OK");
      let saved = null;
      if (ok) {
        saved = await upsertConnectionProfile({
          connector,
          params,
          connectionName: connection_name,
        });
      }
      res.json({
        ok,
        message: output.trim(),
        connectionId: saved?.id || null,
        connection: saved,
      });
    } catch (execErr) {
      const stderr = execErr.stderr || execErr.message;
      res.json({ ok: false, message: stderr.trim() });
    } finally {
      conn.cleanup();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List schemas/datasets in a database
app.post("/api/connectors/schemas", express.json(), async (req, res) => {
  let conn = { args: [], cleanup: () => {} };
  try {
    const { connector, ...params } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    conn = buildConnArgs(params);
    const args = [join(REPO_ROOT, "dm"), "schemas", connector, "--output-json", ...conn.args];
    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 30000, cwd: REPO_ROOT });
    const schemas = JSON.parse(output);
    res.json(schemas);
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: stderr });
  } finally {
    conn.cleanup();
  }
});

// List tables in a schema
app.post("/api/connectors/tables", express.json(), async (req, res) => {
  let conn = { args: [], cleanup: () => {} };
  try {
    const { connector, ...params } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    conn = buildConnArgs(params);
    const args = [join(REPO_ROOT, "dm"), "tables", connector, "--output-json", ...conn.args];
    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 30000, cwd: REPO_ROOT });
    const tables = JSON.parse(output);
    res.json(tables);
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: stderr });
  } finally {
    conn.cleanup();
  }
});

// Pull schema from database
app.post("/api/connectors/pull", express.json(), async (req, res) => {
  let conn = { args: [], cleanup: () => {} };
  try {
    const {
      connector,
      model_name,
      tables,
      connection_id,
      project_id,
      project_path,
      ...params
    } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    conn = buildConnArgs(params);
    const args = [join(REPO_ROOT, "dm"), "pull", connector, ...conn.args];
    if (model_name) { args.push("--model-name", model_name); }
    if (tables) {
      const tableList = typeof tables === "string" ? tables.split(",").map(t => t.trim()).filter(Boolean) : tables;
      if (tableList.length) { args.push("--tables", ...tableList); }
    }

    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 60000, cwd: REPO_ROOT });

    // Parse YAML output
    const yamlStart = output.indexOf("model:");
    const yamlText = yamlStart >= 0 ? output.substring(yamlStart) : output;
    let model;
    try { model = yaml.load(yamlText); } catch (_) { model = null; }

    const entities = model?.entities || [];
    const relationships = model?.relationships || [];
    const indexes = model?.indexes || [];
    const fieldCount = entities.reduce((sum, e) => sum + (e.fields || []).length, 0);

    const schemaName = params.db_schema || params.dataset || model_name || "default";

    const savedConnection = await appendConnectionImportEvent({
      connectionId: connection_id,
      connector,
      params,
      event: {
        mode: "pull-single",
        projectId: project_id || null,
        projectPath: project_path || null,
        schemas: [schemaName],
        files: [`${schemaName}.model.yaml`],
        totalEntities: entities.length,
        totalFields: fieldCount,
        totalRelationships: relationships.length,
      },
    });

    res.json({
      success: true,
      entityCount: entities.length,
      fieldCount,
      relationshipCount: relationships.length,
      indexCount: indexes.length,
      yaml: yamlText,
      connectionId: savedConnection?.id || null,
    });
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: stderr });
  } finally {
    conn.cleanup();
  }
});

// Pull multiple schemas — one model file per schema
app.post("/api/connectors/pull-multi", express.json(), async (req, res) => {
  // Write temp key file once for all schemas, clean up at the end
  let baseConn = { args: [], cleanup: () => {} };
  try {
    const {
      connector,
      schemas: schemaList,
      connection_id,
      project_id,
      project_path,
      ...params
    } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });
    if (!schemaList || !Array.isArray(schemaList) || schemaList.length === 0) {
      return res.status(400).json({ error: "Missing schemas array" });
    }

    // Build base args once (handles temp key file)
    baseConn = buildConnArgs(params);

    const results = [];
    const errors = [];

    for (const schemaEntry of schemaList) {
      const schemaName = typeof schemaEntry === "string" ? schemaEntry : schemaEntry.name;
      const tablesToPull = typeof schemaEntry === "object" ? schemaEntry.tables : null;

      try {
        const schemaParams = { db_schema: schemaName };
        if (connector === "bigquery") schemaParams.dataset = schemaName;
        const schemaConn = buildConnArgs(schemaParams);

        const args = [join(REPO_ROOT, "dm"), "pull", connector, ...baseConn.args, ...schemaConn.args];
        args.push("--model-name", schemaName);

        if (tablesToPull && Array.isArray(tablesToPull) && tablesToPull.length > 0) {
          args.push("--tables", ...tablesToPull);
        }

        const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 120000, cwd: REPO_ROOT });

        const yamlStart = output.indexOf("model:");
        const yamlText = yamlStart >= 0 ? output.substring(yamlStart) : output;
        let model;
        try { model = yaml.load(yamlText); } catch (_) { model = null; }

        const entities = model?.entities || [];
        const relationships = model?.relationships || [];
        const indexes = model?.indexes || [];
        const fieldCount = entities.reduce((sum, e) => sum + (e.fields || []).length, 0);

        results.push({
          schema: schemaName,
          success: true,
          entityCount: entities.length,
          fieldCount,
          relationshipCount: relationships.length,
          indexCount: indexes.length,
          yaml: yamlText,
        });
      } catch (pullErr) {
        const stderr = pullErr.stderr || pullErr.message;
        errors.push({ schema: schemaName, error: stderr });
        results.push({ schema: schemaName, success: false, error: stderr });
      }
    }

    const totalEntities = results.filter(r => r.success).reduce((s, r) => s + r.entityCount, 0);
    const totalFields = results.filter(r => r.success).reduce((s, r) => s + r.fieldCount, 0);
    const totalRels = results.filter(r => r.success).reduce((s, r) => s + r.relationshipCount, 0);
    const successfulSchemas = results.filter((r) => r.success).map((r) => r.schema);
    const fileNames = successfulSchemas.map((s) => `${s}.model.yaml`);

    const savedConnection = await appendConnectionImportEvent({
      connectionId: connection_id,
      connector,
      params,
      event: {
        mode: "pull-multi",
        projectId: project_id || null,
        projectPath: project_path || null,
        schemas: successfulSchemas,
        files: fileNames,
        totalEntities,
        totalFields,
        totalRelationships: totalRels,
      },
    });

    res.json({
      success: errors.length === 0,
      schemasProcessed: results.length,
      schemasFailed: errors.length,
      totalEntities,
      totalFields,
      totalRelationships: totalRels,
      results,
      errors,
      connectionId: savedConnection?.id || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    baseConn.cleanup();
  }
});

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(WEB_DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`[duckcodemodeling] Local file server running on http://localhost:${PORT}`);
  console.log(`[duckcodemodeling] Repo root: ${REPO_ROOT}`);
  if (existsSync(WEB_DIST)) {
    console.log(`[duckcodemodeling] Serving web app from: ${WEB_DIST}`);
  } else {
    console.log(`[duckcodemodeling] Web dist not found at: ${WEB_DIST}`);
  }
});
