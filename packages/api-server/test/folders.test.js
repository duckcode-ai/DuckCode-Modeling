import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "fs";
import { join } from "path";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

describe("POST /api/projects/:id/folders", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "models" });
  });
  after(() => project.cleanup());

  test("creates a nested folder (recursive mkdir)", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/folders`)
      .send({ path: "staging/core" });
    assert.equal(res.status, 200);
    assert.equal(res.body.path, "staging/core");
    assert.ok(existsSync(join(project.modelPath, "staging/core")));
  });

  test("is idempotent on pre-existing folder", async () => {
    await request(app)
      .post(`/api/projects/${project.id}/folders`)
      .send({ path: "already/there" });
    const res = await request(app)
      .post(`/api/projects/${project.id}/folders`)
      .send({ path: "already/there" });
    assert.equal(res.status, 200);
  });

  test("rejects path escape", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/folders`)
      .send({ path: "../evil" });
    assert.equal(res.status, 400);
  });

  test("rejects empty path", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/folders`)
      .send({ path: "" });
    assert.equal(res.status, 400);
  });
});

describe("PATCH /api/projects/:id/folders (rename)", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({
      modelsDir: "models",
      seed: { "staging/a.yml": "x\n", "staging/b.yml": "y\n" },
    });
  });
  after(() => project.cleanup());

  test("renames a folder and moves its contents", async () => {
    const res = await request(app)
      .patch(`/api/projects/${project.id}/folders`)
      .send({ fromPath: "staging", toPath: "raw" });
    assert.equal(res.status, 200);
    assert.ok(existsSync(join(project.modelPath, "raw/a.yml")));
    assert.ok(existsSync(join(project.modelPath, "raw/b.yml")));
    assert.ok(!existsSync(join(project.modelPath, "staging")));
  });

  test("rejects moving folder into itself", async () => {
    const res = await request(app)
      .patch(`/api/projects/${project.id}/folders`)
      .send({ fromPath: "raw", toPath: "raw/nested" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /into itself/);
  });

  test("returns 404 when source folder missing", async () => {
    const res = await request(app)
      .patch(`/api/projects/${project.id}/folders`)
      .send({ fromPath: "ghost", toPath: "whatever" });
    assert.equal(res.status, 404);
  });
});

describe("DELETE /api/projects/:id/folders", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({
      modelsDir: "models",
      seed: { "drop/a.yml": "x\n", "drop/nested/b.yml": "y\n" },
    });
  });
  after(() => project.cleanup());

  test("recursively deletes a folder and its contents", async () => {
    const res = await request(app)
      .delete(`/api/projects/${project.id}/folders`)
      .send({ path: "drop" });
    assert.equal(res.status, 200);
    assert.ok(!existsSync(join(project.modelPath, "drop")));
  });

  test("refuses to delete the project model root", async () => {
    const res = await request(app)
      .delete(`/api/projects/${project.id}/folders`)
      .send({ path: "." });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /model root/);
  });

  test("returns 404 when folder missing", async () => {
    const res = await request(app)
      .delete(`/api/projects/${project.id}/folders`)
      .send({ path: "never-existed" });
    assert.equal(res.status, 404);
  });
});
