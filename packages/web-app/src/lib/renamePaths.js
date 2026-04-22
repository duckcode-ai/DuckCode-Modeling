// Path-reference helpers used by the rename cascade. Extracted from the
// workspace store so they can be unit-tested without pulling in zustand
// or the API layer. The normalization defends against the most common
// hand-authored variants of a path (leading "/", "./", backslashes,
// duplicate slashes, trailing slashes) — `fromPath` comes from the
// Explorer and is canonical, but `ref` came out of someone's YAML and
// might not be.

export function normalizePathRef(raw) {
  if (raw == null) return "";
  return String(raw)
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
}

// `matchScope`:
//   - "file"   → rewrites refs where `ref === fromPath`
//   - "folder" → rewrites refs where `ref === fromPath` OR `ref` starts with `fromPath + "/"`
export function matchesRenameSource(ref, fromPath, matchScope) {
  if (!ref) return false;
  const normRef = normalizePathRef(ref);
  const normFrom = normalizePathRef(fromPath);
  if (!normFrom) return false;
  if (normRef === normFrom) return true;
  if (matchScope === "folder" && normRef.startsWith(normFrom + "/")) return true;
  return false;
}

export function rewriteRenameTarget(ref, fromPath, toPath) {
  const normRef = normalizePathRef(ref);
  const normFrom = normalizePathRef(fromPath);
  const normTo = normalizePathRef(toPath);
  if (normRef === normFrom) return normTo;
  return normTo + normRef.slice(normFrom.length);
}
