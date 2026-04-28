/* CodeDocsToggle — small 3-way segmented control for the YAML editor pane.
 *
 *   [Docs] [Split] [Code]
 *
 * Lives in `localStorage` rather than a global store so each user's pref
 * survives reloads without polluting the workspace state. A single
 * key — `datalex.editor.viewMode` — drives every editor pane in the app.
 */
import React from "react";
import { FileText, Code2, Columns2 } from "lucide-react";

const KEY = "datalex.editor.viewMode";
export const VIEW_DOCS = "docs";
export const VIEW_SPLIT = "split";
export const VIEW_CODE = "code";

const VALID = new Set([VIEW_DOCS, VIEW_SPLIT, VIEW_CODE]);

export function readViewMode(defaultMode = VIEW_DOCS) {
  try {
    const v = localStorage.getItem(KEY);
    return VALID.has(v) ? v : defaultMode;
  } catch {
    return defaultMode;
  }
}

export function writeViewMode(mode) {
  if (!VALID.has(mode)) return;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode / quota — ignore */
  }
}

export default function CodeDocsToggle({ value, onChange }) {
  const handle = (mode) => {
    writeViewMode(mode);
    onChange?.(mode);
  };

  const baseStyle = {
    background: "transparent",
    border: "1px solid transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    padding: "4px 9px",
    fontSize: 11.5,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    borderRadius: 6,
  };
  const activeStyle = {
    background: "var(--bg-2, rgba(255,255,255,0.06))",
    color: "var(--text-primary)",
    borderColor: "var(--border-default)",
  };

  const item = (mode, label, Icon) => (
    <button
      key={mode}
      type="button"
      onClick={() => handle(mode)}
      title={`${label} view`}
      aria-pressed={value === mode}
      style={{ ...baseStyle, ...(value === mode ? activeStyle : {}) }}
    >
      <Icon size={12} />
      {label}
    </button>
  );

  return (
    <div
      role="group"
      aria-label="Editor view mode"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        background: "var(--bg-1, transparent)",
        borderRadius: 8,
      }}
    >
      {item(VIEW_DOCS, "Docs", FileText)}
      {item(VIEW_SPLIT, "Split", Columns2)}
      {item(VIEW_CODE, "Code", Code2)}
    </div>
  );
}
