import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptDataLexYaml,
  adaptDataLexModelYaml,
  adaptDbtSchemaYaml,
  adaptDiagramYaml,
  schemaToPanelModel,
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

test("adaptDataLexModelYaml preserves top-level relationships from kind:model files", () => {
  const yamlText = `
kind: model
name: order_items
columns:
  - name: order_id
    type: bigint
    foreign_key:
      entity: fct_orders
      field: order_id
relationships:
  - name: order_items_to_fct_orders
    from: order_items.order_id
    to: fct_orders.order_id
    cardinality: one_to_one
`;
  const adapted = adaptDataLexModelYaml(yamlText);
  assert.ok(adapted);
  assert.equal(adapted.relationships.length, 1);
  assert.equal(adapted.relationships[0].name, "order_items_to_fct_orders");
  assert.equal(adapted.relationships[0].cardinality, "one_to_one");
  assert.equal(adapted.relationships[0].from.max, "1");
  assert.equal(adapted.relationships[0].to.max, "1");
});

test("adaptDataLexModelYaml returns null for non-model kinds", () => {
  const yamlText = `kind: diagram\nname: d\nentities: []\n`;
  assert.equal(adaptDataLexModelYaml(yamlText), null);
});

test("adaptDataLexModelYaml renders canonical conceptual entity without columns", () => {
  const yamlText = `
kind: entity
layer: conceptual
name: customer
logical_name: Customer
description: A buyer or account.
domain: sales
`;
  const adapted = adaptDataLexModelYaml(yamlText);
  assert.ok(adapted);
  assert.equal(adapted.tables.length, 1);
  assert.equal(adapted.tables[0].id, "customer");
  assert.equal(adapted.tables[0].type, "concept");
  assert.equal(adapted.tables[0].columns.length, 0);
  assert.equal(adapted.tables[0].subject_area, "sales");
});

