// Phase 2.4 — Unparseable YAML in a dbt repo scan is surfaced as a
// PARSE_FAILED warning with line/column, not silently dropped.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import request from "supertest";
import { getApp } from "./helpers/harness.js";

describe("POST /api/connectors/dbt-repo/scan — parse-error reporting", () => {
  let app;
  let repoDir;

  before(async () => {
    app = await getApp();
    repoDir = join(tmpdir(), `datalex-dbt-scan-${randomBytes(4).toString("hex")}`);
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(
      join(repoDir, "good.yml"),
      "version: 2\nmodels:\n  - name: stg_customers\n",
    );
    // Unclosed bracket → js-yaml throws with a mark at line 3
    writeFileSync(
      join(repoDir, "bad.yml"),
      "version: 2\nmodels: [\n  - name: broken\n",
    );
  });

  after(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  test("reports per-file parse errors in warnings with line/col", async () => {
    const res = await request(app)
      .post("/api/connectors/dbt-repo/scan")
      .send({ repo_path: repoDir });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const goodFile = res.body.dbtFiles.find((f) => f.path === "good.yml");
    assert.ok(goodFile, "valid YAML still reported");

    const badFile = res.body.dbtFiles.find((f) => f.path === "bad.yml");
    assert.equal(badFile, undefined, "unparseable YAML excluded from dbtFiles list");

    const warning = (res.body.warnings || []).find((w) => w.includes("bad.yml"));
    assert.ok(warning, `expected a warning mentioning bad.yml, got ${JSON.stringify(res.body.warnings)}`);
    assert.match(warning, /line \d+/, "warning includes line number");

    const parseErr = (res.body.parseErrors || []).find((pe) => pe.path === "bad.yml");
    assert.ok(parseErr, "structured parseErrors entry for bad.yml");
    assert.equal(parseErr.code, "PARSE_FAILED");
    assert.equal(typeof parseErr.line, "number");
  });
});
