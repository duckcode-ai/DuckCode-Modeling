/* yamlPatch — small helpers that mutate a DataLex YAML document (string) by
   parsing with js-yaml, patching the in-memory doc, and dumping back.

   Preserves sibling fields; does not preserve comments or original key
   ordering beyond what js-yaml does. Good enough for inspector-driven
   edits; full round-trip fidelity should go through CodeMirror instead. */
import yaml from "js-yaml";

function loadDoc(text) {
  try {
    const doc = yaml.load(text);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch (_e) {
    return null;
  }
}

function dump(doc) {
  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
}

function normalizePathLike(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^[/\\]+/, "");
}

function collectReferencedEntityNames(yamlText) {
  const doc = loadDoc(yamlText);
  if (!doc) return [];
  const names = [];
  const seen = new Set();
  const add = (value) => {
    const name = String(value || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  if (Array.isArray(doc.entities)) {
    doc.entities.forEach((entity) => add(entity?.name));
  }
  if (Array.isArray(doc.models)) {
    doc.models.forEach((model) => add(model?.name));
  }
  if (Array.isArray(doc.sources)) {
    doc.sources.forEach((source) => {
      (source?.tables || []).forEach((table) => add(table?.name));
    });
  }

  const kind = String(doc.kind || "").toLowerCase();
  if ((kind === "model" || kind === "entity" || kind === "source") && doc.name) {
    add(doc.name);
  }
  if (kind === "source" && Array.isArray(doc.tables)) {
    doc.tables.forEach((table) => add(table?.name));
  }

  return names;
}

function normalizeForeignKeyTarget(foreignKey, legacyFkString) {
  if (foreignKey && typeof foreignKey === "object") {
    const entity = String(foreignKey.entity || foreignKey.table || foreignKey.references || "").trim();
    const field = String(foreignKey.field || foreignKey.column || "").trim();
    if (entity && field) return `${entity}.${field}`.toLowerCase();
  }
  if (typeof foreignKey === "string" && foreignKey.trim()) {
    return foreignKey.trim().toLowerCase();
  }
  if (typeof legacyFkString === "string" && legacyFkString.trim()) {
    return legacyFkString.trim().toLowerCase();
  }
  return null;
}

function dbtRelationshipTestTarget(test) {
  if (!test || typeof test !== "object") return null;
  const rel = test.relationships;
  if (!rel || typeof rel !== "object") return null;
  const raw = String(rel.to || "").trim();
  const refMatch = raw.match(/ref\(\s*['"]([^'"]+)['"]\s*\)/);
  const srcMatch = raw.match(/source\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
  const entity = refMatch ? refMatch[1] : (srcMatch ? srcMatch[1] : "");
  const field = String(rel.field || "id").trim();
  if (!entity || !field) return null;
  return `${entity}.${field}`.toLowerCase();
}

function parseRelationshipEndpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) {
    return { entity: raw, field: "" };
  }
  return {
    entity: raw.slice(0, dot),
    field: raw.slice(dot + 1),
  };
}

function relationshipEndpointKey(value) {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (value && typeof value === "object") {
    const entity = String(value.entity || value.table || "").trim().toLowerCase();
    const field = String(value.field || value.column || value.col || "").trim().toLowerCase();
    if (entity && field) return `${entity}.${field}`;
    if (entity) return entity;
  }
  return "";
}

function normalizedRelationshipEndpoint(value) {
  if (typeof value === "string") return parseRelationshipEndpoint(value);
  if (value && typeof value === "object") {
    const entity = String(value.entity || value.table || "").trim();
    const field = String(value.field || value.column || value.col || "").trim();
    if (entity) return { entity, field };
  }
  return null;
}

function canonicalizeDiagramRelationship(entry) {
  if (!entry || typeof entry !== "object") return null;
  const from = normalizedRelationshipEndpoint(entry.from);
  const to = normalizedRelationshipEndpoint(entry.to);
  if (!from || !to) return null;
  const out = {
    name: String(entry.name || `${from.entity}_to_${to.entity}`).trim() || `${from.entity}_to_${to.entity}`,
    from: { entity: from.entity, field: from.field },
    to: { entity: to.entity, field: to.field },
  };
  if (entry.cardinality != null && String(entry.cardinality).trim()) out.cardinality = String(entry.cardinality).trim();
  if (entry.identifying) out.identifying = true;
  if (entry.optional) out.optional = true;
  if (entry.label != null && String(entry.label).trim()) out.label = String(entry.label);
  if (entry.description != null && String(entry.description).trim()) out.description = String(entry.description);
  if (entry.relationship_type != null && String(entry.relationship_type).trim()) out.relationship_type = String(entry.relationship_type).trim();
  if (entry.rationale != null && String(entry.rationale).trim()) out.rationale = String(entry.rationale).trim();
  if (entry.source_of_truth != null && String(entry.source_of_truth).trim()) out.source_of_truth = String(entry.source_of_truth).trim();
  if (entry.on_delete != null && String(entry.on_delete).trim()) out.on_delete = String(entry.on_delete).trim().toUpperCase();
  if (entry.on_update != null && String(entry.on_update).trim()) out.on_update = String(entry.on_update).trim().toUpperCase();
  return out;
}

function diagramRelationshipSignature(entry) {
  const fromKey = relationshipEndpointKey(entry?.from);
  const toKey = relationshipEndpointKey(entry?.to);
  if (!fromKey || !toKey) return "";
  return `${fromKey}|${toKey}`;
}

export function normalizeDiagramYaml(yamlText) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  if (String(doc.kind || "").toLowerCase() !== "diagram") return yamlText;

  if (Array.isArray(doc.relationships)) {
    const canonicalBySignature = new Map();
    const lastIndexBySignature = new Map();
    const passthrough = [];

    doc.relationships.forEach((entry, index) => {
      const canonical = canonicalizeDiagramRelationship(entry);
      if (!canonical) {
        passthrough.push({ index, entry });
        return;
      }
      const signature = diagramRelationshipSignature(canonical);
      if (!signature) {
        passthrough.push({ index, entry });
        return;
      }
      canonicalBySignature.set(signature, canonical);
      lastIndexBySignature.set(signature, index);
    });

    const normalizedRelationships = [
      ...passthrough.map(({ index, entry }) => ({ index, entry })),
      ...Array.from(canonicalBySignature.entries()).map(([signature, entry]) => ({
        index: lastIndexBySignature.get(signature) ?? 0,
        entry,
      })),
    ]
      .sort((left, right) => left.index - right.index)
      .map(({ entry }) => entry);

    doc.relationships = normalizedRelationships;
    if (doc.relationships.length === 0) delete doc.relationships;
  }

  return dump(doc);
}

