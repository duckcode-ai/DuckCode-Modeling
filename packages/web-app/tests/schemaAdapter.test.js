import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptDataLexYaml,
  adaptDataLexModelYaml,
  adaptDbtSchemaYaml,
  adaptDiagramYaml,
} from "../src/design/schemaAdapter.js";

test("adaptDataLexModelYaml parses the dbt-importer `kind: model` shape", () => {
  const yamlText = `
kind: model
name: stg_customers
description: Customer staging.
columns:
  - name: customer_id
    type: integer
    primary_key: true
    description: Surrogate key.
  - name: email
    type: varchar
`;
  const adapted = adaptDataLexModelYaml(yamlText);
  assert.ok(adapted, "model adapter should return a schema");
  assert.equal(adapted.tables.length, 1);
  const t = adapted.tables[0];
  assert.equal(t.id, "stg_customers");
  assert.equal(t.columns.length, 2);
  assert.equal(t.columns[0].name, "customer_id");
  assert.equal(t.columns[0].type, "integer", "type must come through, not `string` fallback");
  assert.equal(t.columns[0].pk, true);
  assert.equal(t.columns[1].type, "varchar");
});

test("adaptDataLexModelYaml falls back to data_type when type is missing", () => {
  const yamlText = `
kind: model
name: stg_orders
columns:
  - name: order_id
    data_type: bigint
`;
  const adapted = adaptDataLexModelYaml(yamlText);
  assert.equal(adapted.tables[0].columns[0].type, "bigint");
});

test("adaptDataLexModelYaml folds dbt tests into FK metadata", () => {
  const yamlText = `
kind: model
name: stg_orders
columns:
  - name: customer_id
    type: integer
    tests:
      - not_null
      - relationships:
          to: "ref('stg_customers')"
          field: customer_id
`;
  const adapted = adaptDataLexModelYaml(yamlText);
  const col = adapted.tables[0].columns[0];
  assert.equal(col.nn, true, "not_null test should mark column nn");
  assert.equal(col.fk, "stg_customers.customer_id");
});

test("adaptDataLexModelYaml returns null for non-model kinds", () => {
  const yamlText = `kind: diagram\nname: d\nentities: []\n`;
  assert.equal(adaptDataLexModelYaml(yamlText), null);
});

test("adaptDataLexYaml normalizes legacy foreign_key shapes into c.fk", () => {
  const yamlText = `
entities:
  - name: orders
    fields:
      - name: id
        type: uuid
        primary_key: true
      - name: customer_id
        type: uuid
        foreign_key:
          entity: customers
          field: id
      - name: legacy_col_ref
        type: uuid
        foreign_key:
          entity: customers
          column: id
      - name: legacy_sqldbm
        type: uuid
        foreign_key:
          table: customers
          column: id
      - name: as_string
        type: uuid
        foreign_key: "customers.id"
`;
  const adapted = adaptDataLexYaml(yamlText);
  const cols = adapted.tables[0].columns;
  assert.equal(cols[1].fk, "customers.id", "canonical {entity, field}");
  assert.equal(cols[2].fk, "customers.id", "legacy {entity, column}");
  assert.equal(cols[3].fk, "customers.id", "SQLDBM {table, column}");
  assert.equal(cols[4].fk, "customers.id", "bare string");
});

test("adaptDataLexYaml handles the canonical entities:[] shape", () => {
  const yamlText = `
entities:
  - name: customers
    fields:
      - { name: id, type: uuid, primary_key: true }
`;
  const adapted = adaptDataLexYaml(yamlText);
  assert.equal(adapted.tables[0].columns[0].type, "uuid");
});

test("adaptDiagramYaml composes entities from kind:model files via the new adapter", () => {
  const diagramYaml = `
kind: diagram
name: customer_360
entities:
  - file: models/staging/stg_customers.yml
    entity: stg_customers
    x: 100
    y: 100
`;
  const modelYaml = `
kind: model
name: stg_customers
columns:
  - name: customer_id
    type: integer
`;
  const projectFiles = [
    { fullPath: "models/staging/stg_customers.yml", content: modelYaml },
  ];
  const adapted = adaptDiagramYaml(diagramYaml, projectFiles);
  assert.ok(adapted, "diagram adapter must return a schema when model adapter matches");
  assert.equal(adapted.tables.length, 1);
  assert.equal(adapted.tables[0].columns[0].type, "integer");
  assert.equal(adapted.tables[0].x, 100);
  assert.equal(adapted.tables[0].y, 100);
});

test("adaptDbtSchemaYaml still handles version: 2 schema.yml shape", () => {
  const yamlText = `
version: 2
models:
  - name: orders
    columns:
      - name: order_id
        data_type: bigint
`;
  const adapted = adaptDbtSchemaYaml(yamlText);
  assert.equal(adapted.tables[0].columns[0].type, "bigint");
});
