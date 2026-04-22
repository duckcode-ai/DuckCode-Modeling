/* Client-side DDL preview generator.
   =====================================================================

   Produces a reasonable CREATE TABLE statement (plus FK alters and index
   declarations) from a single entity, for the right-panel SQL tab. This
   is NOT meant to replace the server-side `generateForwardSql` that the
   Export-DDL dialog uses — that one is dialect-aware, handles views /
   matviews / snapshots, and produces production-grade DDL. The client
   generator is a *preview*, so the user sees shape changes as they edit
   a column, without paying a round-trip to the api-server on every
   keystroke.

   The output is plain text. The inspector's SQL tab wraps it in a <pre>
   and hands it to a tiny syntax-highlighter for colour — no HTML is
   emitted here.

   Consumers:
     • `inspector/SqlView.jsx` (preview)
     • any future panel that needs a quick, dialect-agnostic SQL sketch
*/

/* Quote an identifier when it contains characters Postgres would otherwise
   treat as special. Simple heuristic: alphanumerics + underscore pass
   unquoted; everything else gets double-quoted. */
function quoteIdent(name) {
  const s = String(name || "");
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/* Format a default expression for inclusion in DDL. Strings that look like
   function calls (`now()`, `gen_random_uuid()`) or boolean / numeric
   literals are emitted as-is; everything else is wrapped in single
   quotes with minimal escaping. */
function formatDefault(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (/^(true|false|null)$/i.test(s)) return s.toUpperCase();
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

/* Normalise a DataLex field entry into the shape the generator below
   uses. Handles both the adapter-flattened shape (`{ pk, nn, unique,
   fk, onDelete }`) and the raw YAML shape (`{ primary_key, nullable,
   foreign_key }`) so the same generator can be fed either one. */
function normaliseField(f) {
  if (!f) return null;
  const name = String(f.name || "").trim();
  if (!name) return null;
  const fkRaw = f.fk || (f.foreign_key && f.foreign_key.entity
    ? `${f.foreign_key.entity}.${f.foreign_key.field}`
    : null);
  return {
    name,
    type: String(f.type || "string"),
    pk: !!(f.pk || f.primary_key),
    nn: f.nn === true || f.nullable === false,
    unique: !!f.unique,
    generated: !!f.generated,
    default: f.default,
    check: f.check,
    description: f.description,
    fk: fkRaw,
    onDelete: f.onDelete || f.foreign_key?.on_delete,
    onUpdate: f.onUpdate || f.foreign_key?.on_update,
  };
}

/* Primary-key columns, in declaration order. Supports both per-column pk
   flags and an entity-level `primary_key` array. */
function primaryKey(entity, fields) {
  if (Array.isArray(entity?.primary_key) && entity.primary_key.length) {
    return entity.primary_key.map(String);
  }
  const pks = fields.filter((f) => f.pk).map((f) => f.name);
  return pks;
}

/* Render a CREATE TABLE / VIEW / MATERIALIZED VIEW statement for `entity`.
   Options:
     - schema: fallback schema when the entity omits one ("public")
     - includeIndexes: also emit CREATE INDEX statements from `indexes`
     - indexes: optional top-level indexes array (filtered by entity.name)
     - relationships: optional top-level relationships array (used to
       annotate FK alters with ON DELETE/UPDATE overrides) */
export function generateEntityDDL(entity, options = {}) {
  if (!entity) return "";
  const schema = String(entity.schema || options.schema || "public");
  const tableName = String(entity.name || "unnamed");
  const typ = String(entity.type || "table").toLowerCase();
  const fields = (Array.isArray(entity.fields) ? entity.fields : (entity.columns || []))
    .map(normaliseField)
    .filter(Boolean);

  const lines = [];
  if (entity.description) lines.push(`-- ${entity.description}`);
  lines.push(`-- ${schema}.${tableName}${entity.subject_area ? `  (${entity.subject_area})` : ""}`);

  if (typ === "view" || typ === "materialized_view") {
    const kw = typ === "materialized_view" ? "CREATE MATERIALIZED VIEW" : "CREATE VIEW";
    lines.push(`${kw} ${quoteIdent(schema)}.${quoteIdent(tableName)} AS`);
    lines.push(`SELECT ${fields.map((f) => quoteIdent(f.name)).join(", ") || "1"}`);
    lines.push(`FROM <source>;`);
    lines.push("-- NOTE: view body is project-specific; export via the DDL dialog for full SQL.");
    return lines.join("\n");
  }

  lines.push(`CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(tableName)} (`);

  const pkCols = primaryKey(entity, fields);
  const colLines = fields.map((f) => {
    const parts = [`  ${quoteIdent(f.name)}`, f.type];
    if (f.generated) parts.push("GENERATED ALWAYS AS IDENTITY");
    if (f.nn && !pkCols.includes(f.name)) parts.push("NOT NULL");
    if (f.unique && !pkCols.includes(f.name)) parts.push("UNIQUE");
    const def = formatDefault(f.default);
    if (def != null) parts.push(`DEFAULT ${def}`);
    if (f.check) parts.push(`CHECK (${f.check})`);
    return parts.join(" ");
  });

  if (pkCols.length) {
    colLines.push(`  PRIMARY KEY (${pkCols.map(quoteIdent).join(", ")})`);
  }

  const keySets = Array.isArray(entity.unique_keys) ? entity.unique_keys : [];
  for (const k of keySets) {
    const cols = Array.isArray(k?.fields) ? k.fields : [];
    if (!cols.length) continue;
    const label = k.name ? `CONSTRAINT ${quoteIdent(k.name)} ` : "";
    colLines.push(`  ${label}UNIQUE (${cols.map(quoteIdent).join(", ")})`);
  }

  lines.push(colLines.join(",\n"));
  lines.push(");");

  /* Foreign key alters from field-level FKs.
   * Unresolved relationships (flagged by the dbt importer when it sees a
   * `relationships:` test whose target entity hasn't been modeled yet)
   * are visual-only — we deliberately skip them here so the generated
   * DDL never contains a dangling reference. The dashed edge in the
   * diagram signals the gap; the user has to either model the missing
   * entity or delete the rel before DDL will include it. */
  const relMap = new Map();
  for (const r of options.relationships || []) {
    if (r?.status === "unresolved" || r?.unresolved === true) continue;
    const from = String(r?.from || "").toLowerCase();
    if (!from.startsWith(`${tableName.toLowerCase()}.`)) continue;
    const col = from.split(".").slice(1).join(".");
    relMap.set(col, r);
  }
  const fkLines = [];
  for (const f of fields) {
    if (!f.fk) continue;
    const [targetTable, targetCol] = String(f.fk).split(".");
    if (!targetTable || !targetCol) continue;
    const rel = relMap.get(f.name.toLowerCase());
    const onDelete = (rel?.on_delete || f.onDelete || "").toString().trim();
    const onUpdate = (rel?.on_update || f.onUpdate || "").toString().trim();
    const tail = [];
    if (onDelete && onDelete.toUpperCase() !== "NO ACTION") tail.push(`ON DELETE ${onDelete.toUpperCase()}`);
    if (onUpdate && onUpdate.toUpperCase() !== "NO ACTION") tail.push(`ON UPDATE ${onUpdate.toUpperCase()}`);
    fkLines.push(
      `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(tableName)}\n  ` +
        `ADD FOREIGN KEY (${quoteIdent(f.name)}) REFERENCES ` +
        `${quoteIdent(targetTable)}(${quoteIdent(targetCol)})${tail.length ? " " + tail.join(" ") : ""};`
    );
  }
  if (fkLines.length) {
    lines.push("");
    lines.push(...fkLines);
  }

  /* Index declarations (filtered by entity) */
  if (options.includeIndexes && Array.isArray(options.indexes)) {
    const mine = options.indexes.filter(
      (ix) => String(ix?.entity || "").toLowerCase() === tableName.toLowerCase()
    );
    if (mine.length) {
      lines.push("");
      for (const ix of mine) {
        const unique = ix.unique ? "UNIQUE " : "";
        const cols = Array.isArray(ix.fields) ? ix.fields : [];
        if (!cols.length) continue;
        const type = ix.type ? ` USING ${String(ix.type).toUpperCase()}` : "";
        lines.push(
          `CREATE ${unique}INDEX ${quoteIdent(ix.name)} ON ${quoteIdent(schema)}.${quoteIdent(tableName)}${type} ` +
            `(${cols.map(quoteIdent).join(", ")});`
        );
      }
    }
  }

  return lines.join("\n");
}

/* Theme-aware SQL highlighter. Emits span classes consumed by
   `.inspector-sql-pre` / `.sql-preview` — all colour-per-class driven by
   the `--sql-*` palette tokens defined per Luna theme, so the preview
   looks intentional on midnight, obsidian, paper, and arctic alike.

   Classes emitted:
     .sql-kw      keywords          (CREATE, SELECT, NOT NULL, …)
     .sql-type    column types      (INT, VARCHAR, UUID, TIMESTAMP, …)
     .sql-str     quoted strings    ('abc', 'now')
     .sql-num     numeric literals  (42, 3.14)
     .sql-fn      function calls    (now(), gen_random_uuid())
     .sql-punct   punctuation       (parens, commas, semicolons)
     .sql-comment line comments     (-- anything)
     (identifiers fall through unstyled → inherit .inspector-sql-pre fg) */

const SQL_KEYWORDS = new Set([
  "CREATE", "TABLE", "VIEW", "MATERIALIZED", "INDEX", "UNIQUE", "PRIMARY",
  "KEY", "FOREIGN", "REFERENCES", "NOT", "NULL", "DEFAULT", "CHECK", "ON",
  "DELETE", "UPDATE", "CASCADE", "RESTRICT", "SET", "NO", "ACTION", "ADD",
  "ALTER", "USING", "BTREE", "HASH", "GIN", "GIST", "AS", "SELECT", "FROM",
  "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "GROUP", "BY",
  "HAVING", "ORDER", "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT",
  "CONSTRAINT", "GENERATED", "ALWAYS", "IDENTITY", "TRUE", "FALSE",
  "INSERT", "INTO", "VALUES", "WITH", "RETURNING", "AND", "OR", "IS",
  "BEGIN", "END", "IF", "THEN", "ELSE", "CASE", "WHEN",
]);

// SQL data types — a separate class so types render with a different
// (teal-ish) tone than structural keywords. Matched case-insensitively.
const SQL_TYPES = new Set([
  "INT", "INTEGER", "SMALLINT", "BIGINT", "TINYINT",
  "FLOAT", "DOUBLE", "REAL", "NUMERIC", "DECIMAL",
  "VARCHAR", "CHAR", "TEXT", "STRING", "CHARACTER",
  "BOOL", "BOOLEAN",
  "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "DATETIME", "INTERVAL",
  "JSON", "JSONB", "UUID", "BYTEA", "BLOB", "BYTES",
  "SERIAL", "BIGSERIAL", "MONEY", "INET", "CIDR",
]);

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function highlightSql(source) {
  if (!source) return "";
  const out = [];
  const lines = String(source).split("\n");
  for (const line of lines) {
    // Full-line comment — cheap path before per-char tokenising.
    if (/^\s*--/.test(line)) {
      out.push(`<span class="sql-comment">${escapeHtml(line)}</span>`);
      continue;
    }
    let rendered = "";
    let i = 0;
    while (i < line.length) {
      const ch = line[i];

      // Inline comment starting mid-line (e.g. after a statement).
      if (ch === "-" && line[i + 1] === "-") {
        rendered += `<span class="sql-comment">${escapeHtml(line.slice(i))}</span>`;
        i = line.length;
        continue;
      }

      // String literal — Postgres-style single-quoted, with ''-escape.
      if (ch === "'") {
        let j = i + 1;
        while (j < line.length) {
          if (line[j] === "'" && line[j + 1] === "'") { j += 2; continue; }
          if (line[j] === "'") { j++; break; }
          j++;
        }
        rendered += `<span class="sql-str">${escapeHtml(line.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      // Double-quoted identifier — render as plain ident (no highlight).
      if (ch === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') j++;
        rendered += escapeHtml(line.slice(i, Math.min(j + 1, line.length)));
        i = j + 1;
        continue;
      }

      // Numeric literal.
      if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < line.length && /[0-9.]/.test(line[j])) j++;
        rendered += `<span class="sql-num">${escapeHtml(line.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      // Word — keyword, type, function call, or plain identifier.
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
        const word = line.slice(i, j);
        const upper = word.toUpperCase();
        if (SQL_KEYWORDS.has(upper)) {
          rendered += `<span class="sql-kw">${escapeHtml(word)}</span>`;
        } else if (SQL_TYPES.has(upper)) {
          rendered += `<span class="sql-type">${escapeHtml(word)}</span>`;
        } else if (line[j] === "(") {
          // Looks like a function call — now(), gen_random_uuid(), …
          rendered += `<span class="sql-fn">${escapeHtml(word)}</span>`;
        } else {
          // Plain identifier — inherit editor fg.
          rendered += escapeHtml(word);
        }
        i = j;
        continue;
      }

      // Punctuation — parens, commas, semicolons, operators.
      if (/[(),;]/.test(ch)) {
        rendered += `<span class="sql-punct">${escapeHtml(ch)}</span>`;
        i++;
        continue;
      }

      rendered += escapeHtml(ch);
      i++;
    }
    out.push(rendered);
  }
  return out.join("\n");
}