/* Find an entity by its name (case-insensitive match because the adapter
   lowercases ids when surfacing them). */
function findEntity(doc, entityName) {
  const target = String(entityName || "").toLowerCase();
  if (!doc || !target) return null;
  if (Array.isArray(doc.entities)) {
    const hit = doc.entities.find((e) => String(e.name || "").toLowerCase() === target);
    if (hit) return hit;
  }
  const kind = String(doc.kind || "").toLowerCase();
  if ((kind === "model" || kind === "entity" || kind === "source") && String(doc.name || "").toLowerCase() === target) {
    return doc;
  }
  if (kind === "source" && Array.isArray(doc.tables)) {
    const hit = doc.tables.find((t) => String(t?.name || "").toLowerCase() === target);
    if (hit) return hit;
  }
  if (Array.isArray(doc.models)) {
    const hit = doc.models.find((m) => String(m?.name || "").toLowerCase() === target);
    if (hit) return hit;
  }
  if (Array.isArray(doc.sources)) {
    for (const source of doc.sources) {
      const hit = (source?.tables || []).find((t) => String(t?.name || "").toLowerCase() === target);
      if (hit) return hit;
    }
  }
  return null;
}

function findField(entity, fieldName) {
  const target = String(fieldName || "").toLowerCase();
  const fields = Array.isArray(entity?.fields)
    ? entity.fields
    : (Array.isArray(entity?.columns) ? entity.columns : []);
  return fields.find((f) => String(f.name || "").toLowerCase() === target) || null;
}

function ensureFieldList(entity) {
  if (!entity || typeof entity !== "object") return null;
  if (Array.isArray(entity.fields)) return entity.fields;
  if (Array.isArray(entity.columns)) return entity.columns;
  if (Object.prototype.hasOwnProperty.call(entity, "columns")) {
    entity.columns = [];
    return entity.columns;
  }
  entity.fields = [];
  return entity.fields;
}

/* Patch a single field on an entity. `patch` is an object of changes:
     { name, type, default, description, primary_key, nullable, unique, generated, check }
   Undefined keys are ignored. Returns new YAML text, or null when the
   document can't be parsed or the target isn't found. */
export function patchField(yamlText, entityName, fieldName, patch) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const entity = findEntity(doc, entityName);
  if (!entity) return null;
  const field = findField(entity, fieldName);
  if (!field) return null;

  if (patch.name != null && patch.name !== field.name) field.name = String(patch.name);
  if (patch.type != null) field.type = String(patch.type);
  if (patch.description !== undefined) {
    if (patch.description) field.description = String(patch.description);
    else delete field.description;
  }
  if (patch.default !== undefined) {
    if (patch.default === "" || patch.default == null) delete field.default;
    else field.default = patch.default;
  }
  if (patch.primary_key !== undefined) {
    if (patch.primary_key) field.primary_key = true;
    else delete field.primary_key;
  }
  if (patch.nullable !== undefined) {
    // DataLex convention: nullable: false means NOT NULL; nullable: true or
    // absence means NULLABLE.
    if (patch.nullable === false) field.nullable = false;
    else delete field.nullable;
  }
  if (patch.unique !== undefined) {
    if (patch.unique) field.unique = true;
    else delete field.unique;
  }
  if (patch.generated !== undefined) {
    if (patch.generated) field.generated = true;
    else delete field.generated;
  }
  if (patch.check !== undefined) {
    if (patch.check) field.check = String(patch.check);
    else delete field.check;
  }

  return dump(doc);
}

/* Set the top-level model/diagram description.
 *
 * For `*.model.yaml` (top-level `model:` block) the description lives at
 * `model.description`. For `*.diagram.yaml` and other shapes it lives at
 * the document root. Empty/whitespace deletes the field.
 */
export function setModelDescription(yamlText, description) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const trimmed = String(description ?? "").trim();
  const target = doc.model && typeof doc.model === "object" ? doc.model : doc;
  if (trimmed) target.description = trimmed;
  else delete target.description;
  return dump(doc);
}

