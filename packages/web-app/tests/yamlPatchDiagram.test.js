/* yamlPatchDiagram — regression tests for the diagram-entry patcher.
 *
 * Covers the wildcard-fallback path added in v0.5.1: drag-and-drop
 * onto a diagram writes `{file, entity: "*"}` entries, and users then
 * drag individual entities around the canvas. Without the fallback the
 * move was a silent no-op because `setDiagramEntityDisplay` couldn't
 * find a concrete `(file, entity)` row to patch. */
import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { setDiagramEntityDisplay, addDiagramEntries, deleteDiagramEntity, patchRelationship, addDiagramRelationship, normalizeDiagramYaml } from "../src/design/yamlPatch.js";
import { adaptDiagramYaml } from "../src/design/schemaAdapter.js";

function parse(text) { return yaml.load(text); }

test("setDiagramEntityDisplay patches an explicit entry in place", () => {
  const src = yaml.dump({
    kind: "diagram",
    entities: [
      { file: "models/customers.yml", entity: "customer", x: 100, y: 200 },
    ],
  });
  const out = setDiagramEntityDisplay(src, "models/customers.yml", "customer", { x: 555, y: 777 });
  assert.ok(out, "returns patched YAML");
  const doc = parse(out);
  assert.equal(doc.entities.length, 1);
  assert.equal(doc.entities[0].x, 555);
  assert.equal(doc.entities[0].y, 777);
  assert.equal(doc.entities[0].entity, "customer");
});

test("setDiagramEntityDisplay falls back to wildcard and appends a concrete override", () => {
  // Drag-drop onto canvas creates wildcard entries. Moving a single
  // entity must persist — append a concrete entry alongside the
  // wildcard so the adapter's last-wins dedupe picks up the override.
  const src = yaml.dump({
    kind: "diagram",
    entities: [
      { file: "models/customers.yml", entity: "*" },
    ],
  });
  const out = setDiagramEntityDisplay(src, "models/customers.yml", "customer", { x: 300, y: 400 });
  assert.ok(out, "returns patched YAML even without a concrete entry");
  const doc = parse(out);
  assert.equal(doc.entities.length, 2, "appends a concrete entry next to the wildcard");
  assert.equal(doc.entities[0].entity, "*", "wildcard survives");
  assert.equal(doc.entities[1].entity, "customer");
  assert.equal(doc.entities[1].x, 300);
  assert.equal(doc.entities[1].y, 400);
});

test("setDiagramEntityDisplay moving the same entity twice mutates the appended row, not the wildcard", () => {
  let src = yaml.dump({
    kind: "diagram",
    entities: [{ file: "models/orders.yml", entity: "*" }],
  });
  src = setDiagramEntityDisplay(src, "models/orders.yml", "orders", { x: 10, y: 20 });
  src = setDiagramEntityDisplay(src, "models/orders.yml", "orders", { x: 99, y: 88 });
  const doc = parse(src);
  assert.equal(doc.entities.length, 2);
  const concrete = doc.entities.filter((e) => e.entity === "orders");
  assert.equal(concrete.length, 1, "doesn't append duplicates");
  assert.equal(concrete[0].x, 99);
  assert.equal(concrete[0].y, 88);
});

test("setDiagramEntityDisplay returns null when neither concrete nor wildcard matches", () => {
  const src = yaml.dump({
    kind: "diagram",
    entities: [{ file: "models/customers.yml", entity: "customer" }],
  });
  const out = setDiagramEntityDisplay(src, "models/different.yml", "customer", { x: 1, y: 2 });
  assert.equal(out, null);
});

test("setDiagramEntityDisplay treats empty/omitted entity as wildcard", () => {
  // Older diagrams may have an entry with entity omitted. Treat as
  // wildcard for backward compat.
  const src = yaml.dump({
    kind: "diagram",
    entities: [{ file: "models/customers.yml" }],
  });
  const out = setDiagramEntityDisplay(src, "models/customers.yml", "customer", { x: 42, y: 42 });
  assert.ok(out);
  const doc = parse(out);
  const concrete = doc.entities.find((e) => e.entity === "customer");
  assert.ok(concrete);
  assert.equal(concrete.x, 42);
});

