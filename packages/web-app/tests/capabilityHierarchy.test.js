import test from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityHierarchy } from "../src/design/views/capabilityHierarchy.js";

test("groups entities by domain → subject_area", () => {
  const ents = [
    { name: "Customer", domain: "sales", subject_area: "Customer Profile" },
    { name: "Order",    domain: "sales", subject_area: "Transaction" },
    { name: "Invoice",  domain: "finance", subject_area: "AR" },
    { name: "Payment",  domain: "finance", subject_area: "AR" },
  ];
  const out = buildCapabilityHierarchy(ents, {});
  assert.equal(out.length, 2);
  const finance = out.find((d) => d.domain === "finance");
  assert.equal(finance.total, 2);
  assert.equal(finance.subjects.length, 1);
  assert.equal(finance.subjects[0].subjectArea, "AR");
  assert.deepEqual(finance.subjects[0].items.map((e) => e.name), ["Invoice", "Payment"]);
});

test("falls back to doc-level domain when entity has none", () => {
  // Mirrors sales_order_lifecycle.diagram.yaml — top-level domain: sales,
  // entities have subject_area but no per-entity domain.
  const doc = { domain: "sales" };
  const ents = [
    { name: "Customer", subject_area: "Customer Profile" },
    { name: "Order", subject_area: "Transaction" },
  ];
  const out = buildCapabilityHierarchy(ents, doc);
  assert.equal(out.length, 1);
  assert.equal(out[0].domain, "sales");
  assert.equal(out[0].total, 2);
  assert.equal(out[0].subjects.length, 2);
});

test("falls back through doc.model.domain", () => {
  const doc = { model: { domain: "marketing" } };
  const ents = [{ name: "Lead" }];
  const out = buildCapabilityHierarchy(ents, doc);
  assert.equal(out[0].domain, "marketing");
});

test("buckets entities with no domain anywhere as 'Uncategorized'", () => {
  const out = buildCapabilityHierarchy([{ name: "Floater" }], {});
  assert.equal(out[0].domain, "Uncategorized");
  assert.equal(out[0].subjects[0].subjectArea, "—");
});

test("accepts canvas-style entity: name (diagram files)", () => {
  const out = buildCapabilityHierarchy([{ entity: "Customer", domain: "sales" }], {});
  assert.equal(out[0].subjects[0].items[0].entity, "Customer");
});

test("skips malformed entries instead of throwing", () => {
  const out = buildCapabilityHierarchy([null, undefined, {}, { name: "" }, { name: "Real", domain: "x" }], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].subjects[0].items[0].name, "Real");
});

test("subjects within a domain are alphabetically sorted", () => {
  const ents = [
    { name: "Z", domain: "ops", subject_area: "Zeta" },
    { name: "A", domain: "ops", subject_area: "Alpha" },
    { name: "M", domain: "ops", subject_area: "Mu" },
  ];
  const out = buildCapabilityHierarchy(ents, {});
  assert.deepEqual(out[0].subjects.map((s) => s.subjectArea), ["Alpha", "Mu", "Zeta"]);
});

test("domains themselves are alphabetically sorted", () => {
  const out = buildCapabilityHierarchy([
    { name: "X", domain: "marketing" },
    { name: "Y", domain: "finance" },
    { name: "Z", domain: "sales" },
  ], {});
  assert.deepEqual(out.map((d) => d.domain), ["finance", "marketing", "sales"]);
});