/* Set an entity's description. Empty/whitespace deletes the field. */
export function setEntityDescription(yamlText, entityName, description) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const entity = findEntity(doc, entityName);
  if (!entity) return null;
  const trimmed = String(description ?? "").trim();
  if (trimmed) entity.description = trimmed;
  else delete entity.description;
  return dump(doc);
}

/* Rename an entity; renames foreign-key references pointing at it too. */
export function renameEntity(yamlText, oldName, newName) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const entity = findEntity(doc, oldName);
  if (!entity) return null;
  entity.name = String(newName);

  // Walk all FK references.
  const target = String(oldName).toLowerCase();
  (doc.entities || []).forEach((e) => {
    (e.fields || []).forEach((f) => {
      if (f.foreign_key?.entity && String(f.foreign_key.entity).toLowerCase() === target) {
        f.foreign_key.entity = newName;
      }
    });
  });
  (doc.relationships || []).forEach((r) => {
    ["from", "to"].forEach((side) => {
      const val = String(r[side] || "");
      if (val.toLowerCase().startsWith(`${target}.`)) {
        r[side] = `${newName}.${val.split(".").slice(1).join(".")}`;
      }
    });
  });
  return dump(doc);
}

/* Append a new field to an entity. */
export function appendField(yamlText, entityName, fieldSpec) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const entity = findEntity(doc, entityName);
  if (!entity) return null;
  const fields = ensureFieldList(entity);
  if (!fields) return null;
  fields.push(fieldSpec);
  return dump(doc);
}

/* Append a new entity (or enum) to the document. */
export function appendEntity(yamlText, entitySpec) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  doc.entities = doc.entities || [];
  // Reject duplicates (case-insensitive).
  const name = String(entitySpec?.name || "").toLowerCase();
  if (!name) return null;
  if (doc.entities.some((e) => String(e.name || "").toLowerCase() === name)) return null;
  doc.entities.push(entitySpec);
  return dump(doc);
}

/* Delete an entity and every dependent reference. Legacy callers
   expect a YAML string back, so that remains the return shape. Use
   `deleteEntityDeep` when you need the cascade-impact counts (which
   the UI surfaces in a toast so users know what got cleaned up).

   Cascade covers:
     • entities[]         — the target row
     • relationships[]    — any edge with target on either end (handles
                             the canonical `from: "entity.field"` string
                             shape and the diagram-level `{from:{entity}}`
                             object shape)
     • indexes[]          — `index.entity === target`
     • metrics[]          — `metric.entity === target`
     • governance.classification — keys prefixed `<target>.<field>`
     • governance.stewards        — same pattern
*/
export function deleteEntity(yamlText, entityName) {
  const result = deleteEntityDeep(yamlText, entityName);
  return result ? result.yaml : null;
}

export function deleteEntityDeep(yamlText, entityName) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const target = String(entityName || "").toLowerCase();
  if (!target) return null;

  const impact = {
    entity: false,
    relationships: 0,
    indexes: 0,
    metrics: 0,
    governance: 0,
  };

  const beforeEntities = Array.isArray(doc.entities) ? doc.entities.length : 0;
  doc.entities = (doc.entities || []).filter(
    (e) => String(e.name || "").toLowerCase() !== target
  );
  impact.entity = doc.entities.length < beforeEntities;
  if (!impact.entity) return null; // nothing to delete — signal no-op

  if (Array.isArray(doc.relationships)) {
    const before = doc.relationships.length;
    doc.relationships = doc.relationships.filter((r) => {
      // String form: "entity.field"
      const fromStr = typeof r?.from === "string" ? r.from.split(".")[0].toLowerCase() : "";
      const toStr = typeof r?.to === "string" ? r.to.split(".")[0].toLowerCase() : "";
      // Object form: {entity, field} — used by diagram-level relationships
      const fromObj = String(r?.from?.entity || r?.from?.table || "").toLowerCase();
      const toObj = String(r?.to?.entity || r?.to?.table || "").toLowerCase();
      const from = fromStr || fromObj;
      const to = toStr || toObj;
      return from !== target && to !== target;
    });
    impact.relationships = before - doc.relationships.length;
  }

  if (Array.isArray(doc.indexes)) {
    const before = doc.indexes.length;
    doc.indexes = doc.indexes.filter(
      (idx) => String(idx?.entity || "").toLowerCase() !== target
    );
    impact.indexes = before - doc.indexes.length;
  }

  if (Array.isArray(doc.metrics)) {
    const before = doc.metrics.length;
    doc.metrics = doc.metrics.filter(
      (m) => String(m?.entity || "").toLowerCase() !== target
    );
    impact.metrics = before - doc.metrics.length;
  }

  // Governance cleanup — classification and stewards keys are
  // "<entity>.<field>". Case-insensitive prefix match.
  if (doc.governance && typeof doc.governance === "object") {
    for (const bucket of ["classification", "stewards"]) {
      const map = doc.governance[bucket];
      if (!map || typeof map !== "object") continue;
      const prefix = `${target}.`;
      for (const key of Object.keys(map)) {
        if (String(key).toLowerCase().startsWith(prefix)) {
          delete map[key];
          impact.governance += 1;
        }
      }
    }
  }

  return { yaml: dump(doc), impact };
}

/* Delete a field from an entity. */
export function deleteField(yamlText, entityName, fieldName) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const entity = findEntity(doc, entityName);
  if (!entity) return null;
  const target = String(fieldName).toLowerCase();
  if (Array.isArray(entity.fields)) {
    entity.fields = entity.fields.filter((f) => String(f.name || "").toLowerCase() !== target);
  } else if (Array.isArray(entity.columns)) {
    entity.columns = entity.columns.filter((f) => String(f.name || "").toLowerCase() !== target);
  } else {
    return null;
  }
  return dump(doc);
}

