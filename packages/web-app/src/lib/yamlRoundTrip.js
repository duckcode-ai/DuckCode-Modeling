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

function coerceStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function coerceKeySets(value) {
  if (Array.isArray(value)) {
    return value
      .map((keyset) => coerceStringList(keyset))
      .filter((keyset) => keyset.length > 0);
  }
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((item) => item.trim()).filter(Boolean))
    .filter((keyset) => keyset.length > 0);
}

function uniqueEntityName(entities, requestedName, fallback = "NewEntity") {
  const names = new Set((entities || []).map((entity) => entity.name));
  let name = String(requestedName || fallback).trim() || fallback;
  let index = 1;
  while (names.has(name)) {
    index += 1;
    name = `${String(requestedName || fallback).trim() || fallback}${index}`;
  }
  return name;
}

function entitySeed(type, entityName) {
  const stem = String(entityName || "entity")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "entity";

  if (type === "concept") {
    return {
      type,
      fields: [
        { name: `${stem}_code`, type: "string", nullable: false },
        { name: `${stem}_name`, type: "string", nullable: false },
      ],
    };
  }
  if (type === "logical_entity") {
    return {
      type,
      candidate_keys: [[`${stem}_id`]],
      fields: [
        { name: `${stem}_id`, type: "string", nullable: false },
        { name: `${stem}_name`, type: "string", nullable: false },
      ],
    };
  }
  if (type === "fact_table") {
    return {
      type,
      grain: [`${stem}_id`],
      dimension_refs: [],
      fields: [
        { name: `${stem}_id`, type: "integer", primary_key: true, nullable: false },
        { name: "event_date", type: "date", nullable: false },
        { name: "amount", type: "decimal(12,2)", nullable: false },
      ],
    };
  }
  if (type === "dimension_table") {
    return {
      type,
      scd_type: 2,
      natural_key: `${stem}_code`,
      surrogate_key: `${stem}_sk`,
      fields: [
        { name: `${stem}_sk`, type: "integer", primary_key: true, nullable: false },
        { name: `${stem}_code`, type: "string", nullable: false },
        { name: `${stem}_name`, type: "string", nullable: false },
        { name: "effective_from", type: "date", nullable: false },
        { name: "effective_to", type: "date", nullable: false },
        { name: "is_current", type: "boolean", nullable: false },
      ],
    };
  }
  if (type === "bridge_table") {
    return {
      type,
      fields: [
        { name: `${stem}_id`, type: "integer", primary_key: true, nullable: false },
        { name: "left_entity_id", type: "integer", nullable: false, foreign_key: true },
        { name: "right_entity_id", type: "integer", nullable: false, foreign_key: true },
      ],
    };
  }
  if (type === "hub") {
    return {
      type,
      business_keys: [[`${stem}_id`]],
      hash_key: `${stem}_hk`,
      load_timestamp_field: "loaded_at",
      record_source_field: "record_source",
      fields: [
        { name: `${stem}_hk`, type: "string", primary_key: true, nullable: false },
        { name: `${stem}_id`, type: "string", nullable: false },
        { name: "loaded_at", type: "timestamp", nullable: false },
        { name: "record_source", type: "string", nullable: false },
      ],
    };
  }
  if (type === "link") {
    return {
      type,
      link_refs: [],
      hash_key: `${stem}_hk`,
      load_timestamp_field: "loaded_at",
      record_source_field: "record_source",
      fields: [
        { name: `${stem}_hk`, type: "string", primary_key: true, nullable: false },
        { name: "left_hk", type: "string", nullable: false },
        { name: "right_hk", type: "string", nullable: false },
        { name: "loaded_at", type: "timestamp", nullable: false },
        { name: "record_source", type: "string", nullable: false },
      ],
    };
  }
  if (type === "satellite") {
    return {
      type,
      parent_entity: "",
      hash_diff_fields: ["descriptive_attr"],
      load_timestamp_field: "loaded_at",
      record_source_field: "record_source",
      fields: [
        { name: "parent_hk", type: "string", nullable: false },
        { name: "descriptive_attr", type: "string", nullable: false },
        { name: "loaded_at", type: "timestamp", nullable: false },
        { name: "record_source", type: "string", nullable: false },
      ],
    };
  }

  return {
    type,
    fields: [
      { name: "id", type: "integer", primary_key: true, nullable: false },
    ],
  };
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

export function setEntityScalarProperty(yamlText, entityName, key, value) {
  return mutateModel(yamlText, (model) => {
    const entity = (model.entities || []).find((e) => e.name === entityName);
    if (!entity) return;
    if (value === null || value === undefined) {
      delete entity[key];
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) delete entity[key];
      else entity[key] = trimmed;
      return;
    }
    entity[key] = value;
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
    const name = uniqueEntityName(model.entities, entityName, "NewEntity");
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

export function addEntityWithOptions(yamlText, options = {}) {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.entities)) model.entities = [];
    const type = String(options.type || "table").trim() || "table";
    const name = uniqueEntityName(model.entities, options.name, "NewEntity");
    const starter = entitySeed(type, name);
    const entity = {
      name,
      description: String(options.description || ""),
      tags: Array.isArray(options.tags) ? options.tags : [],
      ...starter,
    };
    if (options.subjectArea) entity.subject_area = String(options.subjectArea).trim();
    if (options.schema) entity.schema = String(options.schema).trim();
    model.entities.push(entity);
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

export function setEntityListProperty(yamlText, entityName, key, value) {
  const nextValues = coerceStringList(value);
  return mutateModel(yamlText, (model) => {
    const entity = (model.entities || []).find((e) => e.name === entityName);
    if (!entity) return;
    if (nextValues.length === 0) delete entity[key];
    else entity[key] = nextValues;
  });
}

export function setEntityKeySets(yamlText, entityName, key, value) {
  const nextKeySets = coerceKeySets(value);
  return mutateModel(yamlText, (model) => {
    const entity = (model.entities || []).find((e) => e.name === entityName);
    if (!entity) return;
    if (nextKeySets.length === 0) delete entity[key];
    else entity[key] = nextKeySets;
  });
}

export function bulkAssignSubjectArea(yamlText, entityNames, subjectArea) {
  const targets = new Set(coerceStringList(entityNames));
  const area = String(subjectArea || "").trim();
  return mutateModel(yamlText, (model) => {
    for (const entity of model.entities || []) {
      if (!targets.has(entity.name)) continue;
      if (area) entity.subject_area = area;
      else delete entity.subject_area;
    }
  });
}

export function addDomain(yamlText, name, dataType = "string", description = "") {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.domains)) model.domains = [];
    const domainName = String(name || "").trim();
    if (!domainName || model.domains.some((item) => item?.name === domainName)) return;
    model.domains.push({
      name: domainName,
      data_type: String(dataType || "string").trim() || "string",
      description: String(description || ""),
    });
  });
}

