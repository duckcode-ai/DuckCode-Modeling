/* bulkRefactor — project-wide refactoring helpers that operate across
   every YAML file in a DataLex workspace. First landing (v0.4.0):
   "rename a column, chasing every FK / relationship / index / metric /
   governance / diagram-edge reference that points at it." The engine is
   intentionally side-effect-free: plan first, show the user a diff,
   apply only on confirmation.

   ---------------------------------------------------------------
   Ref shapes a column can hide in (catalog checked against schemas):

     A. entity declaration     entities[i].fields[j].name
     B. field-level FK         entities[i].fields[j].foreign_key.{entity,field|column}
                               entities[i].fields[j].references.{entity,field|column}
     C. relationship strings   relationships[i].{from,to} = "entity.field"
     D. diagram relationships  relationships[i].{from,to} = {entity, field}
     E. indexes                indexes[i].{entity,fields[]}
     F. metrics                metrics[i].{entity,grain[],dimensions[],
                                           expression,time_dimension}
     G. governance maps        governance.classification["entity.field"]
                               governance.stewards["entity.field"]
     H. keys & partitions      entity.candidate_keys, business_keys,
                               grain, partition_by, cluster_by,
                               hash_diff_fields, natural_key,
                               surrogate_key, hash_key,
                               load_timestamp_field, record_source_field

   Anything schema-legal that's not in this list is untouched — the
   scanner prefers correctness over breadth. If you see a missed ref in
   the wild, add it here and add a fixture test.

   Diagram YAML's `edges_overrides` only references entities by name, so
   a column rename never touches it.
   --------------------------------------------------------------- */
import yaml from "js-yaml";

function loadDoc(text) {
  try {
    const doc = yaml.load(text);
    if (doc && typeof doc === "object" && !Array.isArray(doc)) return doc;
  } catch (_err) {
    /* non-YAML or malformed — caller will skip the file */
  }
  return null;
}

function dump(doc) {
  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
}

/* Return an array of ref entries recorded while rewriting `doc` in place.
   Each entry is a human-readable locator so the preview can summarise
   "3 places in orders.yml" without dumping full byte diffs. */