/* Remove a relationship/fk edge anchored on a specific field. Supports:
   - top-level relationships[] entries (string or object endpoints)
   - field.foreign_key / field.fk declarations
   - dbt `tests: [{relationships: ...}]` blocks on columns
   Returns new YAML, or null if nothing matched / YAML invalid. */
export function removeFieldRelationship(yamlText, fromEntity, fromField, toEntity, toField) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const sourceEntity = findEntity(doc, fromEntity);
  if (!sourceEntity) return null;
  const field = findField(sourceEntity, fromField);
  if (!field) return null;

  const sourceKey = `${String(fromEntity || "").toLowerCase()}.${String(fromField || "").toLowerCase()}`;
  const targetKey = `${String(toEntity || "").toLowerCase()}.${String(toField || "").toLowerCase()}`;
  let changed = false;

  if (Array.isArray(doc.relationships)) {
    const before = doc.relationships.length;
    doc.relationships = doc.relationships.filter((relationship) => {
      const fromStr = typeof relationship?.from === "string" ? relationship.from.toLowerCase() : "";
      const toStr = typeof relationship?.to === "string" ? relationship.to.toLowerCase() : "";
      const fromObj = relationship?.from && typeof relationship.from === "object"
        ? `${String(relationship.from.entity || relationship.from.table || "").toLowerCase()}.${String(relationship.from.field || relationship.from.col || "").toLowerCase()}`
        : "";
      const toObj = relationship?.to && typeof relationship.to === "object"
        ? `${String(relationship.to.entity || relationship.to.table || "").toLowerCase()}.${String(relationship.to.field || relationship.to.col || "").toLowerCase()}`
        : "";
      const relFrom = fromStr || fromObj;
      const relTo = toStr || toObj;
      return !(relFrom === sourceKey && relTo === targetKey);
    });
    if (doc.relationships.length !== before) changed = true;
  }

  const fkTarget = normalizeForeignKeyTarget(field.foreign_key, field.fk);
  if (fkTarget === targetKey) {
    if ("foreign_key" in field) delete field.foreign_key;
    if ("fk" in field) delete field.fk;
    changed = true;
  }

  if (Array.isArray(field.tests)) {
    const before = field.tests.length;
    field.tests = field.tests.filter((test) => dbtRelationshipTestTarget(test) !== targetKey);
    if (field.tests.length !== before) changed = true;
  }

  return changed ? dump(doc) : null;
}

/* Write canvas-layout hints into an entity's `display:` sub-map. This is the
   single new additive namespace PR B introduces — no existing fields move,
   no dbt meta is touched. Any of `{x, y, width}` may be omitted; omitted
   keys are preserved from the prior display block if present. Passing
   `null` for a key removes it.

   Example output:
     - name: stg_customers
       display:
         x: 480
         y: 120
         width: 280
       fields: [...]

   Positions round to the nearest integer — canvas precision is a pixel,
   and the extra precision bloats git diffs for no benefit. */
export function setEntityDisplay(yamlText, entityName, { x, y, width } = {}) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const entity = findEntity(doc, entityName);
  if (!entity) return null;

  const current = (entity.display && typeof entity.display === "object") ? entity.display : {};
  const next = { ...current };

  const applyNum = (key, value) => {
    if (value === undefined) return;
    if (value === null) { delete next[key]; return; }
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    next[key] = Math.round(n);
  };
  applyNum("x", x);
  applyNum("y", y);
  applyNum("width", width);

  if (Object.keys(next).length === 0) {
    delete entity.display;
  } else {
    entity.display = next;
  }

  return dump(doc);
}

/* Patch the position of a diagram entry inside a `.diagram.yaml`. The
   diagram file has shape `{kind: diagram, entities: [{file, entity, x, y, width}]}`
   — so we match by `(file, entity)` rather than by entity name alone
   (two different files can define an entity with the same name).

   Drag-and-drop from the Explorer writes wildcard entries — shape
   `{file, entity: "*"}` — that expand to every entity in the referenced
   model file. When the user subsequently moves an individual entity,
   there's no concrete `(file, entityName)` row to patch. Rather than
   silently dropping the move, we append a concrete override row next
   to the wildcard. The adapter's last-wins dedupe by entity id picks
   up the override without disturbing the wildcard (so the remaining
   entities stay positioned by the adapter defaults).

   Positions round to integers (same as setEntityDisplay). Returns null
   when the doc can't be parsed or when neither a concrete entry nor a
   wildcard for the file is found. */
