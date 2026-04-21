import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

describe("POST /api/projects/:id/files", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "models" });
  });
  after(() => project.cleanup());

  test("creates a file under modelPath", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/files`)
      .send({ name: "stg_customers.yml", content: "model:\n  name: stg_customers\n" });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "stg_customers.yml");
    assert.ok(existsSync(join(project.modelPath, "stg_customers.yml")));
  });

  test("rejects names that escape modelPath", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/files`)
      .send({ name: "../outside.yml", content: "" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "PATH_ESCAPE");
    assert.match(res.body.error.message, /inside project model path/);
  });

  test("returns 409 on collision", async () => {
    await request(app)
      .post(`/api/projects/${project.id}/files`)
      .send({ name: "dupe.yml", content: "" });
    const res = await request(app)
      .post(`/api/projects/${project.id}/files`)
      .send({ name: "dupe.yml", content: "" });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "CONFLICT");
  });

  test("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/files`)
      .send({ content: "x" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VALIDATION");
  });

  test("returns 404 for unknown project", async () => {
    const res = await request(app)
      .post("/api/projects/proj_does_not_exist/files")
      .send({ name: "x.yml", content: "" });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });
});

describe("PATCH /api/projects/:id/files (rename)", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({
      modelsDir: "models",
      seed: { "orig.yml": "hi\n", "other.yml": "there\n" },
    });
  });
  after(() => project.cleanup());

  test("renames a file in place", async () => {
    const res = await request(app)
      .patch(`/api/projects/${project.id}/files`)
      .send({ fromPath: "orig.yml", toPath: "renamed.yml" });
    assert.equal(res.status, 200);
    assert.ok(existsSync(join(project.modelPath, "renamed.yml")));
    assert.ok(!existsSync(join(project.modelPath, "orig.yml")));
  });

  test("returns 404 when source missing", async () => {
    const res = await request(app)
      .patch(`/api/projects/${project.id}/files`)
      .send({ fromPath: "nope.yml", toPath: "also-nope.yml" });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  test("returns 409 when destination exists", async () => {
    const res = await request(app)
      .patch(`/api/projects/${project.id}/files`)
      .send({ fromPath: "renamed.yml", toPath: "other.yml" });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "CONFLICT");
  });

  test("rejects destination outside modelPath", async () => {
    const res = await request(app)
      .patch(`/api/projects/${project.id}/files`)
      .send({ fromPath: "renamed.yml", toPath: "../escape.yml" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "PATH_ESCAPE");
  });
});

describe("DELETE /api/projects/:id/files", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({
      modelsDir: "models",
      seed: { "deleteme.yml": "bye\n" },
    });
  });
  after(() => project.cleanup());

  test("deletes a file", async () => {
    const res = await request(app)
      .delete(`/api/projects/${project.id}/files`)
      .send({ path: "deleteme.yml" });
    assert.equal(res.status, 200);
    assert.ok(!existsSync(join(project.modelPath, "deleteme.yml")));
  });

  test("returns 404 when file missing", async () => {
    const res = await request(app)
      .delete(`/api/projects/${project.id}/files`)
      .send({ path: "ghost.yml" });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  test("rejects path escape", async () => {
    const res = await request(app)
      .delete(`/api/projects/${project.id}/files`)
      .send({ path: "../../secret.yml" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "PATH_ESCAPE");
  });
});

describe("POST /api/projects/:id/save-all", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "models" });
  });
  after(() => project.cleanup());

  test("writes all files and returns per-file status", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/save-all`)
      .send({
        files: [
          { path: "a.yml", content: "alpha\n" },
          { path: "nested/b.yml", content: "beta\n" },
        ],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.saved, 2);
    assert.equal(res.body.total, 2);
    assert.equal(readFileSync(join(project.modelPath, "a.yml"), "utf-8"), "alpha\n");
    assert.equal(readFileSync(join(project.modelPath, "nested/b.yml"), "utf-8"), "beta\n");
  });

  test("reports partial failure without aborting the batch", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/save-all`)
      .send({
        files: [
          { path: "good.yml", content: "ok\n" },
          { path: "../escape.yml", content: "bad\n" },
          { path: "also-good.yml", content: "fine\n" },
        ],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.saved, 2);
    assert.equal(res.body.total, 3);
    const failed = res.body.results.find((r) => !r.ok);
    assert.equal(failed.code, "PATH_ESCAPE");
    assert.match(failed.error, /inside project model path/);
  });

  test("rejects non-string content per file", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/save-all`)
      .send({
        files: [
          { path: "weird.yml", content: { not: "a string" } },
        ],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.saved, 0);
    assert.equal(res.body.results[0].code, "VALIDATION");
    assert.match(res.body.results[0].error, /content must be a string/);
  });

  test("returns 400 when files array empty or missing", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/save-all`)
      .send({ files: [] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VALIDATION");
  });
});
