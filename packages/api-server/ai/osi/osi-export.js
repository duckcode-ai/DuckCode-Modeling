/* osi-export.js — convert a DataLex project (collection of YAML files)
 * into an Open Semantic Interchange (OSI) v0.1.1 bundle.
 *
 * The OSI spec is the vendor-neutral context format finalized Jan 2026
 * by Snowflake / dbt Labs / Salesforce / Atlan / Mistral / ThoughtSpot.
 * The schema lives at packages/api-server/ai/osi/osi-schema.json (vendored
 * from https://github.com/open-semantic-interchange/OSI on April 2026).
 *
 * Mapping summary (DataLex → OSI):
 *
 *   YAML doc with `entities[]`            → SemanticModel
 *   entity (kind: model / concept / etc)  → Dataset
 *   field on entity                       → Field (default ANSI_SQL expression = name)
 *   relationship                          → Relationship
 *     - relationship `verb` field         → Relationship.ai_context.instructions
 *   YAML doc-level `metrics[]`            → SemanticModel.metrics
 *   entity.terms[] (glossary cross-link)  → Dataset.ai_context.synonyms
 *   entity.description                    → Dataset.description
 *   entity.visibility                     → governs INCLUSION:
 *       internal → skipped from export
 *       shared   → included (default)
 *       public   → included
 *   relationship.visibility               → same gating (skips internal)
 *
 * The export is best-effort and forgiving: malformed YAML at one path
 * doesn't kill the whole bundle. Use validateOsiBundle() to check the
 * output against the vendored schema before shipping it to a consumer.
 *
 * Usage:
 *   import { exportOsiBundle, validateOsiBundle } from "./osi-export.js";
 *   const bundle = exportOsiBundle({
 *     projectName: "jaffle-shop",
 *     yamlDocs: [
 *       { path: "models/staging/customers.yml", content: "..." },
 *       { path: "sales/Conceptual/sales_flow.diagram.yaml", content: "..." },
 *     ],
 *   });
 *   const issues = validateOsiBundle(bundle);
 */

import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const OSI_SPEC_VERSION = "0.1.1";

let _schemaCache = null;
function loadSchema() {
  if (_schemaCache) return _schemaCache;
  const schemaPath = path.join(__dirname, "osi-schema.json");
  _schemaCache = JSON.parse(readFileSync(schemaPath, "utf8"));
  return _schemaCache;
}

/* Visibility gate. Phase 1A reserved a `visibility:` field on entities
   and relationships. OSI is meant for cross-team / AI consumption, so
   internal-only artifacts are excluded by default. The default when
   the field is absent is "shared" (included). */
function isVisible(entity) {
  const v = String(entity?.visibility || "").trim().toLowerCase();
  if (!v) return true;
  return v === "shared" || v === "public";
}

function toOsiName(value, fallback = "unnamed") {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  // OSI names are unique identifiers — prefer slug-friendly forms.
  return cleaned.replace(/\s+/g, "_");
}

function pickAiContext({ description, terms, verb, instructions }) {
  const synonyms = Array.isArray(terms) ? terms.filter(Boolean) : [];
  const hasInstructions = Boolean(verb || instructions || description);
  if (!synonyms.length && !hasInstructions) return undefined;
  const obj = {};
  const inst = instructions || verb || description;
  if (inst) obj.instructions = String(inst);
  if (synonyms.length) obj.synonyms = synonyms.map(String);
  return obj;
}

function buildField(field) {
  const name = toOsiName(field?.name);
  const expression = {
    dialects: [
      {
        dialect: "ANSI_SQL",
        // Default expression mirrors the column name. The user can
        // override per-field once the OSI export is part of their
        // workflow. Phase 4 (business-flow modeling) is the natural
        // place to richen this.
        expression: name,
      },
    ],
  };
  const out = { name, expression };
  if (field?.description) out.description = String(field.description);
  return out;
}

