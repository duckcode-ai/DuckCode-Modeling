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
    };
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

function parseRelationshipEndpoint(value) {
  if (value && typeof value === "object") {
    return {
      table: String(value.entity || value.table || "").toLowerCase(),
      col: value.field || value.col ? String(value.field || value.col).toLowerCase() : undefined,
    };
  }
  const s = String(value || "");
  const [table, col] = s.split(".");
  return { table: (table || "").toLowerCase(), col: col ? String(col).toLowerCase() : undefined };
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
      name: id,
      schema: String(doc.model?.name || "public"),
      cat,
      subject: subjectArea || cat,
      subject_area: subjectArea || undefined,
      x,
      y,
      width,
      manualPosition,
      badges: kind === "ENUM" ? ["ENUM"] : ["BASE"],
      rowCount: e.row_count || "",
      type: e.type ? String(e.type) : undefined,
      kind: kind || undefined,
      columns,
    };
  });

  const tableIdSet = new Set(tables.map((t) => t.id));

  const explicitRels = Array.isArray(doc.relationships) ? doc.relationships : [];
  const relationships = [];
  explicitRels.forEach((r, i) => {
    const from = parseRelationshipEndpoint(r.from);
    const to = parseRelationshipEndpoint(r.to);
    if (!tableIdSet.has(from.table) || !tableIdSet.has(to.table)) return;
    const ends = cardinalityToEnds(r.cardinality);
    // When cardinality is unknown / unspecified, leave min/max undefined so
    // Canvas.drawEnd renders a neutral edge (no crow's-foot, no "one" bar)
    // instead of defaulting to a misleading many-to-one glyph.
    relationships.push({
      id: `r${i + 1}`,
      name: String(r.name || `${from.table}_${to.table}`),
      from: { table: from.table, col: from.col, side: "right", ...(ends?.from || {}) },
      to:   { table: to.table,   col: to.col,   side: "left",  ...(ends?.to   || {}) },
      identifying: !!r.identifying,
      dashed: !!r.optional || !!r.dashed,
      onDelete: r.on_delete ? String(r.on_delete).toUpperCase() : undefined,
      onUpdate: r.on_update ? String(r.on_update).toUpperCase() : undefined,
      verb: r.verb ? String(r.verb) : undefined,
      description: r.description ? String(r.description) : undefined,
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
      // Preserve "unknown" / empty verbatim so downstream renderers can
      // show the em-dash for untyped columns rather than silently
      // coercing everything to "string".
      type: String(c?.data_type ?? c?.type ?? ""),
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
  if (c.primary_key || c.pk || (Array.isArray(c.constraints) && c.constraints.some((x) => x?.type === "primary_key"))) {
    out.primary_key = true;
  }
  if (c.nullable === false) out.nullable = false;
  if (c.unique || (Array.isArray(c.constraints) && c.constraints.some((x) => x?.type === "unique"))) out.unique = true;
  if (c.default != null) out.default = c.default;
  if (c.description) out.description = String(c.description);
  if (c.references && typeof c.references === "object") {
    out.foreign_key = {
      entity: c.references.entity,
      field: c.references.column || c.references.field,
      on_delete: c.references.on_delete,
    };
  }
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
  const cols = Array.isArray(doc?.columns) ? doc.columns : (Array.isArray(doc?.fields) ? doc.fields : []);
  const fields = cols.map(dataLexColumnToField).filter(Boolean);
  const layer = String(doc?.layer || "").toLowerCase();
  const entity = {
    name,
    type: layer === "conceptual" ? "concept" : (layer === "logical" ? "logical_entity" : "table"),
    description: doc?.description ? String(doc.description) : "",
    fields,
  };
  if (doc?.logical_name) entity.logical_name = String(doc.logical_name);
  if (doc?.physical_name) entity.physical_name = String(doc.physical_name);
  if (doc?.owner) entity.owner = String(doc.owner);
  if (doc?.domain) entity.subject_area = String(doc.domain);
  if (doc?.display && typeof doc.display === "object") entity.display = doc.display;
  if (Array.isArray(doc?.tags)) entity.tags = doc.tags;
  // Surface both spellings so a per-file `kind: model` picks up its
  // domain the same way an `entities:` block does. The downstream
  // schemaAdapter path already prefers `subject_area` over `subject`.
  if (doc?.subject_area) entity.subject_area = doc.subject_area;
  if (doc?.subject) entity.subject = doc.subject;
  if (Array.isArray(doc?.candidate_keys)) entity.candidate_keys = doc.candidate_keys;
  if (Array.isArray(doc?.business_keys)) entity.business_keys = doc.business_keys;
  if (doc?.subtype_of) entity.subtype_of = String(doc.subtype_of);
  if (Array.isArray(doc?.subtypes)) entity.subtypes = doc.subtypes;
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
  const layer = String(doc.layer || "").toLowerCase();
  const synthetic = yaml.dump(
    {
      model: {
        name: String(doc.schema || doc.database || doc.name || "dbt_schema"),
        ...(layer ? { kind: layer, layer } : {}),
      },
      entities,
    },
    { lineWidth: 120 },
  );
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

    const wantAll = !ref.entity || ref.entity === "*";
    const wantId = String(ref.entity || "").toLowerCase();
    adapted.tables.forEach((t) => {
      if (!wantAll && t.id !== wantId) return;
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
      // Dedupe by entity id — last-wins on position (diagram overrides).
      const existingIdx = allTables.findIndex((x2) => x2.id === t.id);
      const tagged = { ...t, x, y, width, manualPosition, _sourceFile: ref.file };
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

  // Merge diagram-level relationships (cross-file FKs authored on the
  // canvas — drag-to-relate, "Add Relationship" dialog). These aren't
  // written back into the referenced model files; they live only in the
  // diagram YAML so a user can compose edges across dbt models without
  // mutating the underlying schema. Shape matches the canonical
  // relationships[] entries produced by adaptDataLexYaml: {from:{table,col},
  // to:{table,col}, kind?, label?, ...}.
  const diagramRels = Array.isArray(diagram.relationships) ? diagram.relationships : [];
  diagramRels.forEach((r) => {
    const fromEnt = String(r?.from?.entity || r?.from?.table || "").toLowerCase();
    const fromCol = r?.from?.field || r?.from?.col ? String(r?.from?.field || r?.from?.col).toLowerCase() : undefined;
    const toEnt = String(r?.to?.entity || r?.to?.table || "").toLowerCase();
    const toCol = r?.to?.field || r?.to?.col ? String(r?.to?.field || r?.to?.col).toLowerCase() : undefined;
    if (!fromEnt || !toEnt) return;
    const key = `${fromEnt}.${fromCol || "*"}->${toEnt}.${toCol || "*"}`;
    if (relSeen.has(key)) return;
    relSeen.add(key);
    const ends = cardinalityToEnds(r?.cardinality);
    allRelationships.push({
      from: { table: fromEnt, col: fromCol, ...(ends?.from || {}) },
      to: { table: toEnt, col: toCol, ...(ends?.to || {}) },
      kind: String(r?.cardinality || "many_to_one"),
      identifying: !!r?.identifying,
      label: r?.label ? String(r.label) : undefined,
      name: r?.name ? String(r.name) : undefined,
      verb: r?.verb ? String(r.verb) : undefined,
      description: r?.description ? String(r.description) : undefined,
      // Tag as diagram-origin so the identifying/non-identifying renderer
      // can tell it apart from model-file FKs if it ever needs to.
      _diagramLevel: true,
    });
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
