/**
 * Per-intent endpoint runner — Phases 3-5 of the AI architecture rebuild.
 *
 * Shared logic for POST /api/ai/{fix, explain, explore, create, refactor}.
 * Each endpoint:
 *   1. Validates its intent-specific request body
 *   2. Resolves the project + AI provider config
 *   3. Pre-fetches context using the tool registry (deterministic — no
 *      LLM-driven tool calls in v1)
 *   4. Builds a focused per-intent system + user prompt
 *   5. Calls the LLM with JSON-mode enforcing the intent's output schema
 *   6. Validates the response against the intent's schema
 *   7. Returns the typed response
 *
 * Compared to /api/ai/ask:
 *   - No 4-agent run, no 8-skill dump, no 7-key generic JSON
 *   - One agent's contract per intent
 *   - Per-intent output schema validated server-side
 *   - Tools fetched real content instead of BM25-summary dumps
 *   - No memory extraction (these are one-shot tasks)
 */

import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { invokeTool, listTools } from "./tools.js";
import { classifyYamlText, dbtVersionWarning, YAML_DOCUMENT_KINDS } from "./yamlDocumentKind.js";

/* Load the validation-fix-recipes skill once at module init so the
   validation_fix system prompt actually carries the rule-by-rule
   recipe table. The file is a Markdown doc kept under Skills/, so
   humans and the agent are reading the same source of truth.
   Resolved relative to the repo root. Falls back to an empty string
   when the file isn't shipped (e.g. minimal install) so the prompt
   still works — just without the rule table. */
const __INTENT_DIRNAME = path.dirname(fileURLToPath(import.meta.url));
function loadValidationFixRecipes() {
  const candidates = [
    path.join(__INTENT_DIRNAME, "..", "..", "..", "Skills", "validation-fix-recipes.md"),
    path.join(__INTENT_DIRNAME, "..", "..", "..", "..", "Skills", "validation-fix-recipes.md"),
  ];
  for (const candidate of candidates) {
    try {
      const body = readFileSync(candidate, "utf-8");
      if (body && body.length > 100) return body;
    } catch (_err) { /* keep trying */ }
  }
  return "";
}
const VALIDATION_FIX_RECIPES = loadValidationFixRecipes();

/**
 * Per-intent system prompts. Each describes the agent's job, the
 * output schema, and the constraints. Kept short — the work happens in
 * the user prompt + the prefetched context.
 */
