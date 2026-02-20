import React, { useState, useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Key, Fingerprint, Diamond, ChevronDown, ChevronUp, ArrowRightLeft, Tag, Shield, Database, AlertTriangle } from "lucide-react";
import { SCHEMA_COLORS, getSchemaColor } from "../../lib/schemaColors";

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
  table: { bg: "from-blue-50 to-blue-100/60", border: "border-blue-200", badge: "bg-blue-100 text-blue-700" },
  view: { bg: "from-purple-50 to-purple-100/60", border: "border-purple-200", badge: "bg-purple-100 text-purple-700" },
  materialized_view: { bg: "from-indigo-50 to-indigo-100/60", border: "border-indigo-200", badge: "bg-indigo-100 text-indigo-700" },
  external_table: { bg: "from-teal-50 to-teal-100/60", border: "border-teal-200", badge: "bg-teal-100 text-teal-700" },
  snapshot: { bg: "from-amber-50 to-amber-100/60", border: "border-amber-200", badge: "bg-amber-100 text-amber-700" },
  fact_table: { bg: "from-orange-50 to-amber-100/60", border: "border-orange-300", badge: "bg-orange-100 text-orange-700" },
  dimension_table: { bg: "from-sky-50 to-cyan-100/60", border: "border-sky-300", badge: "bg-sky-100 text-sky-700" },
  bridge_table: { bg: "from-rose-50 to-pink-100/60", border: "border-rose-300", badge: "bg-rose-100 text-rose-700" },
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

function DimBadges({ entityType, scdType, conformed, dimensionRefs }) {
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
  return badges.length > 0 ? <>{badges}</> : null;
}

export default function EntityNode({ data }) {
  const [collapsed, setCollapsed] = useState(false);
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

  const schemaColor = getSchemaColor(data.schemaColorIndex);
  const schemaName = data.subject_area || data.schema || null;

  // Compact dot mode for large models
  if (data.compactMode) {
    const relCount = data.relationshipCount || 0;
    return (
      <div className={`w-[140px] rounded-lg border ${colors.border} bg-white shadow-sm overflow-hidden flex`}>
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
  } else if (fieldView === "keys") {
    visibleFields = fields.filter((f) => {
      const key = `${data.name}.${f.name}`;
      return f.primary_key || f.unique || Boolean(classifications[key]);
    });
    hiddenCount = fields.length - visibleFields.length;
  } else if (fieldView === "minimal") {
    visibleFields = fields.slice(0, 8);
    hiddenCount = Math.max(0, fields.length - 8);
  }

  const relCount = data.relationshipCount || 0;

  return (
    <div className={`w-[280px] rounded-lg border ${colors.border} bg-white shadow-md shadow-slate-200/60 overflow-hidden flex`}>
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
              <DimBadges entityType={entityType} scdType={scdType} conformed={conformed} dimensionRefs={dimensionRefs} />
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
              <span className="font-mono text-slate-400 text-[10px] shrink-0">{field.type}</span>
              <FieldBadges field={field} entityName={data.name} classifications={classifications} indexedFields={indexedFields} />
              {field.nullable === false && (
                <span className="text-[8px] text-accent-red font-bold">NN</span>
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
  );
}