function rewriteColumnRefs(doc, entity, oldField, newField) {
  const refs = [];
  if (!doc || typeof doc !== "object") return refs;
  const record = (kind, detail) => refs.push({ kind, detail });

  const rewriteKeySet = (value, owner) => {
    if (!Array.isArray(value)) return value;
    let changed = false;
    const out = value.map((inner) => {
      if (Array.isArray(inner)) {
        let innerChanged = false;
        const arr = inner.map((f) => {
          if (f === oldField) { innerChanged = true; return newField; }
          return f;
        });
        if (innerChanged) { changed = true; record("keyset", `${owner}: ${inner.join(",")} → ${arr.join(",")}`); return arr; }
        return inner;
      }
      if (inner === oldField) { changed = true; record("keyset", `${owner}`); return newField; }
      return inner;
    });
    return changed ? out : value;
  };

  /* ── A. entity declarations + H. keys & partitions ───────────── */
  const entities = Array.isArray(doc.entities) ? doc.entities : [];
  entities.forEach((e) => {
    if (!e || typeof e !== "object") return;
    const isSelf = e.name === entity;

    /* A — rename the field on the declaring entity */
    if (isSelf && Array.isArray(e.fields)) {
      const target = e.fields.find((f) => f?.name === oldField);
      if (target) {
        target.name = newField;
        record("field", `${e.name}.${oldField} → ${e.name}.${newField}`);
      }
      /* H — keys / partitions carry field names */
      if (isSelf) {
        e.candidate_keys = rewriteKeySet(e.candidate_keys, `${e.name}.candidate_keys`);
        e.business_keys = rewriteKeySet(e.business_keys, `${e.name}.business_keys`);
        e.grain = rewriteKeySet(e.grain, `${e.name}.grain`);
        e.hash_diff_fields = rewriteKeySet(e.hash_diff_fields, `${e.name}.hash_diff_fields`);
        e.partition_by = rewriteKeySet(e.partition_by, `${e.name}.partition_by`);
        e.cluster_by = rewriteKeySet(e.cluster_by, `${e.name}.cluster_by`);
        [
          "natural_key", "surrogate_key", "hash_key",
          "load_timestamp_field", "record_source_field",
        ].forEach((k) => {
          if (e[k] === oldField) { e[k] = newField; record("key-scalar", `${e.name}.${k}`); }
        });
      }
    }

    /* B — FK refs on every entity (not just self) */
    (e.fields || []).forEach((f) => {
      if (!f || typeof f !== "object") return;
      for (const refKey of ["foreign_key", "references"]) {
        const ref = f[refKey];
        if (!ref || typeof ref !== "object") continue;
        if (ref.entity !== entity) continue;
        if (ref.field === oldField) { ref.field = newField; record("fk", `${e.name}.${f.name}.${refKey}.field`); }
        if (ref.column === oldField) { ref.column = newField; record("fk", `${e.name}.${f.name}.${refKey}.column`); }
      }
    });
  });

  /* ── C + D. relationships (string form + object form) ────────── */
  const relationships = Array.isArray(doc.relationships) ? doc.relationships : [];
  relationships.forEach((r) => {
    if (!r || typeof r !== "object") return;
    const relLabel = r.name || "(unnamed)";

    /* C — string form "entity.field" */
    for (const side of ["from", "to"]) {
      if (typeof r[side] === "string" && r[side] === `${entity}.${oldField}`) {
        r[side] = `${entity}.${newField}`;
        record("relationship", `${relLabel}.${side}`);
      }
    }

    /* D — diagram-level object form {entity, field} */
    for (const side of ["from", "to"]) {
      const s = r[side];
      if (s && typeof s === "object" && s.entity === entity && s.field === oldField) {
        s.field = newField;
        record("diagram-relationship", `${relLabel}.${side}`);
      }
    }
  });

  /* ── E. indexes ──────────────────────────────────────────────── */
  const indexes = Array.isArray(doc.indexes) ? doc.indexes : [];
  indexes.forEach((idx) => {
    if (!idx || idx.entity !== entity || !Array.isArray(idx.fields)) return;
    let changed = false;
    const nextFields = idx.fields.map((f) => {
      if (f === oldField) { changed = true; return newField; }
      return f;
    });
    if (changed) { idx.fields = nextFields; record("index", idx.name || "(unnamed)"); }
  });

  /* ── F. metrics ──────────────────────────────────────────────── */
  const metrics = Array.isArray(doc.metrics) ? doc.metrics : [];
  metrics.forEach((m) => {
    if (!m || m.entity !== entity) return;
    const mLabel = m.name || "(unnamed)";
    const rewriteArr = (arr, key) => {
      if (!Array.isArray(arr)) return arr;
      let changed = false;
      const out = arr.map((f) => {
        if (f === oldField) { changed = true; return newField; }
        return f;
      });
      if (changed) record("metric", `${mLabel}.${key}`);
      return changed ? out : arr;
    };
    m.grain = rewriteArr(m.grain, "grain");
    m.dimensions = rewriteArr(m.dimensions, "dimensions");
    if (m.expression === oldField) { m.expression = newField; record("metric", `${mLabel}.expression`); }
    if (m.time_dimension === oldField) { m.time_dimension = newField; record("metric", `${mLabel}.time_dimension`); }
  });

  /* ── G. governance ("entity.field" keys) ─────────────────────── */
  const gov = doc.governance;
  if (gov && typeof gov === "object") {
    for (const mapKey of ["classification", "stewards"]) {
      const m = gov[mapKey];
      if (!m || typeof m !== "object" || Array.isArray(m)) continue;
      const oldK = `${entity}.${oldField}`;
      const newK = `${entity}.${newField}`;
      if (Object.prototype.hasOwnProperty.call(m, oldK)) {
        m[newK] = m[oldK];
        delete m[oldK];
        record("governance", `${mapKey}.${oldK}`);
      }
    }
  }

  return refs;
}

