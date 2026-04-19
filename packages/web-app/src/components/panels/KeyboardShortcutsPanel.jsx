import React from "react";
import { Keyboard, X } from "lucide-react";

const SHORTCUT_GROUPS = [
  {
    title: "General",
    shortcuts: [
      { keys: ["⌘", "S"], description: "Save current file" },
      { keys: ["⌘", "K"], description: "Open global search" },
      { keys: ["⌘", "\\"], description: "Toggle sidebar" },
      { keys: ["⌘", "J"], description: "Toggle bottom panel" },
      { keys: ["⌘", "D"], description: "Toggle dark mode" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
      { keys: ["Esc"], description: "Close modal / exit fullscreen" },
    ],
  },
  {
    title: "Diagram",
    shortcuts: [
      { keys: ["⌘", "F"], description: "Search entities in diagram" },
      { keys: ["⌘", "E"], description: "Export diagram as PNG" },
      { keys: ["⌘", "Shift", "E"], description: "Export diagram as SVG" },
      { keys: ["F"], description: "Fit diagram to view" },
      { keys: ["G"], description: "Toggle subject area groups" },
    ],
  },
  {
    title: "Editor",
    shortcuts: [
      { keys: ["⌘", "Z"], description: "Undo" },
      { keys: ["⌘", "Shift", "Z"], description: "Redo" },
      { keys: ["Ctrl", "Space"], description: "Trigger autocomplete" },
      { keys: ["Tab"], description: "Indent / accept completion" },
    ],
  },
];

export default function KeyboardShortcutsPanel({ onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-bg-primary border border-border-primary rounded-xl shadow-2xl w-[520px] max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-accent-blue" />
            <h2 className="text-sm font-semibold text-text-primary">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[60vh] p-5 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-bg-hover transition-colors"
                  >
                    <span className="text-xs text-text-secondary">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, j) => (
                        <React.Fragment key={j}>
                          {j > 0 && <span className="text-[9px] text-text-muted">+</span>}
                          <kbd className="px-1.5 py-0.5 rounded bg-bg-tertiary border border-border-primary text-[10px] font-mono font-medium text-text-primary min-w-[22px] text-center shadow-sm">
                            {key}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-border-primary bg-bg-secondary/30">
          <p className="text-[10px] text-text-muted text-center">
            Press <kbd className="px-1 py-0.5 rounded bg-bg-tertiary border border-border-primary text-[9px] font-mono">?</kbd> anywhere to toggle this panel
          </p>
        </div>
      </div>
    </div>
  );
}
