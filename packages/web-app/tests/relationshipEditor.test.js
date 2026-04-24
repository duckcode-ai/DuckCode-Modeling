import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { buildRelationshipEditorPayload } from "../src/design/relationshipEditor.js";
import { patchRelationship } from "../src/design/yamlPatch.js";
import { adaptDiagramYaml } from "../src/design/schemaAdapter.js";

test("relationship editor writes canonical entity names instead of canvas node ids", () => {
  const diagramYaml = `
kind: diagram
name: sales_logical
layer: logical
entities:
  - name: Customer
    type: logical_entity
    fields:
      - { name: customer_key, type: number, primary_key: true }
  - name: Sales Order
    type: logical_entity
    fields:
      - { name: order_key, type: number, primary_key: true }
relationships:
  - name: customer_to_sales_order
    from: { entity: Customer }
    to: { entity: Sales Order }
    cardinality: one_to_many
`;

  const adapted = adaptDiagramYaml(diagramYaml, []);
  const rel = adapted.relationships[0];
  const payload = buildRelationshipEditorPayload(rel, adapted.tables, "logical");

  assert.equal(payload.modelKind, "logical");
  assert.equal(payload.conceptualLevel, false);
  assert.equal(payload.fromEntity, "Customer");
  assert.equal(payload.toEntity, "Sales Order");
  assert.ok(!payload.fromEntity.startsWith("diagram::"));
  assert.ok(!payload.toEntity.startsWith("diagram::"));

  const patched = patchRelationship(diagramYaml, rel.name, {
    from: { entity: payload.fromEntity },
    to: { entity: payload.toEntity },
    cardinality: "many_to_many",
    _match: {
      from: { entity: payload.fromEntity },
      to: { entity: payload.toEntity },
    },
  });
  assert.ok(patched);
  const doc = yaml.load(patched);
  assert.equal(doc.relationships[0].from.entity, "Customer");
  assert.equal(doc.relationships[0].to.entity, "Sales Order");
  assert.equal(doc.relationships[0].cardinality, "many_to_many");

  const readBack = adaptDiagramYaml(patched, []);
  assert.equal(readBack.relationships.length, 1, "edited relationship remains visible after read-back");
});