/* ---------------------------------------------------------------------
   Entity-name rewriter
   ---------------------------------------------------------------------
   Mirrors rewriteColumnRefs but for an entity rename. We walk every
   place an entity name can appear:
     A. entities[i].name                                 (declaration)
     B. field-level FK / references {entity, ...}
     C. relationships[i].{from,to} "entity.field"        (string form)
     D. relationships[i].{from,to} {entity, field}       (object form)
     E. indexes[i].entity
     F. metrics[i].entity
     G. governance maps keyed by "entity.field"
     H. diagram entities[i].entity                       (diagram YAML)
     I. entity-level scalars that name another entity    (subtype_of,
        derived_from, mapped_from, parent_entity, dimension_refs[],
        link_refs[], subtypes[], templates[])
   Returns the same {kind, detail}[] shape so plan previews are uniform.
*/
export function rewriteEntityRefs(doc, oldName, newName) {
  const refs = [];
  if (!doc || typeof doc !== "object" || !oldName || !newName || oldName === newName) return refs;
  const record = (kind, detail) => refs.push({ kind, detail });
  const oldLc = String(oldName).toLowerCase();

  // A — entity declaration itself (when this doc owns it)
  const entities = Array.isArray(doc.entities) ? doc.entities : [];
  entities.forEach((e) => {
    if (!e || typeof e !== "object") return;
    if (String(e.name || "").toLowerCase() === oldLc) {
      e.name = newName;
      record("entity", `entities[].name: ${oldName} → ${newName}`);
    }

    // B — FK / references objects
    (e.fields || []).forEach((f) => {
      if (!f || typeof f !== "object") return;
      for (const key of ["foreign_key", "references"]) {
        const ref = f[key];
        if (!ref || typeof ref !== "object") continue;
        // {entity}, {table}, {references} all name the target entity.
        for (const slot of ["entity", "table", "references"]) {
          if (typeof ref[slot] === "string" && ref[slot].toLowerCase() === oldLc) {
            ref[slot] = newName;
            record("fk", `${e.name}.${f.name}.${key}.${slot}`);
          }
        }
      }
      // Bare-string FK: "customers.id" → "customer.id"
      for (const key of ["fk", "foreign_key"]) {
        const v = f[key];
        if (typeof v === "string" && v.toLowerCase().startsWith(`${oldLc}.`)) {
          f[key] = `${newName}.${v.slice(oldName.length + 1)}`;
          record("fk-string", `${e.name}.${f.name}.${key}`);
        }
      }
    });

    // I — entity-level scalars referencing another entity
    for (const k of ["subtype_of", "derived_from", "mapped_from", "parent_entity"]) {
      if (typeof e[k] === "string" && e[k].toLowerCase() === oldLc) {
        e[k] = newName;
        record("entity-ref", `${e.name}.${k}`);
      }
    }
    for (const k of ["subtypes", "dimension_refs", "link_refs", "templates"]) {
      if (!Array.isArray(e[k])) continue;
      let changed = false;
      e[k] = e[k].map((v) => {
        if (typeof v === "string" && v.toLowerCase() === oldLc) {
          changed = true;
          return newName;
        }
        return v;
      });
      if (changed) record("entity-ref-array", `${e.name}.${k}`);
    }
  });

  // C + D — relationships
  const relationships = Array.isArray(doc.relationships) ? doc.relationships : [];
  relationships.forEach((r) => {
    if (!r || typeof r !== "object") return;
    const relLabel = r.name || "(unnamed)";
    for (const side of ["from", "to"]) {
      // String form "entity.field"
      if (typeof r[side] === "string") {
        const v = r[side];
        if (v.toLowerCase().startsWith(`${oldLc}.`)) {
          r[side] = `${newName}.${v.slice(oldName.length + 1)}`;
          record("relationship", `${relLabel}.${side} (string)`);
        }
      }
      // Object form {entity, field}
      const obj = r[side];
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        if (typeof obj.entity === "string" && obj.entity.toLowerCase() === oldLc) {
          obj.entity = newName;
          record("relationship", `${relLabel}.${side}.entity`);
        }
      }
    }
  });

  // E — indexes
  const indexes = Array.isArray(doc.indexes) ? doc.indexes : [];
  indexes.forEach((idx, i) => {
    if (idx && typeof idx === "object" && typeof idx.entity === "string" && idx.entity.toLowerCase() === oldLc) {
      idx.entity = newName;
      record("index", idx.name || `#${i}`);
    }
  });

  // F — metrics
  const metrics = Array.isArray(doc.metrics) ? doc.metrics : [];
  metrics.forEach((m, i) => {
    if (m && typeof m === "object" && typeof m.entity === "string" && m.entity.toLowerCase() === oldLc) {
      m.entity = newName;
      record("metric", m.name || `#${i}`);
    }
  });

  // G — governance maps
  const gov = doc.governance;
  if (gov && typeof gov === "object") {
    for (const mapKey of ["classification", "stewards"]) {
      const m = gov[mapKey];
      if (!m || typeof m !== "object" || Array.isArray(m)) continue;
      for (const k of Object.keys(m)) {
        if (k.toLowerCase().startsWith(`${oldLc}.`)) {
          const newK = `${newName}.${k.slice(oldName.length + 1)}`;
          m[newK] = m[k];
          delete m[k];
          record("governance", `${mapKey}.${k}`);
        }
      }
    }
  }

  // H — diagram entities[].entity (cross-file diagram composition)
  //     We detect diagram shape by presence of a top-level `kind: diagram`
  //     or by `entities[].file` entries (diagrams only).
  const isDiagram = doc.kind === "diagram" || (entities.some((e) => e && typeof e === "object" && typeof e.file === "string"));
  if (isDiagram) {
    entities.forEach((entry, i) => {
      if (entry && typeof entry === "object" && typeof entry.entity === "string" && entry.entity.toLowerCase() === oldLc) {
        entry.entity = newName;
        record("diagram-entity", `entities[${i}].entity`);
      }
    });
  }

  return refs;
}

