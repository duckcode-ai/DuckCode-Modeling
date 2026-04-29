/* dbtLint — client-side linting of imported dbt entities.
 *
 * Runs entirely in-memory against parsed YAML entity objects. Produces a flat
 * array of findings shaped the same as `runModelChecks` (code / severity /
 * path / message) so ValidationPanel can render them in the same UI.
 *
 * We intentionally keep the rules lightweight: the goal is to nudge dbt users
 * toward complete metadata, not to replace `dbt-checkpoint` or `sqlfluff`.
 * Every rule is a function that returns an array of findings — easy to add
 * more, easy to disable individually.
 *
 * Consumed by:
 *   - ColumnsView → per-column warning pill beside the column name
 *   - ValidationPanel → aggregated findings across the active file
 *
 * Nothing in this file writes to YAML or persists state. Pure functions only.
 */

/** @typedef {{
 *   code: string,
 *   severity: "error" | "warn" | "info",
 *   path: string,
 *   field?: string,
 *   message: string,
 * }} LintFinding
 */

/**
 * Lint a single entity / model / source-table object.
 *
 * @param {object} entity  Parsed entity dict (as produced by yaml.load).
 * @param {object} [opts]
 * @param {string} [opts.filePath] Optional file path, used in `path` for UI display.
 * @returns {LintFinding[]}
 */
export function lintEntity(entity, opts = {}) {
  if (!entity || typeof entity !== "object") return [];
  const filePath = opts.filePath || "";
  const entityName = entity.name || entity.entity || "(unnamed)";
  const pathBase = filePath ? `${filePath}#${entityName}` : entityName;
  // Conceptual concepts don't have columns by design — they describe
  // business meaning, not row shape. Skip dbt-style column-bearing
  // checks for them so the Validation tab stops shouting "X declares
  // no columns" at every concept on a conceptual diagram.
  const isConcept = String(entity?.type || "").toLowerCase() === "concept";

  const out = [];

  // Entity-level: missing description weakens documentation coverage.
  if (!hasValue(entity.description)) {
    out.push({
      code: "DBT_ENTITY_NO_DESCRIPTION",
      severity: "warn",
      path: pathBase,
      message: `Entity \`${entityName}\` has no description.`,
    });
  }

  // Column-level rules run once per column, then aggregate. Skipped
  // entirely for concept-type entities (see comment above).
  if (isConcept) return out;

  const columns = pickColumns(entity);
  if (columns.length === 0) {
    out.push({
      code: "DBT_ENTITY_NO_COLUMNS",
      severity: "warn",
      path: pathBase,
      message: `Entity \`${entityName}\` declares no columns.`,
    });
    return out;
  }

  for (const col of columns) {
    const colName = col.name || "(unnamed)";
    const colPath = `${pathBase}.${colName}`;

    if (!hasValue(col.description)) {
      out.push({
        code: "DBT_COLUMN_NO_DESCRIPTION",
        severity: "warn",
        path: colPath,
        field: colName,
        message: `Column \`${colName}\` has no description.`,
      });
    }

    if (!hasValue(col.type) && !hasValue(col.data_type)) {
      out.push({
        code: "DBT_COLUMN_NO_TYPE",
        severity: "warn",
        path: colPath,
        field: colName,
        message: `Column \`${colName}\` has no \`type\` / \`data_type\`. Contracts will fail.`,
      });
    }

    if (isPrimaryKey(col) && !hasTestCoverage(col)) {
      out.push({
        code: "DBT_PK_NO_TESTS",
        severity: "info",
        path: colPath,
        field: colName,
        message: `Primary-key column \`${colName}\` has no \`tests\` (add \`unique\` / \`not_null\`).`,
      });
    }
  }

  return out;
}

/**
 * Lint every entity inside a parsed DataLex model doc (a file with
 * `entities: [...]`). Returns a flat array — callers group by path as needed.
 */
