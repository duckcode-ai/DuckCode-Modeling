import test from "node:test";
import assert from "node:assert/strict";
import { buildEventStormingFlow, EVENTSTORMING_TYPES } from "../src/design/views/eventStormingFlow.js";

test("returns [] for empty input", () => {
  assert.deepEqual(buildEventStormingFlow([]), []);
  assert.deepEqual(buildEventStormingFlow(null), []);
  assert.deepEqual(buildEventStormingFlow(undefined), []);
});

test("returns [] when no entities have EventStorming types", () => {
  const ents = [
    { name: "Customer", type: "table" },
    { name: "Order", type: "fact_table" },
    { name: "Vendor", type: "concept" },
  ];
  assert.deepEqual(buildEventStormingFlow(ents), []);
});

test("groups EventStorming entities in canonical Brandolini order", () => {
  // Deliberately scrambled input order to confirm the helper sorts groups,
  // not just preserves YAML order across types.
  const ents = [
    { name: "OrderShipped", type: "event" },
    { name: "Customer", type: "actor" },
    { name: "ShippingPolicy", type: "policy" },
    { name: "PlaceOrder", type: "command" },
    { name: "OrderAggregate", type: "aggregate" },
  ];
  const out = buildEventStormingFlow(ents);
  assert.deepEqual(out.map((g) => g.type), ["actor", "command", "aggregate", "event", "policy"]);
});

test("preserves YAML order within each group", () => {
  // Two events appearing in YAML in a deliberate narrative order — the
  // helper must NOT alphabetize them, since the modeler chose the order.
  const ents = [
    { name: "OrderPlaced", type: "event" },
    { name: "InventoryReserved", type: "event" },
    { name: "OrderShipped", type: "event" },
  ];
  const out = buildEventStormingFlow(ents);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].items.map((e) => e.name), ["OrderPlaced", "InventoryReserved", "OrderShipped"]);
});

test("skips groups with zero items", () => {
  const ents = [
    { name: "PlaceOrder", type: "command" },
    { name: "OrderPlaced", type: "event" },
  ];
  const out = buildEventStormingFlow(ents);
  assert.deepEqual(out.map((g) => g.type), ["command", "event"]);
});

test("ignores non-EventStorming entities mixed in", () => {
  // A real model often has an EventStorming layer alongside ER tables.
  // The helper must filter, not error.
  const ents = [
    { name: "Customer", type: "table" },
    { name: "PlaceOrder", type: "command" },
    { name: "OrderHistory", type: "view" },
    { name: "OrderPlaced", type: "event" },
  ];
  const out = buildEventStormingFlow(ents);
  assert.equal(out.length, 2);
  assert.deepEqual(out.flatMap((g) => g.items.map((e) => e.name)), ["PlaceOrder", "OrderPlaced"]);
});

test("attaches a human-readable label to each group", () => {
  const out = buildEventStormingFlow([
    { name: "C", type: "actor" },
    { name: "P", type: "policy" },
  ]);
  assert.equal(out[0].label, "Actors");
  assert.equal(out[1].label, "Policies");
});

test("tolerates malformed entries (null, missing type, wrong shape)", () => {
  const ents = [
    null,
    "not-an-object",
    { type: "event" },                          // missing name — rendered with fallback at view layer
    { name: "Anonymous" },                      // missing type — filtered
    { name: "Real", type: "event" },
  ];
  const out = buildEventStormingFlow(ents);
  assert.equal(out.length, 1);
  assert.equal(out[0].items.length, 2);
});

test("EVENTSTORMING_TYPES export covers exactly the canonical 5", () => {
  assert.deepEqual([...EVENTSTORMING_TYPES].sort(), ["actor", "aggregate", "command", "event", "policy"]);
});
