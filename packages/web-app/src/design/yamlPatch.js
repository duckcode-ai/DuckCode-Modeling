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

/* Delete an entity and any relationships that reference it. */
export function deleteEntity(yamlText, entityName) {
  const doc = loadDoc(yamlText);
  if (!doc) return null;
  const target = String(entityName || "").toLowerCase();
  if (!target) return null;
  doc.entities = (doc.entities || []).filter(
    (e) => String(e.name || "").toLowerCase() !== target
  );
  if (Array.isArray(doc.relationships)) {
    doc.relationships = doc.relationships.filter((r) => {
      const from = String(r.from || "").split(".")[0].toLowerCase();
      const to = String(r.to || "").split(".")[0].toLowerCase();
      return from !== target && to !== target;
    });
  }
  return dump(doc);
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