export function lintDoc(doc, opts = {}) {
  if (!doc || typeof doc !== "object") return [];
  const filePath = opts.filePath || "";

  // DataLex-native file: top-level `entities` array.
  if (Array.isArray(doc.entities)) {
    return doc.entities.flatMap((e) => lintEntity(e, { filePath }));
  }

  // dbt-shaped file: `models:` or `sources:` arrays (pre-import).
  const out = [];
  if (Array.isArray(doc.models)) {
    for (const m of doc.models) out.push(...lintEntity(m, { filePath }));
  }
  if (Array.isArray(doc.sources)) {
    for (const src of doc.sources) {
      for (const t of src.tables || []) {
        out.push(...lintEntity(t, { filePath: `${filePath || ""}#${src.name || ""}` }));
      }
    }
  }
  if (Array.isArray(doc.semantic_models)) {
    for (const sm of doc.semantic_models) out.push(...lintSemanticModel(sm, { filePath }));
  }
  if (Array.isArray(doc.metrics)) {
    for (const m of doc.metrics) out.push(...lintMetric(m, { filePath }));
  }
  if (Array.isArray(doc.saved_queries)) {
    for (const sq of doc.saved_queries) out.push(...lintSavedQuery(sq, { filePath }));
  }
  if (Array.isArray(doc.exposures)) {
    for (const e of doc.exposures) out.push(...lintExposure(e, { filePath }));
  }
  if (Array.isArray(doc.snapshots)) {
    for (const s of doc.snapshots) out.push(...lintSnapshot(s, { filePath }));
  }

  // DataLex per-file entity shape: `kind: model|source` + top-level columns.
  if (!out.length && (doc.kind === "model" || doc.kind === "source")) {
    if (doc.kind === "source" && Array.isArray(doc.tables)) {
      for (const t of doc.tables) out.push(...lintEntity(t, { filePath }));
    } else {
      out.push(...lintEntity(doc, { filePath }));
    }
  }

  return out;
}

/* dbt semantic-layer linters — minimal "metadata complete enough to be
   trustworthy" rules so an imported dbt repo's semantic / metrics / saved
   queries / exposure / snapshot files always show something in Validation
   instead of an empty panel. We don't try to typecheck refs against the
   dbt graph here — that's the readiness review's job. */
function lintSemanticModel(sm, opts = {}) {
  if (!sm || typeof sm !== "object") return [];
  const filePath = opts.filePath || "";
  const name = sm.name || "(unnamed semantic model)";
  const pathBase = filePath ? `${filePath}#${name}` : name;
  const out = [];
  if (!hasValue(sm.description)) {
    out.push({ code: "DBT_SEMANTIC_MODEL_NO_DESCRIPTION", severity: "warn", path: pathBase, message: `Semantic model \`${name}\` has no description.` });
  }
  if (!hasValue(sm.model)) {
    out.push({ code: "DBT_SEMANTIC_MODEL_NO_REF", severity: "error", path: pathBase, message: `Semantic model \`${name}\` is missing the \`model:\` ref to the underlying dbt model.` });
  }
  const entities = Array.isArray(sm.entities) ? sm.entities : [];
  if (entities.length === 0) {
    out.push({ code: "DBT_SEMANTIC_MODEL_NO_ENTITIES", severity: "warn", path: pathBase, message: `Semantic model \`${name}\` declares no entities — metrics built on it cannot resolve joins.` });
  } else if (!entities.some((e) => String(e?.type || "").toLowerCase() === "primary")) {
    out.push({ code: "DBT_SEMANTIC_MODEL_NO_PRIMARY_ENTITY", severity: "warn", path: pathBase, message: `Semantic model \`${name}\` has no \`type: primary\` entity. The semantic layer needs one to anchor joins.` });
  }
  for (const e of entities) {
    if (!hasValue(e?.name)) out.push({ code: "DBT_SEMANTIC_ENTITY_NO_NAME", severity: "error", path: pathBase, message: `Semantic model \`${name}\` has an entity without a \`name\`.` });
    if (!hasValue(e?.type)) out.push({ code: "DBT_SEMANTIC_ENTITY_NO_TYPE", severity: "warn", path: `${pathBase}.${e?.name || "(unnamed)"}`, message: `Entity \`${e?.name || "(unnamed)"}\` has no \`type\` (primary | foreign | natural).` });
  }
  for (const m of (Array.isArray(sm.measures) ? sm.measures : [])) {
    const mName = m?.name || "(unnamed measure)";
    if (!hasValue(m?.agg)) {
      out.push({ code: "DBT_SEMANTIC_MEASURE_NO_AGG", severity: "warn", path: `${pathBase}.${mName}`, field: mName, message: `Measure \`${mName}\` has no \`agg\` (sum | average | count | …).` });
    }
    if (!hasValue(m?.expr) && !hasValue(m?.column)) {
      out.push({ code: "DBT_SEMANTIC_MEASURE_NO_EXPR", severity: "warn", path: `${pathBase}.${mName}`, field: mName, message: `Measure \`${mName}\` has no \`expr\` or \`column\`.` });
    }
  }
  for (const d of (Array.isArray(sm.dimensions) ? sm.dimensions : [])) {
    const dName = d?.name || "(unnamed dimension)";
    if (!hasValue(d?.type)) {
      out.push({ code: "DBT_SEMANTIC_DIMENSION_NO_TYPE", severity: "warn", path: `${pathBase}.${dName}`, field: dName, message: `Dimension \`${dName}\` has no \`type\` (categorical | time).` });
    }
    if (String(d?.type || "").toLowerCase() === "time" && !hasValue(d?.type_params?.time_granularity)) {
      out.push({ code: "DBT_SEMANTIC_TIME_DIMENSION_NO_GRANULARITY", severity: "warn", path: `${pathBase}.${dName}`, field: dName, message: `Time dimension \`${dName}\` should declare a \`type_params.time_granularity\`.` });
    }
  }
  return out;
}