test("adaptDataLexModelYaml maps canonical columns references into FK edges", () => {
  const yamlText = `
kind: entity
layer: physical
dialect: postgres
name: orders
columns:
  - name: id
    type: bigint
    primary_key: true
  - name: customer_id
    type: bigint
    references:
      entity: customers
      column: id
`;
  const adapted = adaptDataLexModelYaml(yamlText);
  const col = adapted.tables[0].columns.find((c) => c.name === "customer_id");
  assert.equal(col.fk, "customers.id");
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
  - name: orders
    fields:
      - { name: id, type: uuid, primary_key: true }
      - { name: customer_id, type: uuid }
relationships:
  - name: orders_to_customers
    from: orders.customer_id
    to: customers.id
    cardinality: many_to_one
`;
  const adapted = adaptDataLexYaml(yamlText);
  assert.equal(adapted.tables[0].columns[0].type, "uuid");
  assert.equal(adapted.relationships[0].cardinality, "many_to_one");
  assert.equal(adapted.relationships[0].from.max, "N");
  assert.equal(adapted.relationships[0].to.max, "1");
});

test("adaptDataLexYaml preserves conceptual entity-level relationships", () => {
  const yamlText = `
model:
  name: customer_concepts
  kind: conceptual
entities:
  - name: Customer
    type: concept
  - name: Order
    type: concept
relationships:
  - name: customer_places_order
    from:
      entity: Customer
    to:
      entity: Order
    cardinality: one_to_many
    verb: places
`;
  const adapted = adaptDataLexYaml(yamlText);
  assert.equal(adapted.relationships.length, 1);
  assert.equal(adapted.relationships[0].from.table, "customer");
  assert.equal(adapted.relationships[0].from.col, undefined);
  assert.equal(adapted.relationships[0].to.table, "order");
  assert.equal(adapted.relationships[0].to.col, undefined);
  assert.equal(adapted.relationships[0].verb, "places");
  assert.equal(adapted.relationships[0].from.max, "1");
  assert.equal(adapted.relationships[0].to.max, "N");
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

test("adaptDiagramYaml renders diagram-first conceptual entities without model files", () => {
  const diagramYaml = `
kind: diagram
name: sales_concepts
layer: conceptual
domain: sales
entities:
  - name: Customer
    type: concept
    description: Registered customers
    owner: Revenue Ops
    x: 100
    y: 120
  - name: Sales Order
    type: concept
    description: Parts sold to a customer
    x: 420
    y: 120
relationships:
  - name: customer_places_order
    from: { entity: Customer }
    to: { entity: Sales Order }
    cardinality: one_to_many
    verb: places
`;
  const adapted = adaptDiagramYaml(diagramYaml, []);
  assert.ok(adapted);
  assert.equal(adapted.modelKind, "conceptual");
  assert.equal(adapted.domain, "sales");
  assert.equal(adapted.tables.length, 2);
  assert.equal(adapted.tables[0].columns.length, 0);
  assert.equal(adapted.relationships[0].verb, "places");
  assert.equal(adapted.relationships[0]._conceptualLevel, true);
});

test("adaptDiagramYaml renders diagram-first logical keys and roles", () => {
  const diagramYaml = `
kind: diagram
name: sales_logical
layer: logical
entities:
  - name: Customer
    type: logical_entity
    fields:
      - { name: customer_key, type: number, primary_key: true, nullable: false }
      - { name: customer_code, type: string, unique: true }
    candidate_keys:
      - [customer_key]
      - [customer_code]
    business_keys:
      - [customer_code]
  - name: Sales Order
    type: associative_entity
    fields:
      - { name: customer_key, type: number }
relationships:
  - name: order_customer
    from: { entity: Sales Order, field: customer_key }
    to: { entity: Customer, field: customer_key }
    cardinality: many_to_one
    from_role: order customer
    to_role: placed orders
`;
  const adapted = adaptDiagramYaml(diagramYaml, []);
  assert.ok(adapted);
  assert.equal(adapted.modelKind, "logical");
  assert.equal(adapted.tables[0].candidate_keys.length, 2);
  assert.equal(adapted.tables[0].business_keys.length, 1);
  assert.equal(adapted.relationships[0].fromRole, "order customer");
  assert.equal(adapted.relationships[0].toRole, "placed orders");
});

test("adaptDiagramYaml preserves logical entity-level relationships from card drags", () => {
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
    from_role: account holder
    to_role: placed orders
`;
  const adapted = adaptDiagramYaml(diagramYaml, []);
  assert.ok(adapted);
  assert.equal(adapted.modelKind, "logical");
  assert.equal(adapted.relationships.length, 1);
  const customer = adapted.tables.find((table) => table.name === "Customer");
  const order = adapted.tables.find((table) => table.name === "Sales Order");
  assert.ok(customer);
  assert.ok(order);
  assert.equal(adapted.relationships[0].from.table, customer.id);
  assert.equal(adapted.relationships[0].from.col, undefined);
  assert.equal(adapted.relationships[0].to.table, order.id);
  assert.equal(adapted.relationships[0].to.col, undefined);
  assert.equal(adapted.relationships[0]._conceptualLevel, true);
  assert.equal(adapted.relationships[0].fromRole, "account holder");
  assert.equal(adapted.relationships[0].toRole, "placed orders");
});

test("adaptDiagramYaml keeps same-named entities from different files as distinct nodes", () => {
  const diagramYaml = `
kind: diagram
name: dupes
entities:
  - file: models/a.yml
    entity: customer
  - file: models/b.yml
    entity: customer
`;
  const modelYaml = `
kind: model
name: customer
columns:
  - name: id
    type: integer
`;
  const adapted = adaptDiagramYaml(diagramYaml, [
    { fullPath: "models/a.yml", content: modelYaml },
    { fullPath: "models/b.yml", content: modelYaml },
  ]);
  assert.ok(adapted);
  assert.equal(adapted.tables.length, 2);
  assert.notEqual(adapted.tables[0].id, adapted.tables[1].id, "node ids must be source-file scoped");
  assert.equal(adapted.tables[0].name, "customer");
  assert.equal(adapted.tables[1].name, "customer");
});