/* Normalise projectFiles + fileContentCache into an array we can scan.
   The caller hands us the two maps; we don't touch the store directly so
   this module stays easy to unit-test. */
function collectCandidateFiles(projectFiles, fileContentCache) {
  const out = [];
  (projectFiles || []).forEach((f) => {
    if (!f) return;
    const path = (f.fullPath || f.path || "").replace(/^[/\\]+/, "");
    if (!path) return;
    if (!/\.(ya?ml)$/i.test(path)) return;
    const cached = fileContentCache ? fileContentCache[path] : undefined;
    out.push({ path, fullPath: f.fullPath || path, content: cached });
  });
  return out;
}

/**
 * Plan a cross-file column rename. Returns an object describing every
 * file that would change, the rewritten content, and a breakdown of the
 * refs touched — but does NOT persist anything. Apply by passing the
 * plan to `applyBulkColumnRename`.
 *
 * @param {Object} opts
 * @param {Array}  opts.projectFiles       workspaceStore.projectFiles
 * @param {Object} opts.fileContentCache   workspaceStore.fileContentCache
 * @param {Function} [opts.loadFile]       async (path) => content, used
 *                                         when cache misses. Defaults to
 *                                         a no-op that skips uncached files
 *                                         (caller is expected to prime
 *                                         the cache via ensureFilesLoaded).
 * @param {string} opts.entity             entity owning the renamed field
 * @param {string} opts.oldField
 * @param {string} opts.newField
 */
export async function planBulkColumnRename(opts) {
  const {
    projectFiles,
    fileContentCache,
    loadFile,
    entity,
    oldField,
    newField,
  } = opts || {};

  const entityName = String(entity || "").trim();
  const oldName = String(oldField || "").trim();
  const newName = String(newField || "").trim();

  const summary = {
    entity: entityName,
    oldField: oldName,
    newField: newName,
    affected: [],
    errors: [],
    declaringFile: null,
  };

  if (!entityName || !oldName || !newName) {
    summary.errors.push({ path: "", message: "entity, oldField and newField are required." });
    return summary;
  }
  if (oldName === newName) {
    summary.errors.push({ path: "", message: "New column name is identical to the old one." });
    return summary;
  }

  const candidates = collectCandidateFiles(projectFiles, fileContentCache);

  for (const candidate of candidates) {
    let content = candidate.content;
    if (typeof content !== "string" && typeof loadFile === "function") {
      try { content = await loadFile(candidate.path); } catch (_err) { content = undefined; }
    }
    if (typeof content !== "string") continue; // nothing to scan

    const doc = loadDoc(content);
    if (!doc) continue;

    /* Collision detection: if this file declares `entity` and it already
       has a field called `newField`, we can't apply — let the user see
       the collision and pick a different new name. */
    const entities = Array.isArray(doc.entities) ? doc.entities : [];
    const declaringEntity = entities.find((e) => e?.name === entityName);
    if (declaringEntity) {
      summary.declaringFile = candidate.path;
      const clash = Array.isArray(declaringEntity.fields) &&
        declaringEntity.fields.some((f) => f?.name === newName && f?.name !== oldName);
      if (clash) {
        summary.errors.push({
          path: candidate.path,
          message: `Entity "${entityName}" already has a field called "${newName}".`,
        });
      }
    }

    const refs = rewriteColumnRefs(doc, entityName, oldName, newName);
    if (refs.length === 0) continue;

    const newContent = dump(doc);
    if (newContent === content) continue;

    summary.affected.push({
      path: candidate.path,
      fullPath: candidate.fullPath,
      oldContent: content,
      newContent,
      refs,
    });
  }

  return summary;
}

/**
 * Write a plan produced by `planBulkColumnRename` to disk. All writes
 * fire in parallel; on any failure we attempt a best-effort rollback by
 * rewriting the untouched original content back. Returns a summary the
 * UI can toast.
 */