function lintMetric(metric, opts = {}) {
  if (!metric || typeof metric !== "object") return [];
  const filePath = opts.filePath || "";
  const name = metric.name || "(unnamed metric)";
  const pathBase = filePath ? `${filePath}#${name}` : name;
  const out = [];
  if (!hasValue(metric.description)) {
    out.push({ code: "DBT_METRIC_NO_DESCRIPTION", severity: "warn", path: pathBase, message: `Metric \`${name}\` has no description.` });
  }
  if (!hasValue(metric.label)) {
    out.push({ code: "DBT_METRIC_NO_LABEL", severity: "info", path: pathBase, message: `Metric \`${name}\` has no \`label\` for BI surfaces.` });
  }
  const type = String(metric.type || "").toLowerCase();
  if (!hasValue(type)) {
    out.push({ code: "DBT_METRIC_NO_TYPE", severity: "error", path: pathBase, message: `Metric \`${name}\` has no \`type\`.` });
  }
  const tp = metric.type_params || {};
  if (type === "simple" && !hasValue(tp.measure)) {
    out.push({ code: "DBT_METRIC_SIMPLE_NO_MEASURE", severity: "error", path: pathBase, message: `Simple metric \`${name}\` is missing \`type_params.measure\`.` });
  }
  if (type === "ratio" && (!hasValue(tp.numerator) || !hasValue(tp.denominator))) {
    out.push({ code: "DBT_METRIC_RATIO_INCOMPLETE", severity: "error", path: pathBase, message: `Ratio metric \`${name}\` needs both \`numerator\` and \`denominator\`.` });
  }
  if (type === "derived" && !hasValue(tp.expr)) {
    out.push({ code: "DBT_METRIC_DERIVED_NO_EXPR", severity: "error", path: pathBase, message: `Derived metric \`${name}\` is missing \`type_params.expr\`.` });
  }
  if (type === "cumulative" && !hasValue(tp.measure)) {
    out.push({ code: "DBT_METRIC_CUMULATIVE_NO_MEASURE", severity: "error", path: pathBase, message: `Cumulative metric \`${name}\` is missing \`type_params.measure\`.` });
  }
  return out;
}