test("adaptDiagramYaml maps diagram relationship cardinality onto endpoint notation", () => {
  const diagramYaml = `
kind: diagram
name: customer_360
entities:
  - file: models/orders.yml
    entity: orders
  - file: models/customers.yml
    entity: customers
relationships:
  - name: orders_to_customers
    from:
      entity: orders
      field: customer_id
    to:
      entity: customers
      field: customer_id
    cardinality: many_to_one
    optional: true
    on_delete: cascade
`;
  const modelYaml = (name) => `
kind: model
name: ${name}
columns:
  - name: customer_id
    type: bigint
`;
  const adapted = adaptDiagramYaml(diagramYaml, [
    { fullPath: "models/orders.yml", content: modelYaml("orders") },
    { fullPath: "models/customers.yml", content: modelYaml("customers") },
  ]);
  assert.ok(adapted);
  const rel = adapted.relationships.find((entry) => entry.name === "orders_to_customers");
  assert.ok(rel);
  assert.equal(rel.from.max, "N");
  assert.equal(rel.to.max, "1");
  assert.equal(rel.dashed, true);
  assert.equal(rel.onDelete, "CASCADE");
});

test("adaptDiagramYaml lets diagram relationships override source-model edges on the same endpoints", () => {
  const diagramYaml = `
kind: diagram
name: customer_360
entities:
  - file: models/orders.yml
    entity: orders
  - file: models/customers.yml
    entity: customers
relationships:
  - name: orders_to_customers_override
    from:
      entity: orders
      field: customer_id
    to:
      entity: customers
      field: id
    cardinality: one_to_many
`;
  const ordersYaml = `
kind: model
name: orders
columns:
  - name: customer_id
    type: bigint
    foreign_key:
      entity: customers
      field: id
`;
  const customersYaml = `
kind: model
name: customers
columns:
  - name: id
    type: bigint
    primary_key: true
`;
  const adapted = adaptDiagramYaml(diagramYaml, [
    { fullPath: "models/orders.yml", content: ordersYaml },
    { fullPath: "models/customers.yml", content: customersYaml },
  ]);
  assert.ok(adapted);
  assert.equal(adapted.relationships.length, 1, "diagram edge should replace the inferred source edge");
  const rel = adapted.relationships[0];
  assert.equal(rel._origin, "diagram_relationship");
  assert.equal(rel.name, "orders_to_customers_override");
  assert.equal(rel.cardinality, "one_to_many");
  assert.equal(rel.from.max, "1");
  assert.equal(rel.to.max, "N");
});

