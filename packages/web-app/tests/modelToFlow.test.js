import test from "node:test";
import assert from "node:assert/strict";
import { modelToFlow } from "../src/modelToFlow.js";

function edgeByName(edges, name) {
  return edges.find((e) => e.data?.name === name);
}

test("modelToFlow annotates edge semantics for PK/FK, self relationships, and shared targets", () => {
  const doc = {
    model: {
      name: "semantic_edges",
      version: "1.0.0",
      domain: "test",
      owners: ["data-team@example.com"],
      state: "draft",
    },
    entities: [
      {
        name: "Parent",
        type: "table",
        fields: [
          { name: "id", type: "integer", primary_key: true, nullable: false },
        ],
      },
      {
        name: "Child",
        type: "table",
        fields: [
          { name: "id", type: "integer", primary_key: true, nullable: false },
          { name: "parent_id", type: "integer", foreign_key: true, nullable: false },
        ],
      },
      {
        name: "Sibling",
        type: "table",
        fields: [
          { name: "id", type: "integer", primary_key: true, nullable: false },
          { name: "parent_id", type: "integer", foreign_key: true, nullable: false },
        ],
      },
    ],
    relationships: [
      { name: "pk_to_fk", from: "Parent.id", to: "Child.parent_id", cardinality: "one_to_many" },
      { name: "fk_to_pk", from: "Child.parent_id", to: "Parent.id", cardinality: "many_to_one" },
      { name: "self_hierarchy", from: "Child.id", to: "Child.parent_id", cardinality: "many_to_one" },
      { name: "shared_parent_key", from: "Sibling.parent_id", to: "Parent.id", cardinality: "many_to_one" },
    ],
  };

  const graph = modelToFlow(doc);
  assert.equal(graph.warnings.length, 0);
  assert.equal(graph.edges.length, 4);

  const pkToFk = edgeByName(graph.edges, "pk_to_fk");
  assert.equal(pkToFk.data.pkToFk, true);
  assert.equal(pkToFk.data.fkToPk, false);
  assert.equal(pkToFk.data.cardinalityLabel, "1:N");

  const fkToPk = edgeByName(graph.edges, "fk_to_pk");
  assert.equal(fkToPk.data.fkToPk, true);
  assert.equal(fkToPk.data.pkToFk, false);

  const self = edgeByName(graph.edges, "self_hierarchy");
  assert.equal(self.data.isSelf, true);
  assert.equal(self.data.fromField, "id");
  assert.equal(self.data.toField, "parent_id");

  // Two relationships target Parent.id -> shared target should be detected.
  assert.equal(fkToPk.data.sharedTarget, true);
  assert.equal(fkToPk.data.sharedTargetCount, 2);
  const shared = edgeByName(graph.edges, "shared_parent_key");
  assert.equal(shared.data.sharedTarget, true);
  assert.equal(shared.data.sharedTargetCount, 2);
});

test("modelToFlow skips invalid relationships and reports warnings", () => {
  const doc = {
    model: {
      name: "invalid_rel",
      version: "1.0.0",
      domain: "test",
      owners: ["data-team@example.com"],
      state: "draft",
    },
    entities: [
      {
        name: "Orders",
        type: "table",
        fields: [
          { name: "order_id", type: "integer", primary_key: true, nullable: false },
        ],
      },
      {
        name: "Customers",
        type: "table",
        fields: [
          { name: "customer_id", type: "integer", primary_key: true, nullable: false },
        ],
      },
    ],
    relationships: [
      { name: "missing_field", from: "Orders.customer_id", to: "Customers.customer_id", cardinality: "many_to_one" },
      { name: "bad_ref_format", from: "Orders", to: "Customers.customer_id", cardinality: "many_to_one" },
    ],
  };

  const graph = modelToFlow(doc);
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.warnings.length, 2);
  assert.match(graph.warnings[0], /missing fields/i);
  assert.match(graph.warnings[1], /invalid field references/i);
});

test("modelToFlow normalizes non-scalar metadata values for safe rendering", () => {
  const doc = {
    model: {
      name: "render_safe",
      version: "1.0.0",
      domain: "test",
      owners: ["data-team@example.com"],
      state: "draft",
    },
    governance: {
      classification: {
        "Orders.customer_id": { level: "confidential" },
      },
    },
    entities: [
      {
        name: "Orders",
        type: { kind: "table" },
        description: { summary: "orders entity" },
        tags: [{ pii: true }, "gold", 101],
        subject_area: { domain: "sales" },
        schema: { raw: "analytics" },
        fields: [
          { name: "id", type: { dbt_type: "number" }, primary_key: true, nullable: false },
          { name: "customer_id", type: "integer", foreign_key: true, nullable: false },
        ],
      },
      {
        name: "Customers",
        type: "table",
        fields: [
          { name: "id", type: "integer", primary_key: true, nullable: false },
        ],
      },
    ],
    relationships: [
      {
        name: { rel: "orders_customer_fk" },
        from: "Customers.id",
        to: "Orders.customer_id",
        cardinality: "one_to_many",
        description: { note: "object description" },
      },
    ],
  };

  const graph = modelToFlow(doc);
  assert.equal(graph.warnings.length, 0);
  assert.equal(graph.edges.length, 1);

  const orders = graph.nodes.find((n) => n.id === "Orders");
  assert.ok(orders);
  assert.equal(typeof orders.data.description, "string");
  assert.equal(Array.isArray(orders.data.tags), true);
  assert.equal(orders.data.tags.every((t) => typeof t === "string"), true);
  assert.equal(typeof orders.data.fields[0].type, "string");
  assert.equal(typeof orders.data.classifications["Orders.customer_id"], "string");

  const edge = graph.edges[0];
  assert.equal(typeof edge.data.name, "string");
  assert.equal(typeof edge.data.description, "string");
});

test("modelToFlow carries phase 2 modeling metadata onto diagram nodes", () => {
  const doc = {
    model: {
      name: "phase2_metadata",
      version: "1.0.0",
      domain: "test",
      owners: ["data-team@example.com"],
      state: "draft",
    },
    entities: [
      {
        name: "Customer",
        type: "logical_entity",
        candidate_keys: [["customer_id"], ["customer_code", "source_system"]],
        subtype_of: "Party",
        subtypes: ["VipCustomer"],
        derived_from: "CustomerConcept",
        mapped_from: "crm.customer",
        templates: ["audit_columns"],
        partition_by: ["ingested_on"],
        cluster_by: ["customer_id"],
        distribution: "hash(customer_id)",
        storage: "iceberg",
        fields: [
          { name: "customer_id", type: "string", nullable: false },
          { name: "customer_code", type: "string", nullable: false },
        ],
      },
    ],
  };

  const graph = modelToFlow(doc);
  assert.equal(graph.warnings.length, 0);
  assert.equal(graph.nodes.length, 1);

  const customer = graph.nodes[0];
  assert.deepEqual(customer.data.candidate_keys, [["customer_id"], ["customer_code", "source_system"]]);
  assert.equal(customer.data.subtype_of, "Party");
  assert.deepEqual(customer.data.subtypes, ["VipCustomer"]);
  assert.equal(customer.data.derived_from, "CustomerConcept");
  assert.equal(customer.data.mapped_from, "crm.customer");
  assert.deepEqual(customer.data.templates, ["audit_columns"]);
  assert.deepEqual(customer.data.partition_by, ["ingested_on"]);
  assert.deepEqual(customer.data.cluster_by, ["customer_id"]);
  assert.equal(customer.data.distribution, "hash(customer_id)");
  assert.equal(customer.data.storage, "iceberg");
});
