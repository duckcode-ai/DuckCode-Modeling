import express from "express";
import cors from "cors";
import { readdir, readFile, writeFile, mkdir, stat, rename, copyFile, unlink as unlinkFile } from "fs/promises";
import { join, relative, extname, basename, resolve, isAbsolute, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, rmSync, realpathSync } from "fs";
import { execFileSync, spawn } from "child_process";
import { tmpdir } from "os";
import { createRequire } from "module";
import { randomBytes } from "crypto";
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const app = express();
const PORT = process.env.PORT || 3006;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`[datalex] ${req.method} ${req.url}`);
  next();
});

// ---------------------------------------------------------------------------
// Error envelope (Phase 1 slice B)
// ---------------------------------------------------------------------------
// Every new or converted route writes errors as:
//   { error: { code: "<ERROR_CODE>", message: "<human>", details?: <any> } }
// Legacy routes that still use `res.status(X).json({ error: "..." })` keep
// working — the frontend `request()` helper accepts both shapes. Codes:
//   VALIDATION         — malformed input, missing required field, bad enum value
//   NOT_FOUND          — project, file, folder, or resource not present
//   CONFLICT           — destination already exists / duplicate create
//   PATH_ESCAPE        — path would resolve outside the project model root
//   PARSE_FAILED       — YAML / JSON from disk or subprocess is unreadable
//   SUBPROCESS_FAILED  — shelled-out CLI (datalex, git, dbt) exited non-zero
//   INTERNAL           — uncaught exception, fallback code from errorHandler
class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function apiFail(res, status, code, message, details = null) {
  const body = { code, message };
  if (details != null) body.details = details;
  return res.status(status).json({ error: body });
}


// Project root defaults to the monorepo root (two levels up from packages/api-server)
const REPO_ROOT = process.env.REPO_ROOT || join(process.cwd(), "../..");
const PROJECTS_FILE = join(REPO_ROOT, ".dm-projects.json");
const CONNECTIONS_FILE = join(REPO_ROOT, ".dm-connections.json");
const CREDENTIALS_FILE = join(REPO_ROOT, ".dm-credentials.json");
// DataLex is open-source and runs locally — no user accounts, no
// sessions, no role gating. Middleware hooks below are intentional
// no-ops so existing route registrations (`app.post(..., requireAdmin,
// handler)`) keep working without a per-route edit sweep.
function requireAuth(_req, _res, next) { next(); }
function requireAdmin(_req, _res, next) { next(); }

const WEB_DIST = process.env.WEB_DIST || join(REPO_ROOT, "packages", "web-app", "dist");

