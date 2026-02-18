import yaml from "js-yaml";

const MODEL_NAME = /^[a-z][a-z0-9_]*$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ENTITY_NAME = /^[A-Z][A-Za-z0-9]*$/;
const FIELD_NAME = /^[a-z][a-z0-9_]*$/;
const REF_NAME = /^[A-Z][A-Za-z0-9]*\.[a-z][a-z0-9_]*$/;

const ALLOWED_STATES = new Set(["draft", "approved", "deprecated"]);
const ALLOWED_LAYERS = new Set(["source", "transform", "report"]);
const ALLOWED_ENTITY_TYPES = new Set(["table", "view", "materialized_view", "external_table", "snapshot"]);
const PK_REQUIRED_TYPES = new Set(["table"]);
const GRAIN_REQUIRED_TYPES = new Set(["table", "view", "materialized_view"]);
const ALLOWED_CARDINALITY = new Set([
  "one_to_one",
  "one_to_many",
  "many_to_one",
  "many_to_many"
]);
const ALLOWED_AGGREGATIONS = new Set([
  "sum",
  "count",
  "count_distinct",
  "avg",
  "min",
  "max",
  "custom"
]);
const ALLOWED_CLASSIFICATIONS = new Set([
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "PII",
  "PCI",
  "PHI"
]);
const ALLOWED_SENSITIVITY = new Set(["public", "internal", "confidential", "restricted"]);
const ALLOWED_SEVERITY = new Set(["info", "warn", "error"]);

