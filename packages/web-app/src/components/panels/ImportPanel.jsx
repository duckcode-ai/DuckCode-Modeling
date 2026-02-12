import React, { useState, useCallback, useRef, useEffect } from "react";
import yaml from "js-yaml";
import {
  Upload,
  FileJson,
  Database,
  FileCode,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";

const SUPPORTED_FORMATS = [
  { id: "sql", label: "SQL DDL", icon: Database, extensions: [".sql"], description: "PostgreSQL, Snowflake, BigQuery, Databricks DDL" },
  { id: "dbml", label: "DBML", icon: FileCode, extensions: [".dbml"], description: "Database Markup Language" },
  { id: "dbt", label: "dbt schema.yml", icon: FileText, extensions: [".yml", ".yaml"], description: "dbt model/source contracts" },
  { id: "spark-schema", label: "Spark Schema", icon: FileJson, extensions: [".json"], description: "Spark StructType JSON / Databricks catalog export" },
];

function detectFormat(filename, text = "") {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".dbml")) return "dbml";
  if (lower.endsWith(".json")) return "spark-schema";
  if (lower.endsWith("schema.yml") || lower.endsWith("schema.yaml")) return "dbt";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
    const hasDbtVersion = /(^|\n)\s*version:\s*2\s*($|\n)/m.test(text);
    const hasDbtSections = /(^|\n)\s*(models|sources)\s*:/m.test(text);
    if (hasDbtVersion && hasDbtSections) return "dbt";
  }
  return null;
}

function deriveModelNameFromPath(pathOrName) {
  return String(pathOrName || "imported_model")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
}

function buildMergedDbtDocument(entries) {
  const merged = { version: 2, models: [], sources: [] };
  for (const entry of entries) {
    let doc;
    try {
      doc = yaml.load(entry.text);
    } catch (_err) {
      doc = null;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) continue;
    if (Array.isArray(doc.models)) merged.models.push(...doc.models);
    if (Array.isArray(doc.sources)) merged.sources.push(...doc.sources);
  }
  return merged;
}

function uniquifyImportedFiles(files) {
  const used = new Set();
  return files.map((f) => {
    const raw = String(f.name || "imported_model");
    const base = raw.replace(/\.model\.ya?ml$/i, "");
    let candidate = base;
    let i = 1;
    while (used.has(candidate)) {
      candidate = `${base}_${i}`;
      i += 1;
    }
    used.add(candidate);
    return { ...f, name: candidate };
  });
}