export function addTemplate(yamlText, name) {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.templates)) model.templates = [];
    const templateName = String(name || "").trim();
    if (!templateName || model.templates.some((item) => item?.name === templateName)) return;
    model.templates.push({
      name: templateName,
      fields: [
        { name: "created_at", type: "timestamp", nullable: false },
      ],
    });
  });
}

export function addEnum(yamlText, name, values) {
  const enumValues = coerceStringList(values);
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.enums)) model.enums = [];
    const enumName = String(name || "").trim();
    if (!enumName || model.enums.some((item) => item?.name === enumName)) return;
    model.enums.push({
      name: enumName,
      values: enumValues,
    });
  });
}

/* Replace the value list on an existing enum. Used by EnumsView's inline
   chip editor. Accepts a string[] or a csv/newline string. */
export function updateEnumValues(yamlText, name, values) {
  const enumValues = coerceStringList(values);
  return mutateModel(yamlText, (model) => {
    const enumName = String(name || "").trim();
    if (!enumName || !Array.isArray(model.enums)) return;
    const target = model.enums.find((item) => item?.name === enumName);
    if (!target) return;
    target.values = enumValues;
  });
}

/* Remove an enum by name. No-op if missing. */
export function removeEnum(yamlText, name) {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.enums)) return;
    const enumName = String(name || "").trim();
    if (!enumName) return;
    model.enums = model.enums.filter((item) => item?.name !== enumName);
  });
}

/* Update fields on an existing index (name, fields, unique, type,
   description). Missing index → no-op. Returns new YAML. Used by the
   right-panel IndexesView inspector tab (addIndex/removeIndex are
   defined below with the long-form signature used by EntityPanel). */
export function updateIndex(yamlText, name, patch) {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.indexes)) return;
    const target = String(name || "").trim();
    if (!target) return;
    const ix = model.indexes.find((item) => item?.name === target);
    if (!ix) return;
    if (patch?.name != null && patch.name !== ix.name) ix.name = String(patch.name);
    if (patch?.fields !== undefined) ix.fields = coerceStringList(patch.fields);
    if (patch?.unique !== undefined) {
      if (patch.unique) ix.unique = true;
      else delete ix.unique;
    }
    if (patch?.type !== undefined) {
      if (patch.type) ix.type = String(patch.type);
      else delete ix.type;
    }
    if (patch?.description !== undefined) {
      if (patch.description) ix.description = String(patch.description);
      else delete ix.description;
    }
  });
}

/* deleteRelationship is a named alias for removeRelationship (defined above)
   so the right-panel inspector can import the more explicit name. */
export const deleteRelationship = removeRelationship;

export function addSubjectArea(yamlText, name, description = "") {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.subject_areas)) model.subject_areas = [];
    const areaName = String(name || "").trim();
    if (!areaName || model.subject_areas.some((item) => item?.name === areaName)) return;
    model.subject_areas.push({ name: areaName, description: String(description || "") });
  });
}

export function setNamingRule(yamlText, target, style, pattern = "") {
  return mutateModel(yamlText, (model) => {
    if (!model.naming_rules || typeof model.naming_rules !== "object" || Array.isArray(model.naming_rules)) {
      model.naming_rules = {};
    }
    const key = String(target || "").trim();
    if (!key) return;
    const nextRule = {};
    if (String(style || "").trim()) nextRule.style = String(style).trim();
    if (String(pattern || "").trim()) nextRule.pattern = String(pattern).trim();
    if (Object.keys(nextRule).length === 0) delete model.naming_rules[key];
    else model.naming_rules[key] = nextRule;
  });
}

export function addIndex(yamlText, name, entityName, fields, unique = false, type = "btree") {
  const indexName = String(name || "").trim();
  const entity = String(entityName || "").trim();
  const fieldList = coerceStringList(fields);
  return mutateModel(yamlText, (model) => {
    if (!indexName || !entity || fieldList.length === 0) return;
    if (!Array.isArray(model.indexes)) model.indexes = [];
    if (model.indexes.some((item) => item?.name === indexName)) return;
    model.indexes.push({
      name: indexName,
      entity,
      fields: fieldList,
      unique: Boolean(unique),
      ...(type && type !== "btree" ? { type } : {}),
    });
  });
}

export function removeIndex(yamlText, name) {
  return mutateModel(yamlText, (model) => {
    if (!Array.isArray(model.indexes)) return;
    model.indexes = model.indexes.filter((idx) => idx.name !== name);
  });
}
