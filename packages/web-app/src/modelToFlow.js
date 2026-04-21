import yaml from "js-yaml";
import { pickCrowsFootMarkers } from "./components/diagram/crowsFootMarkerIds.js";

export const CARDINALITY_COLOR = {
  one_to_one: "#2f7d32",
  one_to_many: "#0277bd",
  many_to_one: "#6a1b9a",
  many_to_many: "#ef6c00"
};

export const CARDINALITY_LABEL = {
  one_to_one: "1:1",
  one_to_many: "1:N",
  many_to_one: "N:1",
  many_to_many: "N:N",
};

function toDisplayText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => toDisplayText(v, "")).filter(Boolean).join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
}

function toTagList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => toDisplayText(v, "").trim()).filter(Boolean);
}

function toStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => toDisplayText(v, "").trim()).filter(Boolean);
}

function toKeySets(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((keySet) => toStringList(keySet))
    .filter((keySet) => keySet.length > 0);
}

function toFieldList(value) {
  if (!Array.isArray(value)) return [];
  const fields = [];
  for (const field of value) {
    if (!field || typeof field !== "object") continue;
    const name = toDisplayText(field.name, "").trim();
    if (!name) continue;
    const normalized = {
      ...field,
      name,
      type: toDisplayText(field.type, "string"),
    };
    if ("description" in field) normalized.description = toDisplayText(field.description, "");
    if ("sensitivity" in field && field.sensitivity != null) normalized.sensitivity = toDisplayText(field.sensitivity, "");
    if ("check" in field && field.check != null && typeof field.check === "object") {
      normalized.check = toDisplayText(field.check, "");
    }
    if ("default" in field && field.default != null && typeof field.default === "object") {
      normalized.default = toDisplayText(field.default, "");
    }
    fields.push(normalized);
  }
  return fields;
}

function toClassificationMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const [key, val] of Object.entries(value)) {
    normalized[key] = toDisplayText(val, "");
  }
  return normalized;
}

