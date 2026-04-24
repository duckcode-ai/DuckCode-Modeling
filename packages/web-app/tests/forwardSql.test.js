import test from "node:test";
import assert from "node:assert/strict";
import { buildForwardSqlForActiveFile, forwardSqlStem } from "../src/lib/forwardSql.js";

test("buildForwardSqlForActiveFile composes diagram SQL with relationship DDL", () => {
  const result = buildForwardSqlForActiveFile({
    activeFile: { name: "customer_360.diagram.yaml", fullPath: "diagrams/customer_360.diagram.yaml" },
    activeFileContent: [
      "kind: diagram",
      "name: customer_360",
      "title: Customer 360",
      "entities:",
      "  - file: models/marts/fct_orders.yml",
      "    entity: fct_orders",
      "  - file: models/marts/order_items.yml",
      "    entity: order_items",
      "relationships:",
      "  - name: order_items_to_fct_orders",
      "    from:",
      "      entity: order_items",
      "      field: order_id",
      "    to:",
      "      entity: fct_orders",
      "      field: order_id",
      "    cardinality: many_to_one",
      "    on_delete: cascade",
    ].join("\n"),
    projectFiles: [
      {
        path: "models/marts/fct_orders.yml",
        fullPath: "models/marts/fct_orders.yml",
        content: [
          "kind: model",
          "name: fct_orders",
          "columns:",
          "  - name: order_id",
          "    type: bigint",
          "    primary_key: true",
        ].join("\n"),
      },
      {
        path: "models/marts/order_items.yml",
        fullPath: "models/marts/order_items.yml",
        content: [
          "kind: model",
          "name: order_items",
          "columns:",
          "  - name: order_id",
          "    type: bigint",
        ].join("\n"),
      },
    ],
    fileContentCache: {},
  });

  assert.equal(result.isDiagram, true);
  assert.match(result.sql, /CREATE TABLE fct_orders\.fct_orders \(/);
  assert.match(result.sql, /CREATE TABLE order_items\.order_items \(/);
  assert.match(result.sql, /ALTER TABLE order_items\.order_items/);
  assert.match(result.sql, /REFERENCES fct_orders\(order_id\) ON DELETE CASCADE;/);
});

test("forwardSqlStem strips diagram and model yaml suffixes", () => {
  assert.equal(forwardSqlStem("DataLex/diagrams/customer_360.diagram.yaml"), "customer_360");
  assert.equal(forwardSqlStem("DataLex/domains/orders/fct_orders.model.yml"), "fct_orders");
});