export function setDiagramEntityDisplay(yamlText, file, entityName, { x, y, width } = {}) {
  let doc;
  try {
    doc = yaml.load(yamlText);
  } catch (_e) {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  if (!Array.isArray(doc.entities)) return null;

  const fileKey = String(file || "").replace(/^[/\\]+/, "");
  const entityKey = String(entityName || "").toLowerCase();
  if (!fileKey || !entityKey) return null;

  let entry = doc.entities.find(
    (e) =>
      String(e?.file || "").replace(/^[/\\]+/, "") === fileKey &&
      String(e?.entity || "").toLowerCase() === entityKey
  );

  if (!entry) {
    // Fall back to wildcard-expansion case: if the diagram references
    // this file with `entity: "*"` (or an empty/omitted entity), append
    // a new concrete entry so the move persists. Without this, dragging
    // entities around on a wildcard-sourced diagram was a silent no-op.
    const hasWildcard = doc.entities.some((e) => {
      if (!e || typeof e !== "object") return false;
      if (String(e.file || "").replace(/^[/\\]+/, "") !== fileKey) return false;
      const ent = String(e.entity || "").trim();
      return ent === "" || ent === "*";
    });
    if (!hasWildcard) return null;
    entry = { file: fileKey, entity: entityName };
    doc.entities.push(entry);
  }

  const applyNum = (key, value) => {
    if (value === undefined) return;
    if (value === null) { delete entry[key]; return; }
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    entry[key] = Math.round(n);
  };
  applyNum("x", x);
  applyNum("y", y);
  applyNum("width", width);

  return dump(doc);
}

export function setInlineDiagramEntityDisplay(yamlText, entityName, { x, y, width } = {}) {
  const doc = loadDoc(yamlText);
  if (!doc || !Array.isArray(doc.entities)) return null;
  const entityKey = String(entityName || "").trim().toLowerCase();
  if (!entityKey) return null;
  const entry = doc.entities.find((e) => {
    if (!e || typeof e !== "object" || e.file) return false;
    return String(e.name || e.entity || "").trim().toLowerCase() === entityKey;
  });
  if (!entry) return null;

  const applyNum = (key, value) => {
    if (value === undefined) return;
    if (value === null) { delete entry[key]; return; }
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    entry[key] = Math.round(n);
  };
  applyNum("x", x);
  applyNum("y", y);
  applyNum("width", width);
  return dump(doc);
}

export function addInlineDiagramEntity(yamlText, entity) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  if (!Array.isArray(doc.entities)) doc.entities = [];

  const name = String(entity?.name || "").trim();
  if (!name) return null;
  const key = name.toLowerCase();
  const dupe = doc.entities.some((entry) => {
    if (!entry || typeof entry !== "object" || entry.file) return false;
    return String(entry.name || entry.entity || "").trim().toLowerCase() === key;
  });
  if (dupe) return yamlText;

  const entry = {
    name,
    type: String(entity?.type || "concept"),
  };
  if (entity?.logical_name && String(entity.logical_name).trim() !== name) {
    entry.logical_name = String(entity.logical_name).trim();
  }
  if (entity?.description) entry.description = String(entity.description);
  if (entity?.domain) entry.domain = String(entity.domain);
  if (entity?.subject_area) entry.subject_area = String(entity.subject_area);
  if (entity?.owner) entry.owner = String(entity.owner);
  if (Array.isArray(entity?.terms)) entry.terms = entity.terms;
  if (Array.isArray(entity?.tags)) entry.tags = entity.tags;
  if (Array.isArray(entity?.fields)) entry.fields = entity.fields;
  if (Array.isArray(entity?.candidate_keys)) entry.candidate_keys = entity.candidate_keys;
  if (Array.isArray(entity?.business_keys)) entry.business_keys = entity.business_keys;
  if (entity?.subtype_of) entry.subtype_of = String(entity.subtype_of);
  if (entity?.discriminator) entry.discriminator = String(entity.discriminator);
  if (Number.isFinite(Number(entity?.x))) entry.x = Math.round(Number(entity.x));
  if (Number.isFinite(Number(entity?.y))) entry.y = Math.round(Number(entity.y));
  if (Number.isFinite(Number(entity?.width))) entry.width = Math.round(Number(entity.width));

  doc.entities.push(entry);
  return dump(doc);
}

/* Append a batch of `{file, entity}` references to a .diagram.yaml's
   `entities:` array. Dedupes by `(file, entity)` so dropping the same
   file twice is idempotent. Creates `entities: []` if absent. Used by
   the drag-to-canvas path. Returns new YAML or null if parse fails. */
