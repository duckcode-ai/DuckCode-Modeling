import test from "node:test";
import assert from "node:assert/strict";
import { runGate, runModelChecks } from "../src/modelQuality.js";
import { classifyYamlText, YAML_DOCUMENT_KINDS } from "../src/lib/yamlDocumentKind.js";

const BASE_HEADER = `model:
  name: analytics_model
  version: 1.0.0
  domain: commerce
  owners:
    - data@example.com
  state: draft`;

test("runModelChecks enforces grain in transform layer", () => {
  const yamlText = `${BASE_HEADER}
  layer: transform

entities:
  - name: Widget
    type: table
    fields:
      - name: widget_id
        type: integer
        primary_key: true
        nullable: false
`;

  const check = runModelChecks(yamlText);
  const codes = check.errors.map((item) => item.code);
  assert.ok(codes.includes("MISSING_GRAIN"));
});

test("runModelChecks requires metrics in report layer", () => {
  const yamlText = `${BASE_HEADER}
  layer: report

entities:
  - name: Widget
    type: view
    grain: [widget_id]
    fields:
      - name: widget_id
        type: integer
        nullable: false
`;

  const check = runModelChecks(yamlText);
  const codes = check.errors.map((item) => item.code);
  assert.ok(codes.includes("MISSING_METRICS"));
});

test("runModelChecks validates metric dimension and time references", () => {
  const yamlText = `${BASE_HEADER}
  layer: report

entities:
  - name: Widget
    type: view
    grain: [widget_id]
    fields:
      - name: widget_id
        type: integer
      - name: metric_date
        type: date

metrics:
  - name: widget_count
    entity: Widget
    expression: widget_id
    aggregation: count_distinct
    grain: [widget_id]
    dimensions: [missing_dim]
    time_dimension: missing_time
`;

  const check = runModelChecks(yamlText);
  const codes = check.errors.map((item) => item.code);
  assert.ok(codes.includes("METRIC_DIMENSION_NOT_FOUND"));
  assert.ok(codes.includes("METRIC_TIME_DIMENSION_NOT_FOUND"));
});

test("runModelChecks accepts object-shaped relationship endpoints", () => {
  const yamlText = `${BASE_HEADER}
  layer: transform

entities:
  - name: Customer
    type: table
    grain: [customer_id]
    fields:
      - name: customer_id
        type: integer
        primary_key: true
      - name: customer_name
        type: text
  - name: Order
    type: table
    grain: [order_id]
    fields:
      - name: order_id
        type: integer
        primary_key: true
      - name: customer_id
        type: integer

relationships:
  - name: order_customer
    from:
      entity: Order
      field: customer_id
    to:
      entity: Customer
      field: customer_id
    cardinality: many_to_one
`;

  const check = runModelChecks(yamlText);
  const codes = check.errors.map((item) => item.code);
  assert.equal(codes.includes("INVALID_RELATIONSHIP_FROM"), false);
  assert.equal(codes.includes("INVALID_RELATIONSHIP_TO"), false);
});

test("runGate reports metric contract breaking changes", () => {
  const oldYamlText = `${BASE_HEADER}
  layer: report

entities:
  - name: DailySales
    type: view
    grain: [metric_date]
    fields:
      - name: metric_date
        type: date
      - name: net_revenue
        type: decimal(18,2)
      - name: customer_id
        type: integer

metrics:
  - name: revenue
    entity: DailySales
    expression: net_revenue
    aggregation: sum
    grain: [metric_date]
    dimensions: [customer_id]
    time_dimension: metric_date
`;

  const newYamlText = `${BASE_HEADER}
  layer: report

entities:
  - name: DailySales
    type: view
    grain: [metric_date]
    fields:
      - name: metric_date
        type: date
      - name: net_revenue
        type: decimal(18,2)
      - name: customer_id
        type: integer

metrics:
  - name: revenue
    entity: DailySales
    expression: net_revenue * 1.05
    aggregation: sum
    grain: [metric_date]
    dimensions: [customer_id]
    time_dimension: metric_date
`;

  const gate = runGate(oldYamlText, newYamlText, false);
  assert.equal(gate.gatePassed, false);
  assert.equal(gate.blockedByBreaking, true);
  assert.equal(gate.diff.summary.changed_metrics, 1);
  assert.ok(gate.diff.breaking_changes.includes("Metric contract changed: revenue"));
});

test("runModelChecks applies conceptual validation rules to entity-level models", () => {
  const yamlText = `model:
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

relationships:
  - name: customer_holds_policy
    from:
      entity: Customer
    to:
      entity: Policy
    cardinality: one_to_many
`;

  const check = runModelChecks(yamlText);
  const codes = check.warnings.map((item) => item.code);
  const errorCodes = check.errors.map((item) => item.code);
  assert.ok(codes.includes("CONCEPTUAL_MISSING_DESCRIPTION"));
  assert.ok(codes.includes("CONCEPTUAL_MISSING_OWNER"));
  assert.ok(codes.includes("CONCEPTUAL_MISSING_SUBJECT_AREA"));
  assert.ok(codes.includes("CONCEPTUAL_MISSING_GLOSSARY_LINK"));
  assert.equal(errorCodes.includes("INVALID_RELATIONSHIP_FROM"), false);
  assert.equal(errorCodes.includes("INVALID_RELATIONSHIP_TO"), false);
});

test("runModelChecks accepts EventStorming entity types (event / command / actor / policy / aggregate)", () => {
  // Phase 4a: business-flow modeling using the EventStorming canon.
  // None of these types should produce INVALID_ENTITY_TYPE.
  const yamlText = `kind: diagram
layer: conceptual
domain: sales
entities:
  - name: PlaceOrder
    type: command
  - name: OrderPlaced
    type: event
  - name: Customer
    type: actor
  - name: SettleOnPayment
    type: policy
  - name: Order
    type: aggregate
`;
  const check = runModelChecks(yamlText);
  const codes = (check.errors || []).map((e) => e.code);
  assert.equal(
    codes.includes("INVALID_ENTITY_TYPE"),
    false,
    `EventStorming types must be allowed; got: ${codes.join(", ")}`,
  );
});

test("runModelChecks rejects unknown entity types", () => {
  // Negative test: prove the suite would have caught it if I'd
  // forgotten to register the EventStorming types.
  const yamlText = `kind: diagram
layer: conceptual
domain: sales
entities:
  - name: Customer
    type: not_a_real_type
`;
  const check = runModelChecks(yamlText);
  const codes = (check.errors || []).map((e) => e.code);
  assert.ok(codes.includes("INVALID_ENTITY_TYPE"));
});

test("runModelChecks treats dbt semantic YAML without version as dbt semantic", () => {
  const yamlText = `semantic_models:
  - name: orders
    model: ref('fct_orders')
    entities:
      - name: order_id
        type: primary
metrics:
  - name: order_total
    type: simple
    type_params:
      measure: order_total
`;

  assert.equal(classifyYamlText(yamlText), YAML_DOCUMENT_KINDS.DBT_SEMANTIC);
  const check = runModelChecks(yamlText);
  const errorCodes = check.errors.map((item) => item.code);
  assert.equal(check.hasErrors, false);
  assert.equal(errorCodes.includes("INVALID_METRIC_ENTITY"), false);
  assert.equal(errorCodes.includes("INVALID_METRIC_EXPRESSION"), false);
  assert.ok(check.warnings.some((item) => item.code === "DBT_SCHEMA_DETECTED"));
});
