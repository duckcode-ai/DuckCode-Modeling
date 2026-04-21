/* yamlPatchDiagram — regression tests for the diagram-entry patcher.
 *
 * Covers the wildcard-fallback path added in v0.5.1: drag-and-drop
 * onto a diagram writes `{file, entity: "*"}` entries, and users then
 * drag individual entities around the canvas. Without the fallback the
 * move was a silent no-op because `setDiagramEntityDisplay` couldn't
 * find a concrete `(file, entity)` row to patch. */
import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { setDiagramEntityDisplay, addDiagramEntries } from "../src/design/yamlPatch.js";

function parse(text) { return yaml.load(text); }

test("setDiagramEntityDisplay patches an explicit entry in place", () => {
  const src = yaml.dump({
    kind: "diagram",
    entities: [
      { file: "models/customers.yml", entity: "customer", x: 100, y: 200 },
    ],
  });
  const out = setDiagramEntityDisplay(src, "models/customers.yml", "customer", { x: 555, y: 777 });
  assert.ok(out, "returns patched YAML");
  const doc = parse(out);
  assert.equal(doc.entities.length, 1);
  assert.equal(doc.entities[0].x, 555);
  assert.equal(doc.entities[0].y, 777);
  assert.equal(doc.entities[0].entity, "customer");
});

test("setDiagramEntityDisplay falls back to wildcard and appends a concrete override", () => {
  // Drag-drop onto canvas creates wildcard entries. Moving a single
  // entity must persist — append a concrete entry alongside the
  // wildcard so the adapter's last-wins dedupe picks up the override.
  const src = yaml.dump({
    kind: "diagram",
    entities: [
      { file: "models/customers.yml", entity: "*" },
    ],
  });
  const out = setDiagramEntityDisplay(src, "models/customers.yml", "customer", { x: 300, y: 400 });
  assert.ok(out, "returns patched YAML even without a concrete entry");
  const doc = parse(out);
  assert.equal(doc.entities.length, 2, "appends a concrete entry next to the wildcard");
  assert.equal(doc.entities[0].entity, "*", "wildcard survives");
  assert.equal(doc.entities[1].entity, "customer");
  assert.equal(doc.entities[1].x, 300);
  assert.equal(doc.entities[1].y, 400);
});

test("setDiagramEntityDisplay moving the same entity twice mutates the appended row, not the wildcard", () => {
  let src = yaml.dump({
    kind: "diagram",
    entities: [{ file: "models/orders.yml", entity: "*" }],
  });
  src = setDiagramEntityDisplay(src, "models/orders.yml", "orders", { x: 10, y: 20 });
  src = setDiagramEntityDisplay(src, "models/orders.yml", "orders", { x: 99, y: 88 });
  const doc = parse(src);
  assert.equal(doc.entities.length, 2);
  const concrete = doc.entities.filter((e) => e.entity === "orders");
  assert.equal(concrete.length, 1, "doesn't append duplicates");
  assert.equal(concrete[0].x, 99);
  assert.equal(concrete[0].y, 88);
});

test("setDiagramEntityDisplay returns null when neither concrete nor wildcard matches", () => {
  const src = yaml.dump({
    kind: "diagram",
    entities: [{ file: "models/customers.yml", entity: "customer" }],
  });
  const out = setDiagramEntityDisplay(src, "models/different.yml", "customer", { x: 1, y: 2 });
  assert.equal(out, null);
});

test("setDiagramEntityDisplay treats empty/omitted entity as wildcard", () => {
  // Older diagrams may have an entry with entity omitted. Treat as
  // wildcard for backward compat.
  const src = yaml.dump({
    kind: "diagram",
    entities: [{ file: "models/customers.yml" }],
  });
  const out = setDiagramEntityDisplay(src, "models/customers.yml", "customer", { x: 42, y: 42 });
  assert.ok(out);
  const doc = parse(out);
  const concrete = doc.entities.find((e) => e.entity === "customer");
  assert.ok(concrete);
  assert.equal(concrete.x, 42);
});

test("addDiagramEntries is idempotent by (file, entity) pair", () => {
  let src = yaml.dump({ kind: "diagram", entities: [] });
  src = addDiagramEntries(src, [{ file: "a.yml", entity: "*" }]);
  src = addDiagramEntries(src, [{ file: "a.yml", entity: "*" }]);
  const doc = parse(src);
  assert.equal(doc.entities.length, 1);
});
