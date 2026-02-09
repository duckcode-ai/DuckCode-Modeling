import React, { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { Key, Fingerprint, Diamond, ChevronDown, ChevronUp, ArrowRightLeft, Tag, Shield } from "lucide-react";

const TYPE_COLORS = {
  table: { bg: "from-blue-50 to-blue-100/60", border: "border-blue-200", badge: "bg-blue-100 text-blue-700" },
  view: { bg: "from-purple-50 to-purple-100/60", border: "border-purple-200", badge: "bg-purple-100 text-purple-700" },
};

const TAG_COLORS = {
  PII: "bg-red-50 text-red-700 border-red-200",
  GOLD: "bg-yellow-50 text-yellow-700 border-yellow-200",
  PCI: "bg-orange-50 text-orange-700 border-orange-200",
  INTERNAL: "bg-slate-100 text-slate-600 border-slate-200",
  PUBLIC: "bg-green-50 text-green-700 border-green-200",
  CONFIDENTIAL: "bg-red-50 text-red-700 border-red-200",
};

function FieldIcon({ field, entityName, classifications }) {
  const classKey = `${entityName}.${field.name}`;
  const classification = classifications?.[classKey];

  if (classification) {
    return (
      <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-red-50 text-red-700 border border-red-200">
        <Shield size={8} />
        {classification}
      </span>
    );
  }
  if (field.primary_key) {
    return (
      <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
        <Key size={8} />
        PK
      </span>
    );
  }
  if (field.unique) {
    return (
      <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">
        <Fingerprint size={8} />
        UQ
      </span>
    );
  }
  return null;
}

export default function EntityNode({ data }) {
  const [collapsed, setCollapsed] = useState(false);
  const fieldView = data.fieldView || "all";
  const entityType = data.type || "table";
  const colors = TYPE_COLORS[entityType] || TYPE_COLORS.table;
  const fields = Array.isArray(data.fields) ? data.fields : [];
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const classifications = data.classifications || {};

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
    <div className={`w-[280px] rounded-lg border ${colors.border} bg-white shadow-md shadow-slate-200/60 overflow-hidden`}>
      <Handle type="target" position={Position.Left} className="!bg-blue-500 !border-white !w-2 !h-2" />

      {/* Header */}
      <div className={`bg-gradient-to-r ${colors.bg} px-3 py-2 border-b ${colors.border}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary truncate">{data.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`px-1.5 py-0 rounded text-[10px] font-medium uppercase tracking-wider ${colors.badge}`}>
                {entityType}
              </span>
              {relCount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-text-muted">
                  <ArrowRightLeft size={9} />
                  {relCount}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
            className="p-0.5 rounded hover:bg-slate-200/60 text-slate-400 hover:text-slate-700 transition-colors"
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
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
              <span className="font-mono text-slate-800 flex-1 truncate">{field.name}</span>
              <span className="font-mono text-slate-400 text-[10px] shrink-0">{field.type}</span>
              <FieldIcon field={field} entityName={data.name} classifications={classifications} />
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
    </div>
  );
}
