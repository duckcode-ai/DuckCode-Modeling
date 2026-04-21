// Phase 2.3 — Save-All merges sibling docs that target the same file.
//
// dbt repos commonly share a single `schema.yml` across several models;
// in DataLex each model gets its own in-memory YAML doc, but they all
// canonicalize to the same destination path. Before the merge, the last
// writer won and the earlier siblings' entities disappeared silently.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

describe("POST /api/projects/:id/save-all (shared-path merge)", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "models" });
  });
  after(() => project.cleanup());

  test("merges two docs targeting the same file (entities unioned by name)", async () => {
    const docA = yaml.dump({
      model: { name: "schema" },
      entities: [{ name: "customers", fields: [{ name: "id" }] }],
    });
    const docB = yaml.dump({
      model: { name: "schema" },
      entities: [{ name: "orders", fields: [{ name: "id" }] }],
    });
    const res = await request(app)
      .post(`/api/projects/${project.id}/save-all`)
      .send({
        files: [
          { path: "staging/schema.yml", content: docA },
          { path: "staging/schema.yml", content: docB },
        ],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.saved, 1, "two inputs targeting one path collapse into one written result");
    const result = res.body.results[0];
    assert.equal(result.ok, true);
    assert.equal(result.merged, true);
    assert.deepEqual(result.mergedFrom, ["staging/schema.yml", "staging/schema.yml"]);

    const onDisk = yaml.load(readFileSync(join(project.modelPath, "staging/schema.yml"), "utf-8"));
    const names = onDisk.entities.map((e) => e.name).sort();
    assert.deepEqual(names, ["customers", "orders"], "both entities persisted, neither clobbered");
  });

  test("first-seen wins on entity-name collision (preserves handwritten docs)", async () => {
    const docA = yaml.dump({
      entities: [{ name: "customers", description: "canonical — keep me", fields: [{ name: "id" }] }],
    });
    const docB = yaml.dump({
      entities: [{ name: "customers", description: "auto-generated stub", fields: [{ name: "id" }] }],
    });
    const res = await request(app)
      .post(`/api/projects/${project.id}/save-all`)
      .send({
        files: [
          { path: "marts/customers_schema.yml", content: docA },
          { path: "marts/customers_schema.yml", content: docB },
        ],
      });
    assert.equal(res.status, 200);
    const onDisk = yaml.load(readFileSync(join(project.modelPath, "marts/customers_schema.yml"), "utf-8"));
    assert.equal(onDisk.entities.length, 1, "dedup by name");
    assert.equal(onDisk.entities[0].description, "canonical — keep me");
  });

  test("single-doc path is untouched (no re-serialization)", async () => {
    const raw = "# hand-written comment should survive\nmodel:\n  name: untouched\n";
    const res = await request(app)
      .post(`/api/projects/${project.id}/save-all`)
      .send({ files: [{ path: "untouched.yml", content: raw }] });
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].merged ?? false, false);
    assert.equal(readFileSync(join(project.modelPath, "untouched.yml"), "utf-8"), raw);
  });
});
