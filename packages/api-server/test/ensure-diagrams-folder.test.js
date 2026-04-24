// Phase 3.1 — GET /projects/:id/files is a project-open hook: calling it
// must idempotently seed the domain-first DataLex folders so the Explorer
// shows the conventional modeling locations for projects not created via
// dbt import.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

describe("GET /api/projects/:id/files — ensureWorkspaceFolders hook", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "models" });
  });
  after(() => project.cleanup());

  test("seeds domain-first DataLex modeling folders on first open", async () => {
    assert.equal(existsSync(join(project.modelPath, "core", "Conceptual")), false, "fixture starts without a conceptual folder");
    const res = await request(app).get(`/api/projects/${project.id}/files`);
    assert.equal(res.status, 200);
    assert.equal(existsSync(join(project.modelPath, "core", "Conceptual")), true);
    assert.equal(existsSync(join(project.modelPath, "core", "Logical")), true);
    assert.equal(existsSync(join(project.modelPath, "core", "Physical", "postgres")), true);
    assert.equal(existsSync(join(project.modelPath, "core", "Generated", "dbt")), true);
    assert.equal(existsSync(join(project.modelPath, "core", "Conceptual", ".gitkeep")), true);
  });

  test("is idempotent — does not overwrite existing files in the folder", async () => {
    const userFile = join(project.modelPath, "core", "Conceptual", "overview.diagram.yaml");
    writeFileSync(userFile, "kind: diagram\nname: overview\nentities: []\n");
    const res = await request(app).get(`/api/projects/${project.id}/files`);
    assert.equal(res.status, 200);
    const entries = readdirSync(join(project.modelPath, "core", "Conceptual"));
    assert.ok(entries.includes("overview.diagram.yaml"), "user's diagram file is preserved");
  });
});
