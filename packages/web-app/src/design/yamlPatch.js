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

/* Find an entity by its name (case-insensitive match because the adapter
   lowercases ids when surfacing them). */
function findEntity(doc, entityName) {
  if (!doc || !Array.isArray(doc.entities)) return null;
  const target = String(entityName || "").toLowerCase();
  return doc.entities.find((e) => String(e.name || "").toLowerCase() === target) || null;
}

function findField(entity, fieldName) {
  if (!entity || !Array.isArray(entity.fields)) return null;
  const target = String(fieldName || "").toLowerCase();
  return entity.fields.find((f) => String(f.name || "").toLowerCase() === target) || null;
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
  entity.fields = entity.fields || [];
  entity.fields.push(fieldSpec);
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
  entity.fields = (entity.fields || []).filter(
    (f) => String(f.name || "").toLowerCase() !== target
  );
  return dump(doc);
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

/* Append a diagram-level relationship to a `.diagram.yaml` document.
 * Diagram-level relationships carry FKs authored on the canvas (drag-to-
 * relate, "Add Relationship" dialog) without mutating any of the
 * referenced model files. Shape matches `diagram.schema.json`:
 *   {name, from:{entity,field}, to:{entity,field}, cardinality,
 *    identifying?, label?}
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
    String(r?.from?.entity || "").toLowerCase() === fromEnt.toLowerCase() &&
    String(r?.from?.field || "").toLowerCase() === fromFld.toLowerCase() &&
    String(r?.to?.entity || "").toLowerCase() === toEnt.toLowerCase() &&
    String(r?.to?.field || "").toLowerCase() === toFld.toLowerCase()
  );
  if (dupe) return yamlText;

  const entry = {
    name: rel?.name ? String(rel.name) : `${fromEnt}_to_${toEnt}`.toLowerCase(),
    from: { entity: fromEnt, ...(fromFld ? { field: fromFld } : {}) },
    to: { entity: toEnt, ...(toFld ? { field: toFld } : {}) },
  };
  if (rel?.cardinality) entry.cardinality = String(rel.cardinality);
  if (rel?.identifying) entry.identifying = true;
  if (rel?.optional) entry.optional = true;
  if (rel?.on_delete) entry.on_delete = String(rel.on_delete);
  if (rel?.label) entry.label = String(rel.label);
  if (rel?.verb) entry.verb = String(rel.verb);
  if (rel?.description) entry.description = String(rel.description);
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
  const target = String(relName || "").toLowerCase();
  if (!target) return null;
  const rel = doc.relationships.find(
    (r) => String(r?.name || "").toLowerCase() === target
  );
  if (!rel) return null;

  if (patch.name != null && patch.name !== rel.name) rel.name = String(patch.name);
  if (patch.from != null) rel.from = String(patch.from);
  if (patch.to != null)   rel.to = String(patch.to);
  if (patch.cardinality != null) rel.cardinality = String(patch.cardinality);
  if (patch.description !== undefined) {
    if (patch.description) rel.description = String(patch.description);
    else delete rel.description;
  }
  if (patch.verb !== undefined) {
    if (patch.verb) rel.verb = String(patch.verb);
    else delete rel.verb;
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
  return dump(doc);
}
