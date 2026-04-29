// Pins the fix-intent routing changes shipped after the user reported the
// AI proposing `create_diagram` for a `MISSING_MODEL_SECTION` validation
// finding (and surfacing Description Writer + Conceptualizer agents that
// have nothing to do with patching a YAML file).
//
// We assert via source-string matches rather than module imports because
// importing api-server's index.js spins up the Express listener and
// collides with the other test files. The strings under test are
// load-bearing — accidental removal would re-introduce the regression.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve("./index.js"), "utf-8");

describe("AI fix-intent anchoring (source-level guards)", () => {
  test("system prompt contains the fix-intent anchor block", () => {
    assert.match(SRC, /INTENT = FIX-EXISTING-FILE/);
    assert.match(SRC, /ONLY allowed change types for this request are `patch_yaml` and `update_file`/);
    assert.match(SRC, /DO NOT propose `create_diagram`, `create_model`/);
  });

  test("agent classifier hard-suppresses prose / inference agents on fix intents", () => {
    assert.match(SRC, /if \(isFixIntent\)/);
    assert.match(SRC, /id === "yaml_patch_engineer"\) score \+= 20/);
    assert.match(SRC, /id === "governance_reviewer"\) score \+= 15/);
    // Description writer / conceptualizer / canonicalizer get score=0
    assert.match(SRC, /id === "description_writer" \|\| id === "conceptualizer" \|\| id === "canonicalizer"/);
  });

  test("agent classifier caps fix-intent agent set at 2", () => {
    assert.match(SRC, /const cap = isFixIntent \? 2 : 4/);
  });

  test("skill scoping caps fix-intent skills at 3 and suppresses prose skills", () => {
    assert.match(SRC, /isFixIntent \? 3 : 8/);
    assert.match(SRC, /yaml-proposal-safety\|governance\|dbt-test-coverage\|dbt-naming-conventions/);
    assert.match(SRC, /description-writing\|conceptual-business-modeling/);
  });
});
