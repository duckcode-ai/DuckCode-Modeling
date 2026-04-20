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
    return {
      id,
      name: id,
      schema: String(doc.model?.name || "public"),
      cat,
      subject: e.subject || cat,
      x: 60 + col * COL_W,
      y: 60 + row * ROW_H,
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
