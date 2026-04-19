import React from "react";
import { Database, ChevronDown, ChevronRight, Waypoints, Table2 } from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";

export default function SubjectAreaGroup({ id, data }) {
  const color = data?.color || { text: "#475569", border: "rgba(100,116,139,0.3)", bg: "rgba(100,116,139,0.08)" };
  const label = data?.label || "";
  const entityCount = typeof data?.entityCount === "number" ? data.entityCount : 0;
  const relCount = typeof data?.relCount === "number" ? data.relCount : 0;
  const toggleSubjectAreaCollapsed = useDiagramStore(
    (s) => s.toggleSubjectAreaCollapsed
  );
  const collapsed = Boolean(data?.collapsed);

  const handleToggle = (e) => {
    e.stopPropagation();
    if (toggleSubjectAreaCollapsed) toggleSubjectAreaCollapsed(label || id);
  };

  if (collapsed) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <button
          type="button"
          onClick={handleToggle}
          onDoubleClick={handleToggle}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border shadow-sm hover:shadow-md transition"
          style={{
            backgroundColor: color.bg || "rgba(100,116,139,0.12)",
            borderColor: color.border,
          }}
          title="Expand subject area"
        >
          <ChevronRight size={12} style={{ color: color.text }} />
          <Database size={12} style={{ color: color.text }} />
          <span
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: color.text }}
          >
            {label}
          </span>
          <span className="flex items-center gap-1 ml-1">
            <span
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold"
              style={{ backgroundColor: "rgba(0,0,0,0.08)", color: color.text }}
              title={`${entityCount} entities`}
            >
              <Table2 size={9} />
              {entityCount}
            </span>
            {relCount > 0 && (
              <span
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                style={{ backgroundColor: "rgba(0,0,0,0.08)", color: color.text }}
                title={`${relCount} relationships`}
              >
                <Waypoints size={9} />
                {relCount}
              </span>
            )}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <button
        type="button"
        onClick={handleToggle}
        onDoubleClick={handleToggle}
        className="absolute top-2 left-3 flex items-center gap-1.5 px-2 py-1 rounded-md hover:ring-1 hover:ring-border-primary transition"
        style={{ backgroundColor: color.bg || "rgba(100,116,139,0.08)" }}
        title="Collapse subject area"
      >
        <ChevronDown size={11} style={{ color: color.text }} />
        <Database size={11} style={{ color: color.text }} />
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: color.text }}
        >
          {label}
        </span>
        <span
          className="text-[10px] font-semibold opacity-70 ml-1 flex items-center gap-1"
          style={{ color: color.text }}
        >
          <span className="flex items-center gap-0.5">
            <Table2 size={9} />
            {entityCount}
          </span>
          {relCount > 0 && (
            <span className="flex items-center gap-0.5">
              <Waypoints size={9} />
              {relCount}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