export const INTENT_SYSTEM_PROMPTS = {
  validation_fix: [
    "You are the DataLex YAML Patch Engineer.",
    "Task: explain a validation finding in one sentence, then return the smallest JSON-patch that fixes it.",
    "Allowed outcomes: patch_yaml, needs_user_input, or no_patch_needed.",
    "Output schema for a fix (strict JSON): { \"status\": \"patch_yaml\", \"explanation\": string, \"patch\": { \"path\": string, \"ops\": [{ \"op\": \"add\"|\"replace\"|\"remove\"|\"move\"|\"copy\"|\"test\", \"path\": string, \"value\"?: any }] } }.",
    "Output schema when the missing value cannot be safely inferred: { \"status\": \"needs_user_input\", \"explanation\": string, \"questions\": [string] }.",
    "Output schema for a false-positive validation finding: { \"status\": \"no_patch_needed\", \"explanation\": string }.",
    "Hard rules: target the EXISTING file at the path the user gave. Use ONLY the patch_yaml shape above. Do NOT propose create_diagram, create_model, create_file, delete_file, or rename_file. If the file is missing a top-level key, ADD it via a single JSON-patch op.",
    VALIDATION_FIX_RECIPES
      ? "Follow the rule-by-rule recipe table below. Match by `code` from the user's prompt. The user prompt also carries WHY/FIX guidance which should agree with this table — if they conflict, prefer the recipe.\n\n--- VALIDATION FIX RECIPES ---\n" + VALIDATION_FIX_RECIPES + "\n--- END RECIPES ---"
      : "",
    "Reply with JSON only — no preamble, no code fences.",
  ].filter(Boolean).join(" "),

  explain: [
    "You are the DataLex Governance Reviewer.",
    "Task: answer the user's question grounded in the retrieved sources. Do NOT propose any file changes.",
    "Output schema (strict JSON): { \"answer\": string, \"sources\": [{ \"path\": string, \"snippet\": string }] }.",
    "Cite at least one source from the retrieved context when one is relevant. Keep the answer to 2-4 sentences. Reply with JSON only.",
  ].join(" "),

  explore: [
    "You are the DataLex Governance Reviewer.",
    "Task: list the items the user asked for, summarized. Do NOT propose any file changes.",
    "Output schema (strict JSON): { \"matches\": [{ \"path\": string, \"snippet\": string, \"score\"?: number }], \"summary\": string }.",
    "Reply with JSON only.",
  ].join(" "),

  create_artifact: [
    "You are the DataLex Conceptualizer.",
    "Task: propose ONE create_diagram or create_model change satisfying the user's request.",
    "Output schema (strict JSON): { \"change\": { \"type\": \"create_diagram\"|\"create_model\", \"path\": string, \"content\": string } } where `content` is the full YAML body.",
    "The path must be domain-first: <domain>/<Layer>/<name>.[diagram|model].yaml — server canonicalization will prepend DataLex/ when needed.",
    "For conceptual diagrams, use `kind: diagram`, include `entities[]` with `type: concept`, and include `relationships[]` with verbs.",
    "For logical/physical models, use `kind: model`, include `entities[]` with `fields[]`.",
    "Reply with JSON only.",
  ].join(" "),

  refactor: [
    "You are the DataLex YAML Patch Engineer.",
    "Task: produce one or more patch_yaml changes that achieve the requested refactor across files.",
    "Output schema (strict JSON): { \"patches\": [{ \"path\": string, \"ops\": [...JSON-patch ops] }] }.",
    "Each patch targets one EXISTING file. Do NOT propose create_*, delete_*, or rename_* changes — refactors are in-place edits.",
    "Reply with JSON only.",
  ].join(" "),
};

// ───────────────────────────────────────────────────────────────────────
// Per-intent prefetchers — deterministic tool calls based on the intent
// ───────────────────────────────────────────────────────────────────────

async function prefetchValidationFix(project, body, helpers) {
  const filePath = normalizeRequestPath(body?.context?.filePath || body?.filePath || "");
  if (!filePath) return { context: {}, warnings: ["no filePath provided"] };
  const file = await invokeTool("read_file", project, { path: filePath }, helpers);
  const issue = body?.context?.issue || body?.issue || {};
  const yamlDocumentKind = file?.ok ? classifyYamlText(file.content) : YAML_DOCUMENT_KINDS.UNKNOWN;
  let parsedDoc = null;
  if (file?.ok) {
    try { parsedDoc = yaml.load(file.content); } catch (_err) { parsedDoc = null; }
  }
  const versionWarning = parsedDoc ? dbtVersionWarning(parsedDoc, yamlDocumentKind) : null;
  const targetPointer = issue?.path || issue?.pointer || body?.context?.pointer || "";
  const nearbyYaml = file?.ok ? extractNearbyYamlContext(file.content, targetPointer) : "";
  return {
    context: {
      intent: "validation_fix",
      file,
      issue,
      target_pointer: targetPointer,
      yaml_document_kind: yamlDocumentKind,
      dbt_version_warning: versionWarning,
      nearby_yaml: nearbyYaml,
      context_priority: [
        "exact_file",
        "json_pointer",
        "validation_code",
        "yaml_document_kind",
        "nearby_yaml",
        "memory_is_not_fact",
      ],
    },
    warnings: versionWarning ? [versionWarning] : [],
  };
}

