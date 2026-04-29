/**
 * AI tool registry — Phase 2 of the AI architecture rebuild.
 *
 * Pure functions the per-intent endpoints (Phases 3-5) call to extract
 * real content from the project. Replaces the BM25-dump-into-prompt
 * pattern with focused, testable helpers.
 *
 * Each tool takes `(project, args)` and returns JSON-serializable data.
 * No LLM calls here — these run BEFORE the LLM is invoked, to prefetch
 * the context the LLM needs. (Multi-turn agent loops with tool-calling
 * come later; for v1 the endpoints decide deterministically which tools
 * to call upfront based on the intent.)
 *
 * Tools are intentionally narrow:
 *   - read_file(path)             → string
 *   - list_files(glob, limit)     → string[]
 *   - find_entity(name)           → entity metadata | null
 *   - list_columns(entity_path)   → field[]
 *   - find_references(name)       → match[]
 *   - get_doc_block(name)         → string | null
 *   - search_records(query, kind) → record[]
 *   - validate_yaml(text, path)   → { valid, issues }
 *   - lineage_lookup(entity)      → { upstream, downstream }
 *   - apply_patch_dry_run(path, ops) → { resulting_yaml, valid, issues }
 *
 * The registry exposes `tools.list()` and `tools.invoke(name, project, args)`
 * so per-intent endpoints can call by name and a future Phase can swap
 * to LLM-driven tool calls without changing call sites.
 */

import { readFileSync, existsSync } from "fs";
import { join, isAbsolute, basename, relative } from "path";
import { glob as fastGlob } from "glob";
import yaml from "js-yaml";
import jsonpatch from "fast-json-patch";

/**
 * Resolve a project-relative or absolute path inside the project root.
 * Throws if the resolved path escapes the project (path-traversal guard).
 */
function resolveInProject(project, rawPath) {
  if (!project?.path) throw new Error("project root not available");
  const abs = isAbsolute(rawPath) ? rawPath : join(project.path, String(rawPath));
  // Lightweight guard — real project resolves with realpathSync; we
  // tolerate non-existent files because callers may want to ENOENT
  // gracefully instead of failing the whole pipeline.
  if (!abs.startsWith(project.path) && !abs.includes(project.path)) {
    throw new Error(`path escapes project root: ${rawPath}`);
  }
  return abs;
}

// ───────────────────────────────────────────────────────────────────────
// File-system tools
// ───────────────────────────────────────────────────────────────────────

export async function read_file(project, { path } = {}) {
  if (!path) throw new Error("read_file: path required");
  const abs = resolveInProject(project, path);
  if (!existsSync(abs)) return { ok: false, error: "ENOENT", path };
  try {
    const content = readFileSync(abs, "utf-8");
    return { ok: true, path, content, bytes: content.length };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), path };
  }
}

export async function list_files(project, { glob = "**/*", limit = 50, cwd = "" } = {}) {
  const root = cwd ? resolveInProject(project, cwd) : project.path;
  try {
    const matches = await fastGlob(glob, {
      cwd: root,
      nodir: true,
      ignore: ["node_modules/**", ".git/**", ".datalex/**"],
    });
    return {
      ok: true,
      glob,
      cwd: relative(project.path, root) || ".",
      matches: matches.slice(0, limit),
      truncated: matches.length > limit,
      total: matches.length,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), glob };
  }
}

// ───────────────────────────────────────────────────────────────────────
// Entity / field lookup tools
// ───────────────────────────────────────────────────────────────────────

function loadYamlSafe(absPath) {
  if (!existsSync(absPath)) return null;
  try {
    const text = readFileSync(absPath, "utf-8");
    return { text, doc: yaml.load(text) };
  } catch {
    return null;
  }
}