function toNormalizedSla(value) {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const freshness = toDisplayText(value.freshness, "");
    const qualityScore = toDisplayText(value.quality_score, "");
    if (!freshness && !qualityScore) return { value: "defined" };
    return {
      ...(freshness ? { freshness } : {}),
      ...(qualityScore ? { quality_score: qualityScore } : {}),
    };
  }
  return toDisplayText(value, "");
}

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
  const enums = Array.isArray(doc.enums) ? doc.enums : [];
  const relationships = Array.isArray(doc.relationships) ? doc.relationships : [];
  const indexes = Array.isArray(doc.indexes) ? doc.indexes : [];
  const classifications = toClassificationMap(doc.governance?.classification);

  const indexesByEntity = new Map();
  for (const idx of indexes) {
    const entity = toDisplayText(idx?.entity, "");
    const normalizedIdx = {
      ...idx,
      entity,
      fields: Array.isArray(idx?.fields)
        ? idx.fields.map((f) => toDisplayText(f, "").trim()).filter(Boolean)
        : [],
    };
    if (!indexesByEntity.has(entity)) indexesByEntity.set(entity, []);
    indexesByEntity.get(entity).push(normalizedIdx);
  }

  const entityByName = new Map();
  const fieldRefs = new Set();
  const fieldMetaByRef = new Map();
  const normalizedEntities = [];

  for (const entity of entities) {
    const entityName = toDisplayText(entity?.name, "").trim();
    if (!entityName) {
      throw new Error("Each entity needs a 'name'.");
    }
    const normalizedEntity = {
      ...entity,
      name: entityName,
      type: toDisplayText(entity?.type, "table") || "table",
      description: toDisplayText(entity?.description, ""),
      tags: toTagList(entity?.tags),
      fields: toFieldList(entity?.fields),
      subject_area: toDisplayText(entity?.subject_area, ""),
      owner: toDisplayText(entity?.owner, ""),
      schema: toDisplayText(entity?.schema, ""),
      database: toDisplayText(entity?.database, ""),
      sla: toNormalizedSla(entity?.sla),
      candidate_keys: toKeySets(entity?.candidate_keys),
      subtype_of: toDisplayText(entity?.subtype_of, ""),
      subtypes: toStringList(entity?.subtypes),
      derived_from: toDisplayText(entity?.derived_from, ""),
      mapped_from: toDisplayText(entity?.mapped_from, ""),
      templates: Array.from(
        new Set([
          ...toStringList(entity?.templates),
          ...toStringList(entity?.template ? [entity.template] : []),
        ])
      ),
      scd_type: entity?.scd_type ?? null,
      natural_key: toDisplayText(entity?.natural_key, ""),
      surrogate_key: toDisplayText(entity?.surrogate_key, ""),
      conformed: Boolean(entity?.conformed),
      dimension_refs: toStringList(entity?.dimension_refs),
      business_keys: toKeySets(entity?.business_keys),
      hash_key: toDisplayText(entity?.hash_key, ""),
      link_refs: toStringList(entity?.link_refs),
      parent_entity: toDisplayText(entity?.parent_entity, ""),
      hash_diff_fields: toStringList(entity?.hash_diff_fields),
      load_timestamp_field: toDisplayText(entity?.load_timestamp_field, ""),
      record_source_field: toDisplayText(entity?.record_source_field, ""),
      grain: toStringList(entity?.grain),
      partition_by: toStringList(entity?.partition_by),
      cluster_by: toStringList(entity?.cluster_by),
      distribution: toDisplayText(entity?.distribution, ""),
      storage: toDisplayText(entity?.storage, ""),
    };
    normalizedEntities.push(normalizedEntity);
    entityByName.set(normalizedEntity.name, normalizedEntity);

    for (const field of normalizedEntity.fields) {
      const ref = `${normalizedEntity.name}.${field.name}`;
      fieldRefs.add(ref);
      fieldMetaByRef.set(ref, field);
    }
  }

  const nodes = normalizedEntities.map((entity, index) => {
    const entityIndexes = indexesByEntity.get(entity.name) || [];
    return {
      id: entity.name,
      type: "entityNode",
      position: buildLayoutPosition(index, normalizedEntities.length),
      data: {
        name: entity.name,
        type: entity.type,
        description: entity.description,
        tags: entity.tags,
        fields: entity.fields,
        classifications,
        subject_area: entity.subject_area,
        owner: entity.owner,
        schema: entity.schema,
        database: entity.database,
        sla: entity.sla,
        indexes: entityIndexes,
        candidate_keys: entity.candidate_keys,
        subtype_of: entity.subtype_of,
        subtypes: entity.subtypes,
        derived_from: entity.derived_from,
        mapped_from: entity.mapped_from,
        templates: entity.templates,
        scd_type: entity.scd_type,
        natural_key: entity.natural_key,
        surrogate_key: entity.surrogate_key,
        conformed: entity.conformed,
        dimension_refs: entity.dimension_refs,
        business_keys: entity.business_keys,
        hash_key: entity.hash_key,
        link_refs: entity.link_refs,
        parent_entity: entity.parent_entity,
        hash_diff_fields: entity.hash_diff_fields,
        load_timestamp_field: entity.load_timestamp_field,
        record_source_field: entity.record_source_field,
        grain: entity.grain,
        partition_by: entity.partition_by,
        cluster_by: entity.cluster_by,
        distribution: entity.distribution,
        storage: entity.storage,
      }
    };
  });

  const totalNodes = normalizedEntities.length + enums.length;
  enums.forEach((enumDef, idx) => {
    const name = toDisplayText(enumDef?.name, "").trim();
    if (!name) return;
    const values = toStringList(enumDef?.values);
    const position = buildLayoutPosition(normalizedEntities.length + idx, Math.max(totalNodes, 1));
    nodes.push({
      id: `enum:${name}`,
      type: "enumNode",
      position,
      data: {
        name,
        values,
        description: toDisplayText(enumDef?.description, ""),
      },
    });
  });

  const relationshipCandidates = [];

  for (const rel of relationships) {
    const sourceRef = toDisplayText(rel?.from, "");
    const targetRef = toDisplayText(rel?.to, "");
    const cardinality = toDisplayText(rel?.cardinality, "one_to_many") || "one_to_many";
    const relName = toDisplayText(rel?.name, "") || `${sourceRef}-${targetRef}`;

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

    relationshipCandidates.push({
      rel,
      relName,
      sourceRef,
      targetRef,
      sourceEntity,
      targetEntity,
      cardinality,
    });
  }

  const targetRefCounts = new Map();
  for (const candidate of relationshipCandidates) {
    const count = targetRefCounts.get(candidate.targetRef) || 0;
    targetRefCounts.set(candidate.targetRef, count + 1);
  }

  const edges = [];
  for (const candidate of relationshipCandidates) {
    const {
      rel,
      relName,
      sourceRef,
      targetRef,
      sourceEntity,
      targetEntity,
      cardinality,
    } = candidate;
    const sourceField = fieldMetaByRef.get(sourceRef) || {};
    const targetField = fieldMetaByRef.get(targetRef) || {};
    const sourceFieldName = sourceRef.split(".")[1];
    const targetFieldName = targetRef.split(".")[1];

    const isSelf = sourceEntity === targetEntity;
    const pkToFk = Boolean(sourceField.primary_key && targetField.foreign_key);
    const fkToPk = Boolean(sourceField.foreign_key && targetField.primary_key);
    const sharedTargetCount = targetRefCounts.get(targetRef) || 1;
    const sharedTarget = sharedTargetCount > 1;

    const edgeColor =
      isSelf ? "#f59e0b" :
      pkToFk ? "#0ea5e9" :
      fkToPk ? "#8b5cf6" :
      CARDINALITY_COLOR[cardinality] || "#455a64";

    // Identifying vs non-identifying.
    //   - Explicit: `relationship.identifying: true` in YAML.
    //   - Auto: the FK column on the referencing side is itself part of
    //     that entity's primary key (classic identifying pattern — child
    //     rows can't exist without a parent, FK is in the PK).
    // Rendering:
    //   - Identifying     → solid stroke (default).
    //   - Non-identifying → dashed stroke (weaker coupling).
    // Self-references keep their own dash pattern (set above); this flag
    // only changes the stroke for normal edges.
    const explicitIdentifying =
      rel?.identifying === true ||
      rel?.kind === "identifying" ||
      rel?.type === "identifying";
    const explicitNonIdentifying =
      rel?.identifying === false ||
      rel?.kind === "non_identifying" ||
      rel?.type === "non_identifying";
    const autoIdentifying = Boolean(
      (sourceField.primary_key && sourceField.foreign_key) ||
      (targetField.primary_key && targetField.foreign_key)
    );
    const isIdentifying = explicitIdentifying
      ? true
      : (explicitNonIdentifying ? false : autoIdentifying);

    // Optionality: explicit relationship flags win; otherwise infer from field
    // nullability (nullable FK => optional on that end). Relationships default
    // to mandatory-mandatory when nothing is specified.
    const sourceOptional = rel?.source_optional === true
      || rel?.optional === true
      || Boolean(sourceField?.nullable);
    const targetOptional = rel?.target_optional === true
      || rel?.optional === true
      || Boolean(targetField?.nullable);

    const { markerStart, markerEnd } = pickCrowsFootMarkers({
      cardinality,
      sourceOptional,
      targetOptional,
    });

    edges.push({
      id: `rel-${toDisplayText(relName, "relationship")}`,
      source: sourceEntity,
      target: targetEntity,
      label: `${relName} (${CARDINALITY_LABEL[cardinality] || cardinality})`,
      data: {
        name: relName,
        fromRef: sourceRef,
        toRef: targetRef,
        fromField: sourceFieldName,
        toField: targetFieldName,
        cardinality,
        cardinalityLabel: CARDINALITY_LABEL[cardinality] || cardinality,
        pkToFk,
        fkToPk,
        isSelf,
        sharedTarget,
        sharedTargetCount,
        sourceOptional,
        targetOptional,
        identifying: isIdentifying,
        description: toDisplayText(rel?.description, "")
      },
      markerStart,
      markerEnd,
      style: {
        stroke: edgeColor,
        strokeWidth: (isSelf || pkToFk || fkToPk) ? 2.4 : 2,
        // Self-links keep their signature dash; otherwise: solid for
        // identifying, dashed for non-identifying (matches the legend).
        strokeDasharray: isSelf ? "6 4" : (isIdentifying ? undefined : "5 3"),
      },
      labelStyle: { fill: "#475569", fontSize: 10, fontWeight: 600 },
      animated: cardinality === "many_to_many" || isSelf
    });
  }

  // Generate visual dimension_refs edges (fact → dimension, dashed orange)
  for (const entity of normalizedEntities) {
    if (entity.type !== "fact_table" || entity.dimension_refs.length === 0) continue;
    for (const dimName of entity.dimension_refs) {
      if (!entityByName.has(dimName)) continue;
      const edgeId = `dimref-${entity.name}-${dimName}`;
      // Skip if a formal relationship edge already connects these two entities
      const alreadyLinked = edges.some(
        (e) => (e.source === entity.name && e.target === dimName) ||
                (e.source === dimName && e.target === entity.name)
      );
      if (alreadyLinked) continue;
      edges.push({
        id: edgeId,
        source: entity.name,
        target: dimName,
        label: "dim ref",
        data: { isDimRef: true },
        style: {
          stroke: "#f97316",
          strokeWidth: 1.5,
          strokeDasharray: "4 3",
        },
        labelStyle: { fill: "#f97316", fontSize: 9, fontWeight: 500 },
        animated: false,
      });
    }
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
