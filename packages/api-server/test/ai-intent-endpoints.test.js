// Pins the per-intent endpoint wiring (Path B Phases 3-6).
// Source-level guards because the endpoints' real value is the LLM
// integration, which we cover with the existing AI provider harness in
// ai-proposals.test.js. Here we lock the routing + schema-validation
// scaffolding so they don't silently drift.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve("./index.js"), "utf-8");
const ENDPOINTS_SRC = fs.readFileSync(path.resolve("./ai/intent-endpoints.js"), "utf-8");

describe("Per-intent endpoint registration", () => {
  test("all five new endpoints are registered", () => {
    assert.match(SRC, /app\.post\("\/api\/ai\/fix"/);
    assert.match(SRC, /app\.post\("\/api\/ai\/explain"/);
    assert.match(SRC, /app\.post\("\/api\/ai\/explore"/);
    assert.match(SRC, /app\.post\("\/api\/ai\/create"/);
    assert.match(SRC, /app\.post\("\/api\/ai\/refactor"/);
  });

  test("each endpoint routes through intentEndpointHandler", () => {
    assert.match(SRC, /intentEndpointHandler\("validation_fix"/);
    assert.match(SRC, /intentEndpointHandler\("explain"/);
    assert.match(SRC, /intentEndpointHandler\("explore"/);
    assert.match(SRC, /intentEndpointHandler\("create_artifact"/);
    assert.match(SRC, /intentEndpointHandler\("refactor"/);
  });

  test("intentEndpointHandler enforces NO_PROVIDER 503 fast-fail", () => {
    assert.match(SRC, /async function intentEndpointHandler\(intent, req, res, next\)/);
    assert.match(SRC, /NO_PROVIDER/);
    assert.match(SRC, /No AI provider configured/);
  });
});

describe("Phase 6 — /api/ai/ask routes through classifier", () => {
  test("imports classifyIntent + runIntentEndpoint", () => {
    assert.match(SRC, /import { classifyIntent } from "\.\/ai\/intent-router\.js"/);
    assert.match(SRC, /import { runIntentEndpoint } from "\.\/ai\/intent-endpoints\.js"/);
  });

  test("ask endpoint forwards high-confidence intents to per-intent handlers", () => {
    assert.match(SRC, /classifyIntent\(message, req\.body\?\.context \|\| \{\}\)/);
    assert.match(SRC, /decision\.confidence >= 0\.75/);
    assert.match(SRC, /ROUTABLE\.includes\(decision\.intent\)/);
  });

  test("routing decisions logged for tuning", () => {
    assert.match(SRC, /function logIntentRouting/);
    assert.match(SRC, /\.datalex.*ai.*intent-routing\.log/);
  });
});

describe("Per-intent system prompts + validators", () => {
  test("validation_fix prompt locks output to patch_yaml shape", () => {
    assert.match(ENDPOINTS_SRC, /validation_fix:/);
    assert.match(ENDPOINTS_SRC, /Use ONLY the patch_yaml shape/);
    assert.match(ENDPOINTS_SRC, /Do NOT propose create_diagram, create_model/);
  });

  test("explain prompt forbids file changes", () => {
    assert.match(ENDPOINTS_SRC, /explain:/);
    assert.match(ENDPOINTS_SRC, /Do NOT propose any file changes/);
  });

  test("each intent has a schema validator", () => {
    assert.match(ENDPOINTS_SRC, /validateValidationFix/);
    assert.match(ENDPOINTS_SRC, /validateExplain/);
    assert.match(ENDPOINTS_SRC, /validateExplore/);
    assert.match(ENDPOINTS_SRC, /validateCreate/);
    assert.match(ENDPOINTS_SRC, /validateRefactor/);
  });

  test("create_artifact validator parses the proposed YAML before accepting", () => {
    assert.match(ENDPOINTS_SRC, /change\.content is not parseable YAML/);
  });
});
