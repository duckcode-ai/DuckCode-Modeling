// Pins the structured error envelope shape + the set of allowed error codes.
// Changes here are a breaking API change for the frontend — treat accordingly.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

const ALLOWED_CODES = new Set([
  "VALIDATION",
  "NOT_FOUND",
  "CONFLICT",
  "PATH_ESCAPE",
  "PARSE_FAILED",
  "SUBPROCESS_FAILED",
  "INTERNAL",
]);

function assertEnvelope(body) {
  assert.ok(body, "response body exists");
  assert.ok(body.error, "body.error exists");
  assert.equal(typeof body.error, "object", "body.error is an object, not a string");
  assert.equal(typeof body.error.code, "string", "error.code is a string");
  assert.equal(typeof body.error.message, "string", "error.message is a string");
  assert.ok(ALLOWED_CODES.has(body.error.code), `unknown code: ${body.error.code}`);
  assert.ok(body.error.message.length > 0, "error.message is non-empty");
  if ("details" in body.error) {
    assert.notEqual(body.error.details, undefined);
  }
}

describe("error envelope shape", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "models" });
  });
  after(() => project.cleanup());

  test("VALIDATION error from POST /folders with empty path", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/folders`)
      .send({ path: "" });
    assert.equal(res.status, 400);
    assertEnvelope(res.body);
    assert.equal(res.body.error.code, "VALIDATION");
  });

  test("PATH_ESCAPE error from POST /folders with ../", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/folders`)
      .send({ path: "../somewhere" });
    assert.equal(res.status, 400);
    assertEnvelope(res.body);
    assert.equal(res.body.error.code, "PATH_ESCAPE");
  });

  test("NOT_FOUND error for unknown project", async () => {
    const res = await request(app)
      .post("/api/projects/proj_does_not_exist/folders")
      .send({ path: "anything" });
    assert.equal(res.status, 404);
    assertEnvelope(res.body);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  test("CONFLICT error on duplicate file create", async () => {
    await request(app)
      .post(`/api/projects/${project.id}/files`)
      .send({ name: "conflict-target.yml", content: "" });
    const res = await request(app)
      .post(`/api/projects/${project.id}/files`)
      .send({ name: "conflict-target.yml", content: "" });
    assert.equal(res.status, 409);
    assertEnvelope(res.body);
    assert.equal(res.body.error.code, "CONFLICT");
  });
});
