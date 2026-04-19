import React, { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { ListChecks } from "lucide-react";

function EnumNodeImpl({ data, selected }) {
  const name = data?.name || "enum";
  const values = Array.isArray(data?.values) ? data.values : [];
  const preview = values.slice(0, 5);
  const overflow = Math.max(0, values.length - preview.length);

  return (
    <div
      className={`rounded-full border bg-accent-purple-soft text-text-accent shadow-sm transition-shadow px-3 py-1.5 flex items-center gap-2 ${
        selected ? "border-accent-purple ring-2 ring-accent-purple/40" : "border-accent-purple/60"
      }`}
      title={values.join(", ")}
      style={{ minWidth: 120 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-accent-purple !border-accent-purple !w-2 !h-2"
      />
      <ListChecks size={12} strokeWidth={2} className="shrink-0" />
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-xs font-semibold truncate">{name}</span>
        {preview.length > 0 && (
          <span className="text-[10px] font-mono text-text-muted truncate">
            {preview.join(" · ")}
            {overflow > 0 ? ` +${overflow}` : ""}
          </span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-accent-purple !border-accent-purple !w-2 !h-2"
      />
    </div>
  );
}

export default memo(EnumNodeImpl);
