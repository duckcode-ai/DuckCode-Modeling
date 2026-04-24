import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import {
  addEntityWithOptions,
  addRelationship,
  setEntityKeySets,
  setEntityScalarProperty,
  addIndex,
  removeIndex,
  bulkAssignSubjectArea,
} from "../src/lib/yamlRoundTrip.js";

const BASE_MODEL = `model:
  name: phase2_editor
  version: 1.0.0
  domain: commerce
  owners:
    - data@example.com
  state: draft

entities:
  - name: Customer
    type: logical_entity
    fields:
      - name: customer_id
        type: string
        nullable: false
`;

test("addEntityWithOptions seeds entity types for the modeler quick-create flow", () => {
  const result = addEntityWithOptions(BASE_MODEL, {
    name: "OrderEvent",
    type: "fact_table",
    subjectArea: "Sales",
  });

  assert.equal(result.error, null);
  const doc = yaml.load(result.yaml);
  const entity = doc.entities.find((item) => item.name === "OrderEvent");
  assert.ok(entity);
  assert.equal(entity.type, "fact_table");
  assert.deepEqual(entity.grain, ["order_event_id"]);
  assert.equal(entity.subject_area, "Sales");
});

test("setEntityKeySets and setEntityScalarProperty manage logical metadata cleanly", () => {
  const withKeys = setEntityKeySets(BASE_MODEL, "Customer", "candidate_keys", "customer_id\ncustomer_code, source_system");
  assert.equal(withKeys.error, null);

  const withSubtype = setEntityScalarProperty(withKeys.yaml, "Customer", "subtype_of", "Party");
  assert.equal(withSubtype.error, null);

  const doc = yaml.load(withSubtype.yaml);
  const customer = doc.entities.find((item) => item.name === "Customer");
  assert.deepEqual(customer.candidate_keys, [["customer_id"], ["customer_code", "source_system"]]);
  assert.equal(customer.subtype_of, "Party");

  const cleared = setEntityScalarProperty(withSubtype.yaml, "Customer", "subtype_of", "");
  const clearedDoc = yaml.load(cleared.yaml);
  const clearedCustomer = clearedDoc.entities.find((item) => item.name === "Customer");
  assert.equal("subtype_of" in clearedCustomer, false);
});

test("index mutations and bulk subject-area assignment stay YAML-safe", () => {
  const withIndex = addIndex(BASE_MODEL, "customer_customer_id_idx", "Customer", "customer_id", true, "btree");
  assert.equal(withIndex.error, null);

  const withArea = bulkAssignSubjectArea(withIndex.yaml, ["Customer"], "Identity");
  assert.equal(withArea.error, null);

  const removedIndex = removeIndex(withArea.yaml, "customer_customer_id_idx");
  const doc = yaml.load(removedIndex.yaml);
  const customer = doc.entities.find((item) => item.name === "Customer");

  assert.equal(customer.subject_area, "Identity");
  assert.equal(Array.isArray(doc.indexes), true);
  assert.equal(doc.indexes.length, 0);
});

test("addRelationship round-trips conceptual entity-level endpoints", () => {
  const conceptualModel = `model:
  name: insurance_concepts
  kind: conceptual
  domain: insurance
  owners: []
  state: draft

entities:
  - name: Customer
    type: concept
  - name: Policy
    type: concept
relationships: []
`;

  const result = addRelationship(
    conceptualModel,
    "customer_holds_policy",
    { entity: "Customer" },
    { entity: "Policy" },
    "one_to_many",
  );
  assert.equal(result.error, null);
  const doc = yaml.load(result.yaml);
  assert.deepEqual(doc.relationships[0].from, { entity: "Customer" });
  assert.deepEqual(doc.relationships[0].to, { entity: "Policy" });
  assert.equal(doc.relationships[0].cardinality, "one_to_many");
});
