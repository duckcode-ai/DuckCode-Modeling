// Phase 3.1 — GET /projects/:id/files is a project-open hook: calling it
// must idempotently seed `datalex/diagrams/` so the Explorer shows the
// conventional diagrams location for projects that were not created via
// dbt import.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

describe("GET /api/projects/:id/files — ensureDiagramsFolder hook", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "models" });
  });
  after(() => project.cleanup());

  test("seeds datalex/diagrams/.gitkeep on first open", async () => {
    assert.equal(existsSync(join(project.modelPath, "datalex", "diagrams")), false, "fixture starts without a diagrams folder");
    const res = await request(app).get(`/api/projects/${project.id}/files`);
    assert.equal(res.status, 200);
    assert.equal(existsSync(join(project.modelPath, "datalex", "diagrams")), true);
    assert.equal(existsSync(join(project.modelPath, "datalex", "diagrams", ".gitkeep")), true);
  });

  test("is idempotent — does not overwrite existing files in the folder", async () => {
    const userFile = join(project.modelPath, "datalex", "diagrams", "overview.diagram.yaml");
    writeFileSync(userFile, "kind: diagram\nname: overview\nentities: []\n");
    const res = await request(app).get(`/api/projects/${project.id}/files`);
    assert.equal(res.status, 200);
    const entries = readdirSync(join(project.modelPath, "datalex", "diagrams"));
    assert.ok(entries.includes("overview.diagram.yaml"), "user's diagram file is preserved");
  });
});
