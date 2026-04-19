import React, { useState, useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Key, Fingerprint, ChevronDown, ChevronUp, ArrowRightLeft, Shield, Database, AlertTriangle } from "lucide-react";
import { getSchemaColor } from "../../lib/schemaColors";

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

function FieldBadges({ field, entityName, classifications, indexedFields }) {
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
      <span key="pk" className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
        <Key size={8} />
        PK
      </span>
    );
  }
  if (field.foreign_key) {
    badges.push(
      <span key="fk" className="px-1 py-0.5 rounded text-[9px] font-bold bg-violet-50 text-violet-700 border border-violet-200">
        FK
      </span>
    );
  }
  if (field.unique && !field.primary_key) {
    badges.push(
      <span key="uq" className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">
        <Fingerprint size={8} />
        UQ
      </span>
    );
  }
  if (indexedFields?.has(field.name)) {
    badges.push(
      <span key="idx" className="px-1 py-0.5 rounded text-[9px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
        IDX
      </span>
    );
  }
  if (field.sensitivity) {
    const cls = SENSITIVITY_COLORS[field.sensitivity] || SENSITIVITY_COLORS.internal;
    badges.push(
      <span key="sens" className={`px-1 py-0.5 rounded text-[9px] font-bold border ${cls}`}>
        {field.sensitivity.toUpperCase().slice(0, 4)}
      </span>
    );
  }
  if (field.computed) {
    badges.push(
      <span key="comp" className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        COMP
      </span>
    );
  }
  if (field.check) {
    badges.push(
      <span key="chk" className="px-1 py-0.5 rounded text-[9px] font-bold bg-pink-50 text-pink-700 border border-pink-200">
        CHK
      </span>
    );
  }
  if ("default" in field) {
    badges.push(
      <span key="def" className="px-1 py-0.5 rounded text-[9px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
        DEF
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

  // Compact dot mode for large models
  if (data.compactMode) {
    const relCount = data.relationshipCount || 0;
    return (
      <div className="w-[140px] rounded-lg border border-border-primary bg-bg-card shadow-sm overflow-hidden flex">
        <div className="w-1 shrink-0" style={{ backgroundColor: schemaColor.hex }} />
        <Handle type="target" position={Position.Left} className="!bg-blue-500 !border-white !w-2 !h-2" />
        <div className="px-2 py-1.5 flex-1 min-w-0" style={{ backgroundColor: `${schemaColor.hex}1a` }}>
          <h3 className="text-[11px] font-semibold text-text-primary truncate">{data.name}</h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`px-1 py-0 rounded text-[8px] font-bold uppercase ${colors.badge}`}>
              {entityType.replace("_", " ")}
            </span>
            <span className="text-[9px] text-text-muted">{fields.length}f</span>
            {relCount > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-text-muted">
                <ArrowRightLeft size={7} />{relCount}
              </span>
            )}
          </div>
        </div>
        <Handle type="source" position={Position.Right} className="!bg-blue-500 !border-white !w-2 !h-2" />
      </div>
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
    <div className="w-[280px] rounded-lg border border-border-primary bg-bg-card shadow-md overflow-hidden flex">
      {/* Schema color accent bar */}
      <div className="w-1.5 shrink-0" style={{ backgroundColor: schemaColor.hex }} />

      <div className="flex-1 min-w-0">
      <Handle type="target" position={Position.Left} className="!bg-blue-500 !border-white !w-2 !h-2" />

      {/* Header — tinted by subject area */}
      <div
        className="px-3 py-2 border-b border-border-primary"
        style={{ backgroundColor: `${schemaColor.hex}1f` }}
      >
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
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <CompletenessIndicator score={data.completenessScore} />
            <button
              onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
              className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
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
              <span className="text-[9px] text-text-tertiary truncate">
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
        <div className="px-3 py-1.5 text-[11px] text-text-tertiary border-b border-border-subtle leading-relaxed">
          {data.description}
        </div>
      )}

      {!collapsed && modelingHints.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border-subtle bg-bg-sunken space-y-1">
          {modelingHints.slice(0, isConceptual ? 3 : 4).map((hint) => (
            <div key={hint} className="text-[10px] text-text-tertiary leading-snug">
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
                idx % 2 === 0 ? "bg-transparent" : "bg-bg-sunken"
              } hover:bg-bg-hover transition-colors`}
            >
              <span className={`font-mono flex-1 truncate ${field.deprecated ? "line-through text-text-muted" : "text-text-primary"}`}>
                {field.name}
                {field.deprecated && <AlertTriangle size={8} className="inline ml-0.5 text-amber-500" />}
              </span>
              {!isConceptual && <span className="font-mono text-text-muted text-[10px] shrink-0">{field.type}</span>}
              {!isConceptual && <FieldBadges field={field} entityName={data.name} classifications={classifications} indexedFields={indexedFields} />}
              {isPhysical && field.nullable === false && (
                <span className="text-[8px] text-accent-red font-bold">NN</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Hidden count */}
      {hiddenCount > 0 && (
        <div
          className="px-3 py-1 text-[10px] text-text-muted text-center border-t border-border-subtle cursor-pointer hover:text-text-primary hover:bg-bg-hover transition-colors"
          onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}
        >
          {collapsed ? `${hiddenCount} fields` : `+ ${hiddenCount} more fields`}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!bg-blue-500 !border-white !w-2 !h-2" />
      </div>{/* end flex-1 wrapper */}
    </div>
  );
}