function jsonPointerParts(pathValue) {
  return String(pathValue || "")
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function extractNearbyYamlContext(content, pointer) {
  if (!content || !pointer || pointer === "/") return String(content || "").slice(0, 5000);
  let doc;
  try { doc = yaml.load(content); } catch (_err) { return String(content || "").slice(0, 5000); }
  let cursor = doc;
  let parent = doc;
  for (const part of jsonPointerParts(pointer)) {
    parent = cursor;
    if (Array.isArray(cursor)) cursor = cursor[Number(part)];
    else if (cursor && typeof cursor === "object") cursor = cursor[part];
    else break;
  }
  const focus = cursor === undefined ? parent : cursor;
  try {
    return yaml.dump(focus, { lineWidth: 120, noRefs: true, sortKeys: false }).slice(0, 5000);
  } catch (_err) {
    return String(content || "").slice(0, 5000);
  }
}

async function prefetchExplain(project, body, helpers) {
  const message = String(body?.message || "");
  const records = await invokeTool("search_records", project, { query: message, limit: 8 }, helpers);
  return { context: { records: records.matches || [] }, warnings: [] };
}

async function prefetchExplore(project, body, helpers) {
  const message = String(body?.message || "");
  const records = await invokeTool("search_records", project, { query: message, limit: 25 }, helpers);
  return { context: { records: records.matches || [] }, warnings: [] };
}

async function prefetchCreate(project, body, helpers) {
  // Pull a small sample of existing diagram + model files so the LLM
  // can match the project's structural conventions.
  const sample = await invokeTool("list_files", project, {
    glob: "**/*.{diagram.yaml,model.yaml,yml}",
    limit: 12,
  }, helpers);
  return { context: { sample_files: sample.matches || [] }, warnings: [] };
}

async function prefetchRefactor(project, body, helpers) {
  // Best-effort: if the message mentions a name, find_references for it.
  const message = String(body?.message || "").toLowerCase();
  const m = message.match(/\b([a-z][a-z0-9_]{2,})\b/);
  if (!m) return { context: {}, warnings: ["no candidate name to find references for"] };
  const refs = await invokeTool("find_references", project, { name: m[1], limit: 20 }, helpers);
  return { context: { references_to: m[1], references: refs.matches || [] }, warnings: [] };
}

const PREFETCHERS = {
  validation_fix: prefetchValidationFix,
  explain: prefetchExplain,
  explore: prefetchExplore,
  create_artifact: prefetchCreate,
  refactor: prefetchRefactor,
};

// ───────────────────────────────────────────────────────────────────────
// Per-intent response validators — enforce the output schema
// ───────────────────────────────────────────────────────────────────────

function validateValidationFix(parsed) {
  if (!parsed || typeof parsed !== "object") return "response must be an object";
  if (typeof parsed.explanation !== "string" || !parsed.explanation.trim()) {
    return "missing/empty `explanation` string";
  }
  const status = String(parsed.status || (parsed.patch ? "patch_yaml" : "")).trim() || "patch_yaml";
  if (status === "needs_user_input") {
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) return "`needs_user_input` requires questions[]";
    return null;
  }
  if (status === "no_patch_needed") return null;
  if (status !== "patch_yaml") return "`status` must be patch_yaml, needs_user_input, or no_patch_needed";
  if (!parsed.patch || typeof parsed.patch !== "object") return "missing `patch` object";
  if (typeof parsed.patch.path !== "string" || !parsed.patch.path.trim()) {
    return "missing/empty `patch.path`";
  }
  if (!Array.isArray(parsed.patch.ops) || parsed.patch.ops.length === 0) {
    return "`patch.ops` must be a non-empty array";
  }
  for (const op of parsed.patch.ops) {
    if (!op?.op || !op?.path) return "each op needs `op` and `path`";
  }
  return null;
}

function cleanRelativePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/^DataLex\//i, "");
}

function normalizeRequestPath(value) {
  const text = String(value || "").trim();
  if (/^(?:[A-Za-z]:)?[\\/]/.test(text)) return text;
  return cleanRelativePath(text);
}

function isFalsePositiveDbtMetricFinding(issue, yamlDocumentKind) {
  const code = String(issue?.code || "").toUpperCase();
  return yamlDocumentKind === YAML_DOCUMENT_KINDS.DBT_SEMANTIC && /^INVALID_METRIC_/.test(code);
}