export function addDiagramEntries(yamlText, newEntries) {
  let doc;
  try {
    doc = yaml.load(yamlText);
  } catch (_e) {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  if (!Array.isArray(doc.entities)) doc.entities = [];
  const seen = new Set(
    doc.entities.map(
      (e) =>
        `${String(e?.file || "").replace(/^[/\\]+/, "")}::${String(e?.entity || "").toLowerCase()}`
    )
  );
  (newEntries || []).forEach((e) => {
    const file = String(e?.file || "").replace(/^[/\\]+/, "");
    const entity = String(e?.entity || "");
    if (!file || !entity) return;
    const key = `${file}::${entity.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const entry = { file, entity };
    if (Number.isFinite(Number(e?.x))) entry.x = Math.round(Number(e.x));
    if (Number.isFinite(Number(e?.y))) entry.y = Math.round(Number(e.y));
    doc.entities.push(entry);
  });
  return dump(doc);
}

/* Remove an entity reference from a `.diagram.yaml`.
 *
 * Concrete entries (`{file, entity: "orders"}`) are removed directly.
 * Wildcard entries (`{file, entity: "*"}`) need expansion so removing one
 * entity does not also drop every other entity from the same source file.
 * `referencedYamlText` should be the referenced model/schema YAML so we can
 * enumerate the remaining entities for that file. */
export function deleteDiagramEntity(yamlText, file, entityName, referencedYamlText = "") {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  if (!Array.isArray(doc.entities)) return null;

  const fileKey = normalizePathLike(file);
  const entityKey = String(entityName || "").trim().toLowerCase();
  if (!entityKey) return null;

  if (!fileKey) {
    const before = doc.entities.length;
    doc.entities = doc.entities.filter((entry) => {
      if (entry?.file) return true;
      return String(entry?.name || entry?.entity || "").trim().toLowerCase() !== entityKey;
    });
    if (doc.entities.length === before) return null;
    let relationships = 0;
    if (Array.isArray(doc.relationships)) {
      const relBefore = doc.relationships.length;
      doc.relationships = doc.relationships.filter((rel) => {
        const from = String(rel?.from?.entity || rel?.from?.table || "").toLowerCase();
        const to = String(rel?.to?.entity || rel?.to?.table || "").toLowerCase();
        return from !== entityKey && to !== entityKey;
      });
      relationships = relBefore - doc.relationships.length;
    }
    return { yaml: dump(doc), impact: { entity: true, relationships } };
  }

  const impact = { entity: false, relationships: 0 };
  const kept = [];
  const wildcardEntries = [];

  for (const entry of doc.entities) {
    const entryFile = normalizePathLike(entry?.file);
    if (entryFile !== fileKey) {
      kept.push(entry);
      continue;
    }

    const rawEntity = String(entry?.entity || "").trim();
    const entryEntity = rawEntity.toLowerCase();
    const isWildcard = rawEntity === "" || rawEntity === "*";

    if (isWildcard) {
      wildcardEntries.push(entry);
      continue;
    }
    if (entryEntity === entityKey) {
      impact.entity = true;
      continue;
    }
    kept.push(entry);
  }

  if (wildcardEntries.length > 0) {
    const remainingNames = collectReferencedEntityNames(referencedYamlText)
      .filter((name) => String(name || "").trim().toLowerCase() !== entityKey);

    if (remainingNames.length > 0) {
      const existing = new Set(
        kept.map((entry) => `${normalizePathLike(entry?.file)}::${String(entry?.entity || "").trim().toLowerCase()}`)
      );
      wildcardEntries.forEach((entry, index) => {
        remainingNames.forEach((name) => {
          const key = `${fileKey}::${String(name).toLowerCase()}`;
          if (existing.has(key)) return;
          existing.add(key);
          const next = { file: fileKey, entity: name };
          // If the wildcard only expands to one survivor, preserve its saved
          // coordinates instead of dropping the layout hint on delete.
          if (remainingNames.length === 1 && index === 0) {
            if (Number.isFinite(Number(entry?.x))) next.x = Math.round(Number(entry.x));
            if (Number.isFinite(Number(entry?.y))) next.y = Math.round(Number(entry.y));
            if (Number.isFinite(Number(entry?.width))) next.width = Math.round(Number(entry.width));
          }
          kept.push(next);
        });
      });
      impact.entity = true;
    } else if (collectReferencedEntityNames(referencedYamlText).length > 0) {
      impact.entity = true;
    }
  }

  if (!impact.entity) return null;

  doc.entities = kept;

  if (Array.isArray(doc.relationships)) {
    const before = doc.relationships.length;
    doc.relationships = doc.relationships.filter((rel) => {
      const from = String(rel?.from?.entity || rel?.from?.table || "").toLowerCase();
      const to = String(rel?.to?.entity || rel?.to?.table || "").toLowerCase();
      return from !== entityKey && to !== entityKey;
    });
    impact.relationships = before - doc.relationships.length;
  }

  return { yaml: dump(doc), impact };
}

/* Append a diagram-level relationship to a `.diagram.yaml` document.
 * Diagram-level relationships carry FKs authored on the canvas (drag-to-
 * relate, "Add Relationship" dialog) without mutating any of the
 * referenced model files. Shape matches `diagram.schema.json`:
 *   {name, from:{entity,field}, to:{entity,field}, cardinality,
 *    identifying?, label?, description?, verb?, relationship_type?, rationale?, source_of_truth?}
 *
 * Dedupes by `{from, to}` endpoint pair — the same edge authored twice
 * is a no-op. Returns new YAML text, or null when the doc doesn't
 * parse as an object. */
export function addDiagramRelationship(yamlText, rel) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const fromEnt = String(rel?.from?.entity || "").trim();
  const fromFld = String(rel?.from?.field || "").trim();
  const toEnt = String(rel?.to?.entity || "").trim();
  const toFld = String(rel?.to?.field || "").trim();
  if (!fromEnt || !toEnt) return null;

  if (!Array.isArray(doc.relationships)) doc.relationships = [];
  const dupe = doc.relationships.some((r) =>
    relationshipEndpointKey(r?.from) === `${fromEnt}.${fromFld}`.toLowerCase() &&
    relationshipEndpointKey(r?.to) === `${toEnt}.${toFld}`.toLowerCase()
  );
  if (dupe) return yamlText;

  const entry = {
    name: rel?.name ? String(rel.name) : `${fromEnt}_to_${toEnt}`.toLowerCase(),
    from: fromFld ? { entity: fromEnt, field: fromFld } : { entity: fromEnt },
    to: toFld ? { entity: toEnt, field: toFld } : { entity: toEnt },
  };
  if (rel?.cardinality) entry.cardinality = String(rel.cardinality);
  if (rel?.identifying) entry.identifying = true;
  if (rel?.label) entry.label = String(rel.label);
  if (rel?.description) entry.description = String(rel.description);
  if (rel?.verb) entry.verb = String(rel.verb);
  if (rel?.relationship_type) entry.relationship_type = String(rel.relationship_type);
  if (rel?.from_role) entry.from_role = String(rel.from_role);
  if (rel?.to_role) entry.to_role = String(rel.to_role);
  if (rel?.rationale) entry.rationale = String(rel.rationale);
  if (rel?.source_of_truth) entry.source_of_truth = String(rel.source_of_truth);
  doc.relationships.push(entry);
  return dump(doc);
}

/* ─── Diagram sticky notes (v0.3.4) ─────────────────────────────
 * Free-form annotations persisted in a `.diagram.yaml` under
 * `notes: [{id, text, x, y, width?, height?, color?}]`. Dialog authored
 * on the canvas; round-trips through these helpers so a refresh / git
 * clone preserves the stickies next to the edges and entity refs.
 */

function roundInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function buildNoteEntry({ id, text, x, y, width, height, color }) {
  const entry = { id: String(id) };
  if (typeof text === "string" && text.length > 0) entry.text = text;
  const rx = roundInt(x); if (rx != null) entry.x = rx;
  const ry = roundInt(y); if (ry != null) entry.y = ry;
  const rw = roundInt(width); if (rw != null) entry.width = rw;
  const rh = roundInt(height); if (rh != null) entry.height = rh;
  if (Number.isInteger(color) && color >= 0) entry.color = color;
  return entry;
}

/* Append a new sticky note. Caller supplies the id so the UI can
 * optimistically render the same key before the YAML round-trips.
 * Dedupes by id (same id => no-op). */
export function addDiagramNote(yamlText, note) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const id = String(note?.id || "").trim();
  if (!id) return null;
  if (!Array.isArray(doc.notes)) doc.notes = [];
  if (doc.notes.some((n) => String(n?.id || "") === id)) return yamlText;
  doc.notes.push(buildNoteEntry(note));
  return dump(doc);
}

/* Patch an existing note by id. Any of {text, x, y, width, height, color}
 * may be updated; undefined keys are left untouched. Returns the input
 * unchanged when the note isn't found, so UI callers can safely race a
 * delete with a drag-end. */
export function patchDiagramNote(yamlText, id, patch) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  if (!Array.isArray(doc.notes)) return yamlText;
  const target = String(id || "");
  const idx = doc.notes.findIndex((n) => String(n?.id || "") === target);
  if (idx < 0) return yamlText;
  const current = doc.notes[idx] || {};
  const next = { ...current };
  if (patch.text !== undefined) {
    if (patch.text === "" || patch.text == null) delete next.text;
    else next.text = String(patch.text);
  }
  const applyNum = (key) => {
    if (patch[key] === undefined) return;
    if (patch[key] === null) { delete next[key]; return; }
    const r = roundInt(patch[key]);
    if (r != null) next[key] = r;
  };
  applyNum("x");
  applyNum("y");
  applyNum("width");
  applyNum("height");
  if (patch.color !== undefined) {
    if (patch.color === null) delete next.color;
    else if (Number.isInteger(patch.color)) next.color = patch.color;
  }
  doc.notes[idx] = next;
  return dump(doc);
}

/* Remove a note by id. No-op if the note isn't there. */
export function deleteDiagramNote(yamlText, id) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  if (!Array.isArray(doc.notes)) return yamlText;
  const target = String(id || "");
  const before = doc.notes.length;
  doc.notes = doc.notes.filter((n) => String(n?.id || "") !== target);
  if (doc.notes.length === before) return yamlText;
  if (doc.notes.length === 0) delete doc.notes;
  return dump(doc);
}

/* Patch a relationship by name. `patch` may set any of:
     { name, from, to, cardinality, on_delete, on_update, identifying,
       optional, description }.
   Undefined keys ignored; null/empty string on string keys clears the
   key. Returns new YAML or null when the doc can't be parsed / relation
   not found. Used by the right-panel relationship editor. */
export function patchRelationship(yamlText, relName, patch) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  if (!Array.isArray(doc.relationships)) return null;
  const isDiagram = String(doc.kind || "").toLowerCase() === "diagram";
  const target = String(relName || "").toLowerCase();
  if (!target) return null;
  const originalFromKey = relationshipEndpointKey(patch?._match?.from);
  const originalToKey = relationshipEndpointKey(patch?._match?.to);
  const matchingIndexes = [];
  doc.relationships.forEach((r, index) => {
    const nameMatch = String(r?.name || "").toLowerCase() === target;
    const endpointMatch = originalFromKey && originalToKey
      && relationshipEndpointKey(r?.from) === originalFromKey
      && relationshipEndpointKey(r?.to) === originalToKey;
    if (nameMatch || endpointMatch) matchingIndexes.push(index);
  });
  if (matchingIndexes.length === 0) return null;
  const selectedIndex = matchingIndexes.find((index) =>
    originalFromKey && originalToKey
      && relationshipEndpointKey(doc.relationships[index]?.from) === originalFromKey
      && relationshipEndpointKey(doc.relationships[index]?.to) === originalToKey
  ) ?? matchingIndexes[0];
  const rel = doc.relationships[selectedIndex];

  if (patch.name != null && patch.name !== rel.name) rel.name = String(patch.name);
  if (patch.from != null) {
    if (rel.from && typeof rel.from === "object" && !Array.isArray(rel.from)) {
      const parsed = normalizedRelationshipEndpoint(patch.from);
      if (parsed) {
        if (Object.prototype.hasOwnProperty.call(rel.from, "entity")) rel.from.entity = parsed.entity;
        else if (Object.prototype.hasOwnProperty.call(rel.from, "table")) rel.from.table = parsed.entity;
        else rel.from.entity = parsed.entity;
        if (parsed.field) {
          if (Object.prototype.hasOwnProperty.call(rel.from, "field")) rel.from.field = parsed.field;
          else if (Object.prototype.hasOwnProperty.call(rel.from, "column")) rel.from.column = parsed.field;
          else if (Object.prototype.hasOwnProperty.call(rel.from, "col")) rel.from.col = parsed.field;
          else rel.from.field = parsed.field;
        } else {
          delete rel.from.field;
          delete rel.from.column;
          delete rel.from.col;
        }
      } else {
        rel.from = String(patch.from);
      }
    } else {
      const parsed = normalizedRelationshipEndpoint(patch.from);
      rel.from = parsed ? (parsed.field ? `${parsed.entity}.${parsed.field}` : parsed.entity) : String(patch.from);
    }
  }
  if (patch.to != null) {
    if (rel.to && typeof rel.to === "object" && !Array.isArray(rel.to)) {
      const parsed = normalizedRelationshipEndpoint(patch.to);
      if (parsed) {
        if (Object.prototype.hasOwnProperty.call(rel.to, "entity")) rel.to.entity = parsed.entity;
        else if (Object.prototype.hasOwnProperty.call(rel.to, "table")) rel.to.table = parsed.entity;
        else rel.to.entity = parsed.entity;
        if (parsed.field) {
          if (Object.prototype.hasOwnProperty.call(rel.to, "field")) rel.to.field = parsed.field;
          else if (Object.prototype.hasOwnProperty.call(rel.to, "column")) rel.to.column = parsed.field;
          else if (Object.prototype.hasOwnProperty.call(rel.to, "col")) rel.to.col = parsed.field;
          else rel.to.field = parsed.field;
        } else {
          delete rel.to.field;
          delete rel.to.column;
          delete rel.to.col;
        }
      } else {
        rel.to = String(patch.to);
      }
    } else {
      const parsed = normalizedRelationshipEndpoint(patch.to);
      rel.to = parsed ? (parsed.field ? `${parsed.entity}.${parsed.field}` : parsed.entity) : String(patch.to);
    }
  }
  if (patch.cardinality != null) rel.cardinality = String(patch.cardinality);
  if (patch.description !== undefined) {
    if (patch.description) rel.description = String(patch.description);
    else delete rel.description;
  }
  if (patch.verb !== undefined) {
    if (patch.verb) rel.verb = String(patch.verb);
    else delete rel.verb;
  }
  if (patch.relationship_type !== undefined) {
    if (patch.relationship_type) rel.relationship_type = String(patch.relationship_type);
    else delete rel.relationship_type;
  }
  if (patch.from_role !== undefined) {
    if (patch.from_role) rel.from_role = String(patch.from_role);
    else delete rel.from_role;
  }
  if (patch.to_role !== undefined) {
    if (patch.to_role) rel.to_role = String(patch.to_role);
    else delete rel.to_role;
  }
  if (patch.rationale !== undefined) {
    if (patch.rationale) rel.rationale = String(patch.rationale);
    else delete rel.rationale;
  }
  if (patch.source_of_truth !== undefined) {
    if (patch.source_of_truth) rel.source_of_truth = String(patch.source_of_truth);
    else delete rel.source_of_truth;
  }
  if (patch.on_delete !== undefined) {
    const v = String(patch.on_delete || "").trim();
    if (v && v.toUpperCase() !== "NO ACTION") rel.on_delete = v;
    else delete rel.on_delete;
  }
  if (patch.on_update !== undefined) {
    const v = String(patch.on_update || "").trim();
    if (v && v.toUpperCase() !== "NO ACTION") rel.on_update = v;
    else delete rel.on_update;
  }
  if (patch.identifying !== undefined) {
    if (patch.identifying) rel.identifying = true;
    else delete rel.identifying;
  }
  if (patch.optional !== undefined) {
    if (patch.optional) rel.optional = true;
    else delete rel.optional;
  }

  if (isDiagram) {
    const from = normalizedRelationshipEndpoint(rel.from);
    const to = normalizedRelationshipEndpoint(rel.to);
    if (!from || !to) return null;
    rel.from = from.field ? { entity: from.entity, field: from.field } : { entity: from.entity };
    rel.to = to.field ? { entity: to.entity, field: to.field } : { entity: to.entity };

    const finalName = String(rel?.name || "").toLowerCase();
    const finalFromKey = relationshipEndpointKey(rel.from);
    const finalToKey = relationshipEndpointKey(rel.to);
    const seen = new Set();
    const deduped = [];
    doc.relationships.forEach((entry, index) => {
      const entryName = String(entry?.name || "").toLowerCase();
      const entryFromKey = relationshipEndpointKey(entry?.from);
      const entryToKey = relationshipEndpointKey(entry?.to);
      const matchesEdited = index === selectedIndex
        || (entryName === target)
        || (originalFromKey && originalToKey && entryFromKey === originalFromKey && entryToKey === originalToKey)
        || (finalName && entryName === finalName)
        || (entryFromKey === finalFromKey && entryToKey === finalToKey);
      if (!matchesEdited) {
        deduped.push(entry);
        return;
      }
      const signature = `${finalName}|${finalFromKey}|${finalToKey}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      deduped.push(rel);
    });
    doc.relationships = deduped;
  }

  return dump(doc);
}
