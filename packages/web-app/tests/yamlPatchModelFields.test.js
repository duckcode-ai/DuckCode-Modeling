import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { appendField, deleteField, patchField, removeFieldRelationship } from "../src/design/yamlPatch.js";

function parse(text) {
  return yaml.load(text);
}

test("patchField updates top-level kind:model columns", () => {
  const src = `
kind: model
name: stg_customers
columns:
  - name: customer_id
    type: integer
`;
  const out = patchField(src, "stg_customers", "customer_id", { type: "varchar" });
  assert.ok(out, "returns patched YAML");
  const doc = parse(out);
  assert.equal(doc.columns[0].type, "varchar");
});

test("appendField adds to top-level kind:model columns", () => {
  const src = `
kind: model
name: stg_customers
columns: []
`;
  const out = appendField(src, "stg_customers", { name: "email", type: "string" });
  assert.ok(out, "returns patched YAML");
  const doc = parse(out);
  assert.equal(doc.columns.length, 1);
  assert.equal(doc.columns[0].name, "email");
});

test("deleteField removes from top-level kind:model columns", () => {
  const src = `
kind: model
name: stg_customers
columns:
  - name: customer_id
    type: integer
  - name: email
    type: string
`;
  const out = deleteField(src, "stg_customers", "email");
  assert.ok(out, "returns patched YAML");
  const doc = parse(out);
  assert.deepEqual(doc.columns.map((column) => column.name), ["customer_id"]);
});

test("removeFieldRelationship clears a DataLex foreign_key declaration", () => {
  const src = `
kind: model
name: fct_orders
columns:
  - name: customer_id
    type: integer
    foreign_key:
      entity: dim_customers
      field: customer_id
`;
  const out = removeFieldRelationship(src, "fct_orders", "customer_id", "dim_customers", "customer_id");
  assert.ok(out, "returns patched YAML");
  const doc = parse(out);
  assert.equal("foreign_key" in doc.columns[0], false);
});

test("removeFieldRelationship clears dbt relationships tests on a column", () => {
  const src = `
version: 2
models:
  - name: fct_orders
    columns:
      - name: customer_id
        data_type: integer
        tests:
          - relationships:
              to: "ref('dim_customers')"
              field: customer_id
          - not_null
`;
  const out = removeFieldRelationship(src, "fct_orders", "customer_id", "dim_customers", "customer_id");
  assert.ok(out, "returns patched YAML");
  const doc = parse(out);
  assert.equal(doc.models[0].columns[0].tests.length, 1);
  assert.equal(doc.models[0].columns[0].tests[0], "not_null");
});
