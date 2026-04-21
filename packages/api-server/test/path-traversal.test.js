// Adversarial tests for resolveInsideModelPath + POST /files name check.
// The *invariant* under test is "no escape happened" — we don't pin the exact
// status code because POST /files and the resolveInsideModelPath-using
// endpoints use slightly different name handling. What matters is that a
// bystander file outside the project is never read, written, or removed.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import request from "supertest";
import { getApp, createProject, repoRoot } from "./helpers/harness.js";

describe("path traversal guardrails", () => {
  let app;
  let project;
  let bystanderPath;
  let bystanderMtime;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "models" });
    bystanderPath = join(repoRoot(), "SECRET-do-not-touch.txt");
    writeFileSync(bystanderPath, "classified\n", "utf-8");
    bystanderMtime = statSync(bystanderPath).mtimeMs;
  });
  after(() => project.cleanup());

  function assertBystanderIntact() {
    assert.ok(existsSync(bystanderPath), "bystander file still exists");
    assert.equal(readFileSync(bystanderPath, "utf-8"), "classified\n");
    assert.equal(statSync(bystanderPath).mtimeMs, bystanderMtime, "bystander mtime unchanged");
  }

  const escapeAttempts = [
    "../SECRET-do-not-touch.txt",
    "../../SECRET-do-not-touch.txt",
    "./../SECRET-do-not-touch.txt",
    "foo/../../SECRET-do-not-touch.txt",
  ];

  for (const attempt of escapeAttempts) {
    test(`POST /files blocks escape: ${JSON.stringify(attempt)}`, async () => {
      const res = await request(app)
        .post(`/api/projects/${project.id}/files`)
        .send({ name: attempt, content: "OVERWRITE" });
      assert.ok(res.status >= 400, `expected error status, got ${res.status}`);
      assert.equal(res.body.error.code, "PATH_ESCAPE");
      assertBystanderIntact();
    });

    test(`DELETE /files blocks escape: ${JSON.stringify(attempt)}`, async () => {
      const res = await request(app)
        .delete(`/api/projects/${project.id}/files`)
        .send({ path: attempt });
      // PATH_ESCAPE (rejected upfront) or NOT_FOUND (resolved inside modelPath,
      // no such file) are both acceptable — what matters is the bystander
      // survives.
      assert.ok(res.status >= 400, `expected error status, got ${res.status}`);
      assert.ok(["PATH_ESCAPE", "NOT_FOUND"].includes(res.body.error.code));
      assertBystanderIntact();
    });

    test(`save-all blocks escape: ${JSON.stringify(attempt)}`, async () => {
      const res = await request(app)
        .post(`/api/projects/${project.id}/save-all`)
        .send({ files: [{ path: attempt, content: "OVERWRITE" }] });
      assert.equal(res.status, 200);
      const ok = res.body.results.every(
        (r) => !(r.ok && r.path && r.path.includes("SECRET")),
      );
      assert.ok(ok, "no result pointed at the bystander");
      const failed = res.body.results.find((r) => !r.ok);
      assert.equal(failed.code, "PATH_ESCAPE");
      assertBystanderIntact();
    });
  }

  test("absolute-path names don't escape modelPath via POST /files", async () => {
    // resolve(modelPath, "/etc/passwd") → "/etc/passwd" so the isPathInside
    // check must reject this.
    const res = await request(app)
      .post(`/api/projects/${project.id}/files`)
      .send({ name: "/etc/passwd", content: "x" });
    assert.ok(res.status >= 400);
    assert.equal(res.body.error.code, "PATH_ESCAPE");
    // Of course we didn't actually write to /etc/passwd — check bystander.
    assertBystanderIntact();
  });

  test("backslash-separated paths don't escape modelPath", async () => {
    const res = await request(app)
      .post(`/api/projects/${project.id}/folders`)
      .send({ path: "staging\\core" });
    // Accept either: (a) 200 with backslash treated as literal filename
    // char, or (b) 400. Either way, must not create anything outside.
    assertBystanderIntact();
    if (res.status === 200) {
      assert.ok(!existsSync(join(repoRoot(), "staging")));
    } else {
      assert.ok(res.status >= 400);
    }
  });
});