export async function applyBulkColumnRename(plan, { saveFile }) {
  const written = [];
  const errors = [];
  if (!plan || !Array.isArray(plan.affected) || plan.affected.length === 0) {
    return { written, errors: [{ path: "", message: "Empty plan — nothing to write." }] };
  }
  if (plan.errors && plan.errors.length > 0) {
    return { written, errors: [...plan.errors, { path: "", message: "Resolve plan errors before applying." }] };
  }
  if (typeof saveFile !== "function") {
    return { written, errors: [{ path: "", message: "saveFile callback missing." }] };
  }

  for (const entry of plan.affected) {
    try {
      await saveFile(entry.fullPath || entry.path, entry.newContent);
      written.push(entry.path);
    } catch (err) {
      errors.push({
        path: entry.path,
        message: err?.message || String(err) || "Save failed.",
      });
      break; // stop before we wreck more files; rollback below
    }
  }

  /* Rollback on partial failure: rewrite each successfully-written file
     back to its original content. Best-effort — a second failure here
     leaves the user with a repo that still needs their attention, but
     we surface it via the errors array. */
  if (errors.length > 0 && written.length > 0) {
    const writtenSet = new Set(written);
    for (const entry of plan.affected) {
      if (!writtenSet.has(entry.path)) continue;
      try {
        await saveFile(entry.fullPath || entry.path, entry.oldContent);
      } catch (rollbackErr) {
        errors.push({
          path: entry.path,
          message: `Rollback failed: ${rollbackErr?.message || rollbackErr}`,
        });
      }
    }
    return { written: [], errors };
  }

  return { written, errors };
}

/* Compact one-line formatter used by the dialog's "x refs in y files"
   summary row. Counts ref kinds rather than listing every detail. */
export function summariseRefs(plan) {
  if (!plan || !Array.isArray(plan.affected)) return "";
  const counts = new Map();
  let total = 0;
  for (const entry of plan.affected) {
    for (const ref of entry.refs || []) {
      total += 1;
      counts.set(ref.kind, (counts.get(ref.kind) || 0) + 1);
    }
  }
  if (total === 0) return "No references found.";
  const parts = [];
  for (const [kind, n] of counts.entries()) parts.push(`${n} ${kind}`);
  return `${total} ref${total === 1 ? "" : "s"} across ${plan.affected.length} file${plan.affected.length === 1 ? "" : "s"} · ${parts.join(", ")}`;
}

/**
 * Plan a cross-file entity rename using `rewriteEntityRefs`. Shape matches
 * `planBulkColumnRename`: projectFiles + fileContentCache → {affected[], errors[]}.
 * Does not persist — pass the returned plan to `applyBulkEntityRename`.
 */
export async function planBulkEntityRename(opts) {
  const { projectFiles, fileContentCache, loadFile, oldName, newName } = opts || {};
  const oldN = String(oldName || "").trim();
  const newN = String(newName || "").trim();

  const summary = { oldName: oldN, newName: newN, affected: [], errors: [], declaringFile: null };

  if (!oldN || !newN) {
    summary.errors.push({ path: "", message: "oldName and newName are required." });
    return summary;
  }
  if (oldN === newN) {
    summary.errors.push({ path: "", message: "New entity name is identical to the old one." });
    return summary;
  }

  const candidates = collectCandidateFiles(projectFiles, fileContentCache);
  const oldLc = oldN.toLowerCase();
  const newLc = newN.toLowerCase();

  for (const candidate of candidates) {
    let content = candidate.content;
    if (typeof content !== "string" && typeof loadFile === "function") {
      try { content = await loadFile(candidate.path); } catch (_err) { content = undefined; }
    }
    if (typeof content !== "string") continue;

    const doc = loadDoc(content);
    if (!doc) continue;

    const entities = Array.isArray(doc.entities) ? doc.entities : [];
    const declares = entities.some((e) => e && typeof e === "object" && String(e.name || "").toLowerCase() === oldLc);
    if (declares) summary.declaringFile = candidate.path;

    // Collision: another entity in this doc already uses the new name.
    const clash = entities.some((e) => e && typeof e === "object"
      && String(e.name || "").toLowerCase() === newLc
      && String(e.name || "").toLowerCase() !== oldLc);
    if (clash) {
      summary.errors.push({
        path: candidate.path,
        message: `File "${candidate.path}" already declares an entity named "${newN}".`,
      });
    }

    const refs = rewriteEntityRefs(doc, oldN, newN);
    if (refs.length === 0) continue;

    const newContent = dump(doc);
    if (newContent === content) continue;

    summary.affected.push({
      path: candidate.path,
      fullPath: candidate.fullPath,
      oldContent: content,
      newContent,
      refs,
    });
  }

  return summary;
}

/**
 * Apply a plan produced by `planBulkEntityRename`. Same rollback semantics
 * as `applyBulkColumnRename`: serial writes, rewrite-on-failure.
 */
export async function applyBulkEntityRename(plan, { saveFile }) {
  return applyBulkColumnRename(plan, { saveFile });
}
