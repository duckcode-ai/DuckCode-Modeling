import yaml from "js-yaml";

export const CARDINALITY_COLOR = {
  one_to_one: "#2f7d32",
  one_to_many: "#0277bd",
  many_to_one: "#6a1b9a",
  many_to_many: "#ef6c00"
};

function buildLayoutPosition(index, total) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const row = Math.floor(index / columns);
  const column = index % columns;

  return {
    x: 60 + column * 380,
    y: 60 + row * 260
  };
}

function assertModelShape(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("YAML root must be an object.");
  }

  if (!Array.isArray(doc.entities) || doc.entities.length === 0) {
    throw new Error("Model requires a non-empty 'entities' array.");
  }
}

export function modelToFlow(doc) {
  const warnings = [];

  const entities = doc.entities;
  const relationships = Array.isArray(doc.relationships) ? doc.relationships : [];
  const classifications = doc.governance?.classification || {};

  const entityByName = new Map();
  const fieldRefs = new Set();

  for (const entity of entities) {
    if (!entity?.name) {
      throw new Error("Each entity needs a 'name'.");
    }
    entityByName.set(entity.name, entity);

    for (const field of entity.fields || []) {
      if (field?.name) {
        fieldRefs.add(`${entity.name}.${field.name}`);
      }
    }
  }

  const nodes = entities.map((entity, index) => {
    const tags = Array.isArray(entity.tags) ? entity.tags : [];
    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    return {
      id: entity.name,
      type: "entityNode",
      position: buildLayoutPosition(index, entities.length),
      data: {
        name: entity.name,
        type: entity.type || "table",
        description: entity.description || "",
        tags,
        fields,
        classifications
      }
    };
  });

  const edges = [];

  for (const rel of relationships) {
    const sourceRef = rel?.from;
    const targetRef = rel?.to;
    const cardinality = rel?.cardinality || "one_to_many";
    const relName = rel?.name || `${sourceRef}-${targetRef}`;

    if (!sourceRef || !targetRef || !sourceRef.includes(".") || !targetRef.includes(".")) {
      warnings.push(`Relationship '${relName}' has invalid field references.`);
      continue;
    }

    if (!fieldRefs.has(sourceRef) || !fieldRefs.has(targetRef)) {
      warnings.push(`Relationship '${relName}' references missing fields.`);
      continue;
    }

    const sourceEntity = sourceRef.split(".")[0];
    const targetEntity = targetRef.split(".")[0];

    if (!entityByName.has(sourceEntity) || !entityByName.has(targetEntity)) {
      warnings.push(`Relationship '${relName}' references missing entities.`);
      continue;
    }

    const edgeColor = CARDINALITY_COLOR[cardinality] || "#455a64";

    edges.push({
      id: `rel-${relName}`,
      source: sourceEntity,
      target: targetEntity,
      label: `${relName} (${cardinality})`,
      data: {
        name: relName,
        fromRef: sourceRef,
        toRef: targetRef,
        cardinality
      },
      style: { stroke: edgeColor, strokeWidth: 2 },
      labelStyle: { fill: "#475569", fontSize: 10, fontWeight: 600 },
      animated: cardinality === "many_to_many"
    });
  }

  return {
    model: doc,
    nodes,
    edges,
    warnings
  };
}

export function parseModelToFlow(yamlText) {
  const doc = yaml.load(yamlText);
  assertModelShape(doc);
  return modelToFlow(doc);
}
