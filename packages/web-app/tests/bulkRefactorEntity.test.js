import test from "node:test";
import assert from "node:assert/strict";
import { rewriteEntityRefs } from "../src/lib/bulkRefactor.js";

test("rewriteEntityRefs renames declaration + FK + relationship refs (string and object)", () => {
  const doc = {
    entities: [
      {
        name: "customers",
        fields: [
          { name: "customer_id", type: "int" },
          { name: "preferred", type: "bool", foreign_key: { entity: "customers", field: "customer_id" } },
        ],
      },
      {
        name: "orders",
        fields: [
          { name: "order_id", type: "int" },
          { name: "customer_id", type: "int", foreign_key: { entity: "customers", field: "customer_id" } },
          { name: "alt_customer_id", type: "int", references: { table: "customers", column: "customer_id" } },
          { name: "bare_customer_id", type: "int", fk: "customers.customer_id" },
        ],
      },
    ],
    relationships: [
      { name: "orders_customer_str", from: "orders.customer_id", to: "customers.customer_id" },
      { name: "orders_customer_obj", from: { entity: "orders", field: "customer_id" }, to: { entity: "customers", field: "customer_id" } },
    ],
    indexes: [
      { name: "ix_customers_pk", entity: "customers", fields: ["customer_id"] },
    ],
    metrics: [
      { name: "customer_count", entity: "customers", expression: "count(1)" },
    ],
    governance: {
      classification: { "customers.customer_id": "PII" },
      stewards: { "customers.customer_id": "data-team@example.com" },
    },
  };
  const refs = rewriteEntityRefs(doc, "customers", "customer");
  assert.ok(refs.length > 0);
  assert.equal(doc.entities[0].name, "customer");
  // Self-referential FK on the renamed entity
  assert.equal(doc.entities[0].fields[1].foreign_key.entity, "customer");
  // FK refs in sibling entity
  assert.equal(doc.entities[1].fields[1].foreign_key.entity, "customer");
  assert.equal(doc.entities[1].fields[2].references.table, "customer");
  // Bare-string FK
  assert.equal(doc.entities[1].fields[3].fk, "customer.customer_id");
  // Relationship string-form
  assert.equal(doc.relationships[0].to, "customer.customer_id");
  // Relationship object-form
  assert.equal(doc.relationships[1].to.entity, "customer");
  // Indexes and metrics
  assert.equal(doc.indexes[0].entity, "customer");
  assert.equal(doc.metrics[0].entity, "customer");
  // Governance maps rekeyed
  assert.equal(doc.governance.classification["customer.customer_id"], "PII");
  assert.equal(doc.governance.classification["customers.customer_id"], undefined);
});

test("rewriteEntityRefs is case-insensitive on match but preserves new casing", () => {
  const doc = {
    entities: [{ name: "Customers", fields: [{ name: "id" }] }],
    relationships: [{ name: "r", from: "Customers.id", to: "Orders.customer_id" }],
  };
  const refs = rewriteEntityRefs(doc, "customers", "Customer");
  assert.ok(refs.length >= 1);
  assert.equal(doc.entities[0].name, "Customer");
  assert.equal(doc.relationships[0].from, "Customer.id");
});

test("rewriteEntityRefs walks diagram entries[].entity when kind=diagram", () => {
  const doc = {
    kind: "diagram",
    entities: [
      { entity: "customers", file: "models/customers.model.yaml" },
      { entity: "orders",    file: "models/orders.model.yaml" },
    ],
  };
  rewriteEntityRefs(doc, "customers", "customer");
  assert.equal(doc.entities[0].entity, "customer");
  assert.equal(doc.entities[1].entity, "orders");
});

test("rewriteEntityRefs is a no-op when old and new names are equal or blank", () => {
  const doc = { entities: [{ name: "customers" }] };
  assert.deepEqual(rewriteEntityRefs(doc, "customers", "customers"), []);
  assert.deepEqual(rewriteEntityRefs(doc, "", "customer"), []);
  assert.deepEqual(rewriteEntityRefs(doc, "customers", ""), []);
  assert.equal(doc.entities[0].name, "customers");
});

test("rewriteEntityRefs updates entity-level scalar refs (subtype_of, derived_from, …)", () => {
  const doc = {
    entities: [
      { name: "sales_order", subtype_of: "orders" },
      { name: "shipment", derived_from: "orders" },
      { name: "orders", subtypes: ["sales_order"] },
    ],
  };
  rewriteEntityRefs(doc, "orders", "order");
  assert.equal(doc.entities[0].subtype_of, "order");
  assert.equal(doc.entities[1].derived_from, "order");
  assert.equal(doc.entities[2].name, "order");
});
