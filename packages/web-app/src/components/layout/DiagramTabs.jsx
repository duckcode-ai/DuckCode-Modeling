import React, { useState } from "react";
import { Plus, X, LayoutGrid } from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";

export default function DiagramTabs() {
  const {
    diagrams,
    activeDiagramId,
    selectDiagram,
    addDiagram,
    closeDiagram,
    renameDiagram,
    requestFitDiagram,
  } = useDiagramStore();
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  const handleClick = (id) => {
    if (id === activeDiagramId) {
      requestFitDiagram();
    } else {
      selectDiagram(id);
    }
  };

  const handleClose = (e, id) => {
    e.stopPropagation();
    if (diagrams.length <= 1) return;
    closeDiagram(id);
  };

  const startRename = (e, d) => {
    e.stopPropagation();
    setEditingId(d.id);
    setDraft(d.name);
  };

  const commitRename = () => {
    if (editingId && draft.trim()) renameDiagram(editingId, draft);
    setEditingId(null);
    setDraft("");
  };

  const handleAdd = () => {
    const name = window.prompt("New diagram name", `Diagram ${diagrams.length + 1}`);
    if (name && name.trim()) addDiagram(name.trim());
  };

  return (
    <div className="flex items-center gap-0.5 h-8 px-2 border-t border-border-primary bg-bg-secondary shrink-0 overflow-x-auto">
      <LayoutGrid size={12} strokeWidth={1.75} className="text-text-muted shrink-0 mr-1" />
      {diagrams.map((d) => {
        const isActive = d.id === activeDiagramId;
        const isEditing = editingId === d.id;
        return (
          <div
            key={d.id}
            onClick={() => !isEditing && handleClick(d.id)}
            onDoubleClick={(e) => startRename(e, d)}
            className={`group flex items-center gap-1 h-6 pl-2 pr-1 rounded-t cursor-pointer select-none transition-colors ${
              isActive
                ? "bg-bg-primary text-text-accent border-t border-l border-r border-border-primary"
                : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            }`}
            title="Double-click to rename"
          >
            {isEditing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setEditingId(null);
                    setDraft("");
                  }
                }}
                className="text-xs font-medium px-1 py-0 bg-bg-primary border border-border-primary rounded w-[120px] outline-none focus:border-accent-blue"
              />
            ) : (
              <span className="text-xs font-medium truncate max-w-[140px]">{d.name}</span>
            )}
            {diagrams.length > 1 && !isEditing && (
              <button
                onClick={(e) => handleClose(e, d.id)}
                className="p-0.5 rounded hover:bg-bg-hover text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                title="Close diagram"
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={handleAdd}
        className="ml-0.5 p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
        title="New diagram"
      >
        <Plus size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
