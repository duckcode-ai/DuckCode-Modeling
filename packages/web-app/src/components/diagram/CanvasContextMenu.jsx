import React, { useEffect, useRef } from "react";
import { Edit3, Trash2, Copy, Crosshair, Plus, LayoutDashboard, Wand2 } from "lucide-react";

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
        { id: "ask-ai", label: "Ask AI about entity", icon: Wand2 },
        { id: "edit", label: "Edit entity", icon: Edit3 },
        { id: "duplicate", label: "Duplicate", icon: Copy },
        { id: "locate", label: "Locate in tree", icon: Crosshair },
        { id: "delete", label: "Delete entity", icon: Trash2, danger: true },
      ]
    : menu.target === "relationship"
    ? [
        { id: "ask-ai", label: "Ask AI about relationship", icon: Wand2 },
        { id: "edit", label: "Edit relationship", icon: Edit3 },
        { id: "delete", label: "Delete relationship", icon: Trash2, danger: true },
      ]
    : [
        { id: "ask-ai", label: "Generate with AI…", icon: Wand2 },
        { id: "add-entity", label: "New entity…", icon: Plus },
        ...(menu.isDiagram ? [{ id: "add-entities", label: "Add entities to diagram…", icon: LayoutDashboard }] : []),
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
