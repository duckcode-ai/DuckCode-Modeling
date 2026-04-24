/* Verifies the full write-relationship → adapter read-back loop for a
 * diagram YAML. When users drag between two column keys or use "Add
 * Relationship" we write via `addDiagramRelationship`, then the canvas
 * re-renders by running the YAML through `adaptDiagramYaml` again —
 * the relationship must survive the round-trip or the edge vanishes
 * from the canvas. */
import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { addDiagramRelationship } from "../src/design/yamlPatch.js";
import { adaptDiagramYaml } from "../src/design/schemaAdapter.js";

const CUSTOMERS_YAML = `kind: model
name: stg_customers
entities:
  - name: stg_customers
    fields:
      - { name: customer_id, type: integer, primary_key: true }
      - { name: name, type: string }
`;

const ORDERS_YAML = `kind: model
name: stg_orders
entities:
  - name: stg_orders
    fields:
      - { name: order_id, type: integer, primary_key: true }
      - { name: customer_id, type: integer }
`;

const DIAGRAM_EMPTY = `kind: diagram
name: test
entities:
  - { file: models/stg_customers.yml, entity: "*" }
  - { file: models/stg_orders.yml, entity: "*" }
`;

const PROJECT_FILES = [
  { fullPath: "models/stg_customers.yml", path: "models/stg_customers.yml", content: CUSTOMERS_YAML },
  { fullPath: "models/stg_orders.yml", path: "models/stg_orders.yml", content: ORDERS_YAML },
];

test("cross-file diagram relationship survives adapter round-trip", () => {
  // User drags from stg_orders.customer_id to stg_customers.customer_id.
  const next = addDiagramRelationship(DIAGRAM_EMPTY, {
    name: "stg_orders_to_stg_customers",
    from: { entity: "stg_orders", field: "customer_id" },
    to: { entity: "stg_customers", field: "customer_id" },
    cardinality: "many_to_one",
    identifying: false,
    label: "",
  });
  assert.ok(next, "addDiagramRelationship returned YAML");
  assert.notEqual(next, DIAGRAM_EMPTY, "document mutated");

  const doc = yaml.load(next);
  assert.equal(Array.isArray(doc.relationships), true);
  assert.equal(doc.relationships.length, 1);

  const adapted = adaptDiagramYaml(next, PROJECT_FILES);
  assert.ok(adapted, "adapter returned a schema");
  assert.ok(Array.isArray(adapted.relationships), "schema has relationships array");
  assert.equal(
    adapted.relationships.length,
    1,
    `expected 1 relationship to survive round-trip, got ${adapted.relationships.length}. ` +
    `Tables on canvas: ${adapted.tables.map((t) => t.id).join(", ")}. ` +
    `YAML:\n${next}`,
  );

  const r = adapted.relationships[0];
  assert.equal(r.from.table, "stg_orders");
  assert.equal(r.from.col, "customer_id");
  assert.equal(r.to.table, "stg_customers");
  assert.equal(r.to.col, "customer_id");
});

test("adding a duplicate relationship returns unchanged YAML", () => {
  const first = addDiagramRelationship(DIAGRAM_EMPTY, {
    from: { entity: "stg_orders", field: "customer_id" },
    to: { entity: "stg_customers", field: "customer_id" },
    cardinality: "many_to_one",
  });
  const second = addDiagramRelationship(first, {
    from: { entity: "stg_orders", field: "customer_id" },
    to: { entity: "stg_customers", field: "customer_id" },
    cardinality: "many_to_one",
  });
  assert.equal(first, second, "dupe add returns same text");
});

test("conceptual diagram relationship supports entity-only endpoints", () => {
  const next = addDiagramRelationship(DIAGRAM_EMPTY, {
    name: "customer_places_order",
    from: { entity: "stg_customers" },
    to: { entity: "stg_orders" },
    cardinality: "one_to_many",
    verb: "places",
    description: "Customer places orders.",
  });
  assert.ok(next, "addDiagramRelationship returned YAML");
  const doc = yaml.load(next);
  assert.equal(doc.relationships.length, 1);
  assert.deepEqual(doc.relationships[0].from, { entity: "stg_customers" });
  assert.deepEqual(doc.relationships[0].to, { entity: "stg_orders" });
  assert.equal(doc.relationships[0].verb, "places");

  const adapted = adaptDiagramYaml(next, PROJECT_FILES);
  assert.equal(adapted.relationships.length, 1);
  assert.equal(adapted.relationships[0].from.col, undefined);
  assert.equal(adapted.relationships[0].to.col, undefined);
  assert.equal(adapted.relationships[0].verb, "places");
});

test("relationship persists across a position patch (move + link should coexist)", async () => {
  const { setDiagramEntityDisplay } = await import("../src/design/yamlPatch.js");
  // Add relationship first.
  let text = addDiagramRelationship(DIAGRAM_EMPTY, {
    from: { entity: "stg_orders", field: "customer_id" },
    to: { entity: "stg_customers", field: "customer_id" },
    cardinality: "many_to_one",
  });
  assert.ok(text);
  // Then move stg_orders — this goes through the wildcard-fallback and
  // appends a concrete entity entry. Relationships must survive.
  text = setDiagramEntityDisplay(text, "models/stg_orders.yml", "stg_orders", { x: 500, y: 200 });
  assert.ok(text, "setDiagramEntityDisplay returned YAML");

  const doc = yaml.load(text);
  assert.equal(doc.relationships.length, 1, "relationship still present after move");
  assert.ok(
    doc.entities.some((e) => e.entity === "stg_orders" && e.x === 500),
    "concrete entity appended",
  );

  const adapted = adaptDiagramYaml(text, PROJECT_FILES);
  assert.equal(adapted.relationships.length, 1, "adapter still returns the relationship");
});