function toPascal(name) {
  return name.replace(/["]/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean).map(p => p[0].toUpperCase() + p.slice(1)).join("");
}

function toSnakeCase(name) {
  const base = String(name || "").trim();
  if (!base) return "";
  const withUnderscores = base
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!withUnderscores) return "";
  return /^[0-9]/.test(withUnderscores) ? `f_${withUnderscores}` : withUnderscores;
}

function parseClientSide(format, text, modelName) {
  if (format === "sql") return parseSQLClient(text, modelName);
  if (format === "dbml") return parseDBMLClient(text, modelName);
  if (format === "dbt") return parseDBTSchemaClient(text, modelName);
  if (format === "spark-schema") return parseSparkSchemaClient(text, modelName);
  throw new Error(`Client-side parsing not available for "${format}". Start the API server (npm start in packages/api-server).`);
}

function parseSQLClient(text, modelName) {
  const entities = [];
  const relationships = [];
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w"`.]+)\s*\((.*?)\)\s*;/gis;
  const viewRe = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([\w"`.]+)/gi;
  let match;

  while ((match = tableRe.exec(text)) !== null) {
    const tableName = toPascal(match[1].split(".").pop());
    const body = match[2];
    const fields = [];
    for (const col of body.split(",").map(s => s.trim())) {
      const cm = col.match(/^"?([A-Za-z_]\w*)"?\s+(\S+)/);
      if (cm && !/^(primary|foreign|check|constraint|unique)\s/i.test(col)) {
        const lower = col.toLowerCase();
        fields.push({
          name: cm[1],
          type: cm[2].toLowerCase(),
          nullable: !lower.includes("not null"),
          primary_key: lower.includes("primary key") || undefined,
        });
      }
    }
    entities.push({ name: tableName, type: "table", fields });
  }

  while ((match = viewRe.exec(text)) !== null) {
    const vn = toPascal(match[1].split(".").pop());
    if (!entities.find(e => e.name === vn)) {
      const isMat = /materialized/i.test(match[0]);
      entities.push({ name: vn, type: isMat ? "materialized_view" : "view", fields: [] });
    }
  }

  const yaml = buildYaml(modelName, entities, relationships);
  return buildResult(entities, relationships, yaml);
}

function parseSparkSchemaClient(text, modelName) {
  const schema = JSON.parse(text);
  const sparkTypeMap = { string: "string", integer: "integer", int: "integer", long: "bigint", bigint: "bigint", short: "smallint", byte: "tinyint", float: "float", double: "float", boolean: "boolean", binary: "binary", date: "date", timestamp: "timestamp", timestamp_ntz: "timestamp" };
  function mapType(t) {
    if (typeof t === "string") {
      const lower = t.toLowerCase();
      if (lower.startsWith("decimal")) return lower;
      if (lower.startsWith("varchar") || lower.startsWith("char")) return "string";
      if (lower.startsWith("array") || lower.startsWith("map") || lower.startsWith("struct")) return "json";
      return sparkTypeMap[lower] || "string";
    }
    if (typeof t === "object" && t !== null) {
      const tn = (t.type || "string").toLowerCase();
      if (["struct", "array", "map", "udt"].includes(tn)) return "json";
      return sparkTypeMap[tn] || "string";
    }
    return "string";
  }
  const tables = [];
  if (Array.isArray(schema)) {
    schema.forEach((item, idx) => {
      if (typeof item === "object") {
        const name = item.name || item.table_name || `table_${idx}`;
        const inner = item.schema || item.columns || item;
        tables.push({ name, schema: inner });
      }
    });
  } else if (typeof schema === "object") {
    if (schema.type === "struct" && schema.fields) {
      tables.push({ name: modelName, schema });
    } else if (schema.columns) {
      tables.push({ name: schema.table_name || schema.name || modelName, schema });
    } else if (schema.fields) {
      tables.push({ name: modelName, schema });
    }
  }
  const entities = tables.map(({ name, schema: tblSchema }) => {
    const rawFields = (typeof tblSchema === "object" && !Array.isArray(tblSchema))
      ? (tblSchema.fields || tblSchema.columns || [])
      : (Array.isArray(tblSchema) ? tblSchema : []);
    const fields = rawFields.filter(f => f && f.name).map(f => {
      const ftype = mapType(f.type || f.data_type || "string");
      const field = { name: f.name, type: ftype, nullable: f.nullable !== false };
      const meta = f.metadata || {};
      if (meta.comment) field.description = meta.comment;
      if (f.comment) field.description = f.comment;
      return field;
    });
    return { name: toPascal(name), type: "table", fields };
  });
  return buildResult(entities, [], buildYaml(modelName, entities, []));
}

function parseDBMLClient(text, modelName) {
  const entities = [];
  const relationships = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const tm = line.match(/^table\s+([\w"]+)\s*\{/i);
    if (tm) { current = { name: toPascal(tm[1]), type: "table", fields: [] }; entities.push(current); continue; }
    if (line === "}") { current = null; continue; }
    if (current) {
      const fm = line.match(/^([A-Za-z_]\w*)\s+(\S+)(?:\s*\[(.*?)\])?$/);
      if (fm) {
        const attrs = (fm[3] || "").toLowerCase();
        current.fields.push({ name: fm[1], type: fm[2].toLowerCase(), nullable: !attrs.includes("not null"), primary_key: attrs.includes("pk") || undefined });
      }
    }
  }
  return buildResult(entities, relationships, buildYaml(modelName, entities, relationships));
}

function parseDbtToEntity(toExpr) {
  if (typeof toExpr !== "string") return null;
  const text = toExpr.trim();
  const ref = text.match(/ref\(\s*['"]([^'"]+)['"]\s*\)/i);
  if (ref) return toPascal(ref[1]);
  const source = text.match(/source\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
  if (source) return toPascal(source[1]);
  const token = text.split(".").pop()?.replace(/['"]/g, "").trim();
  return token ? toPascal(token) : null;
}

function asTestList(tests) {
  if (tests == null) return [];
  return Array.isArray(tests) ? tests : [tests];
}

function asConstraintList(constraints) {
  if (constraints == null) return [];
  return Array.isArray(constraints) ? constraints : [constraints];
}

function parseDbtConstraintTarget(constraint = {}) {
  const explicitTo = parseDbtToEntity(constraint?.to || constraint?.references);
  const explicitField = toSnakeCase(String(constraint?.field || "").trim());
  if (explicitTo && explicitField) {
    return { parentEntity: explicitTo, parentField: explicitField };
  }

  const expr = String(constraint?.expression || constraint?.references || "").trim();
  if (!expr) return null;
  const m = expr.match(/references\s+([A-Za-z0-9_."`]+)\s*\(\s*([A-Za-z0-9_"]+)\s*\)/i);
  if (!m) return null;
  const token = String(m[1]).replace(/["`]/g, "").split(".").pop();
  const parentEntity = token ? toPascal(token) : null;
  const parentField = toSnakeCase(String(m[2] || "").replace(/["`]/g, "").trim());
  if (!parentEntity || !parentField) return null;
  return { parentEntity, parentField };
}

function ensureField(entity, fieldName) {
  const normalized = toSnakeCase(fieldName);
  if (!normalized) return;
  entity.fields = Array.isArray(entity.fields) ? entity.fields : [];
  if (entity.fields.some((f) => f.name === normalized)) return;
  entity.fields.push({
    name: normalized,
    type: "string",
    nullable: true,
    description: "Inferred from dbt relationships test",
  });
}

function upsertField(entity, field) {
  entity.fields = Array.isArray(entity.fields) ? entity.fields : [];
  const existing = entity.fields.find((f) => f.name === field.name);
  if (!existing) {
    entity.fields.push(field);
    return;
  }
  if (field.type && (!existing.type || existing.type === "string")) existing.type = field.type;
  if (field.description && !existing.description) existing.description = field.description;
  if (field.nullable === false) existing.nullable = false;
  if (field.unique) existing.unique = true;
  if (field.primary_key) existing.primary_key = true;
  if (field.foreign_key) existing.foreign_key = true;
}

function parseDBTSchemaClient(text, modelName) {
  const doc = yaml.load(text);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("dbt schema.yml root must be an object.");
  }

  const entitiesByName = new Map();
  const candidates = [];

  function getOrCreateEntity(rawName, type = "view", extra = {}) {
    const entityName = toPascal(rawName);
    if (!entityName) return null;
    if (!entitiesByName.has(entityName)) {
      entitiesByName.set(entityName, {
        name: entityName,
        type,
        description: extra.description || "",
        schema: extra.schema || "",
        subject_area: extra.subject_area || "",
        tags: Array.isArray(extra.tags) ? extra.tags : [],
        fields: [],
      });
    }
    return entitiesByName.get(entityName);
  }

  function processColumns(columns, entityName) {
    if (!Array.isArray(columns)) return;
    const entity = entitiesByName.get(entityName);
    if (!entity) return;

    for (const col of columns) {
      if (!col || typeof col !== "object") continue;
      const colName = toSnakeCase(String(col.name || "").trim());
      if (!colName) continue;

      const field = {
        name: colName,
        type: String(col.data_type || col.type || "string"),
        nullable: true,
      };
      if (col.description) field.description = String(col.description);

      let hasNotNull = false;
      let hasUnique = false;
      let hasFk = false;
      const tests = [...asTestList(col.tests), ...asTestList(col.data_tests)];
      for (const testDef of tests) {
        if (typeof testDef === "string") {
          const tname = testDef.split(".").pop()?.toLowerCase();
          if (tname === "not_null") hasNotNull = true;
          if (tname === "unique") hasUnique = true;
          continue;
        }
        if (!testDef || typeof testDef !== "object") continue;
        for (const [rawName, cfg] of Object.entries(testDef)) {
          const tname = rawName.split(".").pop()?.toLowerCase();
          if (tname === "not_null") hasNotNull = true;
          else if (tname === "unique") hasUnique = true;
          else if (tname === "relationships") {
            const toEntity = parseDbtToEntity(cfg?.to);
            const parentField = toSnakeCase(String(cfg?.field || "").trim());
            if (toEntity && parentField) {
              candidates.push({
                parentEntity: toEntity,
                parentField,
                childEntity: entityName,
                childField: colName,
              });
              hasFk = true;
            }
          }
        }
      }

      for (const constraintDef of asConstraintList(col.constraints)) {
        if (typeof constraintDef === "string") {
          const cname = constraintDef.toLowerCase().replace(/\s+/g, "_");
          if (cname === "not_null") hasNotNull = true;
          else if (cname === "unique") hasUnique = true;
          else if (cname === "primary_key") {
            hasNotNull = true;
            hasUnique = true;
          }
          continue;
        }
        if (!constraintDef || typeof constraintDef !== "object") continue;
        const ctype = String(constraintDef.type || constraintDef.constraint_type || "").toLowerCase().replace(/\s+/g, "_");
        if (ctype === "not_null") hasNotNull = true;
        else if (ctype === "unique") hasUnique = true;
        else if (ctype === "primary_key") {
          hasNotNull = true;
          hasUnique = true;
        } else if (ctype === "foreign_key") {
          hasFk = true;
          const target = parseDbtConstraintTarget(constraintDef);
          if (target) {
            candidates.push({
              parentEntity: target.parentEntity,
              parentField: target.parentField,
              childEntity: entityName,
              childField: colName,
            });
          }
        }
      }

      if (hasNotNull) field.nullable = false;
      if (hasUnique) field.unique = true;
      if (hasNotNull && hasUnique) field.primary_key = true;
      if (hasFk) field.foreign_key = true;

      upsertField(entity, field);
    }
  }

  const sources = Array.isArray(doc.sources) ? doc.sources : [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const sourceName = String(source.name || "").trim();
    const sourceSchema = String(source.schema || "").trim();
    const sourceTags = Array.isArray(source.tags) ? source.tags : [];
    const tables = Array.isArray(source.tables) ? source.tables : [];
    for (const table of tables) {
      if (!table || typeof table !== "object") continue;
      const tableName = String(table.name || "").trim();
      if (!tableName) continue;
      const entity = getOrCreateEntity(tableName, "external_table", {
        description: String(table.description || ""),
        schema: sourceSchema,
        subject_area: sourceName,
        tags: [...sourceTags, ...(Array.isArray(table.tags) ? table.tags : [])],
      });
      if (!entity) continue;
      processColumns(table.columns, entity.name);
    }
  }

  const models = Array.isArray(doc.models) ? doc.models : [];
  for (const mdl of models) {
    if (!mdl || typeof mdl !== "object") continue;
    const mname = String(mdl.name || "").trim();
    if (!mname) continue;
    const entity = getOrCreateEntity(mname, "view", {
      description: String(mdl.description || ""),
      schema: String(mdl.schema || ""),
      subject_area: String(mdl.meta?.subject_area || ""),
      tags: Array.isArray(mdl.tags) ? mdl.tags : [],
    });
    if (!entity) continue;
    processColumns(mdl.columns, entity.name);

    for (const c of asConstraintList(mdl.constraints)) {
      if (!c || typeof c !== "object") continue;
      const ctype = String(c.type || c.constraint_type || "").toLowerCase().replace(/\s+/g, "_");
      const cols = Array.isArray(c.columns) ? c.columns.map((x) => toSnakeCase(String(x).trim())).filter(Boolean) : [];
      if (cols.length === 0) continue;

      if (ctype === "primary_key") {
        for (const colName of cols) {
          ensureField(entity, colName);
          const field = entity.fields.find((f) => f.name === colName);
          if (field) {
            field.primary_key = true;
            field.nullable = false;
            field.unique = true;
          }
        }
      } else if (ctype === "foreign_key") {
        const target = parseDbtConstraintTarget(c);
        for (const colName of cols) {
          ensureField(entity, colName);
          const field = entity.fields.find((f) => f.name === colName);
          if (field) field.foreign_key = true;
          if (target) {
            candidates.push({
              parentEntity: target.parentEntity,
              parentField: target.parentField,
              childEntity: entity.name,
              childField: colName,
            });
          }
        }
      }
    }
  }

  const entities = Array.from(entitiesByName.values()).sort((a, b) => a.name.localeCompare(b.name));
  const entityMap = new Map(entities.map((e) => [e.name, e]));
  const rels = [];
  const seen = new Set();

  for (const c of candidates) {
    const parent = entityMap.get(c.parentEntity);
    const child = entityMap.get(c.childEntity);
    if (!parent || !child) continue;
    ensureField(parent, c.parentField);
    ensureField(child, c.childField);

    const rel = {
      name: `${c.parentEntity.toLowerCase()}_${c.childEntity.toLowerCase()}_${c.childField}_fk`,
      from: `${c.parentEntity}.${c.parentField}`,
      to: `${c.childEntity}.${c.childField}`,
      cardinality: "one_to_many",
    };
    const key = `${rel.name}|${rel.from}|${rel.to}|${rel.cardinality}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rels.push(rel);
  }

  return buildResult(entities, rels, buildYaml(modelName, entities, rels));
}

function buildYaml(modelName, entities, relationships) {
  let y = `model:\n  name: ${modelName}\n  version: '1.0.0'\n  domain: imported\n  owners:\n    - data-team@example.com\n  state: draft\n`;
  y += `entities:\n`;
  for (const e of entities) {
    y += `  - name: ${e.name}\n    type: ${e.type}\n`;
    if (e.description) y += `    description: ${e.description}\n`;
    if (e.schema) y += `    schema: ${e.schema}\n`;
    if (e.subject_area) y += `    subject_area: ${e.subject_area}\n`;
    if (Array.isArray(e.tags) && e.tags.length > 0) {
      y += `    tags:\n`;
      for (const t of e.tags) y += `      - ${t}\n`;
    }
    y += `    fields:\n`;
    for (const f of e.fields || []) {
      y += `      - name: ${f.name}\n        type: ${f.type}\n        nullable: ${f.nullable}\n`;
      if (f.primary_key) y += `        primary_key: true\n`;
      if (f.description) y += `        description: ${f.description}\n`;
    }
  }
  if (relationships.length) {
    y += `relationships:\n`;
    for (const r of relationships) y += `  - name: ${r.name}\n    from: ${r.from}\n    to: ${r.to}\n    cardinality: ${r.cardinality}\n`;
  }
  return y;
}

function buildResult(entities, relationships, yaml) {
  const fieldCount = entities.reduce((s, e) => s + (e.fields || []).length, 0);
  return { success: true, entityCount: entities.length, fieldCount, relationshipCount: relationships.length, indexCount: 0, yaml };
}

function readFileSystemEntry(entry, prefix = "") {
  if (!entry) return Promise.resolve([]);
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file) => resolve([{ file, path: `${prefix}${file.name}` }]),
        () => resolve([])
      );
    });
  }
  if (!entry.isDirectory) return Promise.resolve([]);

  const readAllDirectoryEntries = (reader) => new Promise((resolve) => {
    const out = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch || batch.length === 0) {
            resolve(out);
            return;
          }
          out.push(...batch);
          readBatch();
        },
        () => resolve(out)
      );
    };
    readBatch();
  });

  return (async () => {
    const reader = entry.createReader();
    const children = await readAllDirectoryEntries(reader);
    const nested = await Promise.all(
      children.map((child) => readFileSystemEntry(child, `${prefix}${entry.name}/`))
    );
    return nested.flat();
  })();
}

async function getDroppedFileEntries(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const hasDirectoryItems = items.some((item) => typeof item.webkitGetAsEntry === "function");
  if (hasDirectoryItems) {
    const nested = await Promise.all(
      items
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean)
        .map((entry) => readFileSystemEntry(entry))
    );
    const files = nested.flat();
    if (files.length > 0) return files;
  }

  return Array.from(dataTransfer?.files || [])
    .map((file) => ({
      file,
      path: file.webkitRelativePath || file.name,
    }))
    .filter((item) => item.file);
}

async function readDirectoryHandleFiles(dirHandle, prefix = "") {
  const out = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      const file = await handle.getFile();
      out.push({ file, path: `${prefix}${name}` });
    } else if (handle.kind === "directory") {
      const nested = await readDirectoryHandleFiles(handle, `${prefix}${name}/`);
      out.push(...nested);
    }
  }
  return out;
}

export default function ImportPanel() {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const { loadImportedYaml, loadMultipleImportedYaml } = useWorkspaceStore();
  const { addToast, setBottomPanelTab } = useUiStore();

  const ensureDirectoryPickerAttrs = useCallback(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.setAttribute("mozdirectory", "");
    input.multiple = true;
    // Some browsers expose these as non-standard properties.
    try { input.webkitdirectory = true; } catch (_err) {}
    try { input.directory = true; } catch (_err) {}
    try { input.mozdirectory = true; } catch (_err) {}
  }, []);

  useEffect(() => {
    // React may not reliably preserve non-standard directory picker attributes
    // across all browsers, so set them imperatively on mount.
    ensureDirectoryPickerAttrs();
  }, [ensureDirectoryPickerAttrs]);

  const openFilePicker = useCallback((extensions = null) => {
    if (!fileInputRef.current) return;
    if (Array.isArray(extensions) && extensions.length > 0) {
      fileInputRef.current.accept = extensions.join(",");
    } else {
      fileInputRef.current.accept = ".sql,.dbml,.json,.yml,.yaml";
    }
    fileInputRef.current.click();
  }, []);

  const runImport = useCallback(async ({ format, text, filename, modelName }) => {
    let data = null;
    try {
      const resp = await fetch("http://localhost:3001/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, content: text, filename, modelName }),
      });
      if (resp.ok) data = await resp.json();
    } catch (_err) {
      // API unavailable -> fall back to client-side parser.
    }
    if (!data) data = parseClientSide(format, text, modelName);
    return data;
  }, []);

  const handleFiles = useCallback(async (inputFiles) => {
    setError(null);
    setImportResult(null);
    const normalizedInputs = Array.from(inputFiles || [])
      .map((item) => {
        if (item && typeof item === "object" && item.file) {
          return {
            file: item.file,
            path: item.path || item.file.webkitRelativePath || item.file.name,
          };
        }
        if (!item) return null;
        return {
          file: item,
          path: item.webkitRelativePath || item.name || "",
        };
      })
      .filter((item) => item && item.file);
    if (normalizedInputs.length === 0) return;

    setImporting(true);
    try {
      const entries = await Promise.all(
        normalizedInputs.map(async ({ file, path }) => {
          const text = await file.text();
          const autoFormat = detectFormat(path, text);
          return { file, path, text, autoFormat };
        })
      );

      const usePerFileDetection = entries.length > 1 || entries.some((e) => e.path.includes("/"));

      // Folder/project auto-detect: if dbt files are detected, merge all dbt schema.yml
      // files into a single import so users can pick a folder and get one model.
      const dbtSchemaEntries = entries.filter((e) => e.autoFormat === "dbt");
      const hasDbtProjectMarker = entries.some((e) => /(^|\/)dbt_project\.ya?ml$/i.test(e.path));
      const isFolderStyleSelection = usePerFileDetection;
      if (
        isFolderStyleSelection &&
        (selectedFormat == null || selectedFormat === "dbt") &&
        (hasDbtProjectMarker || dbtSchemaEntries.length > 0)
      ) {
        const mergedDbt = buildMergedDbtDocument(dbtSchemaEntries);
        if ((mergedDbt.models || []).length > 0 || (mergedDbt.sources || []).length > 0) {
          const folderName = entries.find((e) => e.path.includes("/"))?.path.split("/")[0] || "dbt_project";
          const modelName = deriveModelNameFromPath(`${folderName}_dbt`);
          const mergedText = yaml.dump(mergedDbt, { lineWidth: 120, noRefs: true, sortKeys: false });
          const data = await runImport({
            format: "dbt",
            text: mergedText,
            filename: `${folderName}/schema.yml`,
            modelName,
          });
          if (data?.yaml) {
            await loadImportedYaml(modelName, data.yaml);
            setBottomPanelTab("properties");
          }
          setImportResult({
            ...data,
            autoDetected: "dbt-folder",
            schemaFiles: dbtSchemaEntries.length,
            fileCount: entries.length,
          });
          addToast?.({
            message: `Auto-imported dbt folder (${dbtSchemaEntries.length} schema file${dbtSchemaEntries.length === 1 ? "" : "s"})`,
            type: "success",
          });
          return;
        }
      }

      const candidates = entries
        .map((e) => ({
          ...e,
          format: usePerFileDetection ? e.autoFormat : (selectedFormat || e.autoFormat),
        }))
        .filter((e) => Boolean(e.format));

      if (candidates.length === 0) {
        throw new Error("No supported files detected. Supported: .sql, .dbml, .json, .yml/.yaml");
      }

      // Single file path
      if (candidates.length === 1) {
        const single = candidates[0];
        const modelName = deriveModelNameFromPath(single.path);
        const data = await runImport({
          format: single.format,
          text: single.text,
          filename: single.file.name,
          modelName,
        });
        if (data?.yaml) {
          await loadImportedYaml(modelName, data.yaml);
          setBottomPanelTab("properties");
        }
        setImportResult({ ...data, fileCount: 1 });
        addToast?.({ message: `Imported ${single.file.name} -> ${data.entityCount || 0} entities`, type: "success" });
        return;
      }

      // Multi-file path (non-dbt): import each and open as multiple model tabs/files.
      const importedFiles = [];
      let totalEntities = 0;
      let totalFields = 0;
      let totalRelationships = 0;

      for (const item of candidates) {
        const modelName = deriveModelNameFromPath(item.path);
        const data = await runImport({
          format: item.format,
          text: item.text,
          filename: item.file.name,
          modelName,
        });
        if (data?.yaml) {
          importedFiles.push({ name: modelName, yaml: data.yaml });
          totalEntities += data.entityCount || 0;
          totalFields += data.fieldCount || 0;
          totalRelationships += data.relationshipCount || 0;
        }
      }

      if (importedFiles.length === 0) {
        throw new Error("No importable model content was produced.");
      }

      const uniqueFiles = uniquifyImportedFiles(importedFiles);
      await loadMultipleImportedYaml(uniqueFiles);
      setBottomPanelTab("properties");
      setImportResult({
        entityCount: totalEntities,
        fieldCount: totalFields,
        relationshipCount: totalRelationships,
        fileCount: uniqueFiles.length,
        multiFile: true,
      });
      addToast?.({
        message: `Imported ${uniqueFiles.length} files (${totalEntities} entities total)`,
        type: "success",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }, [selectedFormat, addToast, loadImportedYaml, loadMultipleImportedYaml, runImport, setBottomPanelTab]);

  const onDrop = useCallback((e) => {
    (async () => {
      e.preventDefault();
      setDragOver(false);
      const entries = await getDroppedFileEntries(e.dataTransfer);
      if (entries.length > 0) handleFiles(entries);
    })();
  }, [handleFiles]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onFileSelect = useCallback((e) => {
    const files = e.target.files;
    if (files && files.length > 0) handleFiles(files);
    // Reset so the same file can be re-selected
    e.target.value = "";
  }, [handleFiles]);

  const onFolderSelect = useCallback((e) => {
    const files = e.target.files;
    if (files && files.length > 0) handleFiles(files);
    e.target.value = "";
  }, [handleFiles]);

  const openFolderPicker = useCallback(async () => {
    setError(null);
    // Modern browser path (Chromium): explicit native directory picker.
    if (typeof window !== "undefined" && window.isSecureContext && typeof window.showDirectoryPicker === "function") {
      try {
        const dirHandle = await window.showDirectoryPicker();
        const files = await readDirectoryHandleFiles(dirHandle, `${dirHandle.name}/`);
        if (files.length > 0) {
          await handleFiles(files);
          return;
        }
      } catch (err) {
        if (err?.name !== "AbortError") {
          setError("Native folder picker failed, falling back to browser file picker.");
        }
      }
    }

    // Legacy fallback path.
    if (!folderInputRef.current) return;
    ensureDirectoryPickerAttrs();
    folderInputRef.current.click();
  }, [ensureDirectoryPickerAttrs, handleFiles]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border-primary bg-bg-secondary/50 shrink-0">
        <Upload size={12} className="text-accent-blue" />
        <span className="text-xs font-semibold text-text-primary">Import Schema</span>
        <span className="text-[10px] text-text-muted">Drag/drop file(s) or folder auto-detect</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Format selector */}
        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">
            Supported Formats
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {SUPPORTED_FORMATS.map((fmt) => {
              const Icon = fmt.icon;
              const isSelected = selectedFormat === fmt.id;
              return (
                <button
                  key={fmt.id}
                  onClick={() => {
                    setSelectedFormat(fmt.id);
                    setError(null);
                    setImportResult(null);
                    // dbt-first UX: choosing dbt format opens folder picker directly.
                    if (fmt.id === "dbt") {
                      openFolderPicker();
                      return;
                    }
                    // Other formats: open file picker.
                    openFilePicker(fmt.extensions);
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-left transition-colors text-[11px] ${
                    isSelected
                      ? "border-accent-blue bg-accent-blue/10 text-accent-blue"
                      : "border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  <Icon size={12} className="shrink-0" />
                  <div>
                    <div className="font-semibold">{fmt.label}</div>
                    <div className="text-[9px] text-text-muted">{fmt.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => {
            if (selectedFormat === "dbt") {
              openFolderPicker();
              return;
            }
            openFilePicker();
          }}
          className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
            dragOver
              ? "border-accent-blue bg-accent-blue/5"
              : "border-border-primary hover:border-accent-blue/50 hover:bg-bg-hover"
          }`}
        >
          {importing ? (
            <Loader2 size={20} className="animate-spin text-accent-blue" />
          ) : (
            <Upload size={20} className={dragOver ? "text-accent-blue" : "text-text-muted"} />
          )}
          <div className="text-xs text-text-secondary text-center">
            {importing ? "Importing..." : (
              <>
                <span className="font-semibold">Drop files/folder here</span> or click to browse
                <br />
                <span className="text-[10px] text-text-muted">
                  .sql, .dbml, .json, .yml{selectedFormat ? ` (${selectedFormat} mode)` : ""}
                </span>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".sql,.dbml,.json,.yml,.yaml"
            onChange={onFileSelect}
          />
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={onFolderSelect}
          />
        </div>
        <div className="flex items-center justify-center">
          <button
            onClick={() => openFolderPicker()}
            className="px-3 py-1.5 rounded-md text-[11px] font-medium border border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Select Folder (Auto-detect)
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle size={12} className="text-red-500 mt-0.5 shrink-0" />
            <div className="text-[11px] text-red-700">
              {error}
              <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* Result */}
        {importResult && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
              <CheckCircle2 size={12} />
              {importResult.multiFile ? "Multi-file Import Successful" : "Import Successful"}
            </div>
            <div className="text-[11px] text-green-800 space-y-0.5">
              {importResult.fileCount > 1 && (
                <div><strong>Files:</strong> {importResult.fileCount}</div>
              )}
              {importResult.schemaFiles > 0 && (
                <div><strong>dbt schema files:</strong> {importResult.schemaFiles}</div>
              )}
              <div><strong>Entities:</strong> {importResult.entityCount || 0}</div>
              <div><strong>Fields:</strong> {importResult.fieldCount || 0}</div>
              <div><strong>Relationships:</strong> {importResult.relationshipCount || 0}</div>
              {importResult.indexCount > 0 && (
                <div><strong>Indexes:</strong> {importResult.indexCount}</div>
              )}
            </div>
            {importResult.yaml && (
              <details className="mt-1">
                <summary className="text-[10px] text-green-600 cursor-pointer hover:underline">
                  View generated YAML
                </summary>
                <pre className="mt-1 p-2 bg-white rounded border border-green-200 text-[10px] font-mono text-text-primary overflow-x-auto max-h-48 overflow-y-auto">
                  {importResult.yaml}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
