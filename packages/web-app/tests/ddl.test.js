import test from "node:test";
import assert from "node:assert/strict";
import { generateEntityDDL, generateSchemaDDL } from "../src/lib/ddl.js";

test("generateEntityDDL uses object-shaped relationship endpoints for FK actions", () => {
  const sql = generateEntityDDL({
    name: "order_items",
    schema: "analytics",
    fields: [
      { name: "order_id", type: "bigint", foreign_key: { entity: "fct_orders", field: "order_id", on_delete: "cascade" } },
    ],
  }, {
    relationships: [
      {
        from: { entity: "order_items", field: "order_id" },
        to: { entity: "fct_orders", field: "order_id" },
        on_delete: "cascade",
      },
    ],
  });

  assert.match(sql, /REFERENCES fct_orders\(order_id\) ON DELETE CASCADE;/);
});

test("generateSchemaDDL composes a multi-entity script for diagram schemas", () => {
  const sql = generateSchemaDDL({
    name: "Customer 360",
    schema: "analytics",
    tables: [
      {
        id: "models/marts/fct_orders.yml::fct_orders",
        name: "fct_orders",
        schema: "analytics",
        type: "table",
        columns: [{ name: "order_id", type: "bigint", pk: true }],
      },
      {
        id: "models/marts/order_items.yml::order_items",
        name: "order_items",
        schema: "analytics",
        type: "table",
        columns: [{ name: "order_id", type: "bigint", fk: "fct_orders.order_id" }],
      },
    ],
    relationships: [
      {
        from: { table: "models/marts/order_items.yml::order_items", col: "order_id" },
        to: { table: "models/marts/fct_orders.yml::fct_orders", col: "order_id" },
        cardinality: "many_to_one",
        onDelete: "CASCADE",
      },
    ],
    indexes: [],
  });

  assert.match(sql, /-- Customer 360/);
  assert.match(sql, /CREATE TABLE analytics\.fct_orders \(/);
  assert.match(sql, /CREATE TABLE analytics\.order_items \(/);
  assert.match(sql, /ALTER TABLE analytics\.order_items/);
  assert.match(sql, /REFERENCES fct_orders\(order_id\) ON DELETE CASCADE;/);
});

test("generateSchemaDDL emits FK alters for diagram-authored relationships without field fk metadata", () => {
  const sql = generateSchemaDDL({
    name: "Order Flow",
    schema: "analytics",
    tables: [
      {
        id: "models/marts/fct_orders.yml::fct_orders",
        name: "fct_orders",
        schema: "analytics",
        type: "table",
        columns: [{ name: "order_id", type: "bigint", pk: true }],
      },
      {
        id: "models/marts/order_items.yml::order_items",
        name: "order_items",
        schema: "analytics",
        type: "table",
        columns: [{ name: "order_id", type: "bigint" }],
      },
    ],
    relationships: [
      {
        from: { table: "models/marts/order_items.yml::order_items", col: "order_id" },
        to: { table: "models/marts/fct_orders.yml::fct_orders", col: "order_id" },
        cardinality: "many_to_one",
        onDelete: "CASCADE",
      },
    ],
    indexes: [],
  });

  assert.match(sql, /ALTER TABLE analytics\.order_items/);
  assert.match(sql, /ADD FOREIGN KEY \(order_id\) REFERENCES fct_orders\(order_id\) ON DELETE CASCADE;/);
});
