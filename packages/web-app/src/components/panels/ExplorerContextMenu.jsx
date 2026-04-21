/* Explorer context menu — opens on right-click of any row in the EXPLORER
 * tab (file, folder, or empty space inside a folder).
 *
 * The menu itself is dumb: it just renders the right button set for its
 * `menu.target` ("file" | "folder" | "root") and emits a semantic action id
 * back to the caller. LeftPanel owns the actual work (calling the
 * workspaceStore CRUD helpers, prompting for names, refreshing the tree)
 * so the menu stays testable without store mocking.
 *
 * Pattern mirrors `design/CanvasContextMenu.jsx` — dismiss on outside click
 * or Escape; position via fixed coordinates from the caller.
 */
import React, { useEffect, useRef } from "react";
import {
  FilePlus,
  FolderPlus,
  Edit3,
  Trash2,
  Scissors,
  LayoutDashboard,
} from "lucide-react";

const ITEMS_BY_TARGET = {
  file: [
    { id: "rename", label: "Rename…", icon: Edit3 },
    { id: "move", label: "Move to folder…", icon: Scissors },
    { id: "delete", label: "Delete file", icon: Trash2, danger: true },
  ],
  folder: [
    { id: "new-file", label: "New file…", icon: FilePlus },
    { id: "new-folder", label: "New folder…", icon: FolderPlus },
    { id: "new-diagram", label: "New diagram here…", icon: LayoutDashboard },
    { id: "rename", label: "Rename folder…", icon: Edit3 },
    { id: "delete", label: "Delete folder", icon: Trash2, danger: true },
  ],
  root: [
    { id: "new-file", label: "New file…", icon: FilePlus },
    { id: "new-folder", label: "New folder…", icon: FolderPlus },
    { id: "new-diagram", label: "New diagram…", icon: LayoutDashboard },
  ],
};

export default function ExplorerContextMenu({ menu, onClose, onAction }) {
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
  const items = ITEMS_BY_TARGET[menu.target] || ITEMS_BY_TARGET.root;

  return (
    <div
      ref={ref}
      className="dlx-ctx-menu"
      style={{
        position: "fixed",
        top: menu.y,
        left: menu.x,
        zIndex: 1000,
        minWidth: 180,
        background: "var(--bg-surface, var(--bg-1))",
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
        padding: "4px 0",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map(({ id, label, icon: Icon, danger }) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            onAction(id, menu);
            onClose();
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            background: "transparent",
            border: "none",
            color: danger ? "var(--status-error, #d44)" : "var(--text-secondary)",
            fontSize: 12,
            textAlign: "left",
            cursor: "pointer",
            transition: "background 80ms var(--ease)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}
