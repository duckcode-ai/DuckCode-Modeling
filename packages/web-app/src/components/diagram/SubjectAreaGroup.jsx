import React from "react";
import { Database, ChevronDown, ChevronRight } from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";

export default function SubjectAreaGroup({ id, data }) {
  const color = data?.color || { text: "#475569", border: "rgba(100,116,139,0.3)" };
  const label = data?.label || "";
  const entityCount = typeof data?.entityCount === "number" ? data.entityCount : null;
  const toggleSubjectAreaCollapsed = useDiagramStore(
    (s) => s.toggleSubjectAreaCollapsed
  );
  const collapsed = Boolean(data?.collapsed);

  const handleToggle = (e) => {
    e.stopPropagation();
    if (toggleSubjectAreaCollapsed) toggleSubjectAreaCollapsed(label || id);
  };

  return (
    <div className="w-full h-full relative">
      <button
        type="button"
        onClick={handleToggle}
        onDoubleClick={handleToggle}
        className="absolute top-2 left-3 flex items-center gap-1.5 px-2 py-1 rounded-md hover:ring-1 hover:ring-border-primary transition"
        style={{ backgroundColor: color.bg || "rgba(100,116,139,0.08)" }}
        title={collapsed ? "Expand subject area" : "Collapse subject area"}
      >
        {collapsed ? (
          <ChevronRight size={11} style={{ color: color.text }} />
        ) : (
          <ChevronDown size={11} style={{ color: color.text }} />
        )}
        <Database size={11} style={{ color: color.text }} />
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: color.text }}
        >
          {label}
        </span>
        {entityCount !== null && (
          <span
            className="text-[10px] font-semibold opacity-70"
            style={{ color: color.text }}
          >
            · {entityCount}
          </span>
        )}
      </button>
    </div>
  );
}