function issue(severity, code, message, path = "/") {
  return { severity, code, message, path };
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseYaml(yamlText) {
  try {
    const parsed = yaml.load(yamlText);
    if (!isObject(parsed)) {
      return {
        model: null,
        parseError: "YAML root must be an object."
      };
    }
    return { model: parsed, parseError: "" };
  } catch (err) {
    return {
      model: null,
      parseError: err instanceof Error ? err.message : "Unknown YAML parsing error"
    };
  }
}

function looksLikeDbtSchemaDocument(model) {
  if (!isObject(model)) return false;
  const hasDbtSections =
    Array.isArray(model.models) ||
    Array.isArray(model.sources) ||
    Array.isArray(model.semantic_models) ||
    Array.isArray(model.metrics);
  if (!hasDbtSections) return false;
  const version = String(model.version ?? "").trim();
  return version === "2" || version === "2.0";
}

function structuralIssues(model) {
  const issues = [];

  if (!isObject(model.model)) {
    issues.push(issue("error", "MISSING_MODEL_SECTION", "Missing required 'model' object.", "/model"));
  } else {
    const meta = model.model;
    if (typeof meta.name !== "string" || !MODEL_NAME.test(meta.name)) {
      issues.push(
        issue(
          "error",
          "INVALID_MODEL_NAME",
          "model.name must be lowercase letters/numbers/underscores.",
          "/model/name"
        )
      );
    }
    if (typeof meta.version !== "string" || !SEMVER.test(meta.version)) {
      issues.push(issue("error", "INVALID_MODEL_VERSION", "model.version must be SemVer.", "/model/version"));
    }
    if (typeof meta.domain !== "string" || meta.domain.length === 0) {
      issues.push(issue("error", "INVALID_MODEL_DOMAIN", "model.domain must be a non-empty string.", "/model/domain"));
    }
    if (!Array.isArray(meta.owners) || meta.owners.length === 0) {
      issues.push(issue("error", "INVALID_MODEL_OWNERS", "model.owners must be a non-empty array.", "/model/owners"));
    } else {
      meta.owners.forEach((owner, idx) => {
        if (typeof owner !== "string" || !EMAIL.test(owner)) {
          issues.push(issue("error", "INVALID_OWNER_EMAIL", "Invalid owner email format.", `/model/owners/${idx}`));
        }
      });
    }
    if (typeof meta.state !== "string" || !ALLOWED_STATES.has(meta.state)) {
      issues.push(
        issue(
          "error",
          "INVALID_MODEL_STATE",
          "model.state must be one of draft|approved|deprecated.",
          "/model/state"
        )
      );
    }
    if (meta.layer !== undefined && (typeof meta.layer !== "string" || !ALLOWED_LAYERS.has(meta.layer))) {
      issues.push(
        issue(
          "error",
          "INVALID_MODEL_LAYER",
          "model.layer must be one of source|transform|report.",
          "/model/layer"
        )
      );
    }
  }

  if (!Array.isArray(model.entities) || model.entities.length === 0) {
    issues.push(issue("error", "INVALID_ENTITIES", "entities must be a non-empty array.", "/entities"));
  } else {
    model.entities.forEach((entity, entityIdx) => {
      if (!isObject(entity)) {
        issues.push(
          issue("error", "INVALID_ENTITY_OBJECT", "Each entity must be an object.", `/entities/${entityIdx}`)
        );
        return;
      }
      if (typeof entity.name !== "string" || !ENTITY_NAME.test(entity.name)) {
        issues.push(
          issue(
            "error",
            "INVALID_ENTITY_NAME",
            "Entity names must be PascalCase.",
            `/entities/${entityIdx}/name`
          )
        );
      }
      if (typeof entity.type !== "string" || !ALLOWED_ENTITY_TYPES.has(entity.type)) {
        issues.push(
          issue(
            "error",
            "INVALID_ENTITY_TYPE",
            "Entity type must be table, view, materialized_view, external_table, or snapshot.",
            `/entities/${entityIdx}/type`
          )
        );
      }
      if (entity.grain !== undefined) {
        if (!Array.isArray(entity.grain) || entity.grain.length === 0) {
          issues.push(
            issue(
              "error",
              "INVALID_ENTITY_GRAIN",
              "entity.grain must be a non-empty array of field names.",
              `/entities/${entityIdx}/grain`
            )
          );
        } else {
          entity.grain.forEach((grainField, grainIdx) => {
            if (typeof grainField !== "string" || !FIELD_NAME.test(grainField)) {
              issues.push(
                issue(
                  "error",
                  "INVALID_ENTITY_GRAIN_FIELD",
                  "entity.grain fields must be snake_case field names.",
                  `/entities/${entityIdx}/grain/${grainIdx}`
                )
              );
            }
          });
        }
      }
      if (!Array.isArray(entity.fields) || entity.fields.length === 0) {
        issues.push(
          issue(
            "error",
            "INVALID_ENTITY_FIELDS",
            "Entity must include a non-empty fields array.",
            `/entities/${entityIdx}/fields`
          )
        );
      } else {
        entity.fields.forEach((field, fieldIdx) => {
          if (!isObject(field)) {
            issues.push(
              issue(
                "error",
                "INVALID_FIELD_OBJECT",
                "Field must be an object.",
                `/entities/${entityIdx}/fields/${fieldIdx}`
              )
            );
            return;
          }
          if (typeof field.name !== "string" || !FIELD_NAME.test(field.name)) {
            issues.push(
              issue(
                "error",
                "INVALID_FIELD_NAME",
                "Field names must be snake_case.",
                `/entities/${entityIdx}/fields/${fieldIdx}/name`
              )
            );
          }
          if (typeof field.type !== "string" || field.type.length === 0) {
            issues.push(
              issue(
                "error",
                "INVALID_FIELD_TYPE",
                "Field type must be a non-empty string.",
                `/entities/${entityIdx}/fields/${fieldIdx}/type`
              )
            );
          }
        });
      }
    });
  }

  if (model.relationships !== undefined) {
    if (!Array.isArray(model.relationships)) {
      issues.push(
        issue("error", "INVALID_RELATIONSHIPS", "relationships must be an array.", "/relationships")
      );
    } else {
      model.relationships.forEach((rel, idx) => {
        if (!isObject(rel)) {
          issues.push(
            issue("error", "INVALID_RELATIONSHIP_OBJECT", "Relationship must be an object.", `/relationships/${idx}`)
          );
          return;
        }
        if (typeof rel.name !== "string" || rel.name.length === 0) {
          issues.push(issue("error", "INVALID_RELATIONSHIP_NAME", "Relationship name is required.", `/relationships/${idx}/name`));
        }
        if (typeof rel.from !== "string" || !REF_NAME.test(rel.from)) {
          issues.push(
            issue("error", "INVALID_RELATIONSHIP_FROM", "relationships.from must be Entity.field.", `/relationships/${idx}/from`)
          );
        }
        if (typeof rel.to !== "string" || !REF_NAME.test(rel.to)) {
          issues.push(
            issue("error", "INVALID_RELATIONSHIP_TO", "relationships.to must be Entity.field.", `/relationships/${idx}/to`)
          );
        }
        if (typeof rel.cardinality !== "string" || !ALLOWED_CARDINALITY.has(rel.cardinality)) {
          issues.push(
            issue(
              "error",
              "INVALID_CARDINALITY",
              "relationships.cardinality must be one_to_one|one_to_many|many_to_one|many_to_many.",
              `/relationships/${idx}/cardinality`
            )
          );
        }
      });
    }
  }

  if (model.metrics !== undefined) {
    if (!Array.isArray(model.metrics)) {
      issues.push(issue("error", "INVALID_METRICS", "metrics must be an array.", "/metrics"));
    } else {
      model.metrics.forEach((metric, metricIdx) => {
        if (!isObject(metric)) {
          issues.push(issue("error", "INVALID_METRIC_OBJECT", "Metric must be an object.", `/metrics/${metricIdx}`));
          return;
        }
        if (typeof metric.name !== "string" || !FIELD_NAME.test(metric.name)) {
          issues.push(issue("error", "INVALID_METRIC_NAME", "Metric name must be snake_case.", `/metrics/${metricIdx}/name`));
        }
        if (typeof metric.entity !== "string" || !ENTITY_NAME.test(metric.entity)) {
          issues.push(issue("error", "INVALID_METRIC_ENTITY", "Metric entity must be PascalCase.", `/metrics/${metricIdx}/entity`));
        }
        if (typeof metric.expression !== "string" || metric.expression.trim().length === 0) {
          issues.push(issue("error", "INVALID_METRIC_EXPRESSION", "Metric expression is required.", `/metrics/${metricIdx}/expression`));
        }
        if (typeof metric.aggregation !== "string" || !ALLOWED_AGGREGATIONS.has(metric.aggregation)) {
          issues.push(
            issue(
              "error",
              "INVALID_METRIC_AGGREGATION",
              "Metric aggregation must be sum|count|count_distinct|avg|min|max|custom.",
              `/metrics/${metricIdx}/aggregation`
            )
          );
        }
        if (!Array.isArray(metric.grain) || metric.grain.length === 0) {
          issues.push(issue("error", "INVALID_METRIC_GRAIN", "Metric grain must be a non-empty array.", `/metrics/${metricIdx}/grain`));
        } else {
          metric.grain.forEach((grainField, grainIdx) => {
            if (typeof grainField !== "string" || !FIELD_NAME.test(grainField)) {
              issues.push(
                issue(
                  "error",
                  "INVALID_METRIC_GRAIN_FIELD",
                  "Metric grain fields must be snake_case.",
                  `/metrics/${metricIdx}/grain/${grainIdx}`
                )
              );
            }
          });
        }
        if (metric.dimensions !== undefined) {
          if (!Array.isArray(metric.dimensions)) {
            issues.push(issue("error", "INVALID_METRIC_DIMENSIONS", "Metric dimensions must be an array.", `/metrics/${metricIdx}/dimensions`));
          } else {
            metric.dimensions.forEach((dimensionField, dimIdx) => {
              if (typeof dimensionField !== "string" || !FIELD_NAME.test(dimensionField)) {
                issues.push(
                  issue(
                    "error",
                    "INVALID_METRIC_DIMENSION_FIELD",
                    "Metric dimension fields must be snake_case.",
                    `/metrics/${metricIdx}/dimensions/${dimIdx}`
                  )
                );
              }
            });
          }
        }
        if (metric.time_dimension !== undefined && (typeof metric.time_dimension !== "string" || !FIELD_NAME.test(metric.time_dimension))) {
          issues.push(issue("error", "INVALID_METRIC_TIME_DIMENSION", "Metric time_dimension must be snake_case.", `/metrics/${metricIdx}/time_dimension`));
        }
      });
    }
  }

  if (model.indexes !== undefined) {
    if (!Array.isArray(model.indexes)) {
      issues.push(issue("error", "INVALID_INDEXES", "indexes must be an array.", "/indexes"));
    } else {
      model.indexes.forEach((idx, idxNum) => {
        if (!isObject(idx)) {
          issues.push(issue("error", "INVALID_INDEX_OBJECT", "Index must be an object.", `/indexes/${idxNum}`));
          return;
        }
        if (typeof idx.name !== "string" || !FIELD_NAME.test(idx.name)) {
          issues.push(issue("error", "INVALID_INDEX_NAME", "Index name must be snake_case.", `/indexes/${idxNum}/name`));
        }
        if (typeof idx.entity !== "string" || !ENTITY_NAME.test(idx.entity)) {
          issues.push(issue("error", "INVALID_INDEX_ENTITY", "Index entity must be PascalCase.", `/indexes/${idxNum}/entity`));
        }
        if (!Array.isArray(idx.fields) || idx.fields.length === 0) {
          issues.push(issue("error", "INVALID_INDEX_FIELDS", "Index must have a non-empty fields array.", `/indexes/${idxNum}/fields`));
        }
      });
    }
  }

  if (model.glossary !== undefined) {
    if (!Array.isArray(model.glossary)) {
      issues.push(issue("error", "INVALID_GLOSSARY", "glossary must be an array.", "/glossary"));
    } else {
      model.glossary.forEach((term, termIdx) => {
        if (!isObject(term)) {
          issues.push(issue("error", "INVALID_GLOSSARY_OBJECT", "Glossary term must be an object.", `/glossary/${termIdx}`));
          return;
        }
        if (typeof term.term !== "string" || term.term.length === 0) {
          issues.push(issue("error", "INVALID_GLOSSARY_TERM", "Glossary term name is required.", `/glossary/${termIdx}/term`));
        }
        if (typeof term.definition !== "string" || term.definition.length === 0) {
          issues.push(issue("error", "INVALID_GLOSSARY_DEFINITION", "Glossary definition is required.", `/glossary/${termIdx}/definition`));
        }
      });
    }
  }

  if (model.governance !== undefined) {
    if (!isObject(model.governance)) {
      issues.push(issue("error", "INVALID_GOVERNANCE", "governance must be an object.", "/governance"));
    } else {
      const { classification, stewards } = model.governance;
      if (classification !== undefined) {
        if (!isObject(classification)) {
          issues.push(
            issue("error", "INVALID_CLASSIFICATION_MAP", "governance.classification must be an object.", "/governance/classification")
          );
        } else {
          Object.entries(classification).forEach(([target, value]) => {
            if (!REF_NAME.test(target)) {
              issues.push(
                issue(
                  "error",
                  "INVALID_CLASSIFICATION_TARGET",
                  "Classification key must be Entity.field.",
                  "/governance/classification"
                )
              );
            }
            if (typeof value !== "string" || !ALLOWED_CLASSIFICATIONS.has(value)) {
              issues.push(
                issue(
                  "error",
                  "INVALID_CLASSIFICATION",
                  `Classification '${String(value)}' is not allowed.`,
                  `/governance/classification/${target}`
                )
              );
            }
          });
        }
      }

      if (stewards !== undefined) {
        if (!isObject(stewards)) {
          issues.push(
            issue("error", "INVALID_STEWARDS_MAP", "governance.stewards must be an object.", "/governance/stewards")
          );
        } else {
          Object.entries(stewards).forEach(([key, value]) => {
            if (typeof value !== "string" || !EMAIL.test(value)) {
              issues.push(
                issue(
                  "error",
                  "INVALID_STEWARD_EMAIL",
                  `Steward '${key}' must be an email.`,
                  `/governance/stewards/${key}`
                )
              );
            }
          });
        }
      }
    }
  }

  if (model.rules !== undefined) {
    if (!Array.isArray(model.rules)) {
      issues.push(issue("error", "INVALID_RULES", "rules must be an array.", "/rules"));
    } else {
      model.rules.forEach((rule, idx) => {
        if (!isObject(rule)) {
          issues.push(issue("error", "INVALID_RULE_OBJECT", "Rule must be an object.", `/rules/${idx}`));
          return;
        }
        if (typeof rule.name !== "string" || rule.name.length === 0) {
          issues.push(issue("error", "INVALID_RULE_NAME", "Rule name is required.", `/rules/${idx}/name`));
        }
        if (typeof rule.target !== "string" || !REF_NAME.test(rule.target)) {
          issues.push(issue("error", "INVALID_RULE_TARGET", "Rule target must be Entity.field.", `/rules/${idx}/target`));
        }
        if (typeof rule.expression !== "string" || rule.expression.length === 0) {
          issues.push(issue("error", "INVALID_RULE_EXPRESSION", "Rule expression is required.", `/rules/${idx}/expression`));
        }
        if (typeof rule.severity !== "string" || !ALLOWED_SEVERITY.has(rule.severity)) {
          issues.push(
            issue(
              "error",
              "INVALID_RULE_SEVERITY",
              "Rule severity must be info|warn|error.",
              `/rules/${idx}/severity`
            )
          );
        }
      });
    }
  }

  return issues;
}

function fieldRefs(model) {
  const refs = new Set();
  const entities = Array.isArray(model.entities) ? model.entities : [];
  entities.forEach((entity) => {
    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    fields.forEach((field) => {
      if (entity?.name && field?.name) {
        refs.add(`${entity.name}.${field.name}`);
      }
    });
  });
  return refs;
}

function relationshipGraph(model) {
  const graph = new Map();
  const relationships = Array.isArray(model.relationships) ? model.relationships : [];

  relationships.forEach((rel) => {
    const fromRef = rel?.from || "";
    const toRef = rel?.to || "";
    if (!fromRef.includes(".") || !toRef.includes(".")) {
      return;
    }
    const source = fromRef.split(".")[0];
    const target = toRef.split(".")[0];
    if (!graph.has(source)) graph.set(source, new Set());
    if (!graph.has(target)) graph.set(target, new Set());
    graph.get(source).add(target);
  });

  return graph;
}

function hasCycle(graph) {
  const state = new Map();
  for (const node of graph.keys()) {
    state.set(node, 0);
  }

  function visit(node) {
    const status = state.get(node);
    if (status === 1) return true;
    if (status === 2) return false;
    state.set(node, 1);

    const neighbors = graph.get(node) || new Set();
    for (const next of neighbors) {
      if (visit(next)) return true;
    }
    state.set(node, 2);
    return false;
  }

  for (const node of graph.keys()) {
    if ((state.get(node) || 0) === 0 && visit(node)) {
      return true;
    }
  }
  return false;
}

function semanticIssues(model) {
  const issues = [];
  const entities = Array.isArray(model.entities) ? model.entities : [];
  const refs = fieldRefs(model);
  const modelLayer = String(model.model?.layer || "").trim().toLowerCase();
  const requiresGrain = modelLayer === "transform" || modelLayer === "report";
  const entityFieldMap = new Map();
  entities.forEach((entity) => {
    const entityName = entity?.name || "";
    if (!entityName) return;
    const fieldNames = new Set();
    (Array.isArray(entity.fields) ? entity.fields : []).forEach((field) => {
      if (field?.name) fieldNames.add(field.name);
    });
    entityFieldMap.set(entityName, fieldNames);
  });
  const seenEntities = new Set();

  entities.forEach((entity, entityIdx) => {
    const entityName = entity?.name || "";
    if (!entityName) return;

    if (seenEntities.has(entityName)) {
      issues.push(issue("error", "DUPLICATE_ENTITY", `Duplicate entity '${entityName}'.`, `/entities/${entityIdx}/name`));
    } else {
      seenEntities.add(entityName);
    }

    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    const seenFields = new Set();
    let hasPk = false;

    fields.forEach((field, fieldIdx) => {
      const fieldName = field?.name || "";
      if (!fieldName) return;

      if (seenFields.has(fieldName)) {
        issues.push(
          issue(
            "error",
            "DUPLICATE_FIELD",
            `Duplicate field '${entityName}.${fieldName}'.`,
            `/entities/${entityIdx}/fields/${fieldIdx}/name`
          )
        );
      } else {
        seenFields.add(fieldName);
      }
      if (field.primary_key === true) {
        hasPk = true;
      }
    });

    if (PK_REQUIRED_TYPES.has(entity.type) && !hasPk) {
      issues.push(
        issue(
          "error",
          "MISSING_PRIMARY_KEY",
          `Table '${entityName}' must have at least one primary key field.`,
          `/entities/${entityIdx}/fields`
        )
      );
    }

    fields.forEach((field, fieldIdx) => {
      const fieldName = field?.name || "";
      if (!fieldName) return;

      if (field.computed === true && !field.computed_expression) {
        issues.push(
          issue(
            "warn",
            "MISSING_COMPUTED_EXPRESSION",
            `Computed field '${entityName}.${fieldName}' should have a computed_expression.`,
            `/entities/${entityIdx}/fields/${fieldIdx}`
          )
        );
      }

      if (field.deprecated === true) {
        const msg = field.deprecated_message ? ` ${field.deprecated_message}` : "";
        issues.push(
          issue(
            "warn",
            "DEPRECATED_FIELD",
            `Field '${entityName}.${fieldName}' is deprecated.${msg}`,
            `/entities/${entityIdx}/fields/${fieldIdx}`
          )
        );
      }
    });

    const entityGrain = Array.isArray(entity.grain) ? entity.grain : [];
    if (requiresGrain && GRAIN_REQUIRED_TYPES.has(entity.type) && entityGrain.length === 0) {
      issues.push(
        issue(
          "error",
          "MISSING_GRAIN",
          `Entity '${entityName}' must declare grain in '${modelLayer}' layer models.`,
          `/entities/${entityIdx}/grain`
        )
      );
    }

    const seenGrainFields = new Set();
    entityGrain.forEach((grainField) => {
      if (seenGrainFields.has(grainField)) {
        issues.push(
          issue(
            "error",
            "DUPLICATE_GRAIN_FIELD",
            `Entity '${entityName}' grain contains duplicate field '${grainField}'.`,
            `/entities/${entityIdx}/grain`
          )
        );
      } else {
        seenGrainFields.add(grainField);
      }

      if (grainField && !entityFieldMap.get(entityName)?.has(grainField)) {
        issues.push(
          issue(
            "error",
            "GRAIN_FIELD_NOT_FOUND",
            `Entity '${entityName}' grain references non-existent field '${grainField}'.`,
            `/entities/${entityIdx}/grain`
          )
        );
      }
    });
  });

  const indexes = Array.isArray(model.indexes) ? model.indexes : [];

  const seenIndexNames = new Set();
  indexes.forEach((idx, idxNum) => {
    const idxName = idx?.name || "";
    const idxEntity = idx?.entity || "";
    const idxFields = Array.isArray(idx?.fields) ? idx.fields : [];

    if (idxName && seenIndexNames.has(idxName)) {
      issues.push(issue("error", "DUPLICATE_INDEX", `Duplicate index name '${idxName}'.`, `/indexes/${idxNum}`));
    } else {
      seenIndexNames.add(idxName);
    }

    if (idxEntity && !entityFieldMap.has(idxEntity)) {
      issues.push(issue("error", "INDEX_ENTITY_NOT_FOUND", `Index '${idxName}' references non-existent entity '${idxEntity}'.`, `/indexes/${idxNum}`));
    } else if (idxEntity) {
      const eFields = entityFieldMap.get(idxEntity) || new Set();
      idxFields.forEach((f) => {
        if (f && !eFields.has(f)) {
          issues.push(issue("error", "INDEX_FIELD_NOT_FOUND", `Index '${idxName}' references non-existent field '${idxEntity}.${f}'.`, `/indexes/${idxNum}`));
        }
      });
    }
  });

  const glossary = Array.isArray(model.glossary) ? model.glossary : [];
  const seenTerms = new Set();
  glossary.forEach((term, termIdx) => {
    const termName = term?.term || "";
    if (termName && seenTerms.has(termName)) {
      issues.push(issue("warn", "DUPLICATE_GLOSSARY_TERM", `Duplicate glossary term '${termName}'.`, `/glossary/${termIdx}`));
    } else {
      seenTerms.add(termName);
    }
    (Array.isArray(term?.related_fields) ? term.related_fields : []).forEach((fieldRef) => {
      if (fieldRef && !refs.has(fieldRef)) {
        issues.push(issue("error", "GLOSSARY_REF_NOT_FOUND", `Glossary term '${termName}' references non-existent field '${fieldRef}'.`, `/glossary/${termIdx}`));
      }
    });
  });

  const relationships = Array.isArray(model.relationships) ? model.relationships : [];
  const hasImports = Array.isArray(model.model?.imports) && model.model.imports.length > 0;
  relationships.forEach((rel, idx) => {
    const relName = rel?.name || `<relationship-${idx}>`;
    if (typeof rel?.from === "string" && !refs.has(rel.from)) {
      issues.push(
        issue(
          hasImports ? "warn" : "error",
          "RELATIONSHIP_REF_NOT_FOUND",
          `Relationship '${relName}' source '${rel.from}' does not exist.${hasImports ? " (may be in an imported model)" : ""}`,
          `/relationships/${idx}/from`
        )
      );
    }
    if (typeof rel?.to === "string" && !refs.has(rel.to)) {
      issues.push(
        issue(
          hasImports ? "warn" : "error",
          "RELATIONSHIP_REF_NOT_FOUND",
          `Relationship '${relName}' target '${rel.to}' does not exist.${hasImports ? " (may be in an imported model)" : ""}`,
          `/relationships/${idx}/to`
        )
      );
    }
  });

  if (isObject(model.governance?.classification)) {
    Object.entries(model.governance.classification).forEach(([target], idx) => {
      if (!refs.has(target)) {
        issues.push(
          issue(
            "error",
            "CLASSIFICATION_REF_NOT_FOUND",
            `Classification target '${target}' does not exist.`,
            `/governance/classification/${idx}`
          )
        );
      }
    });
  }

  const metrics = Array.isArray(model.metrics) ? model.metrics : [];
  if (modelLayer === "report" && metrics.length === 0) {
    issues.push(
      issue("error", "MISSING_METRICS", "Report layer models must define at least one metric.", "/metrics")
    );
  }

  const seenMetricNames = new Set();
  metrics.forEach((metric, metricIdx) => {
    const metricName = metric?.name || "";
    const metricEntity = metric?.entity || "";

    if (metricName) {
      if (seenMetricNames.has(metricName)) {
        issues.push(issue("error", "DUPLICATE_METRIC", `Duplicate metric name '${metricName}'.`, `/metrics/${metricIdx}/name`));
      } else {
        seenMetricNames.add(metricName);
      }
    }

    if (!metricEntity || !entityFieldMap.has(metricEntity)) {
      issues.push(
        issue(
          "error",
          "METRIC_ENTITY_NOT_FOUND",
          `Metric '${metricName || `<metric-${metricIdx}>`}' references non-existent entity '${metricEntity}'.`,
          `/metrics/${metricIdx}/entity`
        )
      );
      return;
    }

    const entityFields = entityFieldMap.get(metricEntity) || new Set();
    (Array.isArray(metric?.grain) ? metric.grain : []).forEach((grainField) => {
      if (grainField && !entityFields.has(grainField)) {
        issues.push(
          issue(
            "error",
            "METRIC_GRAIN_FIELD_NOT_FOUND",
            `Metric '${metricName}' grain field '${metricEntity}.${grainField}' does not exist.`,
            `/metrics/${metricIdx}/grain`
          )
        );
      }
    });

    (Array.isArray(metric?.dimensions) ? metric.dimensions : []).forEach((dimensionField) => {
      if (dimensionField && !entityFields.has(dimensionField)) {
        issues.push(
          issue(
            "error",
            "METRIC_DIMENSION_NOT_FOUND",
            `Metric '${metricName}' dimension field '${metricEntity}.${dimensionField}' does not exist.`,
            `/metrics/${metricIdx}/dimensions`
          )
        );
      }
    });

    const timeDimension = String(metric?.time_dimension || "").trim();
    if (timeDimension && !entityFields.has(timeDimension)) {
      issues.push(
        issue(
          "error",
          "METRIC_TIME_DIMENSION_NOT_FOUND",
          `Metric '${metricName}' time_dimension '${metricEntity}.${timeDimension}' does not exist.`,
          `/metrics/${metricIdx}/time_dimension`
        )
      );
    }

    if (metric?.deprecated === true && !metric?.deprecated_message) {
      issues.push(
        issue(
          "warn",
          "METRIC_DEPRECATED_WITHOUT_MESSAGE",
          `Metric '${metricName}' is deprecated but missing deprecated_message.`,
          `/metrics/${metricIdx}`
        )
      );
    }
  });

  const graph = relationshipGraph(model);
  if (graph.size > 0 && hasCycle(graph)) {
    issues.push(issue("warn", "CIRCULAR_RELATIONSHIPS", "Circular entity relationships detected.", "/relationships"));
  }

  return issues;
}

function sortByName(list, key = "name") {
  return [...list].sort((a, b) => String(a?.[key] || "").localeCompare(String(b?.[key] || "")));
}

function compileCanonical(model) {
  const canonical = {
    model: { ...(model.model || {}) },
    entities: sortByName(
      (Array.isArray(model.entities) ? model.entities : []).map((entity) => ({
        ...entity,
        fields: sortByName(Array.isArray(entity.fields) ? entity.fields : [], "name"),
        grain: Array.isArray(entity.grain) ? [...entity.grain].sort() : entity.grain,
        tags: Array.isArray(entity.tags) ? [...entity.tags].sort() : entity.tags
      })),
      "name"
    ),
    relationships: [...(Array.isArray(model.relationships) ? model.relationships : [])].sort((a, b) => {
      const left = `${a?.name || ""}|${a?.from || ""}|${a?.to || ""}|${a?.cardinality || ""}`;
      const right = `${b?.name || ""}|${b?.from || ""}|${b?.to || ""}|${b?.cardinality || ""}`;
      return left.localeCompare(right);
    }),
    indexes: sortByName(Array.isArray(model.indexes) ? model.indexes : [], "name"),
    rules: [...(Array.isArray(model.rules) ? model.rules : [])].sort((a, b) => {
      const left = `${a?.name || ""}|${a?.target || ""}`;
      const right = `${b?.name || ""}|${b?.target || ""}`;
      return left.localeCompare(right);
    }),
    metrics: sortByName(
      (Array.isArray(model.metrics) ? model.metrics : []).map((metric) => ({
        ...metric,
        grain: Array.isArray(metric.grain) ? [...metric.grain].sort() : metric.grain,
        dimensions: Array.isArray(metric.dimensions) ? [...metric.dimensions].sort() : metric.dimensions,
        tags: Array.isArray(metric.tags) ? [...metric.tags].sort() : metric.tags
      })),
      "name"
    ),
    governance: { ...(model.governance || {}) },
    glossary: sortByName(
      (Array.isArray(model.glossary) ? model.glossary : []).map((term) => ({
        ...term,
        related_fields: Array.isArray(term.related_fields) ? [...term.related_fields].sort() : term.related_fields,
        tags: Array.isArray(term.tags) ? [...term.tags].sort() : term.tags
      })),
      "term"
    ),
    display: { ...(model.display || {}) }
  };

  if (Array.isArray(canonical.model.owners)) {
    canonical.model.owners = [...canonical.model.owners].sort();
  }

  if (isObject(canonical.governance.classification)) {
    const sorted = {};
    Object.keys(canonical.governance.classification)
      .sort()
      .forEach((key) => {
        sorted[key] = canonical.governance.classification[key];
      });
    canonical.governance.classification = sorted;
  }

  if (isObject(canonical.governance.stewards)) {
    const sorted = {};
    Object.keys(canonical.governance.stewards)
      .sort()
      .forEach((key) => {
        sorted[key] = canonical.governance.stewards[key];
      });
    canonical.governance.stewards = sorted;
  }

  return canonical;
}

function entityMap(model) {
  const map = new Map();
  (Array.isArray(model.entities) ? model.entities : []).forEach((entity) => {
    map.set(entity?.name || "", entity);
  });
  return map;
}

function fieldMap(entity) {
  const map = new Map();
  (Array.isArray(entity?.fields) ? entity.fields : []).forEach((field) => {
    map.set(field?.name || "", field);
  });
  return map;
}

function relationshipKey(rel) {
  return `${rel?.name || ""}|${rel?.from || ""}|${rel?.to || ""}|${rel?.cardinality || ""}`;
}

function metricMap(model) {
  const map = new Map();
  (Array.isArray(model.metrics) ? model.metrics : []).forEach((metric) => {
    if (metric?.name) map.set(metric.name, metric);
  });
  return map;
}

function changed(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function semanticDiff(oldModel, newModel) {
  const oldCanonical = compileCanonical(oldModel);
  const newCanonical = compileCanonical(newModel);

  const oldEntities = entityMap(oldCanonical);
  const newEntities = entityMap(newCanonical);
  const oldNames = new Set([...oldEntities.keys()].filter(Boolean));
  const newNames = new Set([...newEntities.keys()].filter(Boolean));

  const addedEntities = [...newNames].filter((name) => !oldNames.has(name)).sort();
  const removedEntities = [...oldNames].filter((name) => !newNames.has(name)).sort();

  const changedEntities = [];
  const breakingChanges = [];

  [...oldNames]
    .filter((name) => newNames.has(name))
    .sort()
    .forEach((entityName) => {
      const oldEntity = oldEntities.get(entityName);
      const newEntity = newEntities.get(entityName);
      const oldFields = fieldMap(oldEntity);
      const newFields = fieldMap(newEntity);
      const oldFieldNames = new Set([...oldFields.keys()].filter(Boolean));
      const newFieldNames = new Set([...newFields.keys()].filter(Boolean));

      const addedFields = [...newFieldNames].filter((field) => !oldFieldNames.has(field)).sort();
      const removedFields = [...oldFieldNames].filter((field) => !newFieldNames.has(field)).sort();
      const typeChanges = [];
      const nullabilityChanges = [];

      [...oldFieldNames]
        .filter((name) => newFieldNames.has(name))
        .sort()
        .forEach((fieldName) => {
          const oldField = oldFields.get(fieldName);
          const newField = newFields.get(fieldName);

          if (oldField?.type !== newField?.type) {
            typeChanges.push({
              field: fieldName,
              from_type: oldField?.type,
              to_type: newField?.type
            });
            breakingChanges.push(`Field type changed: ${entityName}.${fieldName}`);
          }

          const oldNullable = oldField?.nullable ?? true;
          const newNullable = newField?.nullable ?? true;
          if (oldNullable !== newNullable) {
            nullabilityChanges.push({
              field: fieldName,
              from_nullable: oldNullable,
              to_nullable: newNullable
            });
            if (oldNullable && !newNullable) {
              breakingChanges.push(`Field became non-nullable: ${entityName}.${fieldName}`);
            }
          }
        });

      removedFields.forEach((field) => breakingChanges.push(`Field removed: ${entityName}.${field}`));

      if (addedFields.length || removedFields.length || typeChanges.length || nullabilityChanges.length) {
        changedEntities.push({
          entity: entityName,
          added_fields: addedFields,
          removed_fields: removedFields,
          type_changes: typeChanges,
          nullability_changes: nullabilityChanges
        });
      }
    });

  const oldRelationships = new Set(
    (Array.isArray(oldCanonical.relationships) ? oldCanonical.relationships : []).map((rel) => relationshipKey(rel))
  );
  const newRelationships = new Set(
    (Array.isArray(newCanonical.relationships) ? newCanonical.relationships : []).map((rel) => relationshipKey(rel))
  );

  const addedRelationships = [...newRelationships]
    .filter((key) => !oldRelationships.has(key))
    .sort()
    .map((key) => {
      const [name, from, to, cardinality] = key.split("|");
      return { name, from, to, cardinality };
    });
  const removedRelationships = [...oldRelationships]
    .filter((key) => !newRelationships.has(key))
    .sort()
    .map((key) => {
      const [name, from, to, cardinality] = key.split("|");
      return { name, from, to, cardinality };
    });

  removedEntities.forEach((entity) => breakingChanges.push(`Entity removed: ${entity}`));

  const oldIndexNames = new Set(
    (Array.isArray(oldCanonical.indexes) ? oldCanonical.indexes : []).map((idx) => idx?.name).filter(Boolean)
  );
  const newIndexNames = new Set(
    (Array.isArray(newCanonical.indexes) ? newCanonical.indexes : []).map((idx) => idx?.name).filter(Boolean)
  );
  const addedIndexes = [...newIndexNames].filter((name) => !oldIndexNames.has(name)).sort();
  const removedIndexes = [...oldIndexNames].filter((name) => !newIndexNames.has(name)).sort();
  removedIndexes.forEach((idxName) => breakingChanges.push(`Index removed: ${idxName}`));

  const oldMetrics = metricMap(oldCanonical);
  const newMetrics = metricMap(newCanonical);
  const oldMetricNames = new Set([...oldMetrics.keys()]);
  const newMetricNames = new Set([...newMetrics.keys()]);
  const addedMetrics = [...newMetricNames].filter((name) => !oldMetricNames.has(name)).sort();
  const removedMetrics = [...oldMetricNames].filter((name) => !newMetricNames.has(name)).sort();
  const changedMetrics = [];

  removedMetrics.forEach((metricName) => breakingChanges.push(`Metric removed: ${metricName}`));

  [...oldMetricNames]
    .filter((name) => newMetricNames.has(name))
    .sort()
    .forEach((metricName) => {
      const oldMetric = oldMetrics.get(metricName);
      const newMetric = newMetrics.get(metricName);
      if (!changed(oldMetric, newMetric)) return;

      const changedFields = [];
      [
        "entity",
        "expression",
        "aggregation",
        "grain",
        "dimensions",
        "time_dimension",
        "owner",
        "deprecated"
      ].forEach((field) => {
        if (changed(oldMetric?.[field], newMetric?.[field])) {
          changedFields.push(field);
        }
      });

      changedMetrics.push({ metric: metricName, changed_fields: changedFields.sort() });

      if (changedFields.some((field) => ["entity", "expression", "aggregation", "grain", "time_dimension"].includes(field))) {
        breakingChanges.push(`Metric contract changed: ${metricName}`);
      }
    });

  const uniqueBreaking = [...new Set(breakingChanges)].sort();

  return {
    summary: {
      added_entities: addedEntities.length,
      removed_entities: removedEntities.length,
      changed_entities: changedEntities.length,
      added_relationships: addedRelationships.length,
      removed_relationships: removedRelationships.length,
      added_indexes: addedIndexes.length,
      removed_indexes: removedIndexes.length,
      added_metrics: addedMetrics.length,
      removed_metrics: removedMetrics.length,
      changed_metrics: changedMetrics.length,
      breaking_change_count: uniqueBreaking.length
    },
    added_entities: addedEntities,
    removed_entities: removedEntities,
    changed_entities: changedEntities,
    added_relationships: addedRelationships,
    removed_relationships: removedRelationships,
    added_indexes: addedIndexes,
    removed_indexes: removedIndexes,
    added_metrics: addedMetrics,
    removed_metrics: removedMetrics,
    changed_metrics: changedMetrics,
    breaking_changes: uniqueBreaking,
    has_breaking_changes: uniqueBreaking.length > 0
  };
}

export function runModelChecks(yamlText) {
  const parsed = parseYaml(yamlText);
  if (parsed.parseError) {
    const parseIssue = issue("error", "YAML_PARSE_ERROR", parsed.parseError, "/");
    return {
      model: null,
      parseError: parsed.parseError,
      issues: [parseIssue],
      errors: [parseIssue],
      warnings: [],
      hasErrors: true
    };
  }

  if (looksLikeDbtSchemaDocument(parsed.model)) {
    const dbtIssue = issue(
      "warn",
      "DBT_SCHEMA_DETECTED",
      "This file looks like a dbt schema file (.yml/.yaml). Import it as dbt to generate a DuckCodeModeling model.",
      "/"
    );
    return {
      model: null,
      parseError: "",
      issues: [dbtIssue],
      errors: [],
      warnings: [dbtIssue],
      hasErrors: false
    };
  }

  const issues = [...structuralIssues(parsed.model), ...semanticIssues(parsed.model)];
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity !== "error");

  return {
    model: parsed.model,
    parseError: "",
    issues,
    errors,
    warnings,
    hasErrors: errors.length > 0
  };
}

export function runGate(oldYamlText, newYamlText, allowBreaking = false) {
  const oldCheck = runModelChecks(oldYamlText);
  const newCheck = runModelChecks(newYamlText);

  if (oldCheck.hasErrors || newCheck.hasErrors) {
    return {
      oldCheck,
      newCheck,
      diff: null,
      gatePassed: false,
      blockedByBreaking: false,
      message: "Gate failed: validation errors detected."
    };
  }

  const diff = semanticDiff(oldCheck.model, newCheck.model);
  const blockedByBreaking = diff.has_breaking_changes && !allowBreaking;

  return {
    oldCheck,
    newCheck,
    diff,
    gatePassed: !blockedByBreaking,
    blockedByBreaking,
    message: blockedByBreaking
      ? "Gate failed: breaking changes detected."
      : "Gate passed."
  };
}