function lintSavedQuery(sq, opts = {}) {
  if (!sq || typeof sq !== "object") return [];
  const filePath = opts.filePath || "";
  const name = sq.name || "(unnamed saved query)";
  const pathBase = filePath ? `${filePath}#${name}` : name;
  const out = [];
  if (!hasValue(sq.description)) {
    out.push({ code: "DBT_SAVED_QUERY_NO_DESCRIPTION", severity: "warn", path: pathBase, message: `Saved query \`${name}\` has no description.` });
  }
  const params = sq.query_params || {};
  if (!Array.isArray(params.metrics) || params.metrics.length === 0) {
    out.push({ code: "DBT_SAVED_QUERY_NO_METRICS", severity: "error", path: pathBase, message: `Saved query \`${name}\` lists no \`query_params.metrics\`.` });
  }
  if (!Array.isArray(params.group_by) || params.group_by.length === 0) {
    out.push({ code: "DBT_SAVED_QUERY_NO_GROUP_BY", severity: "info", path: pathBase, message: `Saved query \`${name}\` declares no \`query_params.group_by\` — usually only correct for a single-row aggregate.` });
  }
  return out;
}

function lintExposure(exposure, opts = {}) {
  if (!exposure || typeof exposure !== "object") return [];
  const filePath = opts.filePath || "";
  const name = exposure.name || "(unnamed exposure)";
  const pathBase = filePath ? `${filePath}#${name}` : name;
  const out = [];
  if (!hasValue(exposure.description)) {
    out.push({ code: "DBT_EXPOSURE_NO_DESCRIPTION", severity: "warn", path: pathBase, message: `Exposure \`${name}\` has no description.` });
  }
  if (!hasValue(exposure.type)) {
    out.push({ code: "DBT_EXPOSURE_NO_TYPE", severity: "warn", path: pathBase, message: `Exposure \`${name}\` is missing \`type\` (dashboard | analysis | ml | application | notebook).` });
  }
  if (!hasValue(exposure.owner?.name) && !hasValue(exposure.owner?.email)) {
    out.push({ code: "DBT_EXPOSURE_NO_OWNER", severity: "warn", path: pathBase, message: `Exposure \`${name}\` has no \`owner.name\` or \`owner.email\`.` });
  }
  if (!Array.isArray(exposure.depends_on) || exposure.depends_on.length === 0) {
    out.push({ code: "DBT_EXPOSURE_NO_DEPENDENCIES", severity: "info", path: pathBase, message: `Exposure \`${name}\` declares no \`depends_on\` — its lineage will be invisible to dbt docs.` });
  }
  return out;
}

function lintSnapshot(snapshot, opts = {}) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const filePath = opts.filePath || "";
  const name = snapshot.name || "(unnamed snapshot)";
  const pathBase = filePath ? `${filePath}#${name}` : name;
  const out = [];
  if (!hasValue(snapshot.description)) {
    out.push({ code: "DBT_SNAPSHOT_NO_DESCRIPTION", severity: "warn", path: pathBase, message: `Snapshot \`${name}\` has no description.` });
  }
  const cfg = snapshot.config || {};
  const strategy = String(cfg.strategy || "").toLowerCase();
  if (!hasValue(strategy)) {
    out.push({ code: "DBT_SNAPSHOT_NO_STRATEGY", severity: "error", path: pathBase, message: `Snapshot \`${name}\` is missing \`config.strategy\` (timestamp | check).` });
  }
  if (!hasValue(cfg.unique_key)) {
    out.push({ code: "DBT_SNAPSHOT_NO_UNIQUE_KEY", severity: "error", path: pathBase, message: `Snapshot \`${name}\` is missing \`config.unique_key\`.` });
  }
  if (strategy === "timestamp" && !hasValue(cfg.updated_at)) {
    out.push({ code: "DBT_SNAPSHOT_TIMESTAMP_NO_UPDATED_AT", severity: "error", path: pathBase, message: `Timestamp-strategy snapshot \`${name}\` needs \`config.updated_at\`.` });
  }
  if (strategy === "check" && !Array.isArray(cfg.check_cols) && cfg.check_cols !== "all") {
    out.push({ code: "DBT_SNAPSHOT_CHECK_NO_COLS", severity: "error", path: pathBase, message: `Check-strategy snapshot \`${name}\` needs \`config.check_cols\` (list of columns or "all").` });
  }
  return out;
}

