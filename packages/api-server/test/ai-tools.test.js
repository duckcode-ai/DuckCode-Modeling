// Unit tests for the Phase 2 tool registry.
// Pure-function tools — no LLM calls, no Express. We pass a synthetic
// `project` object pointing at a test-results scratch dir.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  read_file,
  list_files,
  find_entity,
  list_columns,
  find_references,
  get_doc_block,
  apply_patch_dry_run,
  validate_naming,
  required_tests,
  listTools,
  invokeTool,
} from "../ai/tools.js";

const SCRATCH = path.resolve("./test-results/ai-tools-scratch");
const project = { path: SCRATCH, id: "tools-test" };

before(() => {
  fs.mkdirSync(path.join(SCRATCH, "models"), { recursive: true });
  fs.writeFileSync(
    path.join(SCRATCH, "models/customers.yml"),
    [
      "model:",
      "  name: customers",
      "  domain: sales",
      "  layer: physical",
      "entities:",
      "  - name: Customer",
      "    type: dimension",
      "    description: A customer of the company.",
      "    fields:",
      "      - name: customer_id",
      "        type: integer",
      "        primary_key: true",
      "        nullable: false",
      "      - name: email",
      "        type: string",
      "        nullable: false",
      "      - name: customer_status",
      "        type: string",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(SCRATCH, "models/orders.yml"),
    [
      "model:",
      "  name: orders",
      "entities:",
      "  - name: Order",
      "    fields:",
      "      - name: order_id",
      "        type: integer",
      "        primary_key: true",
      "      - name: customer_id",
      "        type: integer",
      "        foreign_key:",
      "          entity: Customer",
      "          field: customer_id",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(SCRATCH, "models/notes.md"),
    [
      "{% docs customer_overview %}",
      "Customers are the people who buy our things.",
      "{% enddocs %}",
    ].join("\n"),
  );
});

after(() => {
  try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {}
});

describe("listTools", () => {
  test("registers every tool with a description", () => {
    const tools = listTools();
    assert.ok(tools.length >= 10, `expected ≥10 tools, got ${tools.length}`);
    for (const t of tools) {
      assert.ok(t.name, "tool has a name");
      assert.ok(t.description, `tool ${t.name} has a description`);
    }
  });
});

describe("read_file", () => {
  test("returns content for an existing file", async () => {
    const r = await read_file(project, { path: "models/customers.yml" });
    assert.equal(r.ok, true);
    assert.match(r.content, /Customer/);
    assert.equal(typeof r.bytes, "number");
  });

  test("returns ok:false for missing file", async () => {
    const r = await read_file(project, { path: "models/nope.yml" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "ENOENT");
  });
});

describe("list_files", () => {
  test("globs files under the project root", async () => {
    const r = await list_files(project, { glob: "models/*.yml" });
    assert.equal(r.ok, true);
    assert.ok(r.matches.includes("models/customers.yml"));
    assert.ok(r.matches.includes("models/orders.yml"));
  });

  test("respects limit", async () => {
    const r = await list_files(project, { glob: "**/*", limit: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.matches.length, 1);
    assert.equal(r.truncated, true);
  });
});

describe("find_entity", () => {
  test("locates an entity by name across YAML files", async () => {
    const r = await find_entity(project, { name: "Customer" });
    assert.equal(r.ok, true);
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].entity, "Customer");
    assert.equal(r.matches[0].path, "models/customers.yml");
    assert.equal(r.matches[0].field_count, 3);
  });

  test("returns empty matches for unknown entity", async () => {
    const r = await find_entity(project, { name: "Spaceship" });
    assert.equal(r.ok, true);
    assert.equal(r.matches.length, 0);
  });
});

describe("list_columns", () => {
  test("returns columns of an entity", async () => {
    const r = await list_columns(project, { entity_path: "models/customers.yml", entity_name: "Customer" });
    assert.equal(r.ok, true);
    assert.equal(r.columns.length, 3);
    const pk = r.columns.find((c) => c.name === "customer_id");
    assert.equal(pk.primary_key, true);
    assert.equal(pk.nullable, false);
  });
});

describe("find_references", () => {
  test("substring-matches across files", async () => {
    const r = await find_references(project, { name: "customer_id" });
    assert.equal(r.ok, true);
    assert.ok(r.matches.length >= 2, `expected ≥2 matches, got ${r.matches.length}`);
    const filesHit = new Set(r.matches.map((m) => m.path));
    assert.ok(filesHit.has("models/customers.yml"));
    assert.ok(filesHit.has("models/orders.yml"));
  });
});

describe("get_doc_block", () => {
  test("finds a doc block by name", async () => {
    const r = await get_doc_block(project, { name: "customer_overview" });
    assert.equal(r.ok, true);
    assert.match(r.body, /Customers are the people/);
    assert.equal(r.source, "models/notes.md");
  });

  test("returns ok:false when missing", async () => {
    const r = await get_doc_block(project, { name: "nonexistent_block" });
    assert.equal(r.ok, false);
  });
});

describe("apply_patch_dry_run", () => {
  test("applies a JSON-patch and returns the resulting YAML", async () => {
    const r = await apply_patch_dry_run(project, {
      path: "models/customers.yml",
      ops: [{ op: "add", path: "/model/owner", value: "data-platform@example.com" }],
    });
    assert.equal(r.ok, true);
    assert.match(r.resulting_yaml, /owner:\s*data-platform@example\.com/);
    // Original file untouched
    const orig = fs.readFileSync(path.join(SCRATCH, "models/customers.yml"), "utf-8");
    assert.ok(!/owner:/.test(orig), "dry-run must not write to disk");
  });

  test("rejects invalid ops array", async () => {
    const r = await apply_patch_dry_run(project, { path: "models/customers.yml", ops: [] });
    assert.equal(r.ok, false);
  });

  test("rejects missing file", async () => {
    const r = await apply_patch_dry_run(project, {
      path: "models/nope.yml",
      ops: [{ op: "add", path: "/x", value: 1 }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "ENOENT");
  });
});

describe("validate_naming", () => {
  test("passes for canonical dbt prefixes", async () => {
    for (const name of ["stg_jaffle__customers", "dim_customers", "fct_orders", "int_customer_summary"]) {
      const r = await validate_naming(project, { name });
      assert.equal(r.passes, true, `${name} should pass`);
    }
  });

  test("fails with suggestions for off-convention names", async () => {
    const r = await validate_naming(project, { name: "MyCustomersTable" });
    assert.equal(r.passes, false);
    assert.ok(Array.isArray(r.suggested_patterns));
    assert.ok(r.suggested_patterns.length > 0);
  });
});

describe("required_tests", () => {
  test("PK column requires unique + not_null", async () => {
    const r = await required_tests(project, { field: { name: "customer_id", primary_key: true } });
    const tests = r.required.map((t) => t.test);
    assert.ok(tests.includes("unique"));
    assert.ok(tests.includes("not_null"));
  });

  test("FK column requires relationships test", async () => {
    const r = await required_tests(project, {
      field: { name: "customer_id", foreign_key: { entity: "Customer", field: "customer_id" } },
    });
    const rel = r.required.find((t) => t.test === "relationships");
    assert.ok(rel);
    assert.equal(rel.to, "ref('Customer')");
  });

  test("status-shaped column suggests accepted_values", async () => {
    const r = await required_tests(project, { field: { name: "status", type: "string" } });
    const av = r.required.find((t) => t.test === "accepted_values");
    assert.ok(av, "expected an accepted_values test for status-shaped column");
  });
});

describe("invokeTool", () => {
  test("dispatches by name", async () => {
    const r = await invokeTool("read_file", project, { path: "models/customers.yml" });
    assert.equal(r.ok, true);
  });

  test("throws on unknown tool", async () => {
    await assert.rejects(() => invokeTool("does_not_exist", project, {}));
  });
});
