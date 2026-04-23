/* schemaAdapter — converts existing DataLex workspaceStore YAML model into the
   prototype's {tables, relationships, subjectAreas} shape. Falls back gracefully
   when no active document is loaded. */
import yaml from "js-yaml";

const CAT_CYCLE = ["users", "billing", "product", "system", "access", "audit"];

function deriveCat(entity, idx) {
  const hint = String(entity.tags || "").toLowerCase();
  if (hint.includes("billing") || hint.includes("payment")) return "billing";
  if (hint.includes("user") || hint.includes("identity"))   return "users";
  if (hint.includes("product") || hint.includes("catalog")) return "product";
  if (hint.includes("audit") || hint.includes("log"))       return "audit";
  if (hint.includes("access") || hint.includes("permission")) return "access";
  return CAT_CYCLE[idx % CAT_CYCLE.length];
}

function kindOf(entity) {
  const t = String(entity.type || "").toLowerCase();
  if (t === "enum") return "ENUM";
  return null;
}

/* Normalize any supported FK shape into `{target: "entity.field", onDelete?}`
 * so Canvas.jsx gets a stable `c.fk` string regardless of whether the YAML
 * uses the canonical `{entity, field}`, the legacy `{entity, column}`,
 * SQLDBM-style `{references, table}`, or a bare string. Returns null when
 * no FK is present or the shape is too ambiguous to render. */
function normalizeForeignKey(foreignKey, legacyFkString) {
  if (foreignKey && typeof foreignKey === "object") {
    const entity = String(foreignKey.entity || foreignKey.table || foreignKey.references || "").trim();
    const field = String(foreignKey.field || foreignKey.column || "").trim();
    if (entity && field) {
      return {
        target: `${entity}.${field}`.toLowerCase(),
        onDelete: foreignKey.on_delete ? String(foreignKey.on_delete).toUpperCase() : null,
      };
    }
  }
  if (typeof foreignKey === "string" && foreignKey.trim()) {
    return { target: foreignKey.trim().toLowerCase(), onDelete: null };
  }
  if (typeof legacyFkString === "string" && legacyFkString.trim()) {
    return { target: legacyFkString.trim(), onDelete: null };
  }
  return null;
}

function columnsFromFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => {
    const col = {
      name: String(f.name || ""),
      // Preserve whatever the YAML says verbatim (including "unknown",
      // which the dbt importer writes when the manifest has no data_type).
      // Legacy silent default of "string" masked uncompiled dbt projects —
      // now we surface the gap so EntityNode can render "—" and Inspector
      // can prompt the user to fill it in.
      type: String(f.type ?? ""),
      description: f.description ? String(f.description) : "",
    };
    if (f.semantic_key_role) col.semanticKeyRole = String(f.semantic_key_role);
    if (f.primary_key || f.pk) col.pk = true;
    if (f.nullable === false) col.nn = true;
    if (f.unique) col.unique = true;
    if (f.default != null) col.default = String(f.default);
    if (f.generated) col.generated = true;
    if (f.check != null) col.check = String(f.check);
    const fkRef = normalizeForeignKey(f.foreign_key, f.fk);
    if (fkRef) {
      col.fk = fkRef.target;
      if (fkRef.onDelete) col.onDelete = fkRef.onDelete;
    }
    if (!col.fk && String(f.semantic_key_role || "").toLowerCase() === "foreign") {
      col.semanticFk = true;
    }
    return col;
  });
}

// Semantics: `one_to_many` means "one row on the from-side maps to many rows
// on the to-side" — so the crow's-foot must render on the to-side, not the
// from-side. v1.0.5 and earlier had `one_to_many` / `many_to_one` branches
// swapped (the to-side showed a single-bar glyph instead of a crow's-foot)
// and the default clause silently returned a plausible-looking
// many-to-one shape instead of surfacing the unknown value. Both are fixed
// here; the default now returns `null` so downstream renderers can show a
// neutral edge for "unspecified cardinality" rather than lying.
function cardinalityToEnds(cardinality) {
  const key = String(cardinality || "").toLowerCase();
  switch (key) {
    case "one_to_one":  return { from: { min: "1", max: "1" }, to: { min: "1", max: "1" } };
    case "one_to_many": return { from: { min: "1", max: "1" }, to: { min: "1", max: "N" } };
    case "many_to_one": return { from: { min: "1", max: "N" }, to: { min: "1", max: "1" } };
    case "many_to_many":return { from: { min: "1", max: "N" }, to: { min: "1", max: "N" } };
    default: {
      if (key) {
        if (!cardinalityToEnds._warned) cardinalityToEnds._warned = new Set();
        if (!cardinalityToEnds._warned.has(key)) {
          cardinalityToEnds._warned.add(key);
          // eslint-disable-next-line no-console
          console.warn("[schemaAdapter] unknown cardinality:", cardinality);
        }
      }
      return null;
    }
  }
}

function parseEndpoint(value) {
  const s = String(value || "");
  const [table, col] = s.split(".");
  return { table: (table || "").toLowerCase(), col: col || "id" };
}

function parseRelationshipSide(value) {
  if (typeof value === "string") return parseEndpoint(value);
  if (value && typeof value === "object") {
    const table = String(value.table || value.entity || "").toLowerCase();
    const col = String(value.col || value.field || value.column || "id");
    return { table, col };
  }
  return { table: "", col: "id" };
}