/* Rule codes whose fix requires human-only data (emails, project name,
   columns, …) and therefore should never go through the LLM — the agent
   would just guess. We short-circuit straight to needs_user_input with
   a stable question shape so the user gets the same prompt every time
   (and the LLM doesn't burn tokens hallucinating placeholders). */
const RULE_FIX_PLAYBOOK = {
  MISSING_MODEL_SECTION: {
    explanation: "This file is missing the top-level model: block that names, versions, and credits the artifact. The agent can't invent owners or domain — answer the questions below and a follow-up patch will materialize.",
    questions: [
      "What slug should model.name use? (lowercase snake_case, e.g. customer_360)",
      "What domain owns this model? (sales, finance, marketing, …)",
      "Which email addresses should appear in model.owners?",
      "Should this remain a kind: model file, or convert to a layout-only kind: diagram?",
    ],
  },
  INVALID_MODEL_NAME: {
    explanation: "model.name has to be lowercase letters, numbers, and underscores so it is safe in SQL and dbt refs.",
    questions: ["What lowercase snake_case slug should we use for model.name?"],
  },
  INVALID_MODEL_VERSION: {
    explanation: "model.version must be a SemVer string so consumers can reason about breaking vs additive changes.",
    questions: ["What SemVer should model.version be set to? (1.0.0 if this is the first release)"],
  },
  INVALID_MODEL_DOMAIN: {
    explanation: "model.domain scopes this artifact under a bounded context; the agent won't pick one for you.",
    questions: ["Which business domain does this model belong to? (sales, finance, marketing, …)"],
  },
  INVALID_MODEL_OWNERS: {
    explanation: "model.owners routes change reviews and access decisions; it must contain at least one email.",
    questions: ["Which email addresses should be listed as model.owners?"],
  },
  INVALID_OWNER_EMAIL: {
    explanation: "One of the model.owners entries isn't a parseable email. The agent won't invent a replacement.",
    questions: ["Which email should replace the invalid one in model.owners?"],
  },
  INVALID_ENTITIES: {
    explanation: "This kind: model file declares no entities, so it doesn't represent any data yet. The agent can't invent business entities for you.",
    questions: [
      "What entities should this model contain? (entity name + 1-line definition each)",
      "If this should actually be a layout-only file, would you rather convert it to kind: diagram?",
    ],
  },
  DBT_ENTITY_NO_COLUMNS: {
    explanation: "An entity without columns can't generate a dbt contract or a schema.yml. The agent doesn't know the schema — only you do.",
    questions: [
      "What columns should this entity expose? Provide name + data_type for each (varchar, integer, timestamp, decimal, …).",
    ],
  },
  DBT_COLUMN_NO_TYPE: {
    explanation: "data_type drives dbt contract enforcement; the agent shouldn't guess.",
    questions: ["What data_type should the column carry? (varchar, integer, timestamp, decimal, …)"],
  },
  CONCEPTUAL_MISSING_OWNER: {
    explanation: "Conceptual concepts need a steward so business questions and definition changes have a clear owner.",
    questions: ["Which team or person should own this concept? (e.g. CRM, Revenue Operations, Product)"],
  },
  CONCEPTUAL_MISSING_SUBJECT_AREA: {
    explanation: "Subject areas are how enterprise teams group concepts into bounded contexts.",
    questions: ["Which subject area (or bounded context) does this concept belong to?"],
  },
  CONCEPTUAL_MISSING_GLOSSARY_LINK: {
    explanation: "Without glossary linkage, the conceptual model stays disconnected from the business dictionary.",
    questions: ["Which glossary term names should be linked to this concept? (comma-separated)"],
  },
  CONCEPTUAL_MISSING_DOMAIN: {
    explanation: "model.domain tells consumers which business area owns this conceptual view.",
    questions: ["What bounded context or enterprise domain does this conceptual model cover?"],
  },
  LOGICAL_UNRESOLVED_TYPE: {
    explanation: "Logical attributes need a platform-neutral type so they can map cleanly into physical dialect types.",
    questions: ["What logical type should this attribute carry? (string, number, date, timestamp, boolean, identifier, money)"],
  },
  LOGICAL_MANY_TO_MANY_NEEDS_ASSOCIATIVE_ENTITY: {
    explanation: "Many-to-many relationships have to be resolved with an associative entity before physical generation can build reliable dbt tables.",
    questions: [
      "What should the associative entity be named?",
      "Which fields on each side should the bridge carry?",
    ],
  },
  PHYSICAL_MISSING_DBT_SOURCE: {
    explanation: "Physical diagrams should be grounded in dbt model/source YAML so the canvas reflects runnable assets.",
    questions: ["Which dbt model or source YAML files should be referenced from this physical diagram?"],
  },
  PHYSICAL_MISSING_SQL_OUTPUT: {
    explanation: "Physical release readiness needs generated or referenced SQL.",
    questions: ["Should we generate SQL now under generated-sql/, or link existing dbt SQL? Provide the path if linking."],
  },
};

