/* Regression tests for `deleteEntityDeep` — the cascade-aware entity
 * delete helper. Shell.jsx / ViewsView / the Inspector all route through
 * it now, and the contract is:
 *   • remove the entity row
 *   • strip every relationship referencing it (both the string-form
 *     `from: "entity.field"` and the diagram-level `{from:{entity,field}}`
 *     object form)
 *   • strip indexes[] / metrics[] whose `entity:` points at the target
 *   • purge governance.classification / governance.stewards keys
 *     prefixed `<target>.<field>`
 *   • return `{yaml, impact}` with counts so the UI can surface "also
 *     removed 3 relationships, 1 index" in the toast
 *   • return `null` when the entity doesn't exist (so the caller can
 *     show a real error rather than silently save a no-op).
 * The legacy `deleteEntity` export is kept as a thin wrapper — tested
 * here to protect callers that haven't migrated yet. */
import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { deleteEntity, deleteEntityDeep } from "../src/design/yamlPatch.js";

const FULL_MODEL = `kind: model
name: sales
entities:
  - name: customer
    fields:
      - { name: id, type: uuid, primary_key: true }
      - { name: email, type: string }
  - name: order
    fields:
      - { name: id, type: uuid, primary_key: true }
      - { name: customer_id, type: uuid }
relationships:
  - name: order_customer
    from: order.customer_id
    to: customer.id
    cardinality: many_to_one
  - name: unrelated
    from: order.id
    to: order.id
indexes:
  - { name: ix_customer_email, entity: customer, fields: [email] }
  - { name: ix_order_id, entity: order, fields: [id] }
metrics:
  - { name: customer_count, entity: customer, expression: "count(*)" }
  - { name: order_total, entity: order, expression: "sum(1)" }
governance:
  classification:
    customer.email: pii
    customer.id: internal
    order.id: internal
  stewards:
    customer.email: alice
    order.id: bob
`;

test("deleteEntityDeep removes entity and cascades through all referencing blocks", () => {
  const result = deleteEntityDeep(FULL_MODEL, "customer");
  assert.ok(result, "returned a result");
  const doc = yaml.load(result.yaml);

  // entity gone
  assert.equal(doc.entities.length, 1);
  assert.equal(doc.entities[0].name, "order");

  // relationships referencing customer gone, unrelated kept
  assert.equal(doc.relationships.length, 1);
  assert.equal(doc.relationships[0].name, "unrelated");

  // index on customer gone
  assert.equal(doc.indexes.length, 1);
  assert.equal(doc.indexes[0].entity, "order");

  // metric on customer gone
  assert.equal(doc.metrics.length, 1);
  assert.equal(doc.metrics[0].entity, "order");

  // governance keys with `customer.` prefix removed, `order.` kept
  assert.deepEqual(Object.keys(doc.governance.classification).sort(), ["order.id"]);
  assert.deepEqual(Object.keys(doc.governance.stewards).sort(), ["order.id"]);

  // impact counts match what we removed
  assert.deepEqual(result.impact, {
    entity: true,
    relationships: 1,
    indexes: 1,
    metrics: 1,
    governance: 3, // 2 classification + 1 stewards
  });
});

test("deleteEntityDeep is case-insensitive on entity name", () => {
  const result = deleteEntityDeep(FULL_MODEL, "CUSTOMER");
  assert.ok(result);
  assert.equal(result.impact.entity, true);
  const doc = yaml.load(result.yaml);
  assert.equal(doc.entities.length, 1);
});

test("deleteEntityDeep returns null when entity not found", () => {
  const result = deleteEntityDeep(FULL_MODEL, "does_not_exist");
  assert.equal(result, null, "missing entity → null (caller surfaces error)");
});

test("deleteEntityDeep returns null on invalid YAML", () => {
  assert.equal(deleteEntityDeep("::: not yaml :::", "customer"), null);
});

test("deleteEntityDeep handles diagram-level relationships (object form)", () => {
  const DIAGRAM_WITH_REL = `kind: diagram
name: test
entities:
  - { name: customer, fields: [{name: id, type: uuid, primary_key: true}] }
  - { name: order, fields: [{name: id, type: uuid}, {name: customer_id, type: uuid}] }
relationships:
  - name: order_customer
    from: { entity: order, field: customer_id }
    to: { entity: customer, field: id }
    cardinality: many_to_one
`;
  const result = deleteEntityDeep(DIAGRAM_WITH_REL, "customer");
  assert.ok(result);
  const doc = yaml.load(result.yaml);
  assert.equal(doc.entities.length, 1);
  assert.equal(doc.relationships?.length || 0, 0,
    "object-form relationship pointing at customer was purged");
  assert.equal(result.impact.relationships, 1);
});

test("deleteEntityDeep leaves minimal docs without optional blocks unchanged in shape", () => {
  const MINIMAL = `kind: model
name: tiny
entities:
  - { name: a, fields: [{name: id, type: uuid, primary_key: true}] }
  - { name: b, fields: [{name: id, type: uuid, primary_key: true}] }
`;
  const result = deleteEntityDeep(MINIMAL, "a");
  assert.ok(result);
  const doc = yaml.load(result.yaml);
  assert.equal(doc.entities.length, 1);
  assert.equal(doc.entities[0].name, "b");
  assert.deepEqual(result.impact, {
    entity: true,
    relationships: 0,
    indexes: 0,
    metrics: 0,
    governance: 0,
  });
});

test("legacy deleteEntity wrapper returns YAML string (backward-compat)", () => {
  const out = deleteEntity(FULL_MODEL, "customer");
  assert.equal(typeof out, "string", "wrapper returns a string, not {yaml,impact}");
  const doc = yaml.load(out);
  assert.equal(doc.entities.length, 1);
  assert.equal(doc.relationships.length, 1);
});

test("legacy deleteEntity returns null when entity not found (signals no-op)", () => {
  assert.equal(deleteEntity(FULL_MODEL, "ghost"), null);
});
