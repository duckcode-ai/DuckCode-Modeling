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
import { invokeTool, listTools } from "./tools.js";

/**
 * Per-intent system prompts. Each describes the agent's job, the
 * output schema, and the constraints. Kept short — the work happens in
 * the user prompt + the prefetched context.
 */
export const INTENT_SYSTEM_PROMPTS = {
  validation_fix: [
    "You are the DataLex YAML Patch Engineer.",
    "Task: explain a validation finding in one sentence, then return the smallest JSON-patch that fixes it.",
    "Output schema (strict JSON): { \"explanation\": string, \"patch\": { \"path\": string, \"ops\": [{ \"op\": \"add\"|\"replace\"|\"remove\"|\"move\"|\"copy\"|\"test\", \"path\": string, \"value\"?: any }] } }.",
    "Hard rules: target the EXISTING file at the path the user gave. Use ONLY the patch_yaml shape above. Do NOT propose create_diagram, create_model, create_file, delete_file, or rename_file. If the file is missing a top-level key, ADD it via a single JSON-patch op.",
    "Reply with JSON only — no preamble, no code fences.",
  ].join(" "),

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
  const filePath = body?.context?.filePath || body?.filePath || "";
  if (!filePath) return { context: {}, warnings: ["no filePath provided"] };
  const file = await invokeTool("read_file", project, { path: filePath }, helpers);
  return { context: { file }, warnings: [] };
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

  return { ok: true, intent, response: parsed, warnings };
}
