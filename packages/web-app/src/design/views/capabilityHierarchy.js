/* Capability hierarchy builder — pure function extracted from
 * CapabilityMap.jsx so it's testable without React/JSX. Builds a
 * 2-level domain → subject_area → concepts hierarchy from a YAML
 * doc's entities array.
 *
 * Domain resolution falls through three sources so files that only
 * set a doc-level domain (common on conceptual diagrams) still get
 * bucketed correctly instead of showing every entity under
 * "Uncategorized":
 *
 *   entity.domain → doc.domain → doc.model.domain → "Uncategorized"
 *
 * Subject area falls through:
 *
 *   entity.subject_area → "—" (placeholder)
 *
 * Returns a sorted array of:
 *
 *   {
 *     domain:   string,
 *     subjects: [{ subjectArea: string, items: entity[] }],
 *     total:    number,        // count of concepts in this domain
 *   }
 */

export function buildCapabilityHierarchy(entities, doc) {
  const docDomain = String(
    (doc && doc.domain) ||
    (doc && doc.model && doc.model.domain) ||
    ""
  ).trim();
  const domains = new Map();
  for (const ent of entities || []) {
    if (!ent || typeof ent !== "object") continue;
    const name = String(ent.name || ent.entity || "").trim();
    if (!name) continue;
    const domain = String(ent.domain || "").trim() || docDomain || "Uncategorized";
    const subjectArea = String(ent.subject_area || "").trim() || "—";
    if (!domains.has(domain)) domains.set(domain, new Map());
    const subjects = domains.get(domain);
    if (!subjects.has(subjectArea)) subjects.set(subjectArea, []);
    subjects.get(subjectArea).push(ent);
  }
  return [...domains.entries()]
    .map(([domain, subjects]) => ({
      domain,
      subjects: [...subjects.entries()]
        .map(([subjectArea, items]) => ({ subjectArea, items }))
        .sort((a, b) => a.subjectArea.localeCompare(b.subjectArea)),
      total: [...subjects.values()].reduce((acc, list) => acc + list.length, 0),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
