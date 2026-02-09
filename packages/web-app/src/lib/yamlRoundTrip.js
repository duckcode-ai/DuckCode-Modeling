import yaml from "js-yaml";

export function parseYamlSafe(yamlText) {
  try {
    const doc = yaml.load(yamlText);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return { doc: null, error: "YAML root must be an object." };
    }
    return { doc, error: null };
  } catch (err) {
    return { doc: null, error: err.message || "YAML parse error" };
  }
}

export function dumpYaml(doc) {
  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
}

export function mutateModel(yamlText, mutator) {
  const { doc, error } = parseYamlSafe(yamlText);
  if (error || !doc) return { yaml: yamlText, error: error || "Invalid model" };

  const clone = JSON.parse(JSON.stringify(doc));
  mutator(clone);
  return { yaml: dumpYaml(clone), error: null };
}

export function updateEntityMeta(yamlText, entityName, key, value) {
  return mutateModel(yamlText, (model) => {
    const entity = (model.entities || []).find((e) => e.name === entityName);
    if (entity) entity[key] = value;
  });
}

export function updateEntityTags(yamlText, entityName, csvText) {
  const tags = csvText.split(",").map((t) => t.trim()).filter(Boolean);
  return updateEntityMeta(yamlText, entityName, "tags", tags);
}

export function updateFieldProperty(yamlText, entityName, fieldName, key, value) {
  return mutateModel(yamlText, (model) => {
    const entity = (model.entities || []).find((e) => e.name === entityName);
    if (!entity) return;
    const field = (entity.fields || []).find((f) => f.name === fieldName);
    if (field) field[key] = value;
  });
}

export function addField(yamlText, entityName) {
  return mutateModel(yamlText, (model) => {
    const entity = (model.entities || []).find((e) => e.name === entityName);
    if (!entity) return;
    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    const names = new Set(fields.map((f) => f.name));
    let name = "new_field";
    let i = 1;
    while (names.has(name)) { i++; name = `new_field_${i}`; }
    fields.push({ name, type: "string", nullable: true });
    entity.fields = fields;
  });
}

export function removeField(yamlText, entityName, fieldName) {
  return mutateModel(yamlText, (model) => {
    const entity = (model.entities || []).find((e) => e.name === entityName);
    if (!entity || !Array.isArray(entity.fields)) return;
    entity.fields = entity.fields.filter((f) => f.name !== fieldName);
    // Clean up governance references
    if (model.governance?.classification) {
      delete model.governance.classification[`${entityName}.${fieldName}`];
    }
    // Clean up relationship references
    if (Array.isArray(model.relationships)) {
      model.relationships = model.relationships.filter(
        (r) => r.from !== `${entityName}.${fieldName}` && r.to !== `${entityName}.${fieldName}`
      );
    }
  });
}

export function addRelationship(yamlText, name, from, to, cardinality) {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.relationships)) model.relationships = [];
    model.relationships.push({ name, from, to, cardinality });
  });
}

export function removeRelationship(yamlText, relName) {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.relationships)) return;
    model.relationships = model.relationships.filter((r) => r.name !== relName);
  });
}

export function addEntity(yamlText, entityName) {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.entities)) model.entities = [];
    const names = new Set(model.entities.map((e) => e.name));
    let name = entityName || "NewEntity";
    let i = 1;
    while (names.has(name)) { i++; name = `${entityName || "NewEntity"}${i}`; }
    model.entities.push({
      name,
      type: "table",
      description: "",
      tags: [],
      fields: [
        { name: "id", type: "integer", primary_key: true, nullable: false },
      ],
    });
  });
}

export function removeEntity(yamlText, entityName) {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.entities)) return;
    model.entities = model.entities.filter((e) => e.name !== entityName);
    // Clean up relationships
    if (Array.isArray(model.relationships)) {
      model.relationships = model.relationships.filter((r) => {
        const fromEntity = r.from?.split(".")[0];
        const toEntity = r.to?.split(".")[0];
        return fromEntity !== entityName && toEntity !== entityName;
      });
    }
    // Clean up governance
    if (model.governance?.classification) {
      for (const key of Object.keys(model.governance.classification)) {
        if (key.startsWith(`${entityName}.`)) {
          delete model.governance.classification[key];
        }
      }
    }
  });
}
