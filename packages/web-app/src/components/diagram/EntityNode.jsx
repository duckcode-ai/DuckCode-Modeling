import React, { useState, useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Key, Fingerprint, ChevronDown, ChevronUp, ArrowRightLeft, Shield, Database, AlertTriangle, GitBranch, Replace } from "lucide-react";
import { getSchemaColor } from "../../lib/schemaColors";
import useUiStore from "../../stores/uiStore";
import useDiagramStore from "../../stores/diagramStore";

function CompletenessIndicator({ score }) {
  if (score === null || score === undefined) return null;
  let dotCls, title;
  if (score === 100) { dotCls = "bg-green-400"; title = `Complete (${score}%)`; }
  else if (score >= 80) { dotCls = "bg-green-400"; title = `Good (${score}%)`; }
  else if (score >= 60) { dotCls = "bg-yellow-400"; title = `Partial (${score}%)`; }
  else { dotCls = "bg-red-400"; title = `Needs work (${score}%)`; }
  return (
    <span
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold text-text-muted hover:text-text-primary transition-colors cursor-default"
      title={title}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
      {score}%
    </span>
  );
}

const TYPE_COLORS = {
  concept: { bg: "from-slate-50 to-zinc-100/70", border: "border-slate-300", badge: "bg-slate-200 text-slate-700" },
  logical_entity: { bg: "from-cyan-50 to-sky-100/70", border: "border-cyan-300", badge: "bg-cyan-100 text-cyan-700" },
  table: { bg: "from-blue-50 to-blue-100/60", border: "border-blue-200", badge: "bg-blue-100 text-blue-700" },
  view: { bg: "from-purple-50 to-purple-100/60", border: "border-purple-200", badge: "bg-purple-100 text-purple-700" },
  materialized_view: { bg: "from-indigo-50 to-indigo-100/60", border: "border-indigo-200", badge: "bg-indigo-100 text-indigo-700" },
  external_table: { bg: "from-teal-50 to-teal-100/60", border: "border-teal-200", badge: "bg-teal-100 text-teal-700" },
  snapshot: { bg: "from-amber-50 to-amber-100/60", border: "border-amber-200", badge: "bg-amber-100 text-amber-700" },
  fact_table: { bg: "from-orange-50 to-amber-100/60", border: "border-orange-300", badge: "bg-orange-100 text-orange-700" },
  dimension_table: { bg: "from-sky-50 to-cyan-100/60", border: "border-sky-300", badge: "bg-sky-100 text-sky-700" },
  bridge_table: { bg: "from-rose-50 to-pink-100/60", border: "border-rose-300", badge: "bg-rose-100 text-rose-700" },
  hub: { bg: "from-emerald-50 to-green-100/60", border: "border-emerald-300", badge: "bg-emerald-100 text-emerald-700" },
  link: { bg: "from-fuchsia-50 to-pink-100/60", border: "border-fuchsia-300", badge: "bg-fuchsia-100 text-fuchsia-700" },
  satellite: { bg: "from-lime-50 to-yellow-100/60", border: "border-lime-300", badge: "bg-lime-100 text-lime-700" },
};

const SENSITIVITY_COLORS = {
  public: "bg-green-50 text-green-700 border-green-200",
  internal: "bg-slate-100 text-slate-600 border-slate-200",
  confidential: "bg-orange-50 text-orange-700 border-orange-200",
  restricted: "bg-red-50 text-red-700 border-red-200",
};

const TAG_COLORS = {
  PII: "bg-red-50 text-red-700 border-red-200",
  GOLD: "bg-yellow-50 text-yellow-700 border-yellow-200",
  PCI: "bg-orange-50 text-orange-700 border-orange-200",
  INTERNAL: "bg-slate-100 text-slate-600 border-slate-200",
  PUBLIC: "bg-green-50 text-green-700 border-green-200",
  CONFIDENTIAL: "bg-red-50 text-red-700 border-red-200",
};

