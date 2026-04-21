/* danglingScan — Phase 4.4 regression tests.
 *
 * Covers both the "scan" side (produces one finding per offending
 * relationship with a readable reason string) and the "prune" side
 * (rewrites the YAML with bad relationships dropped, good ones kept).
 * Both model-YAML and diagram-YAML shapes are exercised because the
 * scanner picks the validation strategy from the document shape. */
import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { scanDangling, pruneDangling } from "../src/lib/danglingScan.js";

function model({ entities, relationships }) {
  return yaml.dump({ entities, relationships });
}

test("scanDangling flags missing from-entity in a model YAML", () => {
  const src = model({
    entities: [
      { name: "Customer", fields: [{ name: "id" }] },
    ],
    relationships: [
      { name: "orders_to_customer", from: "Order.customer_id", to: "Customer.id" },
    ],
  });
  const findings = scanDangling(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].name, "orders_to_customer");
  assert.match(findings[0].reason, /from entity "Order" does not exist/);
});

test("scanDangling flags missing column on an existing entity", () => {
  const src = model({
    entities: [
      { name: "Customer", fields: [{ name: "id" }] },
      { name: "Order", fields: [{ name: "id" }, { name: "customer_id" }] },
    ],
    relationships: [
      { name: "bad_col", from: "Order.not_a_col", to: "Customer.id" },
    ],
  });
  const findings = scanDangling(src);
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /column "Order\.not_a_col" does not exist/);
});

test("scanDangling returns [] when every endpoint resolves", () => {
  const src = model({
    entities: [
      { name: "Customer", fields: [{ name: "id" }] },
      { name: "Order", fields: [{ name: "id" }, { name: "customer_id" }] },
    ],
    relationships: [
      { name: "orders_to_customer", from: "Order.customer_id", to: "Customer.id" },
    ],
  });
  assert.deepEqual(scanDangling(src), []);
});

test("scanDangling only validates entity existence on diagram YAML", () => {
  const src = yaml.dump({
    kind: "diagram",
    entities: [
      { file: "models/customer.yml", entity: "Customer" },
      { file: "models/order.yml", entity: "Order" },
    ],
    relationships: [
      // Entity missing from diagram → flagged
      { name: "bad_entity", from: { entity: "Ghost", field: "id" }, to: { entity: "Customer", field: "id" } },
      // Entity present; column not checked in diagram mode → passes
      { name: "ok", from: { entity: "Order", field: "bogus" }, to: { entity: "Customer", field: "id" } },
    ],
  });
  const findings = scanDangling(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].name, "bad_entity");
  assert.match(findings[0].reason, /entity "Ghost" is not on this diagram/);
});

test("pruneDangling drops bad relationships and preserves the good ones", () => {
  const src = model({
    entities: [
      { name: "Customer", fields: [{ name: "id" }] },
      { name: "Order", fields: [{ name: "id" }, { name: "customer_id" }] },
    ],
    relationships: [
      { name: "keep_me", from: "Order.customer_id", to: "Customer.id" },
      { name: "drop_me", from: "Order.nope", to: "Customer.id" },
      { name: "also_drop", from: "Ghost.x", to: "Customer.id" },
    ],
  });
  const out = pruneDangling(src);
  const doc = yaml.load(out);
  assert.equal(doc.relationships.length, 1);
  assert.equal(doc.relationships[0].name, "keep_me");
});

test("pruneDangling is a no-op when there are no findings", () => {
  const src = model({
    entities: [{ name: "Customer", fields: [{ name: "id" }] }],
    relationships: [],
  });
  assert.equal(pruneDangling(src), src);
});

test("scanDangling gracefully returns [] on unparseable YAML", () => {
  assert.deepEqual(scanDangling("this is: not: yaml: :"), []);
});
