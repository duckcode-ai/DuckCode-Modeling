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

function columnsFromFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => {
    const col = {
      name: String(f.name || ""),
      type: String(f.type || "string"),
    };
    if (f.primary_key || f.pk) col.pk = true;
    if (f.nullable === false) col.nn = true;
    if (f.unique) col.unique = true;
    if (f.default != null) col.default = String(f.default);
    if (f.generated) col.generated = true;
    if (f.check != null) col.check = String(f.check);
    if (f.foreign_key && f.foreign_key.entity && f.foreign_key.field) {
      col.fk = `${f.foreign_key.entity}.${f.foreign_key.field}`.toLowerCase();
      if (f.foreign_key.on_delete) col.onDelete = String(f.foreign_key.on_delete).toUpperCase();
    } else if (typeof f.fk === "string") {
      col.fk = f.fk;
    }
    return col;
  });
}

function cardinalityToEnds(cardinality) {
  switch (String(cardinality || "").toLowerCase()) {
    case "one_to_one":  return { from: { min: "1", max: "1" }, to: { min: "1", max: "1" } };
    case "one_to_many": return { from: { min: "1", max: "N" }, to: { min: "1", max: "1" } };
    case "many_to_one": return { from: { min: "1", max: "1" }, to: { min: "1", max: "N" } };
    case "many_to_many":return { from: { min: "1", max: "N" }, to: { min: "1", max: "N" } };
    default:            return { from: { min: "1", max: "N" }, to: { min: "1", max: "1" } };
  }
}

function parseEndpoint(value) {
  const s = String(value || "");
  const [table, col] = s.split(".");
  return { table: (table || "").toLowerCase(), col: col || "id" };
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
    const x = Number.isFinite(Number(display.x)) ? Number(display.x) : 60 + col * COL_W;
    const y = Number.isFinite(Number(display.y)) ? Number(display.y) : 60 + row * ROW_H;
    const width = Number.isFinite(Number(display.width)) ? Number(display.width) : undefined;

    return {
      id,
      name: id,
      schema: String(doc.model?.name || "public"),
      cat,
      subject: e.subject || cat,
      x,
      y,
      width,
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
    relationships.push({
      id: `r${i + 1}`,
      name: String(r.name || `${from.table}_${to.table}`),
      from: { table: from.table, col: from.col, side: "right", ...ends.from },
      to:   { table: to.table,   col: to.col,   side: "left",  ...ends.to },
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
        from: { table: t.id, col: c.name, side: "right", min: c.nn ? "1" : "0", max: "N" },
        to:   { table: targetTable, col: targetCol, side: "left", min: "1", max: "1" },
        identifying: !!c.pk,
        dashed: !c.nn,
        onDelete: c.onDelete,
      });
    });
  });

  const subjectAreas = []; // future: derive from doc.subject_areas or diagram

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

function dbtModelToDataLexEntity(model) {
  const name = String(model?.name || "").trim();
  if (!name) return null;
  const cols = Array.isArray(model?.columns) ? model.columns : [];
  const fields = cols.map((c) => {
    const tests = Array.isArray(c?.tests) ? c.tests : [];
    const hasNotNull = tests.some((t) => t === "not_null" || t?.not_null);
    const hasUnique = tests.some((t) => t === "unique" || t?.unique);
    const fk = (() => {
      for (const t of tests) {
        const target = dbtRelationshipsTarget(t);
        if (target) return target;
      }
      return null;
    })();
    const out = {
      name: String(c?.name || ""),
      type: String(c?.data_type || c?.type || "string"),
    };
    if (hasNotNull) out.nullable = false;
    if (hasUnique) out.unique = true;
    if (fk) out.foreign_key = fk;
    if (c?.description) out.description = String(c.description);
    return out;
  });
  return { name, type: "table", description: String(model?.description || ""), fields };
}

/* Public adapter: parses a dbt schema.yml and emits DataLex-shaped output
   (same return shape as `adaptDataLexYaml`). Returns null on non-dbt docs
   so callers can chain try-dbt-then-datalex. */
export function adaptDbtSchemaYaml(yamlText) {
  let doc;
  try { doc = yaml.load(yamlText); } catch (_e) { return null; }
  if (!doc || typeof doc !== "object") return null;
  const models = Array.isArray(doc.models) ? doc.models : null;
  const sources = Array.isArray(doc.sources) ? doc.sources : null;
  if (!models && !sources) return null;

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
  if (entities.length === 0) return null;

  // Round-trip through the canonical DataLex adapter so one code path owns
  // column/FK inference — avoids drift if the DataLex shape evolves.
  const synthetic = yaml.dump({ model: { name: "dbt_schema" }, entities }, { lineWidth: 120 });
  return adaptDataLexYaml(synthetic);
}

/* ------------------------------------------------------------------ *
 * Diagram adapter — reads a .diagram.yaml and unions entities from N
 * referenced files. `fileLookup` is a map-like `{fullPath → content}`.
 * ------------------------------------------------------------------ */
function isDbtSchemaLike(yamlText) {
  try {
    const doc = yaml.load(yamlText);
    if (!doc || typeof doc !== "object") return false;
    return Array.isArray(doc.models) || Array.isArray(doc.sources);
  } catch (_e) { return false; }
}

export function adaptDiagramYaml(yamlText, projectFiles) {
  let diagram;
  try { diagram = yaml.load(yamlText); } catch (_e) { return null; }
  if (!diagram || typeof diagram !== "object") return null;
  const entries = Array.isArray(diagram.entities) ? diagram.entities : [];

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
  const relSeen = new Set();

  refs.forEach((ref) => {
    const file = byPath.get(ref.file);
    if (!file || typeof file.content !== "string") return;
    const content = file.content;
    const adapted = isDbtSchemaLike(content)
      ? adaptDbtSchemaYaml(content)
      : adaptDataLexYaml(content);
    if (!adapted) return;

    const wantAll = !ref.entity || ref.entity === "*";
    const wantId = String(ref.entity || "").toLowerCase();
    adapted.tables.forEach((t) => {
      if (!wantAll && t.id !== wantId) return;
      // Overlay diagram-provided position if present.
      const x = Number.isFinite(Number(ref.x)) ? Number(ref.x) : t.x;
      const y = Number.isFinite(Number(ref.y)) ? Number(ref.y) : t.y;
      const width = Number.isFinite(Number(ref.width)) ? Number(ref.width) : t.width;
      // Dedupe by entity id — last-wins on position (diagram overrides).
      const existingIdx = allTables.findIndex((x2) => x2.id === t.id);
      const tagged = { ...t, x, y, width, _sourceFile: ref.file };
      if (existingIdx >= 0) allTables[existingIdx] = tagged;
      else allTables.push(tagged);
    });

    adapted.relationships.forEach((r) => {
      const key = `${r.from.table}.${r.from.col}->${r.to.table}.${r.to.col}`;
      if (relSeen.has(key)) return;
      relSeen.add(key);
      allRelationships.push(r);
    });
  });

  // Filter relationships to those whose both endpoints are on the canvas.
  const onCanvas = new Set(allTables.map((t) => t.id));
  const filteredRels = allRelationships.filter(
    (r) => onCanvas.has(r.from.table) && onCanvas.has(r.to.table)
  );

  return {
    name: String(diagram.title || diagram.name || "Diagram"),
    engine: "DataLex Diagram",
    schema: "diagram",
    tables: allTables,
    relationships: filteredRels,
    subjectAreas: [],
  };
}