export async function find_entity(project, { name, glob = "**/*.{yaml,yml}", limit = 5 } = {}) {
  if (!name) throw new Error("find_entity: name required");
  const target = String(name).toLowerCase();
  const files = await fastGlob(glob, {
    cwd: project.path,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", ".datalex/**"],
  });
  const matches = [];
  for (const rel of files) {
    if (matches.length >= limit) break;
    const loaded = loadYamlSafe(join(project.path, rel));
    if (!loaded?.doc) continue;
    const doc = loaded.doc;
    const entities = Array.isArray(doc.entities) ? doc.entities :
      Array.isArray(doc.models) ? doc.models : [];
    for (const ent of entities) {
      if (!ent || typeof ent !== "object") continue;
      if (String(ent.name || "").toLowerCase() === target) {
        const fields = Array.isArray(ent.fields) ? ent.fields :
          Array.isArray(ent.columns) ? ent.columns : [];
        matches.push({
          path: rel,
          entity: ent.name,
          type: ent.type || "entity",
          domain: doc.domain || doc.model?.domain,
          layer: doc.layer || doc.model?.layer,
          field_count: fields.length,
          field_names: fields.map((f) => f?.name).filter(Boolean).slice(0, 12),
          description: ent.description || "",
        });
      }
    }
  }
  return { ok: true, name, matches };
}

export async function list_columns(project, { entity_path, entity_name = null } = {}) {
  if (!entity_path) throw new Error("list_columns: entity_path required");
  const abs = resolveInProject(project, entity_path);
  const loaded = loadYamlSafe(abs);
  if (!loaded?.doc) return { ok: false, error: "could not parse YAML", path: entity_path };
  const doc = loaded.doc;
  const entities = Array.isArray(doc.entities) ? doc.entities :
    Array.isArray(doc.models) ? doc.models : [];
  const ent = entity_name
    ? entities.find((e) => String(e?.name || "").toLowerCase() === String(entity_name).toLowerCase())
    : entities[0];
  if (!ent) return { ok: false, error: "entity not found in file", path: entity_path, entity_name };
  const fields = Array.isArray(ent.fields) ? ent.fields :
    Array.isArray(ent.columns) ? ent.columns : [];
  return {
    ok: true,
    path: entity_path,
    entity: ent.name,
    columns: fields.map((f) => ({
      name: f?.name,
      type: f?.type || "string",
      primary_key: !!f?.primary_key,
      foreign_key: f?.foreign_key || null,
      unique: !!f?.unique,
      nullable: f?.nullable !== false,
      description: f?.description || "",
    })),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Cross-file search tools
// ───────────────────────────────────────────────────────────────────────

export async function find_references(project, { name, glob = "**/*.{yaml,yml}", limit = 30 } = {}) {
  if (!name) throw new Error("find_references: name required");
  const needle = String(name).toLowerCase();
  const files = await fastGlob(glob, {
    cwd: project.path,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", ".datalex/**"],
  });
  const matches = [];
  for (const rel of files) {
    if (matches.length >= limit) break;
    let text;
    try { text = readFileSync(join(project.path, rel), "utf-8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        matches.push({
          path: rel,
          line: i + 1,
          context: lines[i].trim().slice(0, 200),
        });
        if (matches.length >= limit) break;
      }
    }
  }
  return { ok: true, name, matches, truncated: matches.length >= limit };
}

export async function get_doc_block(project, { name } = {}) {
  if (!name) throw new Error("get_doc_block: name required");
  // Read all .md files under the project, regex-extract `{% docs <name> %}…{% enddocs %}`.
  const mdFiles = await fastGlob("**/*.md", {
    cwd: project.path,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", ".datalex/**"],
  });
  const re = new RegExp(
    `\\{%\\s*docs\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*%\\}([\\s\\S]*?)\\{%\\s*enddocs\\s*%\\}`,
    "i",
  );
  for (const rel of mdFiles) {
    let text;
    try { text = readFileSync(join(project.path, rel), "utf-8"); } catch { continue; }
    const m = re.exec(text);
    if (m) return { ok: true, name, body: m[1].trim(), source: rel };
  }
  return { ok: false, name, error: "doc block not found" };
}

// ───────────────────────────────────────────────────────────────────────
// Validation + patch tools
// ───────────────────────────────────────────────────────────────────────

/**
 * Wraps the existing api-server `validateYamlOnSave` helper. Caller is
 * expected to pass that function in via the bound `helpers` (see tools
 * registry below) — keeps this module free of api-server side effects.
 */
export async function validate_yaml(_project, { text, path } = {}, helpers = {}) {
  if (!text) throw new Error("validate_yaml: text required");
  if (!path) throw new Error("validate_yaml: path required");
  if (typeof helpers.validateYamlOnSave !== "function") {
    return { ok: false, error: "validate_yaml helper not provided to tools registry" };
  }
  try {
    const result = helpers.validateYamlOnSave(path, text);
    return { ok: true, path, valid: result?.valid !== false, issues: result?.issues || [] };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), path };
  }
}

export async function apply_patch_dry_run(project, { path, ops = [] } = {}, helpers = {}) {
  if (!path) throw new Error("apply_patch_dry_run: path required");
  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, error: "ops must be a non-empty JSON-patch array" };
  }
  const abs = resolveInProject(project, path);
  if (!existsSync(abs)) return { ok: false, error: "ENOENT", path };
  let text;
  try { text = readFileSync(abs, "utf-8"); } catch (err) {
    return { ok: false, error: err?.message || String(err), path };
  }
  let doc;
  try { doc = yaml.load(text); }
  catch (err) { return { ok: false, error: `parse failed: ${err.message}`, path }; }
  let patched;
  try {
    patched = jsonpatch.applyPatch(doc, ops, /*validate*/ true).newDocument;
  } catch (err) {
    return { ok: false, error: `patch failed: ${err.message}`, path, ops };
  }
  const resultingYaml = yaml.dump(patched, { lineWidth: 120, noRefs: true, sortKeys: false });
  // Optional: re-validate the resulting YAML if a validator helper was passed.
  let validation = null;
  if (typeof helpers.validateYamlOnSave === "function") {
    try {
      const v = helpers.validateYamlOnSave(path, resultingYaml);
      validation = { valid: v?.valid !== false, issues: v?.issues || [] };
    } catch { validation = { valid: false, issues: ["validator threw"] }; }
  }
  return { ok: true, path, resulting_yaml: resultingYaml, validation };
}

// ───────────────────────────────────────────────────────────────────────
// Index-backed tools (search, lineage)
//
// These take an `index` (the AI index from buildAiIndex) via helpers,
// so the tool stays pure — the api-server passes the cached index in.
// ───────────────────────────────────────────────────────────────────────

export async function search_records(_project, { query, kind = "", limit = 20 } = {}, helpers = {}) {
  if (typeof helpers.searchAiIndex !== "function" || !helpers.index) {
    return { ok: false, error: "searchAiIndex helper or index not provided" };
  }
  const records = helpers.searchAiIndex(helpers.index, query || "", { limit });
  const filtered = kind ? records.filter((r) => r.kind === kind) : records;
  return { ok: true, query: query || "", kind: kind || null, matches: filtered };
}

export async function lineage_lookup(_project, { entity } = {}, helpers = {}) {
  if (!entity) throw new Error("lineage_lookup: entity required");
  if (!helpers.index) return { ok: false, error: "index not provided" };
  const lower = String(entity).toLowerCase();
  const upstream = [];
  const downstream = [];
  for (const record of helpers.index?.records || []) {
    if (record.kind !== "relationship") continue;
    const text = String(record.text || record.name || "").toLowerCase();
    if (!text.includes(lower)) continue;
    // We don't have a strict from/to schema everywhere — surface the
    // relationship record itself and let the LLM reason about direction.
    const isUpstream = text.startsWith(lower);
    (isUpstream ? upstream : downstream).push({
      path: record.path,
      name: record.name,
      summary: text.slice(0, 200),
    });
  }
  return { ok: true, entity, upstream: upstream.slice(0, 8), downstream: downstream.slice(0, 8) };
}

// ───────────────────────────────────────────────────────────────────────
// Phase 7 — skills as behaviors (start with the two most-used)
// ───────────────────────────────────────────────────────────────────────

const NAMING_RULES = {
  // dbt model prefixes
  prefixes: [
    { pattern: /^stg_[a-z0-9]+__[a-z0-9_]+$/, layer: "staging", note: "stg_<source>__<entity>" },
    { pattern: /^int_[a-z0-9_]+$/, layer: "intermediate", note: "int_<purpose>" },
    { pattern: /^dim_[a-z0-9_]+$/, layer: "marts", note: "dim_<entity>" },
    { pattern: /^fct_[a-z0-9_]+$/, layer: "marts", note: "fct_<event>" },
    { pattern: /^agg_[a-z0-9_]+__[a-z0-9_]+$/, layer: "marts", note: "agg_<grain>__<measure>" },
    { pattern: /^bdg_[a-z0-9_]+__[a-z0-9_]+$/, layer: "marts", note: "bdg_<left>__<right>" },
  ],
};

export async function validate_naming(_project, { name, kind = "model" } = {}) {
  if (!name) throw new Error("validate_naming: name required");
  const lower = String(name).toLowerCase();
  if (kind !== "model") {
    return { ok: true, name, kind, passes: true, note: `${kind} naming check not implemented in v1` };
  }
  for (const rule of NAMING_RULES.prefixes) {
    if (rule.pattern.test(lower)) {
      return { ok: true, name, kind, passes: true, layer: rule.layer, matched: rule.note };
    }
  }
  return {
    ok: true,
    name,
    kind,
    passes: false,
    issue: `model name '${name}' doesn't match any standard dbt prefix`,
    suggested_patterns: NAMING_RULES.prefixes.map((r) => r.note),
  };
}

export async function required_tests(_project, { field } = {}) {
  if (!field || typeof field !== "object") {
    throw new Error("required_tests: field object required");
  }
  const required = [];
  if (field.primary_key) {
    required.push({ test: "unique", reason: "primary key" });
    required.push({ test: "not_null", reason: "primary key" });
  }
  if (field.foreign_key && field.foreign_key.entity) {
    required.push({
      test: "relationships",
      to: `ref('${field.foreign_key.entity}')`,
      to_field: field.foreign_key.field || "?",
      reason: "foreign key",
    });
  }
  if (field.nullable === false && !field.primary_key) {
    required.push({ test: "not_null", reason: "explicitly not-null" });
  }
  // Enum-shape detection
  if (/^(status|type|category|kind|state)$/i.test(String(field.name || ""))) {
    required.push({
      test: "accepted_values",
      values: [],
      reason: "name suggests enum — caller should fill in `values:`",
    });
  }
  return { ok: true, field: field.name, required };
}

// ───────────────────────────────────────────────────────────────────────
// Tool registry
// ───────────────────────────────────────────────────────────────────────

const TOOL_FNS = {
  read_file,
  list_files,
  find_entity,
  list_columns,
  find_references,
  get_doc_block,
  validate_yaml,
  apply_patch_dry_run,
  search_records,
  lineage_lookup,
  validate_naming,
  required_tests,
};

const TOOL_DESCRIPTIONS = {
  read_file: "Read a project-relative file. Args: { path }.",
  list_files: "Glob-list files in the project. Args: { glob, limit, cwd }.",
  find_entity: "Find an entity by name across all YAML files. Args: { name, glob, limit }.",
  list_columns: "List the columns/fields of an entity in a given YAML file. Args: { entity_path, entity_name }.",
  find_references: "Substring-search for a name across YAML files. Args: { name, glob, limit }.",
  get_doc_block: "Look up a `{% docs <name> %}` block from any .md file. Args: { name }.",
  validate_yaml: "Run the project's YAML validator on a string. Args: { text, path }.",
  apply_patch_dry_run: "Apply a JSON-patch to a YAML file in-memory; return the resulting YAML and validation. Args: { path, ops }.",
  search_records: "BM25-search the AI index for records. Args: { query, kind, limit }.",
  lineage_lookup: "Find relationship records mentioning an entity. Args: { entity }.",
  validate_naming: "Check a model name against the project's naming conventions. Args: { name, kind }.",
  required_tests: "Compute the required dbt tests for a given field. Args: { field }.",
};

export function listTools() {
  return Object.keys(TOOL_FNS).map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name] || "",
  }));
}

export async function invokeTool(name, project, args = {}, helpers = {}) {
  const fn = TOOL_FNS[name];
  if (!fn) throw new Error(`unknown tool: ${name}`);
  return await fn(project, args, helpers);
}
