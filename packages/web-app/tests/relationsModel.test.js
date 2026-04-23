import test from "node:test";
import assert from "node:assert/strict";

import { getTableRelationships } from "../src/design/inspector/relationsModel.js";

test("getTableRelationships returns relationships touching the selected table id", () => {
  const table = { id: "models/marts/fct_orders.yml::fct_orders", name: "fct_orders" };
  const relationships = [
    {
      id: "rel-1",
      from: { table: "models/marts/fct_orders.yml::fct_orders", col: "customer_id" },
      to: { table: "models/marts/dim_customers.yml::dim_customers", col: "customer_id" },
    },
    {
      id: "rel-2",
      from: { table: "models/marts/dim_customers.yml::dim_customers", col: "customer_id" },
      to: { table: "models/marts/fct_orders.yml::fct_orders", col: "customer_id" },
    },
    {
      id: "rel-3",
      from: { table: "models/marts/order_items.yml::order_items", col: "order_id" },
      to: { table: "models/marts/fct_orders.yml::fct_orders", col: "order_id" },
    },
    {
      id: "rel-4",
      from: { table: "models/marts/order_items.yml::order_items", col: "order_id" },
      to: { table: "models/marts/dim_products.yml::dim_products", col: "product_id" },
    },
  ];

  const mine = getTableRelationships(table, relationships);

  assert.deepEqual(
    mine.map((rel) => rel.id),
    ["rel-1", "rel-2", "rel-3"]
  );
});
