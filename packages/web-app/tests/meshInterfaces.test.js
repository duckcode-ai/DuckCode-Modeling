import test from "node:test";
import assert from "node:assert/strict";
import { lintMeshInterfaces } from "../src/lib/dbtLint.js";
import { modelToFlow } from "../src/modelToFlow.js";

test("lintMeshInterfaces reports missing interface readiness metadata", () => {
  const findings = lintMeshInterfaces({
    version: 2,
    models: [
      {
        name: "dim_customers",
        meta: {
          datalex: {
            interface: {
              enabled: true,
              status: "active",
              stability: "shared",
            },
          },
        },
        columns: [{ name: "customer_id", tests: ["unique"] }],
      },
    ],
  });
  const codes = new Set(findings.map((f) => f.code));
  assert.equal(codes.has("MESH_INTERFACE_MISSING_OWNER"), true);
  assert.equal(codes.has("MESH_INTERFACE_MISSING_UNIQUE_KEY"), true);
});

test("lintMeshInterfaces accepts complete dbt interface metadata", () => {
  const findings = lintMeshInterfaces({
    version: 2,
    models: [
      {
        name: "fct_orders",
        description: "Shared order facts.",
        config: { materialized: "table", contract: { enforced: true } },
        meta: {
          datalex: {
            interface: {
              enabled: true,
              owner: "analytics",
              domain: "commerce",
              status: "active",
              version: "v1",
              description: "Shared order facts contract.",
              unique_key: "order_id",
              freshness: { warn_after: { count: 1, period: "day" } },
              stability: "shared",
            },
          },
        },
        columns: [
          { name: "order_id", description: "Stable order id.", tests: ["unique", "not_null"] },
          {
            name: "customer_id",
            description: "Customer id.",
            tests: [{ relationships: { to: "ref('dim_customers')", field: "customer_id" } }],
          },
        ],
      },
    ],
  });
  assert.deepEqual(findings, []);
});

test("modelToFlow carries interface metadata to node data", () => {
  const graph = modelToFlow({
    entities: [
      {
        name: "dim_customers",
        interface: { enabled: true, status: "active", stability: "shared" },
        fields: [{ name: "customer_id", type: "integer" }],
      },
    ],
  });
  assert.equal(graph.nodes[0].data.interface.status, "active");
});