function shortCircuitValidationFix(issue) {
  const code = String(issue?.code || "").toUpperCase();
  const playbook = RULE_FIX_PLAYBOOK[code];
  if (!playbook) return null;
  return {
    status: "needs_user_input",
    explanation: playbook.explanation,
    questions: playbook.questions,
    rule_code: code,
    short_circuited: true,
  };
}

async function postProcessValidationFix(parsed, project, body, context, helpers) {
  const issue = context?.issue || body?.context?.issue || {};
  const filePath = normalizeRequestPath(body?.context?.filePath || body?.filePath || "");
  if (isFalsePositiveDbtMetricFinding(issue, context?.yaml_document_kind)) {
    return {
      status: "no_patch_needed",
      explanation: "This is a false-positive DataLex-native metric finding for dbt semantic layer YAML; re-run validation with the dbt-aware classifier.",
      yaml_document_kind: context?.yaml_document_kind,
      validation_issue: issue,
    };
  }

  const status = String(parsed.status || (parsed.patch ? "patch_yaml" : "") || "patch_yaml");
  if (status !== "patch_yaml") return { ...parsed, status };

  const patchPath = cleanRelativePath(parsed.patch?.path || "");
  const targetPath = filePath || patchPath;

  const dryRun = await invokeTool("apply_patch_dry_run", project, {
    path: targetPath,
    ops: parsed.patch.ops,
  }, helpers);
  if (!dryRun?.ok || dryRun?.validation?.valid === false) {
    return {
      status: "needs_user_input",
      explanation: dryRun?.ok
        ? "The proposed patch applies but does not pass validation, so it was not made available for apply."
        : `The proposed patch could not be applied: ${dryRun?.error || "unknown patch error"}`,
      questions: ["Review the validation finding and provide the missing business value if it cannot be inferred from the YAML."],
      dry_run: dryRun,
      rejected_patch: parsed.patch,
    };
  }

  return {
    ...parsed,
    status: "patch_yaml",
    patch: {
      path: targetPath,
      ops: parsed.patch.ops,
    },
    targetPointer: context?.target_pointer || undefined,
    yaml_document_kind: context?.yaml_document_kind,
    dry_run: dryRun,
  };
}

function validateExplain(parsed) {
  if (!parsed || typeof parsed !== "object") return "response must be an object";
  if (typeof parsed.answer !== "string" || !parsed.answer.trim()) {
    return "missing/empty `answer` string";
  }
  if (!Array.isArray(parsed.sources)) return "`sources` must be an array";
  return null;
}

function validateExplore(parsed) {
  if (!parsed || typeof parsed !== "object") return "response must be an object";
  if (!Array.isArray(parsed.matches)) return "`matches` must be an array";
  if (typeof parsed.summary !== "string") return "`summary` must be a string";
  return null;
}

function validateCreate(parsed) {
  if (!parsed || typeof parsed !== "object") return "response must be an object";
  if (!parsed.change || typeof parsed.change !== "object") return "missing `change`";
  const t = parsed.change.type;
  if (t !== "create_diagram" && t !== "create_model") {
    return "`change.type` must be create_diagram or create_model";
  }
  if (typeof parsed.change.path !== "string" || !parsed.change.path.trim()) {
    return "missing `change.path`";
  }
  if (typeof parsed.change.content !== "string" || !parsed.change.content.trim()) {
    return "missing `change.content`";
  }
  // Sanity-parse the proposed content so we don't ship YAML the LLM
  // hallucinated the syntax for.
  try { yaml.load(parsed.change.content); } catch (err) {
    return `change.content is not parseable YAML: ${err.message}`;
  }
  return null;
}