test("addDiagramEntries is idempotent by (file, entity) pair", () => {
  let src = yaml.dump({ kind: "diagram", entities: [] });
  src = addDiagramEntries(src, [{ file: "a.yml", entity: "*" }]);
  src = addDiagramEntries(src, [{ file: "a.yml", entity: "*" }]);
  const doc = parse(src);
  assert.equal(doc.entities.length, 1);
});

test("deleteDiagramEntity removes a concrete diagram reference and cleans diagram relationships", () => {
  const src = yaml.dump({
    kind: "diagram",
    entities: [
      { file: "models/stg_customers.yml", entity: "stg_customers" },
      { file: "models/fct_orders.yml", entity: "fct_orders" },
    ],
    relationships: [
      {
        name: "stg_customers_to_fct_orders",
        from: { entity: "stg_customers", field: "customer_id" },
        to: { entity: "fct_orders", field: "customer_id" },
      },
    ],
  });
  const out = deleteDiagramEntity(src, "models/stg_customers.yml", "stg_customers");
  assert.ok(out, "returns patched YAML");
  const doc = parse(out.yaml);
  assert.equal(doc.entities.length, 1);
  assert.equal(doc.entities[0].entity, "fct_orders");
  assert.equal(doc.relationships.length, 0);
  assert.equal(out.impact.relationships, 1);
});

test("deleteDiagramEntity expands wildcard references so one entity can be removed", () => {
  const src = yaml.dump({
    kind: "diagram",
    entities: [
      { file: "models/staging/schema.yml", entity: "*", x: 120, y: 240 },
    ],
  });
  const referenced = `
version: 2
models:
  - name: stg_customers
  - name: stg_orders
`;
  const out = deleteDiagramEntity(src, "models/staging/schema.yml", "stg_customers", referenced);
  assert.ok(out, "returns patched YAML");
  const doc = parse(out.yaml);
  assert.equal(doc.entities.length, 1);
  assert.equal(doc.entities[0].entity, "stg_orders");
});

test("patchRelationship updates diagram relationship object endpoints and cardinality", () => {
  const src = yaml.dump({
    kind: "diagram",
    relationships: [
      {
        name: "orders_to_customers",
        from: { entity: "orders", field: "customer_id" },
        to: { entity: "customers", field: "customer_id" },
        cardinality: "many_to_one",
      },
    ],
  });
  const out = patchRelationship(src, "orders_to_customers", {
    from: "orders.customer_key",
    to: "customers.id",
    cardinality: "one_to_one",
  });
  assert.ok(out, "returns patched YAML");
  const doc = parse(out);
  assert.deepEqual(doc.relationships[0].from, { entity: "orders", field: "customer_key" });
  assert.deepEqual(doc.relationships[0].to, { entity: "customers", field: "id" });
  assert.equal(doc.relationships[0].cardinality, "one_to_one");
});

test("patchRelationship preserves conceptual relationship semantics", () => {
  const src = yaml.dump({
    kind: "diagram",
    relationships: [
      {
        name: "customer_holds_policy",
        from: { entity: "Customer" },
        to: { entity: "Policy" },
        cardinality: "one_to_many",
        verb: "holds",
      },
    ],
  });
  const out = patchRelationship(src, "customer_holds_policy", {
    relationship_type: "ownership",
    rationale: "Customer owns the active policy relationship.",
    source_of_truth: "policy_admin",
  });
  const doc = parse(out);
  assert.equal(doc.relationships[0].relationship_type, "ownership");
  assert.equal(doc.relationships[0].rationale, "Customer owns the active policy relationship.");
  assert.equal(doc.relationships[0].source_of_truth, "policy_admin");
});

