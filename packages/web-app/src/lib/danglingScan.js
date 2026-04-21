/* Dangling-relationship scanner.
 *
 * Reads the active YAML buffer and surfaces `relationships[]` entries whose
 * from/to endpoints reference an entity (or column) that doesn't exist in
 * the same file. This is what produces "phantom" FK edges on the canvas
 * after a user renames or deletes an entity by hand.
 *
 * Two input shapes are supported:
 *   - canonical DataLex model YAML (`entities: [...]`, `relationships: [...]`)
 *   - diagram YAML (`entities: [{file, entity}]`, `relationships: [...]`)
 *
 * For diagrams we can't validate columns (fields live in the referenced
 * files), so we only flag missing entities. For model files we validate
 * both sides fully.
 *
 * Returns a plain array of findings; callers decide how to render them.
 * `pruneDangling(yamlText)` rewrites the buffer with the offending
 * relationships removed — used by the "Remove dangling" button.
 */
import yaml from "js-yaml";

function parseEndpoint(s) {
  const str = typeof s === "string" ? s : "";
  const dot = str.indexOf(".");
  if (dot < 0) return { entity: str.trim(), column: "" };
  return { entity: str.slice(0, dot).trim(), column: str.slice(dot + 1).trim() };
}

function endpointFromValue(v) {
  if (!v) return { entity: "", column: "" };
  if (typeof v === "string") return parseEndpoint(v);
  if (typeof v === "object") {
    // Both `{entity, field}` (diagram) and `{table, col}` shapes exist.
    const entity = String(v.entity || v.table || "").trim();
    const column = String(v.field || v.column || v.col || "").trim();
    return { entity, column };
  }
  return { entity: "", column: "" };
}

function indexEntitiesFromModel(doc) {
  const entities = new Map(); // lower(name) -> Set<lower(fieldName)>
  (Array.isArray(doc?.entities) ? doc.entities : []).forEach((e) => {
    if (!e || typeof e !== "object") return;
    const name = String(e.name || "").trim();
    if (!name) return;
    const fields = new Set();
    (Array.isArray(e.fields) ? e.fields : []).forEach((f) => {
      if (!f) return;
      const fn = String(typeof f === "string" ? f : f.name || "").trim();
      if (fn) fields.add(fn.toLowerCase());
    });
    entities.set(name.toLowerCase(), fields);
  });
  return entities;
}

function indexEntitiesFromDiagram(doc) {
  const entities = new Set();
  (Array.isArray(doc?.entities) ? doc.entities : []).forEach((e) => {
    if (!e || typeof e !== "object") return;
    const entity = String(e.entity || "").trim();
    if (entity && entity !== "*") entities.add(entity.toLowerCase());
  });
  return entities;
}

/* Scan for dangling relationships. Returns `[{name, reason, from, to}]`. */
export function scanDangling(yamlText) {
  if (!yamlText || typeof yamlText !== "string") return [];
  let doc;
  try { doc = yaml.load(yamlText); } catch (_e) { return []; }
  if (!doc || typeof doc !== "object") return [];
  const rels = Array.isArray(doc.relationships) ? doc.relationships : [];
  if (rels.length === 0) return [];

  const hasEntities = Array.isArray(doc.entities) && doc.entities.length > 0;
  if (!hasEntities) return []; // nothing to validate against

  // Heuristic: if any entity entry has a `file:` key, treat as diagram.
  const isDiagram = doc.entities.some(
    (e) => e && typeof e === "object" && typeof e.file === "string"
  );
  const modelIndex = isDiagram ? null : indexEntitiesFromModel(doc);
  const diagramEntities = isDiagram ? indexEntitiesFromDiagram(doc) : null;

  const findings = [];
  rels.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const name = String(r.name || `rel_${i + 1}`);
    const from = endpointFromValue(r.from);
    const to = endpointFromValue(r.to);

    const reasons = [];
    const checkSide = (ep, label) => {
      if (!ep.entity) {
        reasons.push(`${label} endpoint missing entity name`);
        return;
      }
      const el = ep.entity.toLowerCase();
      if (isDiagram) {
        if (!diagramEntities.has(el)) {
          reasons.push(`${label} entity "${ep.entity}" is not on this diagram`);
        }
      } else {
        const fields = modelIndex.get(el);
        if (!fields) {
          reasons.push(`${label} entity "${ep.entity}" does not exist`);
          return;
        }
        if (ep.column && !fields.has(ep.column.toLowerCase())) {
          reasons.push(`${label} column "${ep.entity}.${ep.column}" does not exist`);
        }
      }
    };
    checkSide(from, "from");
    checkSide(to, "to");

    if (reasons.length > 0) {
      findings.push({
        index: i,
        name,
        from: `${from.entity || "?"}${from.column ? `.${from.column}` : ""}`,
        to: `${to.entity || "?"}${to.column ? `.${to.column}` : ""}`,
        reason: reasons.join("; "),
      });
    }
  });

  return findings;
}

/* Rewrite a YAML buffer with all dangling relationships removed.
   Returns the new text, or the original string if nothing changed. */
export function pruneDangling(yamlText) {
  if (!yamlText || typeof yamlText !== "string") return yamlText;
  const findings = scanDangling(yamlText);
  if (findings.length === 0) return yamlText;
  let doc;
  try { doc = yaml.load(yamlText); } catch (_e) { return yamlText; }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.relationships)) return yamlText;
  const drop = new Set(findings.map((f) => f.index));
  doc.relationships = doc.relationships.filter((_r, i) => !drop.has(i));
  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}