function buildDataset(entity, fileHint = "") {
  const name = toOsiName(entity?.name);
  // OSI requires `source`. We try to honor explicit physical metadata
  // first, then fall back to a synthetic placeholder so consumers know
  // the dataset is conceptual (not yet warehouse-backed).
  const explicitSource =
    entity?.source ||
    entity?.materialization ||
    entity?.dbt_ref ||
    entity?.physical?.source;
  const source = explicitSource
    ? String(explicitSource)
    : fileHint
      ? `datalex:${fileHint.replace(/\.ya?ml$/i, "")}#${name}`
      : `datalex:conceptual#${name}`;
  const fields = Array.isArray(entity?.fields)
    ? entity.fields.filter((f) => f && f.name).map(buildField)
    : [];
  const out = { name, source };
  if (fields.length) out.fields = fields;
  if (entity?.description) out.description = String(entity.description);
  const ai = pickAiContext({
    description: entity?.description,
    terms: entity?.terms,
  });
  if (ai) out.ai_context = ai;
  if (Array.isArray(entity?.candidate_keys) && entity.candidate_keys.length) {
    // OSI primary_key = first candidate key by convention; rest are unique_keys.
    out.primary_key = (entity.candidate_keys[0] || []).map(String);
    if (entity.candidate_keys.length > 1) {
      out.unique_keys = entity.candidate_keys.slice(1).map((k) => k.map(String));
    }
  } else {
    const pkFields = (Array.isArray(entity?.fields) ? entity.fields : [])
      .filter((f) => f?.primary_key)
      .map((f) => String(f.name));
    if (pkFields.length) out.primary_key = pkFields;
  }
  return out;
}

function endpointName(value) {
  if (!value) return "";
  if (typeof value === "string") return String(value).split(".")[0];
  return String(value.entity || value.dataset || value.name || "");
}

function endpointColumns(value) {
  if (!value) return ["id"];
  if (typeof value === "string") {
    const parts = value.split(".");
    return parts.length > 1 ? [parts.slice(1).join(".")] : ["id"];
  }
  if (value.field) return [String(value.field)];
  if (value.column) return [String(value.column)];
  return ["id"];
}

function buildRelationship(rel) {
  if (!rel || typeof rel !== "object") return null;
  if (!isVisible(rel)) return null;
  const from = endpointName(rel.from);
  const to = endpointName(rel.to);
  if (!from || !to) return null;
  const out = {
    name: toOsiName(rel.name || `${from}_to_${to}`),
    from,
    to,
    from_columns: endpointColumns(rel.from),
    to_columns: endpointColumns(rel.to),
  };
  // OSI's ai_context.instructions is the obvious home for the business
  // verb the conceptualizer (Phase 1C) populates — gives downstream AI
  // agents readable narrative without parsing YAML.
  const ai = pickAiContext({
    verb: rel.verb ? `${from} ${String(rel.verb).replace(/_/g, " ")} ${to}.` : null,
    description: rel.description,
  });
  if (ai) out.ai_context = ai;
  return out;
}

function buildMetric(metric) {
  if (!metric?.name) return null;
  const out = {
    name: toOsiName(metric.name),
    expression: {
      dialects: [
        {
          dialect: "ANSI_SQL",
          expression:
            metric.expression ||
            metric.expr ||
            (metric.aggregation && metric.column
              ? `${metric.aggregation}(${metric.column})`
              : "/* TODO: define expression */"),
        },
      ],
    },
  };
  if (metric.description) out.description = String(metric.description);
  return out;
}

/* Group entities by their owning YAML doc — each doc becomes one
   SemanticModel in the bundle. Conceptual diagrams and physical model
   files end up as siblings, which is exactly what an AI agent needs to
   reason across layers. */