// Small helper: detect enum-typed columns from either a stringy type
// ("enum('a','b')", "enum[red,blue]") or a separate `enum:` list.
function isEnumField(field) {
  if (Array.isArray(field?.enum) && field.enum.length > 0) return true;
  const t = String(field?.type || "").trim().toLowerCase();
  return t.startsWith("enum(") || t.startsWith("enum<") || t.startsWith("enum[");
}

function enumValues(field) {
  if (Array.isArray(field?.enum)) return field.enum;
  const t = String(field?.type || "");
  const m = t.match(/enum\s*[([<]\s*(.+?)\s*[)\]>]/i);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

function findIndexForField(indexes, fieldName) {
  if (!Array.isArray(indexes)) return null;
  return indexes.find((idx) => Array.isArray(idx?.fields) && idx.fields.includes(fieldName)) || null;
}

/* Resolve a foreign_key into a display string like "entity.field".
 *
 * Canonical DataLex shape is `{entity, field}` (also `{entity, column}` for
 * legacy dbt-importer output). We also accept legacy SQLDBM-style
 * `{references, table}` and bare string "entity.field" forms on read so
 * hand-authored YAML keeps rendering. Writers emit the canonical shape
 * only — see yamlPatch.renameEntity, bulkRefactor, schemaAdapter. */
export function resolveForeignKeyTarget(fk) {
  if (fk == null) return "";
  if (typeof fk === "string") return fk.trim();
  if (typeof fk !== "object") return "";
  const entity = String(fk.entity || fk.table || fk.references || "").trim();
  const field = String(fk.field || fk.column || "").trim();
  if (entity && field) return `${entity}.${field}`;
  return entity || field || "";
}

function FieldBadges({ field, entityName, classifications, indexedFields, indexes }) {
  const classKey = `${entityName}.${field.name}`;
  const classification = classifications?.[classKey];
  const badges = [];

  if (classification) {
    badges.push(
      <span key="cls" className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-red-50 text-red-700 border border-red-200">
        <Shield size={8} />
        {classification}
      </span>
    );
  }
  if (field.primary_key) {
    badges.push(
      <span key="pk" className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200" title="Primary key">
        <Key size={8} />
        PK
      </span>
    );
  }
  if (field.foreign_key) {
    const fkTarget = resolveForeignKeyTarget(field.foreign_key);
    badges.push(
      <span
        key="fk"
        className="px-1 py-0.5 rounded text-[9px] font-bold bg-violet-50 text-violet-700 border border-violet-200"
        title={fkTarget ? `Foreign key → ${fkTarget}` : "Foreign key"}
      >
        FK
      </span>
    );
  }
  if (field.unique && !field.primary_key) {
    badges.push(
      <span key="uq" className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200" title="Unique constraint">
        <Fingerprint size={8} />
        UQ
      </span>
    );
  }
  if (indexedFields?.has(field.name)) {
    // Surface the index definition (fields + type + uniqueness) in the tooltip
    // so users can distinguish composite/unique indexes without opening the
    // inspector. Falls back to a plain label if no metadata is available.
    const idxDef = findIndexForField(indexes, field.name);
    const idxTip = idxDef
      ? `Index: ${idxDef.name || "(unnamed)"} on (${(idxDef.fields || []).join(", ")})${idxDef.unique ? " · UNIQUE" : ""}${idxDef.type ? ` · ${idxDef.type}` : ""}`
      : "Indexed column";
    badges.push(
      <span
        key="idx"
        className="px-1 py-0.5 rounded text-[9px] font-bold bg-sky-50 text-sky-700 border border-sky-200"
        title={idxTip}
      >
        IDX
      </span>
    );
  }
  if (field.sensitivity) {
    const cls = SENSITIVITY_COLORS[field.sensitivity] || SENSITIVITY_COLORS.internal;
    badges.push(
      <span key="sens" className={`px-1 py-0.5 rounded text-[9px] font-bold border ${cls}`} title={`Sensitivity: ${field.sensitivity}`}>
        {field.sensitivity.toUpperCase().slice(0, 4)}
      </span>
    );
  }
  if (field.computed) {
    const formula = String(field.computed_expression || field.formula || field.computed === true ? "" : field.computed || "");
    badges.push(
      <span
        key="comp"
        className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"
        title={formula ? `Computed: ${formula}` : "Computed column"}
      >
        COMP
      </span>
    );
  }
  if (field.check) {
    // CHECK constraints are often the short pithy expression we want on
    // hover — e.g. `length(email) > 3`. Support both string and object
    // ({expression, name}) shapes.
    const expr = typeof field.check === "string"
      ? field.check
      : (field.check?.expression || field.check?.expr || "");
    badges.push(
      <span
        key="chk"
        className="px-1 py-0.5 rounded text-[9px] font-bold bg-pink-50 text-pink-700 border border-pink-200"
        title={expr ? `CHECK: ${expr}` : "CHECK constraint"}
      >
        CHK
      </span>
    );
  }
  if ("default" in field) {
    const def = field.default === null ? "NULL" : String(field.default);
    badges.push(
      <span
        key="def"
        className="px-1 py-0.5 rounded text-[9px] font-bold bg-gray-100 text-gray-600 border border-gray-200"
        title={`DEFAULT: ${def}`}
      >
        DEF
      </span>
    );
  }
  if (isEnumField(field)) {
    const vals = enumValues(field);
    badges.push(
      <span
        key="enum"
        className="px-1 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200"
        title={vals.length ? `Enum: ${vals.join(", ")}` : "Enum column"}
      >
        ENUM
      </span>
    );
  }

  return badges.length > 0 ? <>{badges}</> : null;
}

function DimBadges({ entityType, scdType, conformed, dimensionRefs, businessKeys, linkRefs, parentEntity }) {
  const badges = [];
  if (entityType === "dimension_table" && scdType === 2) {
    badges.push(
      <span key="scd2" className="px-1.5 py-0 rounded text-[9px] font-bold bg-cyan-100 text-cyan-700 border border-cyan-300">
        SCD2
      </span>
    );
  }
  if (entityType === "dimension_table" && conformed) {
    badges.push(
      <span key="conf" className="px-1.5 py-0 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
        CONFORMED
      </span>
    );
  }
  if (entityType === "fact_table" && Array.isArray(dimensionRefs) && dimensionRefs.length > 0) {
    badges.push(
      <span key="dims" className="px-1.5 py-0 rounded text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-300" title={dimensionRefs.join(", ")}>
        {dimensionRefs.length}D
      </span>
    );
  }
  if (entityType === "hub" && Array.isArray(businessKeys) && businessKeys.length > 0) {
    badges.push(
      <span key="hub" className="px-1.5 py-0 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
        {businessKeys.length}BK
      </span>
    );
  }
  if (entityType === "link" && Array.isArray(linkRefs) && linkRefs.length > 0) {
    badges.push(
      <span key="link" className="px-1.5 py-0 rounded text-[9px] font-bold bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-300" title={linkRefs.join(", ")}>
        {linkRefs.length}H
      </span>
    );
  }
  if (entityType === "satellite" && parentEntity) {
    badges.push(
      <span key="sat" className="px-1.5 py-0 rounded text-[9px] font-bold bg-lime-100 text-lime-700 border border-lime-300" title={parentEntity}>
        SAT
      </span>
    );
  }
  return badges.length > 0 ? <>{badges}</> : null;
}

function keySetLabel(keySet) {
  return (Array.isArray(keySet) ? keySet : []).filter(Boolean).join(" + ");
}

export default function EntityNode({ data }) {
  const [collapsed, setCollapsed] = useState(false);
  // Right-click menu. `{x,y}` are viewport coordinates used to position the
  // floating menu (closed when null). `null` means no menu open.
  const [ctxMenu, setCtxMenu] = useState(null);
  const openModal = useUiStore((s) => s.openModal);

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const closeCtxMenu = () => setCtxMenu(null);

  const handleAddRelationshipFromHere = () => {
    // Pull the full model so the dialog's picker can complete the `to` side.
    const model = useDiagramStore.getState().model;
    const entityList = (model?.entities || []).map((e) => ({
      id: e.name,
      name: e.name,
      columns: (e.fields || e.columns || []).map((f) => ({ name: f.name })),
    }));
    const firstField = (data.fields || [])[0]?.name || "";
    openModal("newRelationship", {
      fromEntity: data.name,
      fromColumn: firstField,
      toEntity: "",
      toColumn: "",
      tables: entityList,
    });
    closeCtxMenu();
  };

  const handleRenameColumnFromHere = () => {
    // Open the bulk-rename dialog in column-picker mode — the user picks
    // which column on this entity to rename, then the dialog scans the
    // whole workspace for references.
    const columns = (data.fields || []).map((f) => ({ name: f.name }));
    openModal("bulkRenameColumn", {
      entity: data.name,
      columns,
    });
    closeCtxMenu();
  };

  // Close the menu on any global click / escape. We install the listeners
  // only while the menu is open to keep idle nodes cheap.
  React.useEffect(() => {
    if (!ctxMenu) return;
    const onDown = () => closeCtxMenu();
    const onKey = (e) => { if (e.key === "Escape") closeCtxMenu(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  const modelingViewMode = data.modelingViewMode || "physical";
  const fieldView = data.fieldView || "all";
  const entityType = data.type || "table";
  const colors = TYPE_COLORS[entityType] || TYPE_COLORS.table;
  const fields = Array.isArray(data.fields) ? data.fields : [];
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const classifications = data.classifications || {};
  const entityIndexes = Array.isArray(data.indexes) ? data.indexes : [];

  const indexedFields = useMemo(() => {
    const set = new Set();
    entityIndexes.forEach((idx) => {
      (idx.fields || []).forEach((f) => set.add(f));
    });
    return set;
  }, [entityIndexes]);

  const scdType = data.scd_type ?? null;
  const conformed = data.conformed ?? false;
  const dimensionRefs = Array.isArray(data.dimension_refs) ? data.dimension_refs : [];
  const businessKeys = Array.isArray(data.business_keys) ? data.business_keys : [];
  const linkRefs = Array.isArray(data.link_refs) ? data.link_refs : [];
  const parentEntity = data.parent_entity || "";
  const candidateKeys = Array.isArray(data.candidate_keys) ? data.candidate_keys : [];
  const subtypeOf = data.subtype_of || "";
  const subtypes = Array.isArray(data.subtypes) ? data.subtypes : [];
  const derivedFrom = data.derived_from || "";
  const mappedFrom = data.mapped_from || "";
  const templates = Array.isArray(data.templates) ? data.templates : [];
  const grain = Array.isArray(data.grain) ? data.grain : [];
  const partitionBy = Array.isArray(data.partition_by) ? data.partition_by : [];
  const clusterBy = Array.isArray(data.cluster_by) ? data.cluster_by : [];
  const distribution = data.distribution || "";
  const storage = data.storage || "";
  const interfaceMeta = data.interface && typeof data.interface === "object" ? data.interface : null;
  const isInterface = Boolean(interfaceMeta?.enabled) || ["shared", "contracted"].includes(String(interfaceMeta?.stability || "").toLowerCase());

  const schemaColor = getSchemaColor(data.schemaColorIndex);
  const schemaName = data.subject_area || data.schema || null;
  const isConceptual = modelingViewMode === "conceptual";
  const isLogical = modelingViewMode === "logical";
  const isPhysical = !isConceptual && !isLogical;
  const effectiveFieldView = isConceptual ? "minimal" : (isLogical && fieldView === "all" ? "keys" : fieldView);
  const modelingHints = [];
  const modelingBadges = [];

  if (candidateKeys.length > 0) {
    modelingBadges.push(
      <span key="candidate-keys" className="px-1.5 py-0 rounded text-[9px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
        {candidateKeys.length}CK
      </span>
    );
  }
  if (subtypeOf) {
    modelingBadges.push(
      <span key="subtype-of" className="px-1.5 py-0 rounded text-[9px] font-bold bg-violet-100 text-violet-700 border border-violet-200">
        SUBTYPE
      </span>
    );
  }
  if (subtypes.length > 0) {
    modelingBadges.push(
      <span key="subtypes" className="px-1.5 py-0 rounded text-[9px] font-bold bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-200">
        {subtypes.length}SUB
      </span>
    );
  }
  if (templates.length > 0) {
    modelingBadges.push(
      <span key="templates" className="px-1.5 py-0 rounded text-[9px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
        {templates.length}TPL
      </span>
    );
  }
  if (derivedFrom || mappedFrom) {
    modelingBadges.push(
      <span key="mapping" className="px-1.5 py-0 rounded text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
        MAP
      </span>
    );
  }
  if (isInterface) {
    modelingBadges.push(
      <span
        key="interface"
        className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300"
        title={`Interface ${interfaceMeta?.status || "draft"} · ${interfaceMeta?.stability || "shared"}`}
      >
        <Shield size={8} />
        IFACE
      </span>
    );
  }

  if (isConceptual) {
    if (derivedFrom) modelingHints.push(`Derived from ${derivedFrom}`);
    if (mappedFrom) modelingHints.push(`Mapped from ${mappedFrom}`);
    if (templates.length > 0) modelingHints.push(`Templates: ${templates.join(", ")}`);
  }
  if (isLogical) {
    if (candidateKeys.length > 0) {
      modelingHints.push(`Candidate keys: ${candidateKeys.slice(0, 2).map(keySetLabel).join(" | ")}`);
    }
    if (subtypeOf) modelingHints.push(`Subtype of ${subtypeOf}`);
    if (subtypes.length > 0) modelingHints.push(`Subtypes: ${subtypes.join(", ")}`);
    if (grain.length > 0 && entityType !== "fact_table") modelingHints.push(`Grain: ${grain.join(", ")}`);
  }
  if (isPhysical) {
    if (partitionBy.length > 0) modelingHints.push(`Partition: ${partitionBy.join(", ")}`);
    if (clusterBy.length > 0) modelingHints.push(`Cluster: ${clusterBy.join(", ")}`);
    if (distribution) modelingHints.push(`Distribution: ${distribution}`);
    if (storage) modelingHints.push(`Storage: ${storage}`);
  }

  // Floating right-click menu — rendered alongside whichever render path
  // is active. Position-fixed to the viewport so it clears the node
  // container's clipping.
  const ctxMenuEl = ctxMenu ? (
    <div
      className="dlx-floating-menu"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: ctxMenu.y,
        left: ctxMenu.x,
        zIndex: 10000,
        background: "var(--bg-1)",
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        boxShadow: "0 18px 50px rgba(0, 0, 0, 0.32)",
        minWidth: 200,
        padding: 4,
        fontSize: 12,
        color: "var(--text-primary)",
      }}
    >
      <button
        type="button"
        onClick={handleAddRelationshipFromHere}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 10px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          borderRadius: 4,
          textAlign: "left",
          color: "var(--text-primary)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-3)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <GitBranch size={12} />
        <span>Add Relationship from here…</span>
      </button>
      <button
        type="button"
        onClick={handleRenameColumnFromHere}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 10px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          borderRadius: 4,
          textAlign: "left",
          color: "var(--text-primary)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-3)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <Replace size={12} />
        <span>Rename column…</span>
      </button>
    </div>
  ) : null;

  // Compact dot mode for large models
  if (data.compactMode) {
    const relCount = data.relationshipCount || 0;
    return (
      <>
      <div
        onContextMenu={handleContextMenu}
        className={`w-[140px] rounded-lg border ${colors.border} bg-white shadow-sm overflow-hidden flex`}
      >
        <div className={`w-1 shrink-0 ${schemaColor.bg}`} />
        <Handle type="target" position={Position.Left} className="!bg-blue-500 !border-white !w-2 !h-2" />
        <div className={`bg-gradient-to-r ${colors.bg} px-2 py-1.5 flex-1 min-w-0`}>
          <h3 className="text-[11px] font-semibold text-text-primary truncate">{data.name}</h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`px-1 py-0 rounded text-[8px] font-bold uppercase ${colors.badge}`}>
              {entityType.replace("_", " ")}
            </span>
            <span className="text-[9px] text-slate-400">{fields.length}f</span>
            {relCount > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-slate-400">
                <ArrowRightLeft size={7} />{relCount}
              </span>
            )}
            {isInterface && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-emerald-700" title="Governed Interface">
                <Shield size={7} />IF
              </span>
            )}
          </div>
        </div>
        <Handle type="source" position={Position.Right} className="!bg-blue-500 !border-white !w-2 !h-2" />
      </div>
      {ctxMenuEl}
      </>
    );
  }

  let visibleFields = fields;
  let hiddenCount = 0;
  if (collapsed) {
    visibleFields = [];
    hiddenCount = fields.length;
  } else if (effectiveFieldView === "keys") {
    visibleFields = fields.filter((f) => {
      const key = `${data.name}.${f.name}`;
      return f.primary_key || f.unique || Boolean(classifications[key]);
    });
    hiddenCount = fields.length - visibleFields.length;
  } else if (effectiveFieldView === "minimal") {
    visibleFields = fields.slice(0, isConceptual ? 4 : 8);
    hiddenCount = Math.max(0, fields.length - visibleFields.length);
  }

  const relCount = data.relationshipCount || 0;

  return (
    <>
    <div
      onContextMenu={handleContextMenu}
      className={`w-[280px] rounded-lg border ${colors.border} bg-white shadow-md shadow-slate-200/60 overflow-hidden flex`}
    >
      {/* Schema color accent bar */}
      <div className={`w-1.5 shrink-0 ${schemaColor.bg}`} />

      <div className="flex-1 min-w-0">
      <Handle type="target" position={Position.Left} className="!bg-blue-500 !border-white !w-2 !h-2" />

      {/* Header */}
      <div className={`bg-gradient-to-r ${colors.bg} px-3 py-2 border-b ${colors.border}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary truncate">{data.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className={`px-1.5 py-0 rounded text-[10px] font-medium uppercase tracking-wider ${colors.badge}`}>
                {entityType.replace("_", " ")}
              </span>
              {schemaName && (
                <span className={`px-1.5 py-0 rounded text-[9px] font-semibold ${schemaColor.bgLight} ${schemaColor.text} ${schemaColor.border} border`}>
                  {schemaName}
                </span>
              )}
              <DimBadges entityType={entityType} scdType={scdType} conformed={conformed} dimensionRefs={dimensionRefs} businessKeys={businessKeys} linkRefs={linkRefs} parentEntity={parentEntity} />
              {!isConceptual && modelingBadges}
              {relCount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-text-muted">
                  <ArrowRightLeft size={9} />
                  {relCount}
                </span>
              )}
              {Array.isArray(data.warnings) && data.warnings.length > 0 && (
                <span
                  className="flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] font-semibold border"
                  style={{
                    color: "#b45309",
                    background: "rgba(245,158,11,0.12)",
                    borderColor: "#f59e0b",
                  }}
                  title={data.warnings.join("\n")}
                >
                  <AlertTriangle size={9} />
                  {data.warnings.length} warning{data.warnings.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <CompletenessIndicator score={data.completenessScore} />
            <button
              onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
              className="p-0.5 rounded hover:bg-slate-200/60 text-slate-400 hover:text-slate-700 transition-colors"
            >
              {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className={`px-1.5 py-0 rounded text-[9px] font-semibold uppercase tracking-wider border ${
                  TAG_COLORS[tag] || "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {tag}
              </span>
            ))}
            {tags.length > 4 && (
              <span className="text-[9px] text-text-muted">+{tags.length - 4}</span>
            )}
          </div>
        )}

        {(data.subject_area || data.sla) && (
          <div className="flex items-center gap-2 mt-1">
            {data.subject_area && (
              <span className="text-[9px] text-slate-500 truncate">
                <Database size={8} className="inline mr-0.5" />
                {data.subject_area}
              </span>
            )}
            {data.sla && (
              <span className="px-1.5 py-0 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                SLA: {typeof data.sla === 'object' ? (data.sla.freshness || data.sla.quality_score || 'defined') : data.sla}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      {data.description && !collapsed && (
        <div className="px-3 py-1.5 text-[11px] text-slate-500 border-b border-slate-100 leading-relaxed">
          {data.description}
        </div>
      )}

      {!collapsed && modelingHints.length > 0 && (
        <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50/60 space-y-1">
          {modelingHints.slice(0, isConceptual ? 3 : 4).map((hint) => (
            <div key={hint} className="text-[10px] text-slate-500 leading-snug">
              {hint}
            </div>
          ))}
        </div>
      )}

      {/* Fields */}
      {!collapsed && visibleFields.length > 0 && (
        <div className="py-1">
          {visibleFields.map((field, idx) => (
            <div
              key={field.name}
              className={`flex items-center gap-2 px-3 py-1 text-[11px] ${
                idx % 2 === 0 ? "bg-transparent" : "bg-slate-50/60"
              } hover:bg-slate-50 transition-colors`}
            >
              <span className={`font-mono flex-1 truncate ${field.deprecated ? "line-through text-slate-400" : "text-slate-800"}`}>
                {field.name}
                {field.deprecated && <AlertTriangle size={8} className="inline ml-0.5 text-amber-500" />}
              </span>
              {!isConceptual && (() => {
                // "unknown" / empty type → em-dash. The dbt importer writes
                // "unknown" when a manifest node has no data_type (user hasn't
                // run `dbt compile`). Rendering the raw string would look like
                // a real type; the em-dash signals "fill me in" and pairs with
                // the Inspector's inline type editor.
                const t = String(field.type || "").trim();
                const isUnknown = !t || t.toLowerCase() === "unknown";
                return (
                  <span
                    className={`font-mono text-[10px] shrink-0 ${isUnknown ? "text-slate-300 italic" : "text-slate-400"}`}
                    title={isUnknown ? "Type not set — click Inspector to fill in (or run `dbt compile`)." : t}
                  >
                    {isUnknown ? "—" : field.type}
                  </span>
                );
              })()}
              {!isConceptual && <FieldBadges field={field} entityName={data.name} classifications={classifications} indexedFields={indexedFields} indexes={entityIndexes} />}
              {/* NN across all views — legend documents NN and until now it
                  only rendered in physical mode. Logical/conceptual users
                  need the same visual cue for required columns. */}
              {!isConceptual && field.nullable === false && (
                <span className="text-[8px] text-accent-red font-bold" title="NOT NULL">NN</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Hidden count */}
      {hiddenCount > 0 && (
        <div
          className="px-3 py-1 text-[10px] text-slate-400 text-center border-t border-slate-100 cursor-pointer hover:text-slate-600 hover:bg-slate-50 transition-colors"
          onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}
        >
          {collapsed ? `${hiddenCount} fields` : `+ ${hiddenCount} more fields`}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!bg-blue-500 !border-white !w-2 !h-2" />
      </div>{/* end flex-1 wrapper */}
    </div>
    {ctxMenuEl}
    </>
  );
}
