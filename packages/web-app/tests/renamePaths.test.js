import test from "node:test";
import assert from "node:assert/strict";
import { normalizePathRef, matchesRenameSource, rewriteRenameTarget } from "../src/lib/renamePaths.js";

test("normalizePathRef strips leading slash, ./, backslashes, duplicate and trailing slashes", () => {
  assert.equal(normalizePathRef("/foo/bar.yaml"), "foo/bar.yaml");
  assert.equal(normalizePathRef("./foo/bar.yaml"), "foo/bar.yaml");
  assert.equal(normalizePathRef(".//foo/bar.yaml"), "foo/bar.yaml");
  assert.equal(normalizePathRef("foo\\bar.yaml"), "foo/bar.yaml");
  assert.equal(normalizePathRef("foo//bar.yaml"), "foo/bar.yaml");
  assert.equal(normalizePathRef("foo/bar/"), "foo/bar");
  assert.equal(normalizePathRef(""), "");
  assert.equal(normalizePathRef(null), "");
  assert.equal(normalizePathRef(undefined), "");
});

test("matchesRenameSource recognizes all common ref variants for a file rename", () => {
  const fromPath = "models/staging/customers.yaml";
  for (const variant of [
    "models/staging/customers.yaml",
    "/models/staging/customers.yaml",
    "./models/staging/customers.yaml",
    ".//models/staging/customers.yaml",
    "models//staging/customers.yaml",
    "models\\staging\\customers.yaml",
  ]) {
    assert.equal(matchesRenameSource(variant, fromPath, "file"), true, `variant: ${variant}`);
  }
  // Siblings are NOT matched.
  assert.equal(matchesRenameSource("models/staging/orders.yaml", fromPath, "file"), false);
  // Nested paths match only in folder scope.
  assert.equal(matchesRenameSource("models/staging/customers.yaml/extra", fromPath, "file"), false);
  assert.equal(matchesRenameSource("models/staging/extra", "models/staging", "folder"), true);
  assert.equal(matchesRenameSource("models/stagingX/extra", "models/staging", "folder"), false);
});

test("rewriteRenameTarget preserves normalized nested paths in folder renames", () => {
  assert.equal(
    rewriteRenameTarget("./models/staging/customers.yaml", "models/staging", "models/core"),
    "models/core/customers.yaml"
  );
  assert.equal(
    rewriteRenameTarget("/models/staging", "models/staging", "models/core"),
    "models/core"
  );
  // Empty inputs degrade gracefully.
  assert.equal(rewriteRenameTarget("", "a", "b"), "b");
});