test("patchRelationship cardinality change round-trips into diagram crow-foot endpoints", () => {
  const src = yaml.dump({
    kind: "diagram",
    name: "customer_360",
    entities: [
      { file: "models/orders.yml", entity: "orders" },
      { file: "models/customers.yml", entity: "customers" },
    ],
    relationships: [
      {
        name: "orders_to_customers",
        from: { entity: "orders", field: "customer_id" },
        to: { entity: "customers", field: "id" },
        cardinality: "many_to_one",
      },
    ],
  });
  const patched = patchRelationship(src, "orders_to_customers", {
    cardinality: "one_to_many",
  });
  assert.ok(patched, "returns patched YAML");
  const adapted = adaptDiagramYaml(patched, [
    {
      fullPath: "models/orders.yml",
      content: "kind: model\nname: orders\ncolumns:\n  - name: customer_id\n    type: bigint\n",
    },
    {
      fullPath: "models/customers.yml",
      content: "kind: model\nname: customers\ncolumns:\n  - name: id\n    type: bigint\n",
    },
  ]);
  assert.ok(adapted);
  const rel = adapted.relationships.find((entry) => entry.name === "orders_to_customers");
  assert.ok(rel);
  assert.equal(rel.cardinality, "one_to_many");
  assert.equal(rel.from.max, "1");
  assert.equal(rel.to.max, "N");
});

test("patchRelationship collapses duplicate diagram relationships and keeps edited cardinality", () => {
  const src = yaml.dump({
    kind: "diagram",
    relationships: [
      {
        name: "fct_orders_to_order_item",
        from: "fct_orders.order_id",
        to: "order_item.order_id",
        cardinality: "many_to_one",
      },
      {
        name: "fct_orders_to_order_item",
        from: { entity: "fct_orders", field: "order_id" },
        to: { entity: "order_item", field: "order_id" },
        cardinality: "many_to_many",
      },
    ],
  });
  const out = patchRelationship(src, "fct_orders_to_order_item", {
    cardinality: "one_to_one",
    _match: {
      from: "fct_orders.order_id",
      to: "order_item.order_id",
    },
  });
  assert.ok(out, "returns patched YAML");
  const doc = parse(out);
  assert.equal(doc.relationships.length, 1, "removes stale duplicates");
  assert.deepEqual(doc.relationships[0].from, { entity: "fct_orders", field: "order_id" });
  assert.deepEqual(doc.relationships[0].to, { entity: "order_item", field: "order_id" });
  assert.equal(doc.relationships[0].cardinality, "one_to_one");
});

test("addDiagramRelationship dedupes legacy string-form relationships", () => {
  const src = yaml.dump({
    kind: "diagram",
    relationships: [
      {
        name: "fct_orders_to_order_item",
        from: "fct_orders.order_id",
        to: "order_item.order_id",
        cardinality: "many_to_one",
      },
    ],
  });
  const out = addDiagramRelationship(src, {
    name: "fct_orders_to_order_item",
    from: { entity: "fct_orders", field: "order_id" },
    to: { entity: "order_item", field: "order_id" },
    cardinality: "one_to_one",
  });
  assert.equal(out, src, "legacy duplicate is treated as a no-op");
});

test("normalizeDiagramYaml collapses duplicate relationships and canonicalizes endpoints", () => {
  const src = yaml.dump({
    kind: "diagram",
    relationships: [
      {
        name: "orders_to_customers",
        from: "orders.customer_id",
        to: "customers.id",
        cardinality: "one_to_many",
      },
      {
        name: "orders_to_customers",
        from: { entity: "orders", field: "customer_id" },
        to: { entity: "customers", field: "id" },
        cardinality: "many_to_one",
        on_delete: "cascade",
      },
    ],
  });
  const out = normalizeDiagramYaml(src);
  assert.ok(out, "returns normalized YAML");
  const doc = parse(out);
  assert.equal(doc.relationships.length, 1);
  assert.deepEqual(doc.relationships[0].from, { entity: "orders", field: "customer_id" });
  assert.deepEqual(doc.relationships[0].to, { entity: "customers", field: "id" });
  assert.equal(doc.relationships[0].cardinality, "many_to_one");
  assert.equal(doc.relationships[0].on_delete, "CASCADE");
});
