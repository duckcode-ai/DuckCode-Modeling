import React, { useEffect, useRef } from "react";
import { Edit3, Trash2, Copy, Crosshair, Plus, LayoutGrid } from "lucide-react";

export default function CanvasContextMenu({ menu, onClose, onAction }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!menu) return;
    const onDocMouse = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const items = menu.target === "entity"
    ? [
        { id: "edit", label: "Edit entity", icon: Edit3 },
        { id: "duplicate", label: "Duplicate", icon: Copy },
        { id: "locate", label: "Locate in tree", icon: Crosshair },
        {
          id: "toggle-diagram",
          label: menu.inActiveDiagram ? "Remove from diagram" : "Add to diagram",
          icon: LayoutGrid,
        },
        { id: "delete", label: "Delete entity", icon: Trash2, danger: true },
      ]
    : menu.target === "relationship"
    ? [
        { id: "edit", label: "Edit relationship", icon: Edit3 },
        { id: "delete", label: "Delete relationship", icon: Trash2, danger: true },
      ]
    : menu.target === "enum"
    ? [
        { id: "edit", label: "Edit enum", icon: Edit3 },
        { id: "delete", label: "Delete enum", icon: Trash2, danger: true },
      ]
    : [
        { id: "add-entity", label: "New entity…", icon: Plus },
        { id: "fit", label: "Fit diagram", icon: Crosshair },
      ];

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] rounded-md border border-border-primary bg-bg-surface shadow-xl py-1"
      style={{ top: menu.y, left: menu.x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map(({ id, label, icon: Icon, danger }) => (
        <button
          key={id}
          onClick={() => {
            onAction(id, menu);
            onClose();
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
            danger
              ? "text-status-error hover:bg-status-error/10"
              : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          }`}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}