/**
 * Validate DataLex/dbt Interface metadata in the active YAML document.
 * Mirrors the Python mesh checker enough to give immediate Workbench feedback;
 * CI remains authoritative through `datalex datalex mesh check --strict`.
 */
export function lintMeshInterfaces(doc, opts = {}) {
  if (!doc || typeof doc !== "object") return [];
  const filePath = opts.filePath || "";
  const models = [];
  if (doc.kind === "model") models.push(doc);
  if (Array.isArray(doc.models)) models.push(...doc.models);
  if (Array.isArray(doc.entities)) models.push(...doc.entities);

  const out = [];
  for (const model of models) {
    const iface = interfaceMeta(model);
    if (!interfaceEnabled(iface)) continue;
    const name = model?.name || model?.entity || "(unnamed)";
    const pathBase = filePath ? `${filePath}#${name}` : name;
    const status = iface.status;
    const stability = iface.stability;
    const owner = iface.owner || model.owner;
    const domain = iface.domain || model.domain;
    const description = iface.description || model.description;
    const freshness = iface.freshness || model.freshness;
    const uniqueKey = iface.unique_key;
    const columns = pickColumns(model);
    const columnNames = new Set(columns.map((c) => c.name).filter(Boolean));
    const uniqueKeyCols = uniqueKeyColumns(uniqueKey);

    const required = [
      ["MESH_INTERFACE_MISSING_OWNER", owner, "owner"],
      ["MESH_INTERFACE_MISSING_DOMAIN", domain, "domain"],
      ["MESH_INTERFACE_MISSING_STATUS", status, "status"],
      ["MESH_INTERFACE_MISSING_VERSION", iface.version, "version"],
      ["MESH_INTERFACE_MISSING_DESCRIPTION", description, "description"],
      ["MESH_INTERFACE_MISSING_UNIQUE_KEY", uniqueKey, "unique key"],
      ["MESH_INTERFACE_MISSING_FRESHNESS", freshness, "freshness"],
      ["MESH_INTERFACE_MISSING_STABILITY", stability, "stability"],
    ];
    for (const [code, value, label] of required) {
      if (!hasValue(value)) {
        out.push({ code, severity: "warn", path: pathBase, message: `Interface \`${name}\` is missing ${label}.` });
      }
    }
    if (status && !["draft", "active", "deprecated"].includes(status)) {
      out.push({ code: "MESH_INTERFACE_INVALID_STATUS", severity: "error", path: pathBase, message: `Interface \`${name}\` has invalid status \`${status}\`.` });
    }
    if (stability && !["internal", "shared", "contracted"].includes(stability)) {
      out.push({ code: "MESH_INTERFACE_INVALID_STABILITY", severity: "error", path: pathBase, message: `Interface \`${name}\` has invalid stability \`${stability}\`.` });
    }
    if (!materialization(model)) {
      out.push({ code: "MESH_INTERFACE_MISSING_MATERIALIZATION", severity: "warn", path: pathBase, message: `Interface \`${name}\` should declare a dbt materialization.` });
    }
    if (!model?.contract?.enforced && !model?.config?.contract?.enforced) {
      out.push({ code: "MESH_INTERFACE_CONTRACT_NOT_ENFORCED", severity: "warn", path: pathBase, message: `Interface \`${name}\` should enable a dbt contract before promotion.` });
    }
    for (const keyCol of uniqueKeyCols) {
      if (!columnNames.has(keyCol)) {
        out.push({ code: "MESH_INTERFACE_UNIQUE_KEY_NOT_FOUND", severity: "error", path: `${pathBase}.${keyCol}`, message: `Interface unique key \`${keyCol}\` is not a declared column.` });
      }
    }
    for (const col of columns) {
      if (!col?.name) continue;
      if (!hasValue(col.description)) {
        out.push({ code: "MESH_INTERFACE_COLUMN_DESCRIPTION_MISSING", severity: "warn", path: `${pathBase}.${col.name}`, field: col.name, message: `Interface column \`${col.name}\` needs a consumer-facing description.` });
      }
      if (uniqueKeyCols.includes(col.name) && !(hasNamedTest(col, "unique") && hasNamedTest(col, "not_null"))) {
        out.push({ code: "MESH_INTERFACE_UNIQUE_KEY_TESTS_MISSING", severity: "warn", path: `${pathBase}.${col.name}`, field: col.name, message: `Unique key column \`${col.name}\` should have unique and not_null tests.` });
      }
      if (String(col.name).endsWith("_id") && !uniqueKeyCols.includes(col.name) && !hasRelationshipTest(col)) {
        out.push({ code: "MESH_INTERFACE_RELATIONSHIP_TEST_MISSING", severity: "warn", path: `${pathBase}.${col.name}`, field: col.name, message: `Foreign-key-like column \`${col.name}\` should have a relationships test.` });
      }
    }
  }
  return out;
}