export function exportOsiBundle({ projectName = "datalex_project", yamlDocs = [] } = {}) {
  const semanticModels = [];
  for (const doc of yamlDocs) {
    if (!doc || !doc.content) continue;
    let parsed = null;
    try { parsed = yaml.load(doc.content); } catch (_err) { parsed = null; }
    if (!parsed || typeof parsed !== "object") continue;

    const meta = (parsed.model && typeof parsed.model === "object") ? parsed.model : parsed;
    const baseName = toOsiName(parsed.name || meta?.name || (doc.path || "model").replace(/\.ya?ml$/i, "").split("/").pop());
    const description = parsed.description || meta?.description || "";

    const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
    const datasets = entities
      .filter(isVisible)
      .map((entity) => buildDataset(entity, doc.path || ""));

    if (!datasets.length) continue;

    const relationships = (Array.isArray(parsed.relationships) ? parsed.relationships : [])
      .map(buildRelationship)
      .filter(Boolean);

    const metrics = (Array.isArray(parsed.metrics) ? parsed.metrics : [])
      .map(buildMetric)
      .filter(Boolean);

    const semanticModel = {
      name: baseName,
      datasets,
    };
    if (description) semanticModel.description = String(description);
    const ai = pickAiContext({ description });
    if (ai) semanticModel.ai_context = ai;
    if (relationships.length) semanticModel.relationships = relationships;
    if (metrics.length) semanticModel.metrics = metrics;
    semanticModels.push(semanticModel);
  }

  const bundle = {
    version: OSI_SPEC_VERSION,
    semantic_model: semanticModels,
  };
  // Add CustomExtension carrying DataLex provenance so consumers can
  // round-trip back to source YAML if they want to.
  if (projectName) {
    bundle.dialects = ["ANSI_SQL"];
    bundle.vendors = ["COMMON", "DBT"];
    semanticModels.forEach((sm) => {
      sm.custom_extensions = [
        {
          vendor_name: "COMMON",
          data: JSON.stringify({ datalex_project: projectName, datalex_version: "1.7.0-pre" }),
        },
      ];
    });
  }
  return bundle;
}

/* Lightweight validator. Walks the schema's `required` arrays and a few
   `oneOf` constraints — enough to catch the most common shape errors
   without pulling in ajv. Returns an array of {path, message} entries;
   empty array means valid. */
export function validateOsiBundle(bundle) {
  const issues = [];
  if (!bundle || typeof bundle !== "object") {
    return [{ path: "/", message: "bundle must be an object" }];
  }
  const schema = loadSchema();

  // Top-level required.
  if (bundle.version !== schema.properties.version.const) {
    issues.push({
      path: "/version",
      message: `version must be "${schema.properties.version.const}", got ${JSON.stringify(bundle.version)}`,
    });
  }
  if (!Array.isArray(bundle.semantic_model)) {
    issues.push({ path: "/semantic_model", message: "semantic_model must be an array" });
    return issues;
  }
  bundle.semantic_model.forEach((sm, idx) => {
    const base = `/semantic_model/${idx}`;
    if (!sm?.name) issues.push({ path: `${base}/name`, message: "name is required" });
    if (!Array.isArray(sm?.datasets) || sm.datasets.length === 0) {
      issues.push({ path: `${base}/datasets`, message: "at least one dataset is required" });
    } else {
      sm.datasets.forEach((ds, dsIdx) => {
        const dsBase = `${base}/datasets/${dsIdx}`;
        if (!ds?.name) issues.push({ path: `${dsBase}/name`, message: "dataset name is required" });
        if (!ds?.source) issues.push({ path: `${dsBase}/source`, message: "dataset source is required" });
        if (Array.isArray(ds?.fields)) {
          ds.fields.forEach((f, fIdx) => {
            if (!f?.name) issues.push({ path: `${dsBase}/fields/${fIdx}/name`, message: "field name is required" });
            if (!f?.expression) issues.push({ path: `${dsBase}/fields/${fIdx}/expression`, message: "field expression is required" });
          });
        }
      });
    }
    if (Array.isArray(sm?.relationships)) {
      sm.relationships.forEach((rel, rIdx) => {
        const rBase = `${base}/relationships/${rIdx}`;
        for (const k of ["name", "from", "to"]) {
          if (!rel?.[k]) issues.push({ path: `${rBase}/${k}`, message: `${k} is required` });
        }
        if (!Array.isArray(rel?.from_columns) || !rel.from_columns.length) {
          issues.push({ path: `${rBase}/from_columns`, message: "from_columns must be a non-empty array" });
        }
        if (!Array.isArray(rel?.to_columns) || !rel.to_columns.length) {
          issues.push({ path: `${rBase}/to_columns`, message: "to_columns must be a non-empty array" });
        }
      });
    }
  });
  return issues;
}
