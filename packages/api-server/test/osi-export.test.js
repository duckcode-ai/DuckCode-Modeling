import test from "node:test";
import assert from "node:assert/strict";
import { exportOsiBundle, validateOsiBundle, OSI_SPEC_VERSION } from "../ai/osi/osi-export.js";

const SALES_CONCEPTUAL = `kind: diagram
name: sales_flow
layer: conceptual
description: Customer to revenue flow.
entities:
  - name: Customer
    type: concept
    domain: sales
    owner: CRM
    description: A buyer of goods.
    terms: [customer_id, email]
    visibility: shared
  - name: Order
    type: concept
    domain: sales
    description: Header for one purchase.
    fields:
      - name: order_id
        primary_key: true
      - name: customer_id
relationships:
  - name: customer_places_order
    from: { entity: Customer, field: customer_id }
    to: { entity: Order, field: customer_id }
    cardinality: one_to_many
    verb: places
`;

const INTERNAL_ONLY = `kind: diagram
name: internal_concept
entities:
  - name: SecretConcept
    type: concept
    visibility: internal
    description: Should NOT appear in OSI bundle.
relationships:
  - name: secret_to_anything
    from: SecretConcept
    to: SecretConcept
    visibility: internal
`;

test("exportOsiBundle produces a valid OSI 0.1.1 bundle from a conceptual file", () => {
  const bundle = exportOsiBundle({
    projectName: "test-project",
    yamlDocs: [{ path: "sales/Conceptual/sales_flow.diagram.yaml", content: SALES_CONCEPTUAL }],
  });
  assert.equal(bundle.version, OSI_SPEC_VERSION);
  assert.equal(bundle.semantic_model.length, 1);
  const sm = bundle.semantic_model[0];
  assert.equal(sm.name, "sales_flow");
  assert.equal(sm.datasets.length, 2);
  assert.deepEqual(
    sm.datasets.map((d) => d.name).sort(),
    ["Customer", "Order"]
  );
  // OSI requires every dataset to have a `source`. Conceptual entities
  // without an explicit warehouse source get a synthetic placeholder.
  assert.ok(sm.datasets[0].source.startsWith("datalex:"));
  // Customer's terms should land in ai_context.synonyms.
  const customer = sm.datasets.find((d) => d.name === "Customer");
  assert.ok(customer.ai_context, "customer should have ai_context");
  assert.deepEqual(customer.ai_context.synonyms, ["customer_id", "email"]);
  // Order's primary key was inferred from the field marked primary_key.
  const order = sm.datasets.find((d) => d.name === "Order");
  assert.deepEqual(order.primary_key, ["order_id"]);
  // Relationship picked up the verb as ai_context.instructions.
  assert.equal(sm.relationships.length, 1);
  const rel = sm.relationships[0];
  assert.equal(rel.from, "Customer");
  assert.equal(rel.to, "Order");
  assert.match(rel.ai_context.instructions, /places/);
});

test("validateOsiBundle returns no issues for a well-formed export", () => {
  const bundle = exportOsiBundle({
    projectName: "test-project",
    yamlDocs: [{ path: "sales.yml", content: SALES_CONCEPTUAL }],
  });
  const issues = validateOsiBundle(bundle);
  assert.deepEqual(issues, [], `expected no validation issues, got: ${JSON.stringify(issues, null, 2)}`);
});

test("visibility: internal entities are skipped from the export", () => {
  const bundle = exportOsiBundle({
    projectName: "test-project",
    yamlDocs: [{ path: "secret.yml", content: INTERNAL_ONLY }],
  });
  // The single doc had only internal entities, so it should produce
  // zero semantic models — nothing makes it past the visibility gate.
  assert.equal(bundle.semantic_model.length, 0);
});

test("visibility: internal relationships are skipped even when entities are visible", () => {
  const yaml = `kind: diagram
entities:
  - name: A
    visibility: shared
  - name: B
    visibility: shared
relationships:
  - name: a_to_b_internal
    from: A
    to: B
    verb: links
    visibility: internal
  - name: a_to_b_shared
    from: A
    to: B
    verb: depends_on
    visibility: shared
`;
  const bundle = exportOsiBundle({
    projectName: "vis-test",
    yamlDocs: [{ path: "vis.yml", content: yaml }],
  });
  const sm = bundle.semantic_model[0];
  assert.equal(sm.relationships.length, 1, "only the shared relationship should be exported");
  assert.equal(sm.relationships[0].name, "a_to_b_shared");
});

test("validateOsiBundle catches missing required fields", () => {
  const broken = {
    version: "0.1.1",
    semantic_model: [
      {
        // missing name
        datasets: [
          { /* missing name + source */ },
        ],
      },
    ],
  };
  const issues = validateOsiBundle(broken);
  assert.ok(issues.some((i) => i.path.endsWith("/name") && i.message === "name is required"));
  assert.ok(issues.some((i) => i.path.endsWith("/source") && i.message === "dataset source is required"));
});

test("malformed YAML in one doc does not break the bundle", () => {
  const docs = [
    { path: "good.yml", content: SALES_CONCEPTUAL },
    { path: "broken.yml", content: ":\n - not yaml: [\n" },
  ];
  const bundle = exportOsiBundle({ projectName: "mixed", yamlDocs: docs });
  // The good doc must still produce its semantic model.
  assert.equal(bundle.semantic_model.length, 1);
  assert.equal(bundle.semantic_model[0].name, "sales_flow");
});

test("custom_extensions carries DataLex provenance", () => {
  const bundle = exportOsiBundle({
    projectName: "jaffle",
    yamlDocs: [{ path: "x.yml", content: SALES_CONCEPTUAL }],
  });
  const ext = bundle.semantic_model[0].custom_extensions[0];
  assert.equal(ext.vendor_name, "COMMON");
  const data = JSON.parse(ext.data);
  assert.equal(data.datalex_project, "jaffle");
});