test("adaptDiagramYaml lets explicit kind:model relationships override inferred FK edges", () => {
  const diagramYaml = `
kind: diagram
name: orders
entities:
  - file: models/order_items.yml
    entity: order_items
  - file: models/fct_orders.yml
    entity: fct_orders
`;
  const orderItemsYaml = `
kind: model
name: order_items
columns:
  - name: order_id
    type: bigint
    foreign_key:
      entity: fct_orders
      field: order_id
relationships:
  - name: order_items_to_fct_orders
    from: order_items.order_id
    to: fct_orders.order_id
    cardinality: one_to_one
`;
  const factOrdersYaml = `
kind: model
name: fct_orders
columns:
  - name: order_id
    type: bigint
    primary_key: true
`;
  const adapted = adaptDiagramYaml(diagramYaml, [
    { fullPath: "models/order_items.yml", content: orderItemsYaml },
    { fullPath: "models/fct_orders.yml", content: factOrdersYaml },
  ]);
  assert.ok(adapted);
  assert.equal(adapted.relationships.length, 1);
  const rel = adapted.relationships[0];
  assert.equal(rel._origin, "model_relationship");
  assert.equal(rel.name, "order_items_to_fct_orders");
  assert.equal(rel.cardinality, "one_to_one");
  assert.equal(rel.from.max, "1");
  assert.equal(rel.to.max, "1");
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

test("adaptDbtSchemaYaml honors direct flags and dbt constraints on columns", () => {
  const yamlText = `
version: 2
models:
  - name: orders
    constraints:
      - type: primary_key
        columns: [order_id]
    columns:
      - name: order_id
        data_type: bigint
      - name: customer_id
        data_type: bigint
        nullable: false
        unique: true
        generated: true
        default: 0
        check: customer_id > 0
        constraints:
          - type: foreign_key
            to: "ref('customers')"
            field: customer_id
`;
  const adapted = adaptDbtSchemaYaml(yamlText);
  const orderId = adapted.tables[0].columns.find((column) => column.name === "order_id");
  const customerId = adapted.tables[0].columns.find((column) => column.name === "customer_id");
  assert.equal(orderId.pk, true);
  assert.equal(orderId.nn, true);
  assert.equal(orderId.unique, true);
  assert.equal(customerId.nn, true);
  assert.equal(customerId.unique, true);
  assert.equal(customerId.generated, true);
  assert.equal(customerId.default, "0");
  assert.equal(customerId.check, "customer_id > 0");
  assert.equal(customerId.fk, "customers.customer_id");
});

test("adaptDbtSchemaYaml supports semantic_models and metrics-only files", () => {
  const yamlText = `
version: 2
semantic_models:
  - name: fact_orders
    description: Order-level fact.
    entities:
      - name: order
        type: primary
        expr: order_key
    dimensions:
      - name: order_date
        type: time
    measures:
      - name: net_sales
        agg: sum
        expr: net_sales_amount
metrics:
  - name: avg_order_value_net
    type: derived
`;
  const adapted = adaptDbtSchemaYaml(yamlText);
  assert.ok(adapted);
  const factOrders = adapted.tables.find((table) => table.id === "fact_orders");
  const metricCatalog = adapted.tables.find((table) => table.id === "metric_catalog");
  assert.ok(factOrders, "semantic model should be adapted into a table/view");
  assert.ok(metricCatalog, "metrics-only catalog should be synthesized");
  const orderKey = factOrders.columns.find((column) => column.name === "order_key");
  const orderDate = factOrders.columns.find((column) => column.name === "order_date");
  const netSalesAmount = factOrders.columns.find((column) => column.name === "net_sales_amount");
  assert.equal(orderKey.pk, true);
  assert.equal(orderDate.type, "date");
  assert.equal(netSalesAmount.type, "decimal(18,2)");
});

test("adaptDbtSchemaYaml resolves semantic field types from referenced model YAML when available", () => {
  const semanticYaml = `
version: 2
semantic_models:
  - name: order_item
    model: ref('order_items')
    entities:
      - name: order_item
        type: primary
        expr: order_item_id
    dimensions:
      - name: is_food_item
        type: categorical
      - name: ordered_at
        expr: ordered_at
        type: time
    measures:
      - name: revenue
        agg: sum
        expr: product_price
`;
  const projectFiles = [
    {
      fullPath: "models/marts/order_items.yml",
      content: `
kind: model
name: order_items
columns:
  - name: order_item_id
    type: bigint
    primary_key: true
  - name: is_food_item
    type: boolean
  - name: ordered_at
    type: timestamp
  - name: product_price
    type: decimal(12,2)
`,
    },
  ];
  const adapted = adaptDbtSchemaYaml(semanticYaml, projectFiles);
  const table = adapted.tables.find((entry) => entry.id === "order_item");
  assert.ok(table);
  assert.equal(table.columns.find((column) => column.name === "order_item_id")?.type, "bigint");
  assert.equal(table.columns.find((column) => column.name === "order_item_id")?.pk, true);
  assert.equal(table.columns.find((column) => column.name === "is_food_item")?.type, "boolean");
  assert.equal(table.columns.find((column) => column.name === "ordered_at")?.type, "timestamp");
  assert.equal(table.columns.find((column) => column.name === "product_price")?.type, "decimal(12,2)");
});

test("adaptDbtSchemaYaml marks semantic foreign entity keys as FK-like for UI badges", () => {
  const semanticYaml = `
version: 2
semantic_models:
  - name: order_item
    model: ref('order_items')
    entities:
      - name: order_item
        type: primary
        expr: order_item_id
      - name: order_id
        type: foreign
        expr: order_id
`;
  const adapted = adaptDbtSchemaYaml(semanticYaml);
  const table = adapted.tables.find((entry) => entry.id === "order_item");
  assert.ok(table);
  const pk = table.columns.find((column) => column.name === "order_item_id");
  const fk = table.columns.find((column) => column.name === "order_id");
  assert.equal(pk.pk, true);
  assert.equal(pk.nn, true);
  assert.equal(fk.semanticFk, true);
  assert.equal(fk.fk, undefined);
});

test("schemaToPanelModel preserves table ids for selection-driven panels", () => {
  const model = schemaToPanelModel({
    name: "customer_360",
    tables: [
      {
        id: "models/marts/fct_orders.yml::fct_orders",
        name: "fct_orders",
        type: "view",
        schema: "main",
        subject_area: "orders",
        columns: [{ name: "order_id", type: "bigint", pk: true }],
        _sourceFile: "models/marts/fct_orders.yml",
      },
    ],
    relationships: [
      {
        id: "rel-1",
        name: "orders_to_customers",
        from: { table: "models/marts/fct_orders.yml::fct_orders", col: "customer_id" },
        to: { table: "models/marts/dim_customers.yml::dim_customers", col: "customer_id" },
        kind: "many_to_one",
      },
    ],
    subjectAreas: [{ name: "orders", count: 1 }],
  });
  assert.equal(model.entities[0].id, "models/marts/fct_orders.yml::fct_orders");
  assert.equal(model.entities[0].name, "fct_orders");
  assert.equal(model.relationships[0].from, "models/marts/fct_orders.yml::fct_orders.customer_id");
});

test("adaptDataLexYaml preserves conceptual entity-level relationships", () => {
  const yamlText = `
model:
  name: insurance_concepts
  kind: conceptual
  domain: insurance
  owners:
    - steward@example.com
  state: draft
entities:
  - name: Customer
    type: concept
    description: Business party buying a policy.
  - name: Policy
    type: concept
    description: Insurance contract.
relationships:
  - name: customer_holds_policy
    from:
      entity: Customer
    to:
      entity: Policy
    cardinality: one_to_many
    verb: holds
    relationship_type: ownership
    rationale: Customer is the accountable party for the policy lifecycle.
    source_of_truth: policy_admin
    description: Customer may hold many policies.
`;
  const adapted = adaptDataLexYaml(yamlText);
  assert.equal(adapted.modelKind, "conceptual");
  assert.equal(adapted.domain, "insurance");
  assert.equal(adapted.tables[0].type, "concept");
  assert.equal(adapted.relationships[0]._conceptualLevel, true);
  assert.equal(adapted.relationships[0].from.table, "customer");
  assert.equal(adapted.relationships[0].from.col, undefined);
  assert.equal(adapted.relationships[0].verb, "holds");
  assert.equal(adapted.relationships[0].relationshipType, "ownership");
  assert.equal(adapted.relationships[0].sourceOfTruth, "policy_admin");
});

test("schemaToPanelModel preserves conceptual relationships as entity-level refs", () => {
  const model = schemaToPanelModel({
    modelKind: "conceptual",
    domain: "insurance",
    tables: [
      { id: "Customer", name: "Customer", type: "concept", schema: "business", columns: [] },
      { id: "Policy", name: "Policy", type: "concept", schema: "business", columns: [] },
    ],
    relationships: [
      {
        id: "rel-1",
        name: "customer_holds_policy",
        from: { table: "Customer", col: "" },
        to: { table: "Policy", col: "" },
        cardinality: "one_to_many",
        _conceptualLevel: true,
        verb: "holds",
        relationshipType: "ownership",
        rationale: "Customer is the accountable party.",
        sourceOfTruth: "policy_admin",
      },
    ],
    subjectAreas: [],
  });
  assert.equal(model.model.kind, "conceptual");
  assert.deepEqual(model.relationships[0].from, { entity: "Customer" });
  assert.deepEqual(model.relationships[0].to, { entity: "Policy" });
  assert.equal(model.relationships[0].verb, "holds");
  assert.equal(model.relationships[0].relationship_type, "ownership");
  assert.equal(model.relationships[0].source_of_truth, "policy_admin");
});