// Python resolution order:
//   1. `DM_PYTHON` env var — set by `datalex serve` to its own sys.executable so
//      the subprocess always has the same datalex_cli package the user just ran.
//   2. `<REPO_ROOT>/.venv/bin/python3` — dev-clone convention.
//   3. `python3` on PATH — last-resort fallback; may not have datalex_cli.
const VENV_PYTHON = join(REPO_ROOT, ".venv", "bin", "python3");
const PYTHON =
  (process.env.DM_PYTHON && existsSync(process.env.DM_PYTHON) && process.env.DM_PYTHON) ||
  (existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3");

// Resolve the CLI entry point. `dm` at the repo root is the dev-clone
// path; when the api-server is shipped in a pip wheel, that script
// doesn't exist, so we fall back to the `datalex` / `dm` shell script
// the wheel installs on PATH (via [project.scripts] in pyproject.toml).
//
// `cmd_serve` may also set DM_CLI directly to override — useful for
// integration tests.
// The launcher script was renamed `dm → datalex` in Apr 2026. `REPO_DM_SCRIPT`
// keeps the constant name for code-level compatibility but points at the
// current filename. `REPO_DM_LEGACY` lets a dev on a pre-rename checkout
// still boot.
const REPO_DM_SCRIPT = join(REPO_ROOT, "datalex");
const REPO_DM_LEGACY = join(REPO_ROOT, "dm");
const DM_CLI_OVERRIDE = process.env.DM_CLI || null;
const DM_CLI_KIND = (() => {
  if (DM_CLI_OVERRIDE && existsSync(DM_CLI_OVERRIDE)) return "python-script";
  if (DM_CLI_OVERRIDE) return "exec";  // bare command name on PATH
  if (existsSync(REPO_DM_SCRIPT)) return "python-script";
  if (existsSync(REPO_DM_LEGACY)) return "python-script";
  return "exec"; // falls back to `datalex` on PATH
})();
const DM_CLI_TARGET = (() => {
  if (DM_CLI_OVERRIDE) return DM_CLI_OVERRIDE;
  if (existsSync(REPO_DM_SCRIPT)) return REPO_DM_SCRIPT;
  if (existsSync(REPO_DM_LEGACY)) return REPO_DM_LEGACY;
  return "datalex";
})();

// dmExec(...args) → [command, [argv]] pair for execFileSync/spawn. Use
// it anywhere the old code did `execFileSync(PYTHON, [join(REPO_ROOT,
// "dm"), ...])`. Callers that still pass `[PYTHON, join(REPO_ROOT,
// "dm"), ...]` keep working because the `dm` file still exists in the
// dev clone; the fallback only kicks in on installed wheels.
function dmExec(...args) {
  if (DM_CLI_KIND === "python-script") {
    return { cmd: PYTHON, argv: [DM_CLI_TARGET, ...args] };
  }
  return { cmd: DM_CLI_TARGET, argv: [...args] };
}

const IS_DOCKER_RUNTIME = existsSync("/.dockerenv");
const DIRECT_APPLY_ENABLED = ["1", "true", "yes", "on"].includes(String(process.env.DM_ENABLE_DIRECT_APPLY || "").toLowerCase());
const DATALEX_CONFIG_DIRNAME = ".datalex";
const DATALEX_PROJECT_CONFIG = join(DATALEX_CONFIG_DIRNAME, "project.json");
const DATALEX_DEFAULT_STRUCTURE = {
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

// Canonical path for dedupe: follows symlinks and normalizes
// case-insensitive filesystems (macOS APFS/HFS+, Windows NTFS) so
// `~/Jaffle-Shop` and `~/jaffle-shop` collapse to a single registration.
// Falls back to the resolved absolute path when the target does not
// exist on disk (e.g. orphan entry from a deleted folder).
function canonicalProjectPath(p) {
  if (!p) return "";
  try {
    return realpathSync.native(resolve(p));
  } catch (_) {
    try { return realpathSync(resolve(p)); } catch (_) { return resolve(p); }
  }
}

// Drop duplicate entries (same canonical path) and drop phantom entries
// whose folder no longer exists on disk. Keeps the first occurrence so
// user-chosen names win over auto-registered ones.
function cleanProjectList(projects) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(projects) ? projects : []) {
    if (!p || !p.path) continue;
    if (!existsSync(p.path)) continue;              // phantom — folder gone
    const key = canonicalProjectPath(p.path);
    if (seen.has(key)) continue;                    // duplicate by canonical path
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function loadProjects() {
  try {
    if (existsSync(PROJECTS_FILE)) {
      const raw = await readFile(PROJECTS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      const cleaned = cleanProjectList(parsed);
      // Self-heal on load: if the file had dupes/phantoms, persist the
      // cleaned list so the UI stops seeing them.
      if (cleaned.length !== (Array.isArray(parsed) ? parsed.length : 0)) {
        try { await writeFile(PROJECTS_FILE, JSON.stringify(cleaned, null, 2), "utf-8"); } catch (_) {}
      }
      return cleaned;
    }
  } catch (_err) {
    // ignore
  }
  // No projects file yet — return an empty list. The legacy hardcoded
  // "model-examples" starter was removed because the folder often does
  // not exist on user installs, leaving a broken dropdown entry.
  return [];
}

async function saveProjects(projects) {
  await writeFile(PROJECTS_FILE, JSON.stringify(cleanProjectList(projects), null, 2), "utf-8");
}

// Credentials store — kept in a separate file, never committed
async function loadCredentials() {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      const raw = await readFile(CREDENTIALS_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (_) {}
  return {};
}
async function saveCredentials(creds) {
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  // Auto-add to .gitignore so it is never accidentally committed
  const gitignorePath = join(REPO_ROOT, ".gitignore");
  try {
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
    if (!existing.includes(".dm-credentials.json")) {
      writeFileSync(gitignorePath, existing + (existing.endsWith("\n") ? "" : "\n") + ".dm-credentials.json\n", "utf-8");
    }
  } catch (_) {}
}

// Build an authenticated clone URL by injecting the token into the HTTPS URL
function buildAuthUrl(url, token) {
  if (!token) return url;
  try {
    const u = new URL(url.replace(/^git\+https:\/\//, "https://"));
    // GitLab uses oauth2 as the username; GitHub and others accept the token as username
    if (/gitlab/i.test(u.hostname)) {
      u.username = "oauth2";
      u.password = token;
    } else {
      u.username = token;
      u.password = "";
    }
    return u.toString();
  } catch (_) {
    return url;
  }
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

function sanitizeFolderName(value, fallback = "datalex-project") {
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
    DATALEX_CONFIG_DIRNAME,
  ];
  for (const relDir of dirs) {
    await mkdir(join(absoluteProjectPath, relDir), { recursive: true });
  }

  const readme = [
    `# ${basename(absoluteProjectPath)}` ,
    "",
    "Programmable data modeling repository managed by DataLex.",
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
    "# DataLex",
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
    "        run: echo \"Add datalex validate/migrate checks here\"",
    "",
  ].join("\n");

  await writeFileIfMissing(join(absoluteProjectPath, "README.md"), readme);
  await writeFileIfMissing(join(absoluteProjectPath, ".gitignore"), gitignore);
  await writeFileIfMissing(
    join(absoluteProjectPath, DATALEX_PROJECT_CONFIG),
    `${JSON.stringify(DATALEX_DEFAULT_STRUCTURE, null, 2)}\n`
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
  const configPath = join(absoluteProjectPath, DATALEX_PROJECT_CONFIG);

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

// Parses a YAML file for the dbt repo summary endpoint.
// Return shape:
//   null                                 — not a dbt doc (sources/models/metrics empty); caller skips silently.
//   { parseError: { reason, line, col } }— YAML is malformed; caller surfaces to user.
//   { models, sources, ... }             — parsed successfully.
// Previously a parse failure looked identical to "not a dbt doc", so broken
// schema.yml files vanished from the UI with no explanation.
function parseDbtDocSummary(text, relPath) {
  let loaded;
  try {
    loaded = yaml.load(text);
  } catch (err) {
    const mark = err?.mark || {};
    return {
      parseError: {
        reason: String(err?.reason || err?.message || "YAML parse failed").slice(0, 300),
        line: typeof mark.line === "number" ? mark.line + 1 : null,
        column: typeof mark.column === "number" ? mark.column + 1 : null,
      },
    };
  }
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return null;

  // Skip files already in DataLex model format
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
app.post("/api/projects", requireAdmin, async (req, res) => {
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
    // Canonical dedupe: reuse existing registration if the user points
    // at the same folder (case-insensitive on macOS/Windows, symlink-safe).
    const canonAbs = canonicalProjectPath(absoluteFolderPath);
    const existing = projects.find((p) => canonicalProjectPath(p.path) === canonAbs);
    if (existing) {
      return res.json({ project: existing });
    }
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
app.put("/api/projects/:id", requireAdmin, async (req, res) => {
  try {
    const {
      name,
      path: folderPath,
      create_if_missing,
      scaffold_repo,
      initialize_git,
      create_subfolder,
      github_repo,
      default_branch,
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
      ...(github_repo !== undefined ? { githubRepo: String(github_repo || "").trim() || null } : {}),
      ...(default_branch !== undefined ? { defaultBranch: String(default_branch || "").trim() || null } : {}),
    };
    projects[idx] = updated;
    await saveProjects(projects);
    res.json({ project: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a project
app.delete("/api/projects/:id", requireAdmin, async (req, res) => {
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
        ? " Running in Docker: mount the host parent path (for example -v /Users/<you>:/workspace/host) and use /workspace/host/... in DataLex."
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
    // Project-open hook: keep the conventional diagrams folder visible in
    // Explorer even for projects that weren't created via dbt import. Safe
    // to call every time — idempotent and never rewrites existing files.
    ensureDiagramsFolder(structure.modelPath);

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

// PATCH project config — merges `req.body.patch` into `.datalex/project.json`.
// Used for toggling auto-commit, setting default dialect, etc., without
// requiring the user to hand-edit YAML. Creates the file if missing.
app.patch("/api/projects/:id/config", requireAdmin, async (req, res, next) => {
  try {
    const projectPath = await resolveProjectPath(req.params.id);
    if (!projectPath) return apiFail(res, 404, "NOT_FOUND", "Project not found");
    const patch = req.body?.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return apiFail(res, 400, "VALIDATION", "Body must include a { patch } object.");
    }
    const absProjectPath = resolve(projectPath);
    const configPath = join(absProjectPath, DATALEX_PROJECT_CONFIG);
    let existing = {};
    if (existsSync(configPath)) {
      try {
        const raw = await readFile(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed;
      } catch (_err) { existing = {}; }
    }
    // Shallow merge with a one-level deep merge for nested objects (so that
    // `{ autoCommit: { enabled: true } }` doesn't wipe a sibling field like
    // `autoCommit.messageTemplate`).
    const merged = { ...existing };
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && !Array.isArray(v) && existing[k] && typeof existing[k] === "object" && !Array.isArray(existing[k])) {
        merged[k] = { ...existing[k], ...v };
      } else {
        merged[k] = v;
      }
    }
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
    res.json({ ok: true, projectConfig: merged });
  } catch (err) {
    next(err);
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

// Git: structured file-level diff vs a baseline ref (default: main).
// Drives the v0.4.2 canvas overlay — "show me what changed since main".
// Returns path arrays grouped by change kind so the browser can map each
// path to an entity via `workspace.projectFiles` and decorate the canvas.
//
// `git diff --name-status <ref>...HEAD` uses a three-dot so only HEAD-side
// commits count as changes; shared ancestors drop out even if the ref
// itself has diverged locally.
app.get("/api/git/diff-files", async (req, res) => {
  try {
    const projectId = String(req.query.projectId || "").trim();
    if (!projectId) {
      return res.status(400).json({ error: "projectId query param required" });
    }
    const projectPath = await resolveProjectPath(projectId);
    if (!projectPath) {
      return res.status(404).json({ error: "Project not found" });
    }
    const rawRef = String(req.query.ref || "main").trim();
    // Guardrail: refuse refs with shell metacharacters. `git` itself would
    // reject them but we prefer an explicit 400 over a noisy stderr leak.
    if (!/^[A-Za-z0-9._/\-@]+$/.test(rawRef)) {
      return res.status(400).json({ error: "invalid ref" });
    }

    let output = "";
    try {
      output = runGit(["diff", "--name-status", `${rawRef}...HEAD`], projectPath);
    } catch (err) {
      const stderr = (err.stderr || err.message || "").toString();
      if (stderr.includes("unknown revision") || stderr.includes("bad revision")) {
        return res.status(404).json({ error: `ref not found: ${rawRef}` });
      }
      throw err;
    }

    const added = [];
    const modified = [];
    const removed = [];
    const renamed = []; // { from, to }
    for (const line of output.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      const status = parts[0] || "";
      if (status.startsWith("A")) added.push(parts[1]);
      else if (status.startsWith("M")) modified.push(parts[1]);
      else if (status.startsWith("D")) removed.push(parts[1]);
      else if (status.startsWith("R")) {
        // Treat a rename as remove(from) + add(to) so the overlay shows
        // both sides; callers that care can inspect `renamed` directly.
        renamed.push({ from: parts[1], to: parts[2] });
        if (parts[1]) removed.push(parts[1]);
        if (parts[2]) added.push(parts[2]);
      } else if (status.startsWith("C")) {
        // Copy — surface as an add on the new path.
        if (parts[2]) added.push(parts[2]);
      }
      // Typechanges (T) and unmerged (U) are rare for YAML — fall through.
    }
    res.json({
      ok: true,
      projectId,
      ref: rawRef,
      added,
      modified,
      removed,
      renamed,
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
app.post("/api/git/commit", requireAdmin, express.json(), async (req, res) => {
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
app.post("/api/git/stage", requireAdmin, express.json(), async (req, res) => {
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
app.post("/api/git/unstage", requireAdmin, express.json(), async (req, res) => {
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


// Git: list local branches for a project
app.get("/api/git/branches", async (req, res) => {
  try {
    const { projectId } = req.query;
    const projectPath = await resolveProjectPath(String(projectId || "").trim());
    if (!projectPath) return res.status(404).json({ error: "Project not found" });
    if (!existsSync(projectPath)) return res.status(400).json({ error: "Project path does not exist" });
    try {
      const output = runGit(["branch", "--list", "--format=%(refname:short)"], projectPath);
      const branches = output.split("\n").map((b) => b.trim()).filter(Boolean);
      res.json({ branches });
    } catch (_err) {
      res.json({ branches: [] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Git: list tags — backs the v0.5.0 "Snapshots" UI where each tag is a
// frozen view of a diagram state. Returns `{tags: [{name, commit, date,
// subject, annotation}, ...]}` sorted newest-first. Uses `creatordate`
// so annotated + lightweight tags both sort correctly (the tag's own
// creation date for annotated, the target commit's committer date for
// lightweight).
app.get("/api/git/tags", async (req, res) => {
  try {
    const { projectId } = req.query;
    const projectPath = await resolveProjectPath(String(projectId || "").trim());
    if (!projectPath) return res.status(404).json({ error: "Project not found" });
    if (!existsSync(projectPath)) return res.status(400).json({ error: "Project path does not exist" });
    try {
      // %(contents:subject) is populated for annotated tags; lightweight
      // tags fall back to the target commit's subject via %(*subject).
      const format = "%(refname:short)%x1f%(objectname:short)%x1f%(creatordate:iso-strict)%x1f%(subject)%x1f%(contents:subject)";
      const output = runGit(
        ["tag", "--list", "--sort=-creatordate", `--format=${format}`],
        projectPath
      );
      const tags = output
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name, commit, date, commitSubject, annotation] = line.split("\x1f");
          return {
            name: name || "",
            commit: commit || "",
            date: date || "",
            subject: (annotation || commitSubject || "").trim(),
            annotated: !!annotation,
          };
        });
      res.json({ ok: true, projectId, tags });
    } catch (_err) {
      res.json({ ok: true, projectId, tags: [] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Git: create an annotated tag. Default behavior is to annotate the
// current HEAD so the snapshot captures the state the user is looking at.
// `ref` may be passed to tag an arbitrary commit (power-user path; we
// don't expose this in the UI yet).
app.post("/api/git/tags", requireAdmin, express.json(), async (req, res) => {
  try {
    const { projectId, name, message, ref } = req.body || {};
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return res.status(400).json({ error: "projectId is required" });
    }
    const tagName = String(name || "").trim();
    if (!tagName) {
      return res.status(400).json({ error: "tag name is required" });
    }
    // Lightweight guardrail — git rejects these but we'd rather 400 cleanly.
    if (!/^[A-Za-z0-9._/\-]+$/.test(tagName) || tagName.startsWith("-") || tagName.endsWith(".lock")) {
      return res.status(400).json({ error: "tag name contains invalid characters" });
    }
    const projectPath = await resolveProjectPath(normalizedProjectId);
    if (!projectPath) return res.status(404).json({ error: "Project not found" });

    const body = String(message || `Snapshot: ${tagName}`).trim();
    const target = String(ref || "HEAD").trim();
    if (!/^[A-Za-z0-9._/\-@]+$/.test(target)) {
      return res.status(400).json({ error: "invalid ref" });
    }

    try {
      runGit(["tag", "-a", tagName, "-m", body, target], projectPath);
    } catch (err) {
      const stderr = (err.stderr || err.message || "").toString();
      if (stderr.includes("already exists")) {
        return res.status(409).json({ error: `Tag "${tagName}" already exists` });
      }
      throw err;
    }

    // Re-read the tag we just made so the UI can refresh without a second
    // GET. Lightweight format mirrors the list endpoint.
    const format = "%(refname:short)%x1f%(objectname:short)%x1f%(creatordate:iso-strict)%x1f%(subject)%x1f%(contents:subject)";
    const out = runGit(
      ["tag", "--list", tagName, `--format=${format}`],
      projectPath
    ).trim();
    const [, commit, date, commitSubject, annotation] = out.split("\x1f");
    res.json({
      ok: true,
      tag: {
        name: tagName,
        commit: commit || "",
        date: date || "",
        subject: (annotation || commitSubject || "").trim(),
        annotated: true,
      },
    });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    if (stderr.includes("not a git repository")) {
      return res.status(400).json({ error: "Selected project is not a git repository" });
    }
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// Git: delete a local tag. Remote cleanup is a separate `git push --delete`
// which we leave to the power-user flow; this only touches the local ref.
app.delete("/api/git/tags", requireAdmin, express.json(), async (req, res) => {
  try {
    const { projectId, name } = req.body || {};
    const normalizedProjectId = String(projectId || "").trim();
    const tagName = String(name || "").trim();
    if (!normalizedProjectId || !tagName) {
      return res.status(400).json({ error: "projectId and name are required" });
    }
    if (!/^[A-Za-z0-9._/\-]+$/.test(tagName)) {
      return res.status(400).json({ error: "tag name contains invalid characters" });
    }
    const projectPath = await resolveProjectPath(normalizedProjectId);
    if (!projectPath) return res.status(404).json({ error: "Project not found" });
    try {
      runGit(["tag", "-d", tagName], projectPath);
    } catch (err) {
      const stderr = (err.stderr || err.message || "").toString();
      if (stderr.includes("not found")) {
        return res.status(404).json({ error: `Tag "${tagName}" not found` });
      }
      throw err;
    }
    res.json({ ok: true, deleted: tagName });
  } catch (err) {
    const stderr = (err.stderr || err.message || "").toString();
    res.status(500).json({ error: stderr.trim() || String(err.message || err) });
  }
});

// Git: get remote origin URL and detect GitHub repo
app.get("/api/git/remote", async (req, res) => {
  try {
    const { projectId } = req.query;
    const projectPath = await resolveProjectPath(String(projectId || "").trim());
    if (!projectPath) return res.status(404).json({ error: "Project not found" });
    try {
      const remoteUrl = runGit(["remote", "get-url", "origin"], projectPath).trim();
      const parsed = parseGitHubRemote(remoteUrl);
      const githubRepo = parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : null;
      res.json({ remoteUrl, githubRepo });
    } catch (_err) {
      res.json({ remoteUrl: null, githubRepo: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Git: clone or pull a GitHub/GitLab repo and register as a project
app.post("/api/git/clone", requireAdmin, async (req, res) => {
  try {
    const { repoUrl, branch = "main", projectName, token = "" } = req.body || {};
    if (!repoUrl || !String(repoUrl).trim()) {
      return res.status(400).json({ error: "repoUrl is required" });
    }
    const url = String(repoUrl).trim();
    const tok = String(token || "").trim();
    // Build auth URL — token injected into HTTPS URL, never logged or stored in plain projects file
    const authUrl = buildAuthUrl(url, tok);

    // Derive a safe folder name from the repo slug
    const repoSlug = url.replace(/\.git$/, "").split("/").filter(Boolean).pop() || "repo";
    const safeName = String(projectName || repoSlug)
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "repo";

    const workspacesDir = join(REPO_ROOT, "workspaces");
    if (!existsSync(workspacesDir)) mkdirSync(workspacesDir, { recursive: true });

    const clonePath = join(workspacesDir, safeName);
    const gitOpts = (cwd) => ({ cwd, encoding: "utf-8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });

    if (existsSync(clonePath)) {
      // Already cloned — update remote URL (token may have changed) then pull
      try {
        execFileSync("git", ["remote", "set-url", "origin", authUrl], gitOpts(clonePath));
        execFileSync("git", ["fetch", "--depth", "1", "origin", branch], gitOpts(clonePath));
        execFileSync("git", ["checkout", branch], gitOpts(clonePath));
        execFileSync("git", ["reset", "--hard", `origin/${branch}`], gitOpts(clonePath));
      } catch (_e) {
        // Non-fatal: proceed with what's already on disk
      }
    } else {
      // Fresh clone — try with specified branch, fall back to default branch
      let cloned = false;
      try {
        execFileSync("git", ["clone", "--branch", branch, "--depth", "1", authUrl, clonePath], gitOpts(workspacesDir));
        cloned = true;
      } catch (_e) {
        if (existsSync(clonePath)) {
          try { rmSync(clonePath, { recursive: true, force: true }); } catch (_) {}
        }
      }
      if (!cloned) {
        // Branch not found — clone default branch
        execFileSync("git", ["clone", "--depth", "1", authUrl, clonePath], gitOpts(workspacesDir));
      }
    }

    // Register as a project (create or update) — store clean URL, not auth URL
    const projects = await loadProjects();
    const canonClone = canonicalProjectPath(clonePath);
    const existingIdx = projects.findIndex((p) => canonicalProjectPath(p.path) === canonClone);
    let project;
    if (existingIdx >= 0) {
      project = { ...projects[existingIdx], name: safeName, githubRepo: url, defaultBranch: branch };
      projects[existingIdx] = project;
    } else {
      project = { id: `git-${Date.now()}`, name: safeName, path: clonePath, githubRepo: url, defaultBranch: branch };
      projects.push(project);
    }
    await saveProjects(projects);

    // Persist token separately (never in projects file)
    if (tok) {
      const creds = await loadCredentials();
      creds[project.id] = tok;
      await saveCredentials(creds);
    }

    res.json({ project });
  } catch (err) {
    const raw = String(err.stderr || err.stdout || err.message || err);
    const firstLine = raw.split("\n").map((l) => l.replace(/^(fatal|error):\s*/i, "").trim()).find(Boolean) || raw;
    res.status(500).json({ error: firstLine });
  }
});

// Git: create or checkout branch
app.post("/api/git/branch/create", requireAdmin, express.json(), async (req, res) => {
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
app.post("/api/git/push", requireAdmin, express.json(), async (req, res) => {
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
app.post("/api/git/pull", requireAdmin, express.json(), async (req, res) => {
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
app.post("/api/git/github/pr", requireAdmin, express.json({ limit: "1mb" }), async (req, res) => {
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

// Lightweight structural validation for YAML files on save. We don't run
// the full JSON-schema validator here (too slow for per-keystroke autosave
// once Phase 1 lands, and the dbt-importer `{kind: model, columns}` shape
// legitimately differs from the canonical `{model, entities}` schema).
// Goal is narrow: catch parse failures and obviously-wrong-type top-level
// content before garbage hits disk. Non-YAML files skip entirely.
function validateYamlOnSave(filePath, content) {
  if (!/\.ya?ml$/i.test(filePath)) return { ok: true };
  if (content == null || String(content).trim() === "") return { ok: true };
  let doc;
  try {
    doc = yaml.load(content);
  } catch (err) {
    return {
      ok: false,
      code: "YAML_PARSE_ERROR",
      message: `YAML parse error: ${err.reason || err.message || String(err)}`,
      details: { line: err.mark?.line, column: err.mark?.column },
    };
  }
  // Empty doc (only whitespace/comments) is acceptable — users type into
  // new files.
  if (doc == null) return { ok: true };
  // Must be an object (a YAML list at the top level can't hold DataLex
  // entities/diagrams/models).
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return {
      ok: false,
      code: "SCHEMA_TOP_LEVEL",
      message: "DataLex YAML must be an object at the top level.",
    };
  }
  // For files the UI treats as models/diagrams, require at least one of
  // the recognized shapes so users can't silently save a blob with no
  // renderable content.
  const isModelLike = /\.model\.ya?ml$/i.test(filePath) || /\.diagram\.ya?ml$/i.test(filePath);
  if (isModelLike) {
    const hasCanonical = typeof doc.model === "object" && Array.isArray(doc.entities);
    const hasImporter = typeof doc.kind === "string" && typeof doc.name === "string";
    const hasEnum = typeof doc.kind === "string" && doc.kind === "enum";
    if (!hasCanonical && !hasImporter && !hasEnum) {
      return {
        ok: false,
        code: "SCHEMA_SHAPE",
        message: "File must declare either `model:` + `entities:` or `kind: model|source|diagram|enum` with `name:`.",
      };
    }
  }
  return { ok: true };
}

// Write/update a file
app.put("/api/files", requireAdmin, async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || typeof content !== "string") {
      return res.status(400).json({ error: "path and content are required" });
    }
    const validation = validateYamlOnSave(filePath, content);
    if (!validation.ok) {
      return res.status(422).json({
        error: { code: validation.code, message: validation.message, details: validation.details || null },
      });
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
app.post("/api/projects/:id/files", requireAdmin, async (req, res, next) => {
  try {
    const projects = await loadProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) return apiFail(res, 404, "NOT_FOUND", "Project not found");

    const { name, content = "" } = req.body;
    if (!name) return apiFail(res, 400, "VALIDATION", "name is required");
    if (String(name).includes("\0")) return apiFail(res, 400, "VALIDATION", "invalid name");

    const structure = await loadProjectStructure(project.path);
    if (!existsSync(structure.modelPath)) {
      await mkdir(structure.modelPath, { recursive: true });
    }

    const relativeName = toPosixPath(String(name));
    const filePath = resolve(structure.modelPath, relativeName);
    if (!isPathInside(structure.modelPath, filePath)) {
      return apiFail(res, 400, "PATH_ESCAPE", "name must stay inside project model path");
    }

    if (existsSync(filePath)) return apiFail(res, 409, "CONFLICT", "File already exists");

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
    next(err);
  }
});

// Move or copy an existing model/policy file into another project
app.post("/api/projects/:id/move-file", requireAdmin, async (req, res) => {
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

// --- Folder + file CRUD (PR C) -------------------------------------------------
// All mutations resolve paths relative to the project's modelPath and reject
// anything that escapes it via `isPathInside`. Path strings are POSIX-style
// ("models/staging/stg_orders.yml") as sent from the UI.

async function resolveProjectAndModelPath(projectId) {
  const projects = await loadProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return { project: null, structure: null, error: { status: 404, code: "NOT_FOUND", msg: "Project not found" } };
  const structure = await loadProjectStructure(project.path);
  if (!existsSync(structure.modelPath)) {
    await mkdir(structure.modelPath, { recursive: true });
  }
  return { project, structure, error: null };
}

// Merge N DataLex-style YAML model docs that all target the same destination
// path. This is the Save-All collision case — a dbt `schema.yml` that
// describes multiple models becomes N in-memory docs after import, one per
// model. Writing them sequentially would clobber siblings (last-wins). We
// union entities/relationships/indexes/metrics, deduped by name.
//
// First-seen wins on overlap. That mirrors the Python
// `merge_models_preserving_docs(current, candidate)` in core_engine: the
// first doc's handwritten docs/tags/descriptions are preserved even if a
// later doc declares the same entity. The CLI still uses the richer Python
// merge for two-way sync; this JS variant is scoped to the "N candidates,
// no prior current" save-all path.
// Ensure `datalex/diagrams/` exists under the given root. Idempotent —
// never touches existing files; writes `.gitkeep` only when the folder
// is freshly created so the empty folder round-trips through git.
// Silent on errors (callers are project-open hooks, not actionable).
function ensureDiagramsFolder(rootPath) {
  try {
    const diagramsDir = join(rootPath, "datalex", "diagrams");
    if (!existsSync(diagramsDir)) {
      mkdirSync(diagramsDir, { recursive: true });
      const keepFile = join(diagramsDir, ".gitkeep");
      if (!existsSync(keepFile)) writeFileSync(keepFile, "", "utf-8");
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 400) };
  }
}

function mergeDbtDocsForPath(docContents) {
  if (!Array.isArray(docContents) || docContents.length === 0) return "";
  if (docContents.length === 1) return docContents[0];

  const parsed = [];
  for (const text of docContents) {
    try {
      const doc = yaml.load(text);
      if (doc && typeof doc === "object" && !Array.isArray(doc)) parsed.push(doc);
    } catch (_err) {
      // Skip unparseable — can't merge what we can't read. The rest still
      // fold into a valid combined doc.
    }
  }
  if (parsed.length === 0) return docContents[0];
  if (parsed.length === 1) return yaml.dump(parsed[0], { lineWidth: 120, noRefs: true, sortKeys: false });

  const merged = JSON.parse(JSON.stringify(parsed[0]));
  const unionByName = (targetList, incomingList) => {
    const seen = new Set(
      (targetList || []).map((x) => (x && typeof x.name === "string" ? x.name : null)).filter(Boolean),
    );
    for (const item of incomingList || []) {
      if (!item || typeof item !== "object") continue;
      const name = typeof item.name === "string" ? item.name : null;
      if (name && seen.has(name)) continue;
      if (name) seen.add(name);
      targetList.push(JSON.parse(JSON.stringify(item)));
    }
  };

  for (let i = 1; i < parsed.length; i += 1) {
    const next = parsed[i];
    if (!Array.isArray(merged.entities)) merged.entities = [];
    unionByName(merged.entities, next.entities);
    if (Array.isArray(next.relationships)) {
      if (!Array.isArray(merged.relationships)) merged.relationships = [];
      unionByName(merged.relationships, next.relationships);
    }
    if (Array.isArray(next.indexes)) {
      if (!Array.isArray(merged.indexes)) merged.indexes = [];
      unionByName(merged.indexes, next.indexes);
    }
    if (Array.isArray(next.metrics)) {
      if (!Array.isArray(merged.metrics)) merged.metrics = [];
      unionByName(merged.metrics, next.metrics);
    }
  }

  return yaml.dump(merged, { lineWidth: 120, noRefs: true, sortKeys: false });
}

function resolveInsideModelPath(modelPath, rawSubpath) {
  const rel = toPosixPath(String(rawSubpath || "")).replace(/^\/+|\/+$/g, "");
  if (!rel) return { ok: false, code: "VALIDATION", msg: "path is required" };
  if (rel.includes("\0")) return { ok: false, code: "VALIDATION", msg: "invalid path" };
  const full = resolve(modelPath, rel);
  if (!isPathInside(modelPath, full)) {
    return { ok: false, code: "PATH_ESCAPE", msg: "path must stay inside project model path" };
  }
  return { ok: true, full, rel };
}

// Create a folder (recursive mkdir — no-op if exists)
app.post("/api/projects/:id/folders", requireAdmin, async (req, res, next) => {
  try {
    const { structure, error } = await resolveProjectAndModelPath(req.params.id);
    if (error) return apiFail(res, error.status, error.code, error.msg);
    const { path: subpath } = req.body || {};
    const resolved = resolveInsideModelPath(structure.modelPath, subpath);
    if (!resolved.ok) return apiFail(res, 400, resolved.code, resolved.msg);
    await mkdir(resolved.full, { recursive: true });
    res.json({
      ok: true,
      path: resolved.rel,
      fullPath: resolved.full,
      name: basename(resolved.full),
    });
  } catch (err) {
    next(err);
  }
});

// Rename / move a single file inside the project model path
app.patch("/api/projects/:id/files", requireAdmin, async (req, res, next) => {
  try {
    const { structure, error } = await resolveProjectAndModelPath(req.params.id);
    if (error) return apiFail(res, error.status, error.code, error.msg);
    const { fromPath, toPath } = req.body || {};
    const from = resolveInsideModelPath(structure.modelPath, fromPath);
    if (!from.ok) return apiFail(res, 400, from.code, `fromPath: ${from.msg}`);
    const to = resolveInsideModelPath(structure.modelPath, toPath);
    if (!to.ok) return apiFail(res, 400, to.code, `toPath: ${to.msg}`);
    if (!existsSync(from.full)) return apiFail(res, 404, "NOT_FOUND", "Source file not found");
    const srcStat = await stat(from.full);
    if (!srcStat.isFile()) return apiFail(res, 400, "VALIDATION", "Source is not a file");
    if (existsSync(to.full)) return apiFail(res, 409, "CONFLICT", "Destination already exists");
    await mkdir(dirname(to.full), { recursive: true });
    try {
      await rename(from.full, to.full);
    } catch (err) {
      if (err?.code === "EXDEV") {
        await copyFile(from.full, to.full);
        await unlinkFile(from.full);
      } else {
        throw err;
      }
    }
    const stats = await stat(to.full);
    res.json({
      ok: true,
      fromPath: from.rel,
      toPath: to.rel,
      file: {
        path: to.rel,
        fullPath: to.full,
        name: basename(to.full),
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Rename / move a folder inside the project model path
app.patch("/api/projects/:id/folders", requireAdmin, async (req, res, next) => {
  try {
    const { structure, error } = await resolveProjectAndModelPath(req.params.id);
    if (error) return apiFail(res, error.status, error.code, error.msg);
    const { fromPath, toPath } = req.body || {};
    const from = resolveInsideModelPath(structure.modelPath, fromPath);
    if (!from.ok) return apiFail(res, 400, from.code, `fromPath: ${from.msg}`);
    const to = resolveInsideModelPath(structure.modelPath, toPath);
    if (!to.ok) return apiFail(res, 400, to.code, `toPath: ${to.msg}`);
    if (!existsSync(from.full)) return apiFail(res, 404, "NOT_FOUND", "Source folder not found");
    const srcStat = await stat(from.full);
    if (!srcStat.isDirectory()) return apiFail(res, 400, "VALIDATION", "Source is not a directory");
    if (existsSync(to.full)) return apiFail(res, 409, "CONFLICT", "Destination already exists");
    // Reject moving a folder into itself
    const toRel = relative(from.full, to.full);
    if (toRel === "" || (!toRel.startsWith("..") && !isAbsolute(toRel))) {
      return apiFail(res, 400, "VALIDATION", "Cannot move folder into itself");
    }
    await mkdir(dirname(to.full), { recursive: true });
    try {
      await rename(from.full, to.full);
    } catch (err) {
      if (err?.code === "EXDEV") {
        // cross-device fallback: copy tree then remove
        await copyDirRecursive(from.full, to.full);
        rmSync(from.full, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
    res.json({ ok: true, fromPath: from.rel, toPath: to.rel });
  } catch (err) {
    next(err);
  }
});

async function copyDirRecursive(src, dst) {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, dstPath);
    }
  }
}

/* Atomic rename cascade.
 *
 * Body shape:
 *   { fromPath?, toPath?, kind?: "file"|"folder", rewrites: [{ path, newContent }] }
 *
 * Performs:
 *   1. Snapshot original content of every rewrite target.
 *   2. Apply every rewrite in series. On any write failure we stop and
 *      rewind every successful rewrite back to its snapshot.
 *   3. If fromPath/toPath are provided, rename the file/folder only after
 *      every rewrite landed. If the rename itself fails we still rewind
 *      the rewrites.
 *
 * Response:
 *   { ok: true, written: string[], renamed: boolean }  on success
 *   { ok: false, error, touched, untouched }           on partial failure
 */
app.post("/api/projects/:id/rename-cascade", requireAdmin, async (req, res, next) => {
  try {
    const { structure, error } = await resolveProjectAndModelPath(req.params.id);
    if (error) return apiFail(res, error.status, error.code, error.msg);

    const { fromPath, toPath, kind, rewrites } = req.body || {};
    const moveRequested = typeof fromPath === "string" && typeof toPath === "string" && fromPath && toPath;
    const list = Array.isArray(rewrites) ? rewrites : [];

    // Resolve the move targets (if any) before we touch anything.
    let from = null;
    let to = null;
    if (moveRequested) {
      from = resolveInsideModelPath(structure.modelPath, fromPath);
      if (!from.ok) return apiFail(res, 400, from.code, `fromPath: ${from.msg}`);
      to = resolveInsideModelPath(structure.modelPath, toPath);
      if (!to.ok) return apiFail(res, 400, to.code, `toPath: ${to.msg}`);
      if (!existsSync(from.full)) return apiFail(res, 404, "NOT_FOUND", "Source not found");
      if (existsSync(to.full)) return apiFail(res, 409, "CONFLICT", "Destination already exists");
    }

    // Snapshot every rewrite target so we can roll back on failure.
    const plan = [];
    for (const entry of list) {
      const subpath = entry?.path;
      const newContent = entry?.newContent;
      if (typeof subpath !== "string" || typeof newContent !== "string") {
        return apiFail(res, 400, "VALIDATION", "rewrites[].path and newContent are required strings");
      }
      const resolved = resolveInsideModelPath(structure.modelPath, subpath);
      if (!resolved.ok) return apiFail(res, 400, resolved.code, `rewrites[].path: ${resolved.msg}`);
      let original = null;
      if (existsSync(resolved.full)) {
        try { original = await readFile(resolved.full, "utf-8"); }
        catch (err) { return apiFail(res, 500, "IO_ERROR", `Cannot read ${resolved.rel}: ${err?.message || err}`); }
      }
      plan.push({ rel: resolved.rel, full: resolved.full, newContent, original });
    }

    // Apply rewrites serially. On any error, rewind.
    const written = [];
    for (const step of plan) {
      try {
        await mkdir(dirname(step.full), { recursive: true });
        await writeFile(step.full, step.newContent, "utf-8");
        written.push(step.rel);
      } catch (err) {
        // Rewind every successful write back to its snapshot.
        const untouched = [];
        for (const s of plan) {
          if (!written.includes(s.rel)) { untouched.push(s.rel); continue; }
          try {
            if (s.original == null) await unlinkFile(s.full).catch(() => {});
            else await writeFile(s.full, s.original, "utf-8");
          } catch (_rollbackErr) { /* best-effort */ }
        }
        return apiFail(res, 500, "REWRITE_FAILED", `${step.rel}: ${err?.message || err}`, {
          touched: written, untouched,
        });
      }
    }

    // All rewrites succeeded — now perform the move (if any).
    let renamed = false;
    if (moveRequested) {
      try {
        const srcStat = await stat(from.full);
        const isDir = srcStat.isDirectory();
        if (kind === "file" && isDir) return apiFail(res, 400, "VALIDATION", "Source is a directory, kind=file");
        if (kind === "folder" && !isDir) return apiFail(res, 400, "VALIDATION", "Source is a file, kind=folder");
        await mkdir(dirname(to.full), { recursive: true });
        try {
          await rename(from.full, to.full);
        } catch (err) {
          if (err?.code === "EXDEV") {
            if (isDir) { await copyDirRecursive(from.full, to.full); rmSync(from.full, { recursive: true, force: true }); }
            else { await copyFile(from.full, to.full); await unlinkFile(from.full); }
          } else {
            throw err;
          }
        }
        renamed = true;
      } catch (err) {
        // Rewind rewrites after a failed move.
        for (const s of plan) {
          try {
            if (s.original == null) await unlinkFile(s.full).catch(() => {});
            else await writeFile(s.full, s.original, "utf-8");
          } catch (_rollbackErr) { /* best-effort */ }
        }
        return apiFail(res, 500, "RENAME_FAILED", `${from.rel} → ${to.rel}: ${err?.message || err}`, {
          touched: written, untouched: [],
        });
      }
    }

    res.json({ ok: true, written, renamed, fromPath: from?.rel, toPath: to?.rel });
  } catch (err) {
    next(err);
  }
});

// Delete a single file
app.delete("/api/projects/:id/files", requireAdmin, async (req, res, next) => {
  try {
    const { structure, error } = await resolveProjectAndModelPath(req.params.id);
    if (error) return apiFail(res, error.status, error.code, error.msg);
    const subpath = req.body?.path || req.query?.path;
    const resolved = resolveInsideModelPath(structure.modelPath, subpath);
    if (!resolved.ok) return apiFail(res, 400, resolved.code, resolved.msg);
    if (!existsSync(resolved.full)) return apiFail(res, 404, "NOT_FOUND", "File not found");
    const st = await stat(resolved.full);
    if (!st.isFile()) return apiFail(res, 400, "VALIDATION", "Path is not a file");
    await unlinkFile(resolved.full);
    res.json({ ok: true, path: resolved.rel });
  } catch (err) {
    next(err);
  }
});

// Delete a folder (recursive)
app.delete("/api/projects/:id/folders", requireAdmin, async (req, res, next) => {
  try {
    const { structure, error } = await resolveProjectAndModelPath(req.params.id);
    if (error) return apiFail(res, error.status, error.code, error.msg);
    const subpath = req.body?.path || req.query?.path;
    const resolved = resolveInsideModelPath(structure.modelPath, subpath);
    if (!resolved.ok) return apiFail(res, 400, resolved.code, resolved.msg);
    if (resolve(resolved.full) === resolve(structure.modelPath)) {
      return apiFail(res, 400, "VALIDATION", "Refusing to delete project model root");
    }
    if (!existsSync(resolved.full)) return apiFail(res, 404, "NOT_FOUND", "Folder not found");
    const st = await stat(resolved.full);
    if (!st.isDirectory()) return apiFail(res, 400, "VALIDATION", "Path is not a folder");
    rmSync(resolved.full, { recursive: true, force: true });
    res.json({ ok: true, path: resolved.rel });
  } catch (err) {
    next(err);
  }
});

// Batch-save a set of files. Body: { files: [{ path, content }] }
// Each path is relative to the project model path. All-or-nothing per item —
// one failed write doesn't abort the whole batch, but the response reports
// per-file status so the client can surface partial failure. Per-item errors
// carry a `code` alongside the message so the UI can group failures.
app.post("/api/projects/:id/save-all", requireAdmin, async (req, res, next) => {
  try {
    const { structure, error } = await resolveProjectAndModelPath(req.params.id);
    if (error) return apiFail(res, error.status, error.code, error.msg);
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!files.length) return apiFail(res, 400, "VALIDATION", "files array is required");

    // First pass: validate + resolve paths. Group by canonical destination
    // so that N in-memory docs sharing a destination (dbt's shared
    // `schema.yml` pattern) merge into one YAML document rather than
    // clobbering each other last-wins.
    const results = [];
    const groups = new Map(); // resolved.rel -> { full, rel, contents: string[], inputPaths: string[] }
    for (const item of files) {
      const subpath = item?.path;
      const content = item?.content;
      if (typeof content !== "string") {
        results.push({ path: subpath || "", ok: false, code: "VALIDATION", error: "content must be a string" });
        continue;
      }
      const resolved = resolveInsideModelPath(structure.modelPath, subpath);
      if (!resolved.ok) {
        results.push({ path: subpath || "", ok: false, code: resolved.code, error: resolved.msg });
        continue;
      }
      const key = resolved.rel;
      if (!groups.has(key)) {
        groups.set(key, { full: resolved.full, rel: resolved.rel, contents: [], inputPaths: [] });
      }
      const g = groups.get(key);
      g.contents.push(content);
      g.inputPaths.push(subpath);
    }

    for (const g of groups.values()) {
      const merged = g.contents.length > 1 ? mergeDbtDocsForPath(g.contents) : g.contents[0];
      try {
        await mkdir(dirname(g.full), { recursive: true });
        await writeFile(g.full, merged, "utf-8");
        const stats = await stat(g.full);
        results.push({
          path: g.rel,
          fullPath: g.full,
          ok: true,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          merged: g.contents.length > 1,
          mergedFrom: g.contents.length > 1 ? g.inputPaths.slice() : undefined,
        });
      } catch (err) {
        results.push({ path: g.rel, ok: false, code: "INTERNAL", error: err.message });
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    res.json({ ok: okCount === results.length, saved: okCount, total: results.length, results });
  } catch (err) {
    next(err);
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
app.post("/api/connections", requireAdmin, async (req, res) => {
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
        ? " Running in Docker: mount the host parent path (for example -v /Users/<you>:/workspace/host) and use /workspace/host/... in DataLex."
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
app.post("/api/import", requireAdmin, express.json({ limit: "10mb" }), async (req, res) => {
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
      join(REPO_ROOT, "datalex"),
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
      model = yaml.load(yamlText);
    } catch (err) {
      const mark = err?.mark || {};
      return apiFail(res, 500, "PARSE_FAILED",
        `Imported YAML could not be parsed: ${err?.reason || err?.message || "yaml error"}`,
        {
          line: typeof mark.line === "number" ? mark.line + 1 : null,
          column: typeof mark.column === "number" ? mark.column + 1 : null,
        });
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

function resolveYamlInput({ content, path, label = "model_path" }) {
  if (typeof content === "string" && content.trim()) return content;
  if (path) {
    if (!existsSync(String(path))) {
      throw new Error(`${label} not found: ${path}`);
    }
    return readFileSync(String(path), "utf-8");
  }
  throw new Error(`Provide ${label} or inline content`);
}

function cleanupTempDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

// Forward engineering: generate SQL from model YAML
app.post("/api/forward/generate-sql", requireAdmin, express.json(), async (req, res) => {
  try {
    const { model_path, dialect = "postgres", out } = req.body || {};
    if (!model_path) {
      return res.status(400).json({ error: "model_path is required" });
    }

    const args = [join(REPO_ROOT, "datalex"), "generate", "sql", String(model_path), "--dialect", String(dialect)];
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

app.post("/api/model/transform", requireAdmin, express.json({ limit: "10mb" }), async (req, res) => {
  const tmpDir = join(tmpdir(), `datalex-transform-${Date.now()}`);
  try {
    const { model_content, model_path, transform, dialect = "postgres", out, write_back } = req.body || {};
    if (!transform) {
      return res.status(400).json({ error: "transform is required" });
    }
    const modelYaml = resolveYamlInput({ content: model_content, path: model_path, label: "model_path" });

    mkdirSync(tmpDir, { recursive: true });
    const tmpModel = join(tmpDir, "model.yaml");
    writeFileSync(tmpModel, modelYaml, "utf-8");

    const args = [join(REPO_ROOT, "datalex"), "transform", String(transform), tmpModel];
    if (transform === "logical-to-physical") {
      args.push("--dialect", String(dialect));
    }
    if (out) {
      args.push("--out", String(out));
    }

    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 120000, cwd: REPO_ROOT });
    const transformedYaml = out ? readFileSync(String(out), "utf-8") : output;

    if (model_path && write_back === true) {
      writeFileSync(String(model_path), transformedYaml, "utf-8");
    }

    res.json({
      success: true,
      transform: String(transform),
      dialect: String(dialect),
      out: out ? String(out) : null,
      writeBack: Boolean(model_path && write_back),
      transformedYaml,
    });
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: String(stderr).trim() });
  } finally {
    cleanupTempDir(tmpDir);
  }
});

app.post("/api/model/standards/check", requireAdmin, express.json({ limit: "10mb" }), async (req, res) => {
  const tmpDir = join(tmpdir(), `datalex-standards-check-${Date.now()}`);
  try {
    const { model_content, model_path } = req.body || {};
    const modelYaml = resolveYamlInput({ content: model_content, path: model_path, label: "model_path" });

    mkdirSync(tmpDir, { recursive: true });
    const tmpModel = join(tmpDir, "model.yaml");
    writeFileSync(tmpModel, modelYaml, "utf-8");

    const args = [join(REPO_ROOT, "datalex"), "standards", "check", tmpModel, "--output-json"];
    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 120000, cwd: REPO_ROOT });
    res.json({ success: true, report: JSON.parse(output) });
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: String(stderr).trim() });
  } finally {
    cleanupTempDir(tmpDir);
  }
});

app.post("/api/model/standards/fix", requireAdmin, express.json({ limit: "10mb" }), async (req, res) => {
  const tmpDir = join(tmpdir(), `datalex-standards-fix-${Date.now()}`);
  try {
    const { model_content, model_path, out, write_back } = req.body || {};
    const modelYaml = resolveYamlInput({ content: model_content, path: model_path, label: "model_path" });

    mkdirSync(tmpDir, { recursive: true });
    const tmpModel = join(tmpDir, "model.yaml");
    writeFileSync(tmpModel, modelYaml, "utf-8");

    const args = [join(REPO_ROOT, "datalex"), "standards", "fix", tmpModel];
    if (out) args.push("--out", String(out));
    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 120000, cwd: REPO_ROOT });
    const fixedYaml = out ? readFileSync(String(out), "utf-8") : output.replace(/^#.*\n/gm, "").trimStart();

    if (model_path && write_back === true) {
      writeFileSync(String(model_path), fixedYaml, "utf-8");
    }

    res.json({
      success: true,
      out: out ? String(out) : null,
      writeBack: Boolean(model_path && write_back),
      fixedYaml,
    });
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: String(stderr).trim() });
  } finally {
    cleanupTempDir(tmpDir);
  }
});

app.post("/api/model/sync/compare", requireAdmin, express.json({ limit: "10mb" }), async (req, res) => {
  const tmpDir = join(tmpdir(), `datalex-sync-compare-${Date.now()}`);
  try {
    const {
      current_content,
      current_path,
      candidate_content,
      candidate_path,
      allow_breaking = true,
    } = req.body || {};

    const currentYaml = resolveYamlInput({ content: current_content, path: current_path, label: "current_path" });
    const candidateYaml = resolveYamlInput({ content: candidate_content, path: candidate_path, label: "candidate_path" });

    mkdirSync(tmpDir, { recursive: true });
    const currentFile = join(tmpDir, "current.yaml");
    const candidateFile = join(tmpDir, "candidate.yaml");
    writeFileSync(currentFile, currentYaml, "utf-8");
    writeFileSync(candidateFile, candidateYaml, "utf-8");

    const args = [join(REPO_ROOT, "datalex"), "sync", "compare", currentFile, candidateFile];
    if (allow_breaking) args.push("--allow-breaking");

    let output = "";
    try {
      output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 120000, cwd: REPO_ROOT });
    } catch (err) {
      output = String(err.stdout || "");
      if (!output.trim()) throw err;
    }

    res.json({ success: true, diff: JSON.parse(output) });
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: String(stderr).trim() });
  } finally {
    cleanupTempDir(tmpDir);
  }
});

app.post("/api/model/sync/merge", requireAdmin, express.json({ limit: "10mb" }), async (req, res) => {
  const tmpDir = join(tmpdir(), `datalex-sync-merge-${Date.now()}`);
  try {
    const {
      current_content,
      current_path,
      candidate_content,
      candidate_path,
      out,
      write_back,
    } = req.body || {};

    const currentYaml = resolveYamlInput({ content: current_content, path: current_path, label: "current_path" });
    const candidateYaml = resolveYamlInput({ content: candidate_content, path: candidate_path, label: "candidate_path" });

    mkdirSync(tmpDir, { recursive: true });
    const currentFile = join(tmpDir, "current.yaml");
    const candidateFile = join(tmpDir, "candidate.yaml");
    writeFileSync(currentFile, currentYaml, "utf-8");
    writeFileSync(candidateFile, candidateYaml, "utf-8");

    const args = [join(REPO_ROOT, "datalex"), "sync", "merge", currentFile, candidateFile];
    if (out) args.push("--out", String(out));

    const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 120000, cwd: REPO_ROOT });
    const mergedYaml = out ? readFileSync(String(out), "utf-8") : output;

    if (candidate_path && write_back === true) {
      writeFileSync(String(candidate_path), mergedYaml, "utf-8");
    }

    res.json({
      success: true,
      out: out ? String(out) : null,
      writeBack: Boolean(candidate_path && write_back),
      mergedYaml,
    });
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: String(stderr).trim() });
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// Completeness scoring: score each entity against single-source-of-truth dimensions
app.post("/api/forward/completeness", express.json(), async (req, res) => {
  try {
    const { model_path } = req.body || {};
    if (!model_path) {
      return res.status(400).json({ error: "model_path is required" });
    }

    const args = [
      join(REPO_ROOT, "datalex"),
      "completeness",
      String(model_path),
      "--output-json",
    ];

    const output = execFileSync(PYTHON, args, {
      encoding: "utf-8",
      timeout: 30000,
      cwd: REPO_ROOT,
    });

    const report = JSON.parse(output);
    res.json({ success: true, report });
  } catch (err) {
    const stderr = err.stderr || err.message;
    // If the process exited with code 1 (min-score breach) stdout is still valid JSON
    if (err.stdout) {
      try {
        const report = JSON.parse(err.stdout);
        return res.status(422).json({ success: false, report, error: "One or more entities below minimum score" });
      } catch (_) {}
    }
    res.status(500).json({ error: String(stderr).trim() });
  }
});

// Forward engineering: generate migration SQL from old/new model YAML
app.post("/api/forward/migrate", requireAdmin, express.json(), async (req, res) => {
  try {
    const { old_model, new_model, dialect = "postgres", out } = req.body || {};
    if (!old_model || !new_model) {
      return res.status(400).json({ error: "old_model and new_model are required" });
    }

    const args = [join(REPO_ROOT, "datalex"), "migrate", String(old_model), String(new_model), "--dialect", String(dialect)];
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

// dbt round-trip sync: merge DataLex metadata into an existing dbt schema.yml
app.post("/api/forward/dbt-sync", requireAdmin, express.json({ limit: "5mb" }), async (req, res) => {
  try {
    const { model_content, dbt_schema_content, model_path, dbt_schema_path, write_back } = req.body || {};

    let modelYaml = model_content;
    let dbtYaml = dbt_schema_content;

    if (!modelYaml && model_path) {
      if (!existsSync(String(model_path))) {
        return res.status(400).json({ error: `model_path not found: ${model_path}` });
      }
      modelYaml = readFileSync(String(model_path), "utf-8");
    }
    if (!dbtYaml && dbt_schema_path) {
      if (!existsSync(String(dbt_schema_path))) {
        return res.status(400).json({ error: `dbt_schema_path not found: ${dbt_schema_path}` });
      }
      dbtYaml = readFileSync(String(dbt_schema_path), "utf-8");
    }

    if (!modelYaml || !dbtYaml) {
      return res.status(400).json({
        error: "Provide (model_content + dbt_schema_content) or (model_path + dbt_schema_path)",
      });
    }

    const tmpDir = join(tmpdir(), `dbt-sync-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const tmpModel = join(tmpDir, "model.yaml");
    const tmpDbt   = join(tmpDir, "schema.yml");
    const tmpOut   = join(tmpDir, "out.yml");

    writeFileSync(tmpModel, modelYaml, "utf-8");
    writeFileSync(tmpDbt, dbtYaml, "utf-8");

    let updatedYaml = "";
    let hadError = false;
    let errorMsg = "";

    try {
      const { cmd, argv } = dmExec("dbt", "sync", tmpModel, "--dbt-schema", tmpDbt, "--out", tmpOut);
      execFileSync(cmd, argv, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: REPO_ROOT,
      });
      updatedYaml = readFileSync(tmpOut, "utf-8");
    } catch (err) {
      hadError = true;
      errorMsg = String(err?.stderr || err?.message || "dbt sync failed").trim();
    } finally {
      try { unlinkSync(tmpModel); } catch (_) {}
      try { unlinkSync(tmpDbt); } catch (_) {}
      try { unlinkSync(tmpOut); } catch (_) {}
      try { rmdirSync(tmpDir); } catch (_) {}
    }

    if (hadError) return res.status(500).json({ error: errorMsg });

    if (dbt_schema_path && write_back === true) {
      writeFileSync(String(dbt_schema_path), updatedYaml, "utf-8");
    }

    res.json({ success: true, updatedYaml, wroteBack: Boolean(dbt_schema_path && write_back) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
 * POST /api/dbt/import
 *
 * Full-repo dbt import: shells out to `dm dbt import --project-dir X --out Y`
 * which wraps `sync_dbt_project` and preserves the dbt models/ folder layout
 * in the DataLex output tree. Returns the entire produced YAML tree in-line
 * so the web-app can load it without a second round-trip to disk.
 *
 * Body:
 *   projectDir?: string         Local path to the dbt project (required unless gitUrl).
 *   gitUrl?: string             Public git URL; cloned to a tmp dir first.
 *   gitRef?: string             Branch / tag / commit (default: main).
 *   out?: string                Override output dir (default: tmp dir returned in response).
 *   skipWarehouse?: boolean     Pass --skip-warehouse (default: true for gitUrl imports).
 *   target?: string             Pick a non-default dbt target.
 *
 * Response:
 *   { success: true, tree: Array<{path,content}>, report: SyncReport, outDir }
 * ------------------------------------------------------------------ */
app.post("/api/dbt/import", requireAdmin, express.json({ limit: "2mb" }), async (req, res, next) => {
  const {
    projectDir,
    gitUrl,
    gitRef = "main",
    out,
    target,
    skipWarehouse,
    manifest,
    // When true, the user's dbt folder is registered as a DataLex project
    // and the response includes `{projectId, projectName}`. The GUI then
    // opens the imported tree *against* that project, so Save All writes
    // back into the same dbt repo at each file's original path. Only valid
    // with `projectDir` (nothing to save to for a git URL clone).
    editInPlace,
    editInPlaceName,
  } = req.body || {};

  if (!projectDir && !gitUrl) {
    return apiFail(res, 400, "VALIDATION",
      "Provide either `projectDir` (local path) or `gitUrl` (public git URL).");
  }
  if (editInPlace && !projectDir) {
    return apiFail(res, 400, "VALIDATION",
      "`editInPlace` requires `projectDir` — git URLs have no local folder to save into.");
  }

  let cloneDir = "";
  let outDir = "";
  // Track whether we auto-provisioned outDir. If the caller passed `out`, they
  // own the directory; we leave it alone. Otherwise we must rm it in `finally`
  // or it leaks into $TMPDIR for every import.
  let outDirIsOwned = false;
  let resolvedProjectDir = "";

  try {
    if (gitUrl) {
      cloneDir = join(tmpdir(), `datalex-dbt-${Date.now()}-${randomBytes(4).toString("hex")}`);
      mkdirSync(cloneDir, { recursive: true });
      try {
        execFileSync("git", ["clone", "--depth", "1", "--branch", gitRef, gitUrl, cloneDir], {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 60000,
        });
      } catch (_err) {
        // Branch/tag may not exist; retry without --branch so we at least get the default.
        try {
          execFileSync("git", ["clone", "--depth", "1", gitUrl, cloneDir], {
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 60000,
          });
        } catch (err2) {
          return apiFail(res, 400, "SUBPROCESS_FAILED",
            `git clone failed: ${String(err2?.stderr || err2?.message || err2).slice(0, 400)}`);
        }
      }
      resolvedProjectDir = cloneDir;
    } else {
      if (!existsSync(String(projectDir))) {
        return apiFail(res, 400, "VALIDATION", `projectDir not found: ${projectDir}`);
      }
      resolvedProjectDir = String(projectDir);
    }

    if (out) {
      outDir = String(out);
      outDirIsOwned = false;
    } else {
      outDir = join(tmpdir(), `datalex-dbt-out-${Date.now()}-${randomBytes(4).toString("hex")}`);
      outDirIsOwned = true;
    }
    mkdirSync(outDir, { recursive: true });

    // Default: skip warehouse for git-clone imports (we almost never have warehouse creds
    // for a random jaffle-shop clone) but honour explicit caller setting.
    const skipWh =
      typeof skipWarehouse === "boolean" ? skipWarehouse : Boolean(gitUrl);

    const dbtImportArgs = [
      "dbt",
      "import",
      "--project-dir",
      resolvedProjectDir,
      "--out",
      outDir,
      "--json",
    ];
    if (skipWh) dbtImportArgs.push("--skip-warehouse");
    if (target) dbtImportArgs.push("--target", String(target));
    if (manifest) dbtImportArgs.push("--manifest", String(manifest));

    let report = null;
    let importError = null;
    try {
      const { cmd, argv: cliArgs } = dmExec(...dbtImportArgs);
      const stdout = execFileSync(cmd, cliArgs, {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        timeout: 180000, // 3 min — git + dbt parse can be slow on first run
        stdio: ["ignore", "pipe", "pipe"],
      });
      // Our CLI prints `[dbt-import] ...` progress lines plus a trailing JSON blob
      // (with --json). Find the last line that parses as JSON to decode the report.
      const lines = String(stdout || "").split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const candidate = JSON.parse(lines[i]);
          if (candidate && typeof candidate === "object" && "tables" in candidate) {
            report = candidate;
            break;
          }
        } catch (_) {
          // keep scanning
        }
      }
    } catch (err) {
      importError = String(err?.stderr || err?.message || err).slice(0, 2000);
    }

    if (importError) {
      return apiFail(res, 500, "SUBPROCESS_FAILED", importError);
    }

    // Walk outDir and build an in-memory tree of produced YAML files. Keeping the
    // response self-contained means the UI can ingest the result without any
    // further disk access — important for the "Load jaffle-shop demo" flow where
    // the user may not have chosen a project folder yet.
    const tree = [];
    const walk = (dir, rel = "") => {
      let entries = [];
      try {
        entries = require("fs").readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const ent of entries) {
        const abs = join(dir, ent.name);
        const childRel = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          walk(abs, childRel);
        } else if (/\.ya?ml$/i.test(ent.name)) {
          try {
            tree.push({ path: childRel, content: readFileSync(abs, "utf-8") });
          } catch (_) {}
        }
      }
    };
    walk(outDir);

    // Seed an empty overview diagram so the post-import landing state is
    // "blank canvas to build on" rather than "whichever source file
    // happens to parse first". Only added if the import didn't already
    // emit a .diagram.yaml of its own. The same doc flows through both
    // the offline and edit-in-place frontend paths via the `tree`
    // response, and is persisted to disk below in edit-in-place mode.
    const hasDiagram = tree.some((e) => /\.diagram\.ya?ml$/i.test(e.path));
    if (!hasDiagram) {
      tree.push({
        path: "datalex/diagrams/overview.diagram.yaml",
        content:
          "kind: diagram\n" +
          "name: overview\n" +
          "title: Overview\n" +
          "entities: []\n",
      });
    }

    // Edit-in-place mode: materialise the imported YAMLs inside the user's
    // dbt folder so clicking a file in the Explorer can read it from disk.
    // We only write files that don't already exist — never clobber a
    // hand-authored schema.yml the user already maintains.
    //
    // `writeFailures` collects per-file errors instead of swallowing them so
    // the caller learns which files actually landed. A single unwritable
    // destination used to silently log to the server console and return
    // `success: true`; now we return 207 with the failure list.
    const writeFailures = [];
    if (editInPlace && resolvedProjectDir) {
      for (const entry of tree) {
        // `.diagram.yaml` is a DataLex convention — keep that exact
        // extension. Everything else (dbt model/source files) converts
        // back to `.yml` to match what's on disk in a dbt repo.
        const destRel = /\.diagram\.ya?ml$/i.test(entry.path)
          ? entry.path
          : entry.path.replace(/\.yaml$/i, ".yml");
        const destAbs = join(resolvedProjectDir, destRel);
        try {
          if (!existsSync(destAbs)) {
            mkdirSync(dirname(destAbs), { recursive: true });
            writeFileSync(destAbs, entry.content, "utf-8");
          }
        } catch (err) {
          writeFailures.push({
            path: destRel,
            code: "INTERNAL",
            error: String(err?.message || err).slice(0, 400),
          });
        }
      }
      // Seed `datalex/diagrams/` so the Explorer shows the conventional
      // diagrams location immediately after import. Shared with the
      // project-open hook on GET /files.
      const seed = ensureDiagramsFolder(resolvedProjectDir);
      if (!seed.ok) {
        writeFailures.push({
          path: "datalex/diagrams/.gitkeep",
          code: "INTERNAL",
          error: seed.error,
        });
      }
    }

    // Register the user's dbt folder as a DataLex project so Save All + the
    // project picker work. Idempotent — if the folder is already registered
    // we reuse the existing project.
    let projectRecord = null;
    let registerError = null;
    if (editInPlace && resolvedProjectDir) {
      try {
        const projects = await loadProjects();
        const absolute = resolve(resolvedProjectDir);
        const canonAbs = canonicalProjectPath(absolute);
        const existing = projects.find((p) => canonicalProjectPath(p.path) === canonAbs);
        if (existing) {
          projectRecord = existing;
        } else {
          const derivedName = (editInPlaceName && String(editInPlaceName).trim())
            || basename(absolute) || "dbt-project";
          projectRecord = {
            id: `proj_${Date.now()}`,
            name: derivedName,
            path: absolute,
          };
          projects.push(projectRecord);
          await saveProjects(projects);
        }
      } catch (err) {
        registerError = String(err?.message || err).slice(0, 400);
      }
    }

    const hasFailures = writeFailures.length > 0 || registerError != null;
    res.status(hasFailures ? 207 : 200).json({
      success: !hasFailures,
      outDir,
      tree,
      report,
      project: projectRecord,
      writeFailures,
      registerError,
    });
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    return apiFail(res, 500, "INTERNAL", err?.message || String(err));
  } finally {
    if (cloneDir) {
      try { rmSync(cloneDir, { recursive: true, force: true }); } catch (_) {}
    }
    if (outDir && outDirIsOwned) {
      try { rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
    }
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
    const args = [join(REPO_ROOT, "datalex"), "apply", String(connector), "--dialect", String(dialect || connector), ...conn.args];

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
      join(REPO_ROOT, "datalex"), "connectors", "--output-json",
    ], { encoding: "utf-8", timeout: 10000, cwd: REPO_ROOT });
    const connectors = JSON.parse(output);
    res.json(connectors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan a local dbt repo path and return dbt YAML file candidates for import
app.post("/api/connectors/dbt-repo/scan", requireAdmin, express.json(), async (req, res) => {
  try {
    const repoPath = String(req.body?.repo_path || "").trim();
    if (!repoPath) {
      return res.status(400).json({ error: "repo_path is required" });
    }

    const pathErr = await assertReadableDirectory(repoPath);
    if (pathErr) {
      const dockerHint = IS_DOCKER_RUNTIME
        ? " Running in Docker: mount the host parent path (for example -v /Users/<you>:/workspace/host) and use /workspace/host/... in DataLex."
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
    const parseErrors = [];

    for (const file of yamlFiles) {
      let content = "";
      try {
        content = await readFile(file.fullPath, "utf-8");
      } catch (_err) {
        continue;
      }
      const summary = parseDbtDocSummary(content, file.path);
      if (!summary) continue;
      if (summary.parseError) {
        parseErrors.push({
          path: file.path,
          code: "PARSE_FAILED",
          reason: summary.parseError.reason,
          line: summary.parseError.line,
          column: summary.parseError.column,
        });
        continue;
      }
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

    const warnings = dbtFiles.length === 0
      ? ["No dbt schema/source/semantic/metrics YAML files found under this path."]
      : [];
    for (const pe of parseErrors) {
      const loc = pe.line ? ` (line ${pe.line}${pe.column ? `, col ${pe.column}` : ""})` : "";
      warnings.push(`Failed to parse ${pe.path}${loc}: ${pe.reason}`);
    }
    return res.json({
      success: true,
      repoPath,
      repoName,
      yamlFileCount: yamlFiles.length,
      dbtFiles,
      dbtFileCount: dbtFiles.length,
      parseErrors,
      totals: totalSections,
      suggestedSubfolder: "datalex-models",
      suggestedTargetPath: join(repoPath, "datalex-models"),
      suggestedProjectName: `${repoName}-datalex`,
      suggestedModelName: sanitizeModelStem(`${repoName}_dbt`, "dbt_model"),
      warnings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test database connection. Returns {ok, message, pingMs, serverVersion?}
// — pingMs is wall-clock time for the subprocess probe (upper bound), and
// serverVersion is best-effort parsed from the "OK: …" line if present.
// Future work: dialect-specific probes (account/role for Snowflake etc.)
// by running a second subprocess after the test succeeds.
app.post("/api/connectors/test", express.json(), async (req, res) => {
  let conn = { args: [], cleanup: () => {} };
  const startedAt = Date.now();
  try {
    const { connector, connection_name, connection_id: _connectionId, ...params } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    conn = buildConnArgs(params);
    const args = [join(REPO_ROOT, "datalex"), "pull", connector, "--test", ...conn.args];

    try {
      const output = execFileSync(PYTHON, args, { encoding: "utf-8", timeout: 30000, cwd: REPO_ROOT });
      const pingMs = Date.now() - startedAt;
      const ok = output.startsWith("OK");
      const serverVersion = extractServerVersion(output);
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
        pingMs,
        serverVersion,
        connectionId: saved?.id || null,
        connection: saved,
      });
    } catch (execErr) {
      const stderr = execErr.stderr || execErr.message;
      res.json({
        ok: false,
        message: stderr.trim(),
        pingMs: Date.now() - startedAt,
      });
    } finally {
      conn.cleanup();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Best-effort version extraction from the connector --test output. Each
// connector writes an "OK: connected to …" line; we look for common
// version-ish substrings ("PostgreSQL 16.3", "v5.7.44", "version 8.4.0").
// Returns null when nothing looks like a version.
function extractServerVersion(output) {
  const text = String(output || "");
  const patterns = [
    /(PostgreSQL|MySQL|MariaDB|SQL Server|Microsoft SQL Server|Snowflake|BigQuery|Databricks|Redshift)\s+([\d.]+[\w.-]*)/i,
    /version[:\s]+([\d.]+[\w.-]*)/i,
    /\bv(\d+\.\d+(?:\.\d+)?[\w.-]*)/,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m) return m[0];
  }
  return null;
}

// List schemas/datasets in a database
app.post("/api/connectors/schemas", express.json(), async (req, res) => {
  let conn = { args: [], cleanup: () => {} };
  try {
    const { connector, ...params } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    conn = buildConnArgs(params);
    const args = [join(REPO_ROOT, "datalex"), "schemas", connector, "--output-json", ...conn.args];
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
    const args = [join(REPO_ROOT, "datalex"), "tables", connector, "--output-json", ...conn.args];
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
    const args = [join(REPO_ROOT, "datalex"), "pull", connector, ...conn.args];
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

        const args = [join(REPO_ROOT, "datalex"), "pull", connector, ...baseConn.args, ...schemaConn.args];
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

// Streaming pull: same body as /pull but pipes stdout as SSE events so the
// UI can render per-table progress. Each `[pull] …` line (or any other
// stdout) fires a `data: <line>` event; the final message is a single
// `event: done\ndata: {summary JSON}` frame. Errors arrive as
// `event: error\ndata: {msg}`.
//
// We use POST body semantics because the params include secrets — a
// GET/querystring would leak them in logs. EventSource in browsers only
// supports GET, so the UI uses `fetch` + a ReadableStream reader to parse
// SSE frames manually. That's lighter than a WebSocket and avoids CORS
// preflight fuss when served from the same origin.
app.post("/api/connectors/pull/stream", express.json(), async (req, res) => {
  const {
    connector,
    model_name,
    tables,
    connection_id,
    project_id,
    project_path,
    project_dir,
    dbt_layout,
    ...params
  } = req.body || {};
  if (!connector) {
    return res.status(400).json({ error: "Missing connector type" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if proxied
  res.flushHeaders?.();

  const writeEvent = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
  };

  let conn = { args: [], cleanup: () => {} };
  try {
    conn = buildConnArgs(params);
  } catch (err) {
    writeEvent("error", { message: err.message });
    return res.end();
  }

  const pullArgs = ["pull", connector, ...conn.args];
  if (model_name) pullArgs.push("--model-name", model_name);
  if (tables) {
    const list = typeof tables === "string"
      ? tables.split(",").map((t) => t.trim()).filter(Boolean)
      : tables;
    if (list.length) pullArgs.push("--tables", ...list);
  }
  if (project_dir) pullArgs.push("--project-dir", project_dir, "--create-project-dir");
  if (dbt_layout === false) pullArgs.push("--no-dbt-layout");

  const { cmd, argv } = dmExec(...pullArgs);
  const child = spawn(cmd, argv, { cwd: REPO_ROOT });
  let stdoutBuf = "";
  let stderrBuf = "";

  writeEvent("start", { connector, pid: child.pid });

  const emitLines = (buf, streamName) => {
    const lines = buf.split(/\r?\n/);
    const tail = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Only forward "[pull]" progress lines by default to keep the SSE
      // stream focused. YAML content lives in `stdoutBuf` and ships as
      // part of the `done` summary event at the end.
      if (trimmed.startsWith("[pull]") || streamName === "stderr") {
        writeEvent(streamName === "stderr" ? "warn" : "progress", { line: trimmed });
      }
    }
    return tail;
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf-8");
    const newTail = emitLines(stdoutBuf, "stdout");
    // Keep only the unfinished-line tail so we don't re-emit old progress.
    stdoutBuf = stdoutBuf.slice(stdoutBuf.length - newTail.length);
  });
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString("utf-8");
    const newTail = emitLines(stderrBuf, "stderr");
    stderrBuf = stderrBuf.slice(stderrBuf.length - newTail.length);
  });

  // Heartbeat every 15 s keeps proxies from closing the connection on
  // slow pulls where multiple tables take a while to introspect.
  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch (_) { /* client gone */ }
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    try { child.kill("SIGTERM"); } catch (_) { /* already exited */ }
    conn.cleanup();
  });

  child.on("close", async (code) => {
    clearInterval(heartbeat);
    // Flush any trailing buffered lines (e.g. a final line without newline)
    if (stdoutBuf.trim().startsWith("[pull]")) {
      writeEvent("progress", { line: stdoutBuf.trim() });
    }
    if (stderrBuf.trim()) {
      writeEvent("warn", { line: stderrBuf.trim() });
    }

    // Parse the YAML portion of stdout for a final summary payload.
    const fullStdout = stdoutBuf; // carries the YAML tail if emitted post-split
    let model = null;
    try {
      // Collect every chunk emitted so far by re-reading the stream is
      // not available here — we only have the current tail. The
      // subprocess writes YAML to stdout AFTER the progress lines, so
      // the useful payload has been streamed already. For the summary
      // we synthesise counts from progress lines in the UI layer.
      model = null;
    } catch (_) { model = null; }

    try {
      const saved = await appendConnectionImportEvent({
        connectionId: connection_id,
        connector,
        params,
        event: {
          mode: "pull-stream",
          projectId: project_id || null,
          projectPath: project_path || null,
          schemas: [params.db_schema || params.dataset || model_name || "default"],
          files: [],
          totalEntities: 0,
          totalFields: 0,
          totalRelationships: 0,
        },
      });
      writeEvent("done", {
        code,
        ok: code === 0,
        connectionId: saved?.id || null,
      });
    } catch (err) {
      writeEvent("error", { message: err.message });
    } finally {
      conn.cleanup();
      res.end();
    }
  });

  child.on("error", (err) => {
    clearInterval(heartbeat);
    writeEvent("error", { message: err.message });
    conn.cleanup();
    res.end();
  });
});

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(WEB_DIST, "index.html"));
  });
}

// Global error handler — must be registered after all routes. Converted
// routes forward uncaught errors via `next(err)`; we also catch any thrown
// `ApiError` for the structured envelope. Everything else becomes INTERNAL.
// Legacy routes that still do `res.status(500).json({ error: err.message })`
// inline are unaffected.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof ApiError) {
    return apiFail(res, err.status, err.code, err.message, err.details);
  }
  console.error("[datalex] unhandled error:", err);
  return apiFail(res, 500, "INTERNAL", err?.message || "Internal server error");
});

// When imported by the test harness we set DATALEX_NO_LISTEN=1 so the module
// exports `app` without binding to PORT. Any other caller (node index.js,
// `datalex serve`) keeps the original behavior.
if (!process.env.DATALEX_NO_LISTEN) {
  app.listen(PORT, () => {
    console.log(`[datalex] Local file server running on http://localhost:${PORT}`);
    console.log(`[datalex] Repo root: ${REPO_ROOT}`);
    if (existsSync(WEB_DIST)) {
      console.log(`[datalex] Serving web app from: ${WEB_DIST}`);
    } else {
      console.log(`[datalex] Web dist not found at: ${WEB_DIST}`);
    }
  });
}

export { app };
export default app;
