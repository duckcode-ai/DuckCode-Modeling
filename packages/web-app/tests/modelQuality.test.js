import test from "node:test";
import assert from "node:assert/strict";
import { runGate, runModelChecks } from "../src/modelQuality.js";

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
