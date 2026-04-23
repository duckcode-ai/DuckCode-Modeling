import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConceptualAreas,
  conceptualRelationshipLabel,
  findConceptImplementations,
} from "../src/lib/conceptualModeling.js";

test("buildConceptualAreas groups concepts by domain", () => {
  const areas = buildConceptualAreas([
    { name: "Customer", domain: "Customer", cat: "users", x: 100, y: 120, width: 240, modelKind: "conceptual" },
    { name: "Order", domain: "Customer", cat: "users", x: 420, y: 160, width: 240, modelKind: "conceptual" },
    { name: "Claim", domain: "Claims", cat: "audit", x: 820, y: 240, width: 240, modelKind: "conceptual" },
  ]);

  assert.equal(areas.length, 2);
  const customer = areas.find((area) => area.label === "Customer");
  const claims = areas.find((area) => area.label === "Claims");
  assert.ok(customer);
  assert.ok(claims);
  assert.equal(customer.count, 2);
  assert.equal(claims.count, 1);
  assert.ok(customer.w > 400);
});

test("conceptualRelationshipLabel prefers verb, then relationship type", () => {
  assert.equal(conceptualRelationshipLabel({ verb: "places", relationshipType: "ownership" }), "places");
  assert.equal(conceptualRelationshipLabel({ relationshipType: "source_of_truth" }), "source of truth");
});

test("findConceptImplementations discovers logical and physical descendants", () => {
  const projectFiles = [
    {
      path: "DataLex/models/logical/customer/customer_logical.model.yaml",
      fullPath: "DataLex/models/logical/customer/customer_logical.model.yaml",
      content: `
model:
  name: customer_model
  kind: logical
entities:
  - name: CustomerEntity
    derived_from: Customer
    mapped_from: Customer
`,
    },
    {
      path: "DataLex/models/physical/postgres/customer/customer_physical.model.yaml",
      fullPath: "DataLex/models/physical/postgres/customer/customer_physical.model.yaml",
      content: `
model:
  name: customer_model
  kind: physical
entities:
  - name: dim_customer
    derived_from: Customer
`,
    },
  ];

  const implementations = findConceptImplementations({
    projectFiles,
    conceptName: "Customer",
  });

  assert.equal(implementations.length, 2);
  assert.equal(implementations[0].layer, "logical");
  assert.equal(implementations[1].layer, "physical");
});