function validateRefactor(parsed) {
  if (!parsed || typeof parsed !== "object") return "response must be an object";
  if (!Array.isArray(parsed.patches) || parsed.patches.length === 0) {
    return "`patches` must be a non-empty array";
  }
  for (const p of parsed.patches) {
    if (!p?.path || !Array.isArray(p?.ops) || p.ops.length === 0) {
      return "each patch needs `path` and non-empty `ops`";
    }
  }
  return null;
}

const VALIDATORS = {
  validation_fix: validateValidationFix,
  explain: validateExplain,
  explore: validateExplore,
  create_artifact: validateCreate,
  refactor: validateRefactor,
};

// ───────────────────────────────────────────────────────────────────────
// Shared runner — called by each endpoint
// ───────────────────────────────────────────────────────────────────────

function parseJsonLoose(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) {}
  // Strip markdown code fences if the model added them.
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch (_) {}
  }
  // Last resort: extract the first {...} block.
  const obj = String(text).match(/\{[\s\S]*\}/);
  if (obj) {
    try { return JSON.parse(obj[0]); } catch (_) {}
  }
  return null;
}

/**
 * Run a per-intent endpoint end-to-end.
 *
 * @param {string} intent — e.g. "validation_fix"
 * @param {object} args — { project, body, providerConfig, helpers, callAiProvider }
 * @returns {Promise<object>} — the typed response payload
 */
export async function runIntentEndpoint(intent, args) {
  const { project, body, providerConfig, helpers, callAiProvider } = args;

  const systemPrompt = INTENT_SYSTEM_PROMPTS[intent];
  const prefetcher = PREFETCHERS[intent];
  const validator = VALIDATORS[intent];
  if (!systemPrompt || !prefetcher || !validator) {
    throw new Error(`unknown intent: ${intent}`);
  }

  const { context, warnings } = await prefetcher(project, body, helpers);
  const userMessage = String(body?.message || "").trim();
  if (!userMessage) {
    throw new Error("message required");
  }

  // Validation-fix short-circuit. Some rule codes (MISSING_MODEL_SECTION,
  // INVALID_OWNER_EMAIL, DBT_ENTITY_NO_COLUMNS, …) need human-only data
  // — emails, project name, schema. Routing them through the LLM only
  // results in invented placeholders. We respond directly with the
  // canonical needs_user_input payload so the user always gets the
  // same set of questions and zero hallucinated values.
  if (intent === "validation_fix") {
    const shortCircuit = shortCircuitValidationFix(context?.issue || body?.context?.issue || {});
    if (shortCircuit) {
      return {
        ok: true,
        intent,
        response: shortCircuit,
        warnings: warnings || [],
        short_circuited: true,
      };
    }
  }

  const userPayload = JSON.stringify({
    request: userMessage,
    ui_context: body?.context || {},
    prefetched_context: context,
  }, null, 2);

  let raw;
  try {
    raw = await callAiProvider(providerConfig, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPayload },
    ]);
  } catch (err) {
    return { ok: false, error: { code: "PROVIDER_FAILED", message: err?.message || String(err) } };
  }

  const parsed = parseJsonLoose(raw);
  if (!parsed) {
    return {
      ok: false,
      error: { code: "PARSE_FAILED", message: "LLM did not return valid JSON", raw: String(raw).slice(0, 600) },
    };
  }

  const validationError = validator(parsed);
  if (validationError) {
    return {
      ok: false,
      error: { code: "SCHEMA_INVALID", message: validationError, raw: parsed },
    };
  }

  let response = parsed;
  if (intent === "validation_fix") {
    response = await postProcessValidationFix(parsed, project, body, context, helpers);
  }

  return { ok: true, intent, response, warnings };
}
