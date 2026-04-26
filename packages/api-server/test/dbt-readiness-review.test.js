import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

describe("dbt readiness review", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({
      modelsDir: "DataLex",
      seed: {
        "models/marts/fct_orders.yml": [
          "version: 2",
          "models:",
          "  - name: fct_orders",
          "    columns:",
          "      - name: order_id",
          "        data_type: unknown",
          "        primary_key: true",
          "      - name: customer_id",
          "        data_type: integer",
          "",
        ].join("\n"),
        "models/marts/dim_customers.yml": [
          "version: 2",
          "models:",
          "  - name: dim_customers",
          "    description: Customer dimension.",
          "    owner: analytics",
          "    domain: sales",
          "    columns:",
          "      - name: customer_id",
          "        description: Customer identifier.",
          "        data_type: integer",
          "        primary_key: true",
          "        tests:",
          "          - unique",
          "          - not_null",
          "",
        ].join("\n"),
        "models/bad.yml": "version: 2\nmodels: [\n  - name: broken\n",
      },
    });
  });

  after(() => project.cleanup());

  test("scores YAML files with red, yellow, and green readiness states", async () => {
    const res = await request(app)
      .post("/api/dbt/review")
      .send({ projectId: project.id });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.runId);
    assert.equal(res.body.summary.total_files, 3);
    assert.ok(res.body.summary.red >= 1);
    assert.ok(res.body.summary.green >= 1);

    const fact = res.body.files.find((file) => file.path === "models/marts/fct_orders.yml");
    assert.ok(fact);
    assert.notEqual(fact.status, "green");
    assert.ok(fact.findings.some((finding) => finding.code === "DBT_READINESS_MISSING_MODEL_DESCRIPTION"));
    assert.ok(fact.findings.some((finding) => finding.code === "DBT_READINESS_UNKNOWN_COLUMN_TYPE"));
    assert.ok(fact.remediation_candidates.length > 0);

    const broken = res.body.files.find((file) => file.path === "models/bad.yml");
    assert.equal(broken.status, "red");
    assert.ok(broken.findings.some((finding) => finding.code === "DBT_READINESS_YAML_PARSE_ERROR"));

    const dim = res.body.files.find((file) => file.path === "models/marts/dim_customers.yml");
    assert.equal(dim.status, "green");
  });

  test("returns the latest cached readiness review", async () => {
    const res = await request(app)
      .get("/api/dbt/review")
      .query({ projectId: project.id });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.runId);
    assert.equal(res.body.summary.total_files, 3);
    assert.ok(res.body.byPath["models/marts/fct_orders.yml"]);
  });

  test("reruns a single file without discarding the cached project review", async () => {
    const res = await request(app)
      .post("/api/dbt/review")
      .send({ projectId: project.id, scope: "file", paths: ["models/marts/fct_orders.yml"] });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.summary.total_files, 3);
    assert.ok(res.body.files.some((file) => file.path === "models/bad.yml"));
    assert.ok(res.body.files.some((file) => file.path === "models/marts/fct_orders.yml"));
  });
});