/* Tries to convert a DataLex YAML document into the design schema shape. */
export function adaptDataLexYaml(yamlText) {
  let doc;
  try { doc = yaml.load(yamlText); } catch (_e) { return null; }
  if (!doc || typeof doc !== "object") return null;
  const entities = Array.isArray(doc.entities) ? doc.entities : null;
  if (!entities || entities.length === 0) return null;

  const GRID_COLS = 3, COL_W = 300, ROW_H = 360;
  const tables = entities.map((e, i) => {
    const id = String(e.name || `entity_${i}`).toLowerCase();
    const cat = deriveCat(e, i);
    const kind = kindOf(e);
    const columns = columnsFromFields(e.fields);
    const row = Math.floor(i / GRID_COLS);
    const col = i % GRID_COLS;

    // Prefer persisted layout from `display:` (PR B). Fall back to a simple
    // grid layout so first-time files still render without an extra layout
    // pass. The canvas's localStorage cache layers on top of this at the
    // Shell level.
    const display = (e.display && typeof e.display === "object") ? e.display : {};
    const hasManualX = Number.isFinite(Number(display.x));
    const hasManualY = Number.isFinite(Number(display.y));
    const x = hasManualX ? Number(display.x) : 60 + col * COL_W;
    const y = hasManualY ? Number(display.y) : 60 + row * ROW_H;
    const width = Number.isFinite(Number(display.width)) ? Number(display.width) : undefined;
    // Auto Layout (v0.3.4) respects this flag — entities the user has already
    // placed by drag stay put while ELK repositions the rest. Both axes must
    // come from the YAML `display:` block; a fallback-grid cell doesn't count.
    const manualPosition = hasManualX && hasManualY;

    // `subject_area` is the canonical YAML field (schema v0.3.1+);
    // `subject` is the older alias some demo fixtures still use. Prefer
    // the canonical name so the domain switcher and the bottom-panel
    // Subject Areas view agree on keys.
    const subjectArea = typeof e.subject_area === "string" && e.subject_area.trim()
      ? e.subject_area.trim()
      : (typeof e.subject === "string" && e.subject.trim() ? e.subject.trim() : "");

    return {
      id,
      name: String(e.name || id),
      schema: String(doc.model?.name || "public"),
      cat,
      subject: subjectArea || cat,
      subject_area: subjectArea || undefined,
      description: e.description ? String(e.description) : "",
      tags: Array.isArray(e.tags) ? e.tags : [],
      owner: e.owner ? String(e.owner) : "",
      type: e.type ? String(e.type) : undefined,
      database: e.database ? String(e.database) : undefined,
      x,
      y,
      width,
      manualPosition,
      badges: kind === "ENUM" ? ["ENUM"] : ["BASE"],
      rowCount: e.row_count || "",
      kind: kind || undefined,
      columns,
    };
  });

  const tableIdSet = new Set(tables.map((t) => t.id));

  const explicitRels = Array.isArray(doc.relationships) ? doc.relationships : [];
  const relationships = [];
  explicitRels.forEach((r, i) => {
    const from = parseEndpoint(r.from);
    const to = parseEndpoint(r.to);
    if (!tableIdSet.has(from.table) || !tableIdSet.has(to.table)) return;
    const ends = cardinalityToEnds(r.cardinality);
    // When cardinality is unknown / unspecified, leave min/max undefined so
    // Canvas.drawEnd renders a neutral edge (no crow's-foot, no "one" bar)
    // instead of defaulting to a misleading many-to-one glyph.
    relationships.push({
      id: `r${i + 1}`,
      name: String(r.name || `${from.table}_${to.table}`),
      cardinality: String(r.cardinality || ""),
      from: { table: from.table, col: from.col, side: "right", ...(ends?.from || {}) },
      to:   { table: to.table,   col: to.col,   side: "left",  ...(ends?.to   || {}) },
      identifying: !!r.identifying,
      dashed: !!r.optional || !!r.dashed,
      onDelete: r.on_delete ? String(r.on_delete).toUpperCase() : undefined,
      onUpdate: r.on_update ? String(r.on_update).toUpperCase() : undefined,
    });
  });

  // Also infer relationships from FK columns where not explicitly declared
  tables.forEach((t) => {
    t.columns.forEach((c) => {
      if (!c.fk) return;
      const [targetTable, targetCol] = c.fk.split(".");
      if (!tableIdSet.has(targetTable)) return;
      // skip if already covered
      const dup = relationships.some((r) =>
        r.from.table === t.id && r.from.col === c.name &&
        r.to.table === targetTable && r.to.col === targetCol
      );
      if (dup) return;
      relationships.push({
        id: `rfk-${t.id}-${c.name}`,
        name: `fk_${t.id}_${c.name}`,
        cardinality: "many_to_one",
        from: { table: t.id, col: c.name, side: "right", min: c.nn ? "1" : "0", max: "N" },
        to:   { table: targetTable, col: targetCol, side: "left", min: "1", max: "1" },
        identifying: !!c.pk,
        dashed: !c.nn,
        onDelete: c.onDelete,
      });
    });
  });

  /* subjectAreas: the set of all domains present on the tables, plus any
     top-level `subject_areas:` catalog the YAML declares (so an empty
     domain with no members still shows up in the switcher). Preserves
     declaration order — useful when the YAML orders domains
     intentionally (e.g. by business priority). */
  const catalog = Array.isArray(doc.subject_areas) ? doc.subject_areas : [];
  const seen = new Set();
  const subjectAreas = [];
  for (const c of catalog) {
    const name = typeof c === "string" ? c : c?.name;
    if (name && !seen.has(name)) {
      seen.add(name);
      subjectAreas.push({
        name,
        color: (c && typeof c === "object" && c.color) || undefined,
        description: (c && typeof c === "object" && c.description) || undefined,
        count: 0,
      });
    }
  }
  for (const t of tables) {
    const name = t.subject_area;
    if (!name) continue;
    if (!seen.has(name)) {
      seen.add(name);
      subjectAreas.push({ name, count: 0 });
    }
  }
  // Second pass: count table membership per domain. O(n·m) but both
  // dimensions are small (domains rarely exceed ~20, tables ~200).
  for (const area of subjectAreas) {
    area.count = tables.reduce((n, t) => n + (t.subject_area === area.name ? 1 : 0), 0);
  }

  return {
    name: String(doc.model?.name || "DataLex Model"),
    engine: String(doc.model?.dialect || doc.model?.engine || "DataLex"),
    schema: String(doc.model?.name || "public"),
    tables,
    relationships,
    subjectAreas,
  };
}

