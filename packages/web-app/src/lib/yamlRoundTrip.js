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
    // Clean up metric references
    if (Array.isArray(model.metrics)) {
      model.metrics = model.metrics
        .map((metric) => {
          if (metric.entity !== entityName) return metric;
          const grain = Array.isArray(metric.grain) ? metric.grain.filter((f) => f !== fieldName) : metric.grain;
          const dimensions = Array.isArray(metric.dimensions) ? metric.dimensions.filter((f) => f !== fieldName) : metric.dimensions;
          const expression = metric.expression === fieldName ? "" : metric.expression;
          const time_dimension = metric.time_dimension === fieldName ? undefined : metric.time_dimension;
          return { ...metric, grain, dimensions, expression, ...(time_dimension ? { time_dimension } : {}) };
        })
        .filter((metric) => {
          if (metric.entity !== entityName) return true;
          const hasGrain = Array.isArray(metric.grain) ? metric.grain.length > 0 : true;
          const hasExpression = String(metric.expression || "").trim().length > 0;
          return hasGrain && hasExpression;
        });
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
    // Clean up indexes
    if (Array.isArray(model.indexes)) {
      model.indexes = model.indexes.filter((idx) => idx.entity !== entityName);
    }
    // Clean up metrics
    if (Array.isArray(model.metrics)) {
      model.metrics = model.metrics.filter((metric) => metric.entity !== entityName);
    }
  });
}

export function renameField(yamlText, entityName, oldFieldName, newFieldName) {
  const next = String(newFieldName || "").trim();
  if (!next || next === oldFieldName) return { yaml: yamlText, error: null };

  return mutateModel(yamlText, (model) => {
    const entity = (model.entities || []).find((e) => e.name === entityName);
    if (!entity || !Array.isArray(entity.fields)) return;

    const exists = entity.fields.some((f) => f.name === next);
    if (exists) return;

    const field = entity.fields.find((f) => f.name === oldFieldName);
    if (!field) return;
    field.name = next;

    // Update governance references
    if (model.governance?.classification) {
      const oldKey = `${entityName}.${oldFieldName}`;
      const newKey = `${entityName}.${next}`;
      if (Object.prototype.hasOwnProperty.call(model.governance.classification, oldKey)) {
        model.governance.classification[newKey] = model.governance.classification[oldKey];
        delete model.governance.classification[oldKey];
      }
    }
    if (model.governance?.stewards) {
      const oldKey = `${entityName}.${oldFieldName}`;
      const newKey = `${entityName}.${next}`;
      if (Object.prototype.hasOwnProperty.call(model.governance.stewards, oldKey)) {
        model.governance.stewards[newKey] = model.governance.stewards[oldKey];
        delete model.governance.stewards[oldKey];
      }
    }

    // Update relationships that point at this field
    if (Array.isArray(model.relationships)) {
      model.relationships = model.relationships.map((r) => {
        const from = r.from === `${entityName}.${oldFieldName}` ? `${entityName}.${next}` : r.from;
        const to = r.to === `${entityName}.${oldFieldName}` ? `${entityName}.${next}` : r.to;
        return (from === r.from && to === r.to) ? r : { ...r, from, to };
      });
    }

    // Update indexes referencing this field
    if (Array.isArray(model.indexes)) {
      model.indexes = model.indexes.map((idx) => {
        if (idx.entity !== entityName || !Array.isArray(idx.fields)) return idx;
        const fields = idx.fields.map((f) => (f === oldFieldName ? next : f));
        const changed = fields.some((f, i) => f !== idx.fields[i]);
        return changed ? { ...idx, fields } : idx;
      });
    }

    // Update metric references that point at this field
    if (Array.isArray(model.metrics)) {
      model.metrics = model.metrics.map((metric) => {
        if (metric.entity !== entityName) return metric;
        const grain = Array.isArray(metric.grain)
          ? metric.grain.map((f) => (f === oldFieldName ? next : f))
          : metric.grain;
        const dimensions = Array.isArray(metric.dimensions)
          ? metric.dimensions.map((f) => (f === oldFieldName ? next : f))
          : metric.dimensions;
        const expression = metric.expression === oldFieldName ? next : metric.expression;
        const time_dimension = metric.time_dimension === oldFieldName ? next : metric.time_dimension;
        return { ...metric, grain, dimensions, expression, time_dimension };
      });
    }
  });
}

export function renameEntity(yamlText, oldEntityName, newEntityName) {
  const next = String(newEntityName || "").trim();
  if (!next || next === oldEntityName) return { yaml: yamlText, error: null };

  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.entities)) return;
    const exists = model.entities.some((e) => e.name === next);
    if (exists) return;

    const entity = model.entities.find((e) => e.name === oldEntityName);
    if (!entity) return;
    entity.name = next;

    // Update relationships
    if (Array.isArray(model.relationships)) {
      model.relationships = model.relationships.map((r) => {
        const fromParts = String(r.from || "").split(".");
        const toParts = String(r.to || "").split(".");
        if (fromParts[0] === oldEntityName) fromParts[0] = next;
        if (toParts[0] === oldEntityName) toParts[0] = next;
        const from = fromParts.filter(Boolean).join(".");
        const to = toParts.filter(Boolean).join(".");
        return (from === r.from && to === r.to) ? r : { ...r, from, to };
      });
    }

    // Update governance keys (classification + stewards)
    const rewriteGovernanceMap = (obj) => {
      if (!obj || typeof obj !== "object") return;
      for (const key of Object.keys(obj)) {
        if (!key.startsWith(`${oldEntityName}.`)) continue;
        const suffix = key.slice(oldEntityName.length);
        obj[`${next}${suffix}`] = obj[key];
        delete obj[key];
      }
    };
    rewriteGovernanceMap(model.governance?.classification);
    rewriteGovernanceMap(model.governance?.stewards);

    // Update indexes
    if (Array.isArray(model.indexes)) {
      model.indexes = model.indexes.map((idx) => (idx.entity === oldEntityName ? { ...idx, entity: next } : idx));
    }

    // Update metric entity references
    if (Array.isArray(model.metrics)) {
      model.metrics = model.metrics.map((metric) =>
        metric.entity === oldEntityName ? { ...metric, entity: next } : metric
      );
    }
  });
}