/**
 * Summarise a findings array into the counts the UI header needs.
 * Small helper so callers don't re-implement the same reduce.
 */
export function summarise(findings) {
  const by = { error: 0, warn: 0, info: 0 };
  for (const f of findings || []) {
    if (by[f.severity] !== undefined) by[f.severity] += 1;
  }
  return { ...by, total: by.error + by.warn + by.info };
}

/* ------------------------ helpers ------------------------ */

function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function pickColumns(entity) {
  // DataLex uses `fields` for user-authored models, `columns` for dbt-shaped.
  const raw = entity.columns || entity.fields;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  // dbt manifests sometimes emit columns as a map keyed by name.
  if (typeof raw === "object") {
    return Object.entries(raw).map(([name, col]) => ({ name, ...(col || {}) }));
  }
  return [];
}

function isPrimaryKey(col) {
  if (col.primary_key === true) return true;
  if (col.pk === true) return true;
  const flags = col.flags || [];
  if (Array.isArray(flags) && flags.includes("PK")) return true;
  const constraints = col.constraints || [];
  if (Array.isArray(constraints)) {
    for (const c of constraints) {
      if (c && c.type === "primary_key") return true;
    }
  }
  return false;
}

function hasTestCoverage(col) {
  const tests = col.tests;
  if (!tests) return false;
  if (Array.isArray(tests)) return tests.length > 0;
  if (typeof tests === "object") return Object.keys(tests).length > 0;
  return Boolean(tests);
}

function interfaceMeta(model) {
  if (model?.interface && typeof model.interface === "object") return model.interface;
  const meta = model?.meta;
  const iface = meta?.datalex?.interface;
  return iface && typeof iface === "object" ? iface : {};
}

function interfaceEnabled(iface) {
  if (!iface || typeof iface !== "object") return false;
  return iface.enabled === true || ["shared", "contracted"].includes(String(iface.stability || "").toLowerCase());
}

function uniqueKeyColumns(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  return [];
}

function materialization(model) {
  return model?.materialization || model?.config?.materialized || "";
}

function hasNamedTest(col, name) {
  const tests = Array.isArray(col?.tests) ? col.tests : [];
  if (tests.some((t) => t === name || (t && typeof t === "object" && Object.prototype.hasOwnProperty.call(t, name)))) return true;
  const constraints = Array.isArray(col?.constraints) ? col.constraints : [];
  return constraints.some((c) => c?.type === name);
}

function hasRelationshipTest(col) {
  const tests = Array.isArray(col?.tests) ? col.tests : [];
  if (tests.some((t) => t && typeof t === "object" && Object.prototype.hasOwnProperty.call(t, "relationships"))) return true;
  const constraints = Array.isArray(col?.constraints) ? col.constraints : [];
  return constraints.some((c) => c?.type === "foreign_key");
}