/* ------------------------------------------------------------------ *
 * dbt schema.yml adapter — converts a dbt v2 schema file
 * ({version: 2, models: [{name, columns: [{name, data_type, tests}]}]})
 * into an intermediate DataLex-shaped doc so we can reuse the entire
 * `adaptDataLexYaml` pipeline above. `tests: - relationships:` test
 * blocks are converted into synthetic `foreign_key` metadata so the
 * existing FK inference at lines 127-148 emits edges.
 * ------------------------------------------------------------------ */
function dbtRelationshipsTarget(test) {
  // Each test can be either a string ("not_null") or `{name: {...}}`.
  if (!test || typeof test !== "object") return null;
  const rel = test.relationships;
  if (!rel || typeof rel !== "object") return null;
  // `to` is typically `"ref('other_model')"` or `"source('s','t')"`.
  const raw = String(rel.to || "").trim();
  const refMatch = raw.match(/ref\(\s*['"]([^'"]+)['"]\s*\)/);
  const srcMatch = raw.match(/source\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
  const target = refMatch ? refMatch[1] : (srcMatch ? srcMatch[1] : null);
  if (!target) return null;
  return { entity: target, field: String(rel.field || "id") };
}

function parseDbtEntityName(toExpr) {
  if (typeof toExpr !== "string") return null;
  const text = toExpr.trim();
  if (!text) return null;
  const ref = text.match(/ref\(\s*['"]([^'"]+)['"]\s*\)/i);
  if (ref) return String(ref[1] || "").trim() || null;
  const source = text.match(/source\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
  if (source) return String(source[1] || "").trim() || null;
  const token = text.split(".").pop()?.replace(/['"`]/g, "").trim();
  return token || null;
}

function asDbtList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseDbtConstraintTarget(constraint = {}) {
  const explicitEntity = parseDbtEntityName(constraint?.to || constraint?.references);
  const explicitField = String(constraint?.field || "id").trim();
  if (explicitEntity && explicitField) {
    return { entity: explicitEntity, field: explicitField };
  }

  const expr = String(constraint?.expression || constraint?.references || "").trim();
  if (!expr) return null;
  const match = expr.match(/references\s+([A-Za-z0-9_."`]+)\s*\(\s*([A-Za-z0-9_"]+)\s*\)/i);
  if (!match) return null;
  const entity = String(match[1] || "").replace(/["`]/g, "").split(".").pop()?.trim();
  const field = String(match[2] || "").replace(/["`]/g, "").trim();
  if (!entity || !field) return null;
  return { entity, field };
}

function simpleColumnReference(expr, fallbackName = "") {
  const raw = String(expr || fallbackName || "").trim();
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(raw) ? raw : null;
}

function inferConstraintType(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "_");
}

function buildDbtFieldMap(model) {
  const map = new Map();
  const cols = Array.isArray(model?.columns) ? model.columns : [];
  cols.forEach((column) => {
    const name = String(column?.name || "").trim();
    if (!name) return;
    const tests = [...asDbtList(column?.tests), ...asDbtList(column?.data_tests)];
    const constraints = asDbtList(column?.constraints);
    let hasNotNull = column?.nullable === false || column?.not_null === true;
    let hasUnique = !!column?.unique;
    let hasPrimaryKey = !!(column?.primary_key || column?.pk);
    let foreignKey = null;
    let checkExpr = column?.check != null ? String(column.check) : "";
    const out = {
      name,
      type: String(column?.data_type ?? column?.type ?? ""),
      description: column?.description ? String(column.description) : "",
      default: column?.default,
      generated: !!column?.generated,
    };

    for (const testDef of tests) {
      if (typeof testDef === "string") {
        const tname = inferConstraintType(testDef.split(".").pop());
        if (tname === "not_null") hasNotNull = true;
        else if (tname === "unique") hasUnique = true;
        continue;
      }
      if (!testDef || typeof testDef !== "object") continue;
      for (const [rawName, cfg] of Object.entries(testDef)) {
        const tname = inferConstraintType(rawName.split(".").pop());
        if (tname === "not_null") hasNotNull = true;
        else if (tname === "unique") hasUnique = true;
        else if (tname === "relationships") {
          const target = dbtRelationshipsTarget({ relationships: cfg });
          if (target) foreignKey = target;
        }
      }
    }

    for (const constraintDef of constraints) {
      if (typeof constraintDef === "string") {
        const ctype = inferConstraintType(constraintDef);
        if (ctype === "not_null") hasNotNull = true;
        else if (ctype === "unique") hasUnique = true;
        else if (ctype === "primary_key") hasPrimaryKey = true;
        continue;
      }
      if (!constraintDef || typeof constraintDef !== "object") continue;
      const ctype = inferConstraintType(constraintDef.type || constraintDef.constraint_type);
      if (ctype === "not_null") hasNotNull = true;
      else if (ctype === "unique") hasUnique = true;
      else if (ctype === "primary_key") hasPrimaryKey = true;
      else if (ctype === "foreign_key") {
        const target = parseDbtConstraintTarget(constraintDef);
        if (target) foreignKey = target;
      } else if (ctype === "check") {
        checkExpr = String(constraintDef.expression || constraintDef.expr || checkExpr || "").trim();
      }
    }

    if (hasPrimaryKey) {
      hasNotNull = true;
      hasUnique = true;
    }
    if (hasPrimaryKey) out.primary_key = true;
    if (hasNotNull) out.nullable = false;
    if (hasUnique) out.unique = true;
    if (foreignKey) out.foreign_key = foreignKey;
    if (checkExpr) out.check = checkExpr;
    map.set(name.toLowerCase(), out);
  });

  for (const constraintDef of asDbtList(model?.constraints)) {
    if (!constraintDef || typeof constraintDef !== "object") continue;
    const ctype = inferConstraintType(constraintDef.type || constraintDef.constraint_type);
    const colsForConstraint = asDbtList(constraintDef.columns)
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (colsForConstraint.length === 0) continue;
    const target = ctype === "foreign_key" ? parseDbtConstraintTarget(constraintDef) : null;
    colsForConstraint.forEach((columnName) => {
      const key = columnName.toLowerCase();
      const current = map.get(key) || {
        name: columnName,
        type: "",
        description: "",
        default: undefined,
        generated: false,
      };
      if (ctype === "primary_key") {
        current.primary_key = true;
        current.nullable = false;
        current.unique = true;
      } else if (ctype === "unique") {
        current.unique = true;
      } else if (ctype === "not_null") {
        current.nullable = false;
      } else if (ctype === "foreign_key" && target) {
        current.foreign_key = target;
      }
      map.set(key, current);
    });
  }

  return map;
}

function fieldMapToEntityFields(fieldMap) {
  return Array.from(fieldMap.values()).map((field) => {
    const out = {
      name: String(field.name || ""),
      type: String(field.type ?? ""),
    };
    if (field.nullable === false) out.nullable = false;
    if (field.unique) out.unique = true;
    if (field.primary_key) out.primary_key = true;
    if (field.foreign_key) out.foreign_key = field.foreign_key;
    if (field.description) out.description = String(field.description);
    if (field.default !== undefined) out.default = field.default;
    if (field.generated) out.generated = true;
    if (field.check != null && String(field.check).trim()) out.check = String(field.check);
    return out;
  });
}

function fieldMapFromCanonicalFields(fields) {
  const map = new Map();
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const name = String(field?.name || "").trim();
    if (!name) return;
    const out = {
      name,
      type: String(field?.type ?? field?.data_type ?? ""),
      description: field?.description ? String(field.description) : "",
      default: field?.default,
      generated: !!field?.generated,
    };
    if (field?.primary_key || field?.pk) out.primary_key = true;
    if (field?.nullable === false) out.nullable = false;
    if (field?.unique) out.unique = true;
    if (field?.check != null) out.check = String(field.check);
    if (field?.foreign_key) out.foreign_key = field.foreign_key;
    else if (typeof field?.fk === "string" && field.fk.trim()) {
      const [entity, refField] = field.fk.trim().split(".");
      if (entity && refField) out.foreign_key = { entity, field: refField };
    }
    map.set(name.toLowerCase(), out);
  });
  return map;
}

function buildProjectEntityIndex(projectFiles) {
  const index = new Map();
  (projectFiles || []).forEach((file) => {
    if (!file || typeof file.content !== "string") return;
    let doc;
    try { doc = yaml.load(file.content); } catch (_err) { return; }
    if (!doc || typeof doc !== "object") return;

    const addEntry = (name, fieldMap) => {
      const entityName = String(name || "").trim();
      if (!entityName || !fieldMap || fieldMap.size === 0) return;
      const key = entityName.toLowerCase();
      if (!index.has(key)) {
        index.set(key, {
          name: entityName,
          file: String(file.fullPath || file.path || ""),
          fields: fieldMap,
        });
      }
    };

    if (Array.isArray(doc.models)) {
      doc.models.forEach((model) => addEntry(model?.name, buildDbtFieldMap(model)));
    }
    if (Array.isArray(doc.sources)) {
      doc.sources.forEach((source) => {
        (source?.tables || []).forEach((table) => addEntry(table?.name, buildDbtFieldMap(table)));
      });
    }

    const kind = String(doc.kind || "").toLowerCase();
    if ((kind === "model" || kind === "entity" || kind === "source") && doc.name) {
      addEntry(doc.name, fieldMapFromCanonicalFields(Array.isArray(doc.columns) ? doc.columns : doc.fields));
    }
    if (kind === "source" && Array.isArray(doc.tables)) {
      doc.tables.forEach((table) => addEntry(table?.name, fieldMapFromCanonicalFields(Array.isArray(table?.columns) ? table.columns : table?.fields)));
    }
    if (Array.isArray(doc.entities)) {
      doc.entities.forEach((entity) => addEntry(entity?.name, fieldMapFromCanonicalFields(entity?.fields)));
    }
  });
  return index;
}

function resolveSemanticSourceField(projectIndex, modelExpr, expr, fallbackName = "") {
  const entityName = parseDbtEntityName(modelExpr);
  const fieldName = simpleColumnReference(expr, fallbackName);
  if (!entityName || !fieldName) return null;
  return projectIndex.get(entityName.toLowerCase())?.fields?.get(fieldName.toLowerCase()) || null;
}

function isNumericType(typeName) {
  const value = String(typeName || "").toLowerCase();
  return /(int|decimal|numeric|float|double|real|number)/.test(value);
}

function semanticDimensionFieldType(dimType) {
  const d = String(dimType || "").trim().toLowerCase();
  if (d === "time") return "date";
  return "string";
}

function semanticMeasureFieldType(agg) {
  const a = String(agg || "").trim().toLowerCase();
  if (a === "count" || a === "count_distinct") return "bigint";
  return "decimal(18,2)";
}

function dbtModelToDataLexEntity(model) {
  const name = String(model?.name || "").trim();
  if (!name) return null;
  const fields = fieldMapToEntityFields(buildDbtFieldMap(model));
  return { name, type: "table", description: String(model?.description || ""), fields };
}

/* Public adapter: parses a dbt schema.yml and emits DataLex-shaped output
   (same return shape as `adaptDataLexYaml`). Returns null on non-dbt docs
   so callers can chain try-dbt-then-datalex. */
export function adaptDbtSchemaYaml(yamlText, projectFiles = []) {
  let doc;
  try { doc = yaml.load(yamlText); } catch (_e) { return null; }
  if (!doc || typeof doc !== "object") return null;
  const models = Array.isArray(doc.models) ? doc.models : null;
  const sources = Array.isArray(doc.sources) ? doc.sources : null;
  const semanticModels = Array.isArray(doc.semantic_models) ? doc.semantic_models : null;
  const metrics = Array.isArray(doc.metrics) ? doc.metrics : null;
  if (!models && !sources && !semanticModels && !metrics) return null;
  const projectEntityIndex = buildProjectEntityIndex(projectFiles);

  const entities = [];
  (models || []).forEach((m) => {
    const e = dbtModelToDataLexEntity(m);
    if (e) entities.push(e);
  });
  // Sources: each source can have N tables; emit one entity per table.
  (sources || []).forEach((s) => {
    const tables = Array.isArray(s?.tables) ? s.tables : [];
    tables.forEach((t) => {
      const e = dbtModelToDataLexEntity(t);
      if (e) entities.push(e);
    });
  });
  (semanticModels || []).forEach((sm) => {
    if (!sm || typeof sm !== "object") return;
    const name = String(sm.name || "").trim();
    if (!name) return;
    const fields = [];

    const semEntities = Array.isArray(sm.entities) ? sm.entities : [];
    semEntities.forEach((semEntity) => {
      if (!semEntity || typeof semEntity !== "object") return;
      const fieldName = String(semEntity.expr || semEntity.name || "").trim();
      if (!fieldName) return;
      const role = String(semEntity.type || "").trim().toLowerCase();
      const sourceField = resolveSemanticSourceField(projectEntityIndex, sm.model, semEntity.expr, semEntity.name);
      const field = {
        name: fieldName,
        type: String(sourceField?.type || "string"),
        nullable: role === "primary" ? false : sourceField?.nullable !== false,
        description: `Semantic entity key (${role || "entity"}).`,
        semantic_key_role: role || undefined,
      };
      if (role === "primary") field.primary_key = true;
      if (!field.type) field.type = "string";
      if (role === "foreign" && sourceField?.foreign_key) field.foreign_key = sourceField.foreign_key;
      fields.push(field);
    });

    const dimensions = Array.isArray(sm.dimensions) ? sm.dimensions : [];
    dimensions.forEach((dim) => {
      if (!dim || typeof dim !== "object") return;
      const fieldName = String(dim.expr || dim.name || "").trim();
      if (!fieldName) return;
      const dimType = String(dim.type || "").trim();
      const sourceField = resolveSemanticSourceField(projectEntityIndex, sm.model, dim.expr, dim.name);
      fields.push({
        name: fieldName,
        type: String(sourceField?.type || semanticDimensionFieldType(dimType)),
        nullable: sourceField?.nullable !== false,
        description: String(dim.description || `Semantic dimension (${dimType || "dimension"}).`),
      });
    });

    const measures = Array.isArray(sm.measures) ? sm.measures : [];
    measures.forEach((measure) => {
      if (!measure || typeof measure !== "object") return;
      const fieldName = String(measure.expr || measure.name || "").trim();
      if (!fieldName) return;
      const agg = String(measure.agg || "").trim();
      const sourceField = resolveSemanticSourceField(projectEntityIndex, sm.model, measure.expr, measure.name);
      fields.push({
        name: fieldName,
        type: agg === "count" || agg === "count_distinct"
          ? "bigint"
          : (isNumericType(sourceField?.type) ? String(sourceField.type) : semanticMeasureFieldType(agg)),
        nullable: sourceField?.nullable !== false,
        description: String(measure.description || `Semantic measure (${agg || "measure"}).`),
      });
    });

    entities.push({
      name,
      type: "view",
      description: String(sm.description || ""),
      tags: [...(Array.isArray(sm.tags) ? sm.tags : []), "SEMANTIC_MODEL"],
      fields,
    });
  });
  if ((metrics || []).length > 0) {
    entities.push({
      name: "metric_catalog",
      type: "view",
      description: "dbt metric definitions imported from semantic layer.",
      tags: ["METRIC"],
      fields: metrics
        .filter((metric) => metric && typeof metric === "object")
        .map((metric) => ({
          name: String(metric.name || "").trim(),
          type: "decimal(18,2)",
          nullable: true,
          description: String(metric.description || metric.label || `dbt metric (${String(metric.type || "").trim() || "metric"}).`),
        }))
        .filter((field) => field.name),
    });
  }
  if (entities.length === 0) return null;

  // Round-trip through the canonical DataLex adapter so one code path owns
  // column/FK inference — avoids drift if the DataLex shape evolves.
  const synthetic = yaml.dump({ model: { name: "dbt_schema" }, entities }, { lineWidth: 120 });
  return adaptDataLexYaml(synthetic);
}

/* ------------------------------------------------------------------ *
 * DataLex `kind: model` / `kind: source` adapter — the shape the dbt
 * importer writes to disk (`kind: model`, top-level `columns:`). The
 * canonical `adaptDataLexYaml` expects top-level `entities:`, so these
 * docs would otherwise render as empty / "string"-typed on the canvas.
 * We normalize them into the entities[] shape and round-trip through
 * the canonical adapter for one-source-of-truth column/FK inference.
 * ------------------------------------------------------------------ */
function dataLexColumnToField(c) {
  if (!c || typeof c !== "object") return null;
  const name = String(c.name || "").trim();
  if (!name) return null;
  const out = { name };
  // Column type can live under `type:` (DataLex canonical) or `data_type:`
  // (dbt passthrough when the manifest column is untyped). Preserve "—"
  // on truly missing types so the UI can show an explicit unknown.
  const t = c.type ?? c.data_type;
  if (t != null && String(t).trim() !== "") out.type = String(t);
  if (c.primary_key || c.pk) out.primary_key = true;
  if (c.nullable === false) out.nullable = false;
  if (c.unique) out.unique = true;
  if (c.default != null) out.default = c.default;
  if (c.description) out.description = String(c.description);
  if (c.foreign_key && typeof c.foreign_key === "object") out.foreign_key = c.foreign_key;
  else if (typeof c.fk === "string") out.fk = c.fk;
  // Fold dbt-style `tests: [{relationships: {to, field}}]` into a synthetic
  // foreign_key so FK edges render for imported models without us needing
  // to touch the raw file.
  const tests = Array.isArray(c.tests) ? c.tests : [];
  if (!out.foreign_key && !out.fk) {
    for (const tst of tests) {
      const target = dbtRelationshipsTarget(tst);
      if (target) { out.foreign_key = target; break; }
    }
  }
  if (tests.some((t2) => t2 === "not_null" || t2?.not_null) && out.nullable === undefined) {
    out.nullable = false;
  }
  if (tests.some((t2) => t2 === "unique" || t2?.unique)) {
    out.unique = true;
  }
  return out;
}

function dataLexModelDocToEntity(doc) {
  const name = String(doc?.name || "").trim();
  if (!name) return null;
  const cols = Array.isArray(doc?.columns) ? doc.columns : [];
  const fields = cols.map(dataLexColumnToField).filter(Boolean);
  const entity = {
    name,
    type: "table",
    description: doc?.description ? String(doc.description) : "",
    fields,
  };
  if (doc?.display && typeof doc.display === "object") entity.display = doc.display;
  if (Array.isArray(doc?.tags)) entity.tags = doc.tags;
  // Surface both spellings so a per-file `kind: model` picks up its
  // domain the same way an `entities:` block does. The downstream
  // schemaAdapter path already prefers `subject_area` over `subject`.
  if (doc?.subject_area) entity.subject_area = doc.subject_area;
  if (doc?.subject) entity.subject = doc.subject;
  return entity;
}

/* Public adapter: parses a DataLex `kind: model` / `kind: source` doc
   and emits the same shape as `adaptDataLexYaml`. Returns null when the
   doc is not a recognised model/source so callers can chain adapters. */
export function adaptDataLexModelYaml(yamlText) {
  let doc;
  try { doc = yaml.load(yamlText); } catch (_e) { return null; }
  if (!doc || typeof doc !== "object") return null;
  const kind = String(doc.kind || "").toLowerCase();
  const isModel = kind === "model" || kind === "entity";
  const isSource = kind === "source";
  if (!isModel && !isSource) return null;
  // An entity with explicit `fields:` is already in canonical shape — let
  // adaptDataLexYaml handle it via the `entities:` wrapper below.
  const entities = [];
  if (isSource && Array.isArray(doc.tables)) {
    doc.tables.forEach((t) => {
      const e = dataLexModelDocToEntity(t);
      if (e) entities.push(e);
    });
  } else {
    const e = dataLexModelDocToEntity(doc);
    if (e) entities.push(e);
  }
  if (entities.length === 0) return null;
  const syntheticDoc = {
    model: { name: String(doc.schema || doc.database || doc.name || "dbt_schema") },
    entities,
  };
  if (Array.isArray(doc.relationships)) syntheticDoc.relationships = doc.relationships;
  if (Array.isArray(doc.subject_areas)) syntheticDoc.subject_areas = doc.subject_areas;
  const synthetic = yaml.dump(syntheticDoc, { lineWidth: 120 });
  const adapted = adaptDataLexYaml(synthetic);
  if (!adapted) return null;

  // `kind:model` files often declare top-level relationships to entities in
  // other files. The canonical `adaptDataLexYaml` path drops those because it
  // only keeps edges whose endpoints are both present in the local entities[]
  // block. Restore them here so diagram-composed cross-file relationships can
  // be edited and re-rendered correctly.
  const explicitRels = Array.isArray(doc.relationships) ? doc.relationships : [];
  if (explicitRels.length === 0) return adapted;
  const relIndexByKey = new Map();
  (adapted.relationships || []).forEach((rel, index) => {
    const key = `${rel?.from?.table || ""}.${rel?.from?.col || ""}->${rel?.to?.table || ""}.${rel?.to?.col || ""}`;
    relIndexByKey.set(key, index);
  });
  explicitRels.forEach((rel, index) => {
    const from = parseRelationshipSide(rel?.from);
    const to = parseRelationshipSide(rel?.to);
    if (!from.table || !to.table) return;
    const ends = cardinalityToEnds(rel?.cardinality);
    const nextRel = {
      id: `r-model-${index + 1}`,
      name: String(rel?.name || `${from.table}_${to.table}`),
      cardinality: String(rel?.cardinality || ""),
      from: { table: from.table, col: from.col, side: "right", ...(ends?.from || {}) },
      to: { table: to.table, col: to.col, side: "left", ...(ends?.to || {}) },
      identifying: !!rel?.identifying,
      dashed: !!rel?.optional || !!rel?.dashed,
      onDelete: rel?.on_delete ? String(rel.on_delete).toUpperCase() : undefined,
      onUpdate: rel?.on_update ? String(rel.on_update).toUpperCase() : undefined,
    };
    const key = `${from.table}.${from.col}->${to.table}.${to.col}`;
    const existingIndex = relIndexByKey.get(key);
    if (existingIndex == null) {
      relIndexByKey.set(key, adapted.relationships.length);
      adapted.relationships.push(nextRel);
    } else {
      adapted.relationships[existingIndex] = nextRel;
    }
  });
  return adapted;
}

/* ------------------------------------------------------------------ *
 * Diagram adapter — reads a .diagram.yaml and unions entities from N
 * referenced files. `fileLookup` is a map-like `{fullPath → content}`.
 * ------------------------------------------------------------------ */
function isDbtSchemaLike(yamlText) {
  try {
    const doc = yaml.load(yamlText);
    if (!doc || typeof doc !== "object") return false;
    return Array.isArray(doc.models) || Array.isArray(doc.sources) || Array.isArray(doc.semantic_models) || Array.isArray(doc.metrics);
  } catch (_e) { return false; }
}

export function schemaToPanelModel(schema) {
  if (!schema || typeof schema !== "object") return null;
  const tables = Array.isArray(schema.tables) ? schema.tables : [];
  const relationships = Array.isArray(schema.relationships) ? schema.relationships : [];
  const subjectAreas = Array.isArray(schema.subjectAreas) ? schema.subjectAreas : [];
  return {
    model: {
      name: String(schema.name || "DataLex Model"),
      kind: "physical",
    },
    subject_areas: subjectAreas.map((area) => ({
      name: area?.name || area?.label || area?.id || "",
      color: area?.color,
      description: area?.description,
    })).filter((area) => area.name),
    entities: tables.map((table) => ({
      id: table.id,
      name: String(table.name || table.id || ""),
      type: String(table.type || (table.kind === "ENUM" ? "enum" : "table")),
      description: String(table.description || ""),
      tags: Array.isArray(table.tags) ? table.tags : [],
      owner: table.owner,
      subject_area: table.subject_area,
      schema: table.schema,
      database: table.database,
      row_count: table.rowCount,
      fields: (table.columns || []).map((column) => ({
        name: String(column.name || ""),
        type: String(column.type || ""),
        description: String(column.description || ""),
        primary_key: !!column.pk,
        nullable: !column.nn,
        unique: !!column.unique,
        default: column.default,
        generated: !!column.generated,
        check: column.check,
        fk: column.fk,
        foreign_key: column.fk ? { entity: String(column.fk).split(".")[0], field: String(column.fk).split(".")[1] || "id" } : undefined,
      })),
      _sourceFile: table._sourceFile,
    })),
    relationships: relationships.map((rel) => ({
      id: rel.id,
      name: rel.name,
      from: `${rel.from?.table || ""}.${rel.from?.col || "id"}`,
      to: `${rel.to?.table || ""}.${rel.to?.col || "id"}`,
      cardinality: rel.kind || rel.cardinality || "",
      on_delete: rel.onDelete,
      on_update: rel.onUpdate,
      identifying: !!rel.identifying,
      optional: !!rel.dashed,
    })),
    indexes: [],
  };
}

export function adaptDiagramYaml(yamlText, projectFiles) {
  let diagram;
  try { diagram = yaml.load(yamlText); } catch (_e) { return null; }
  if (!diagram || typeof diagram !== "object") return null;
  const entries = Array.isArray(diagram.entities) ? diagram.entities : [];
  const diagramNodeId = (file, entity) => `${String(file || "").replace(/^[/\\]+/, "")}::${String(entity || "").toLowerCase()}`;

  // Build a fast lookup from projectFiles: [{fullPath, content?, path}].
  const byPath = new Map();
  (projectFiles || []).forEach((f) => {
    if (!f) return;
    const key = (f.fullPath || f.path || "").replace(/^[/\\]+/, "");
    if (key) byPath.set(key, f);
  });

  // Dedupe by {file, entity} so dropping the same file twice doesn't
  // duplicate tables on canvas.
  const seen = new Set();
  const refs = [];
  entries.forEach((e) => {
    const file = String(e?.file || "").replace(/^[/\\]+/, "");
    const entity = String(e?.entity || "").trim();
    if (!file) return;
    const key = `${file}::${entity || "*"}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ file, entity, x: e?.x, y: e?.y, width: e?.width });
  });

  const allTables = [];
  const allRelationships = [];
  const relationshipIndexByEndpoint = new Map();
  const adaptedRefs = [];
  const nodeByScopedName = new Map();
  const nodeIdsByEntity = new Map();

  const upsertRelationship = (relationship, precedence = 0) => {
    const key = `${relationship?.from?.table || ""}.${relationship?.from?.col || ""}->${relationship?.to?.table || ""}.${relationship?.to?.col || ""}`;
    if (!relationship?.from?.table || !relationship?.to?.table || !relationship?.from?.col || !relationship?.to?.col) return;
    const existing = relationshipIndexByEndpoint.get(key);
    if (!existing) {
      relationshipIndexByEndpoint.set(key, { index: allRelationships.length, precedence });
      allRelationships.push(relationship);
      return;
    }
    if (precedence < existing.precedence) return;
    allRelationships[existing.index] = relationship;
    relationshipIndexByEndpoint.set(key, { index: existing.index, precedence });
  };

  refs.forEach((ref) => {
    const file = byPath.get(ref.file);
    if (!file || typeof file.content !== "string") return;
    const content = file.content;
    // Adapter dispatch: try dbt schema.yml first (has explicit `models:` /
    // `sources:` markers), then DataLex canonical (`entities:`), then the
    // `kind: model` / `kind: source` shape the dbt importer writes. The
    // final fallback is what makes dropping an imported stg_*.yml onto a
    // diagram actually render — without it the adapter returns null and
    // the table silently disappears.
    const adapted = isDbtSchemaLike(content)
      ? adaptDbtSchemaYaml(content)
      : (adaptDataLexYaml(content) || adaptDataLexModelYaml(content));
    if (!adapted) return;
    adaptedRefs.push({ ref, adapted });

    const wantAll = !ref.entity || ref.entity === "*";
    const wantId = String(ref.entity || "").toLowerCase();
    adapted.tables.forEach((t) => {
      if (!wantAll && t.id !== wantId) return;
      const entityName = String(t.name || t.id || "").toLowerCase();
      const nodeId = diagramNodeId(ref.file, entityName);
      // Overlay diagram-provided position if present.
      const diagramHasX = Number.isFinite(Number(ref.x));
      const diagramHasY = Number.isFinite(Number(ref.y));
      const x = diagramHasX ? Number(ref.x) : t.x;
      const y = diagramHasY ? Number(ref.y) : t.y;
      const width = Number.isFinite(Number(ref.width)) ? Number(ref.width) : t.width;
      // Entities placed explicitly by the diagram (drag commit) or by the
      // model file's `display:` block count as manually positioned — Auto
      // Layout leaves them alone.
      const manualPosition = (diagramHasX && diagramHasY) || t.manualPosition === true;
      // Dedupe by source-file scoped node id — last-wins on position
      // (diagram overrides), while still allowing two different files to
      // expose the same entity name without collapsing into one node.
      const existingIdx = allTables.findIndex((x2) => x2.id === nodeId);
      const tagged = {
        ...t,
        id: nodeId,
        name: String(t.name || t.id || ""),
        x,
        y,
        width,
        manualPosition,
        _sourceFile: ref.file,
        _entityName: entityName,
      };
      if (existingIdx >= 0) allTables[existingIdx] = tagged;
      else allTables.push(tagged);
      nodeByScopedName.set(diagramNodeId(ref.file, entityName), nodeId);
      const bucket = nodeIdsByEntity.get(entityName) || [];
      if (!bucket.includes(nodeId)) bucket.push(nodeId);
      nodeIdsByEntity.set(entityName, bucket);
    });
  });

  const resolveDiagramNodeId = (entityName, preferredFile = "") => {
    const target = String(entityName || "").toLowerCase();
    if (!target) return null;
    if (preferredFile) {
      const direct = nodeByScopedName.get(diagramNodeId(preferredFile, target));
      if (direct) return direct;
    }
    const bucket = nodeIdsByEntity.get(target) || [];
    return bucket.length === 1 ? bucket[0] : null;
  };

  adaptedRefs.forEach(({ ref, adapted }) => {
    adapted.relationships.forEach((r, index) => {
      const fromEntity = String(r?.from?.table || "").toLowerCase();
      const toEntity = String(r?.to?.table || "").toLowerCase();
      const fromId = resolveDiagramNodeId(fromEntity, ref.file);
      const toId = resolveDiagramNodeId(toEntity, ref.file);
      if (!fromId || !toId) return;
      const relName = String(r?.name || `${fromEntity}_${toEntity}_${index}`);
      const origin = String(r?.id || "").startsWith("rfk-") ? "field_fk" : "model_relationship";
      upsertRelationship({
        ...r,
        name: relName,
        id: `${origin}:${String(ref.file || "").replace(/^[/\\]+/, "")}:${relName}:${index}`,
        from: { ...r.from, table: fromId },
        to: { ...r.to, table: toId },
        _origin: origin,
        _sourceFile: ref.file,
        _fromEntityName: fromEntity,
        _toEntityName: toEntity,
      }, origin === "field_fk" ? 0 : 1);
    });
  });

  // Merge diagram-level relationships (cross-file FKs authored on the
  // canvas — drag-to-relate, "Add Relationship" dialog). These aren't
  // written back into the referenced model files; they live only in the
  // diagram YAML so a user can compose edges across dbt models without
  // mutating the underlying schema. Shape matches the canonical
  // relationships[] entries produced by adaptDataLexYaml: {from:{table,col},
  // to:{table,col}, kind?, label?, ...}.
  const diagramRels = Array.isArray(diagram.relationships) ? diagram.relationships : [];
  diagramRels.forEach((r, index) => {
    const fromEnt = String(r?.from?.entity || r?.from?.table || "").toLowerCase();
    const fromCol = String(r?.from?.field || r?.from?.col || "").toLowerCase();
    const toEnt = String(r?.to?.entity || r?.to?.table || "").toLowerCase();
    const toCol = String(r?.to?.field || r?.to?.col || "").toLowerCase();
    if (!fromEnt || !fromCol || !toEnt || !toCol) return;
    const fromId = resolveDiagramNodeId(fromEnt);
    const toId = resolveDiagramNodeId(toEnt);
    if (!fromId || !toId) return;
    const relName = String(r?.name || `${fromEnt}_to_${toEnt}`);
    const ends = cardinalityToEnds(r?.cardinality);
    upsertRelationship({
      id: `diagram_relationship:${relName}:${index}`,
      from: { table: fromId, col: fromCol, ...(ends?.from || {}) },
      to: { table: toId, col: toCol, ...(ends?.to || {}) },
      cardinality: String(r?.cardinality || "many_to_one"),
      kind: String(r?.cardinality || "many_to_one"),
      identifying: !!r?.identifying,
      dashed: !!r?.optional,
      label: r?.label ? String(r.label) : undefined,
      onDelete: r?.on_delete ? String(r.on_delete).toUpperCase() : undefined,
      onUpdate: r?.on_update ? String(r.on_update).toUpperCase() : undefined,
      name: relName,
      // Tag as diagram-origin so the identifying/non-identifying renderer
      // can tell it apart from model-file FKs if it ever needs to.
      _diagramLevel: true,
      _origin: "diagram_relationship",
      _fromEntityName: fromEnt,
      _toEntityName: toEnt,
    }, 2);
  });

  // Filter relationships to those whose both endpoints are on the canvas.
  const onCanvas = new Set(allTables.map((t) => t.id));
  const filteredRels = allRelationships.filter(
    (r) => onCanvas.has(r.from.table) && onCanvas.has(r.to.table)
  );

  // v0.3.4 — sticky annotations / notes live on the diagram YAML under
  // `notes: []`. Hand them through to the canvas surface so they
  // survive reloads and git commits alongside the edges.
  const rawNotes = Array.isArray(diagram.notes) ? diagram.notes : [];
  const notes = rawNotes
    .map((n) => {
      if (!n || typeof n !== "object") return null;
      const id = String(n.id || "").trim();
      if (!id) return null;
      return {
        id,
        text: typeof n.text === "string" ? n.text : "",
        x: Number.isFinite(Number(n.x)) ? Number(n.x) : 60,
        y: Number.isFinite(Number(n.y)) ? Number(n.y) : 60,
        width: Number.isFinite(Number(n.width)) ? Number(n.width) : undefined,
        height: Number.isFinite(Number(n.height)) ? Number(n.height) : undefined,
        color: Number.isInteger(n.color) ? n.color : 0,
      };
    })
    .filter(Boolean);

  // Collect domains referenced by any of the composed tables. We do
  // this post-merge so diagram views pick up subject_area from every
  // referenced model file without the diagram YAML needing its own
  // `subject_areas:` catalog. Preserves first-seen order.
  const diagramSeen = new Set();
  const diagramSubjectAreas = [];
  for (const t of allTables) {
    const name = t?.subject_area;
    if (!name || diagramSeen.has(name)) continue;
    diagramSeen.add(name);
    diagramSubjectAreas.push({ name, count: 0 });
  }
  for (const area of diagramSubjectAreas) {
    area.count = allTables.reduce((n, t) => n + (t.subject_area === area.name ? 1 : 0), 0);
  }

  return {
    name: String(diagram.title || diagram.name || "Diagram"),
    engine: "DataLex Diagram",
    schema: "diagram",
    tables: allTables,
    relationships: filteredRels,
    subjectAreas: diagramSubjectAreas,
    notes,
  };
}
