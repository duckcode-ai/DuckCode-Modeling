import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

// PUT /api/files writes raw content to disk by absolute path. The
// validator guards against three failure modes users hit in practice:
//   1. YAML that doesn't parse (typo'd colon, bad indent)
//   2. A top-level list where DataLex expects an object
//   3. A model/diagram file that declares neither the canonical
//      `{model, entities}` shape nor the dbt-importer `{kind, name}` shape
// Non-YAML files skip validation entirely.
describe("PUT /api/files — save-time validation", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "models" });
  });
  after(() => project.cleanup());

  test("accepts a valid canonical model YAML", async () => {
    const filePath = join(project.modelPath, "valid.model.yaml");
    const content = `model:
  name: my_model
  version: 1.0.0
  domain: core
  owners: [dev@example.com]
  state: draft
entities:
  - name: customers
    fields:
      - name: id
        type: uuid
`;
    const res = await request(app).put("/api/files").send({ path: filePath, content });
    assert.equal(res.status, 200);
    assert.ok(existsSync(filePath));
  });

  test("accepts the dbt-importer {kind: model} shape", async () => {
    const filePath = join(project.modelPath, "stg_customers.model.yaml");
    const content = `kind: model
name: stg_customers
columns:
  - name: customer_id
    type: integer
`;
    const res = await request(app).put("/api/files").send({ path: filePath, content });
    assert.equal(res.status, 200);
  });

  test("accepts a diagram YAML", async () => {
    const filePath = join(project.modelPath, "overview.diagram.yaml");
    const content = `kind: diagram
name: overview
entities: []
`;
    const res = await request(app).put("/api/files").send({ path: filePath, content });
    assert.equal(res.status, 200);
  });

  test("rejects unparseable YAML with 422 and preserves existing file", async () => {
    const filePath = join(project.modelPath, "existing.model.yaml");
    writeFileSync(filePath, "model:\n  name: pristine\nentities: []\n", "utf-8");
    const bad = "model:\n  name: broken\n\tentities: [\n"; // mixed tab/space + unterminated
    const res = await request(app).put("/api/files").send({ path: filePath, content: bad });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "YAML_PARSE_ERROR");
    // Pristine content is still on disk — the save was rejected before writeFile.
    assert.match(readFileSync(filePath, "utf-8"), /pristine/);
  });

  test("rejects a top-level list in a .yml file", async () => {
    const filePath = join(project.modelPath, "list.yml");
    const res = await request(app)
      .put("/api/files")
      .send({ path: filePath, content: "- a\n- b\n- c\n" });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "SCHEMA_TOP_LEVEL");
  });

  test("rejects a .model.yaml with neither canonical nor importer shape", async () => {
    const filePath = join(project.modelPath, "garbage.model.yaml");
    const res = await request(app)
      .put("/api/files")
      .send({ path: filePath, content: "foo: bar\nbaz: 1\n" });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "SCHEMA_SHAPE");
  });

  test("accepts empty YAML (new file, user still typing)", async () => {
    const filePath = join(project.modelPath, "new.yml");
    const res = await request(app).put("/api/files").send({ path: filePath, content: "" });
    assert.equal(res.status, 200);
  });

  test("non-YAML files skip validation entirely", async () => {
    const filePath = join(project.modelPath, "readme.md");
    const res = await request(app)
      .put("/api/files")
      .send({ path: filePath, content: "# hi\n- a\n- b\n" });
    assert.equal(res.status, 200);
  });
});
