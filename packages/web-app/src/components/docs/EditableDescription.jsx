/* EditableDescription — click-to-edit description block for the Docs view.
 *
 * Displays markdown by default; click pencil (or empty placeholder) to
 * swap in a textarea. On blur OR ⌘/Ctrl+Enter we call `onSave(newText)`
 * which is expected to dispatch a `yamlPatch` op + `updateContent`.
 *
 * Mirrors the inline-edit pattern already used in `inspector/ColumnsView.jsx`
 * (`<input onBlur={...applyPatch}>`) so the UX feels consistent — but
 * uses a textarea for multi-line description prose.
 */
import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Pencil, Check, X } from "lucide-react";

export default function EditableDescription({
  value = "",
  placeholder = "No description yet — click to add.",
  onSave,
  multiline = true,
  ariaLabel,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  // Sync draft to incoming value when not editing — so AI-driven YAML
  // updates appear in the textarea if the user opens it next.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, [editing]);

  const commit = () => {
    const trimmed = String(draft || "").trim();
    if (trimmed !== String(value || "").trim()) {
      onSave?.(trimmed);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          ref={ref}
          className="panel-input"
          aria-label={ariaLabel || "Description"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          rows={multiline ? Math.max(3, (draft.match(/\n/g) || []).length + 2) : 1}
          style={{
            width: "100%",
            fontSize: 13.5,
            lineHeight: 1.55,
            padding: "8px 10px",
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, color: "var(--text-tertiary)" }}>
          <span><kbd>⌘/Ctrl + Enter</kbd> save · <kbd>Esc</kbd> cancel</span>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); commit(); }}
            title="Save"
            style={{ background: "transparent", border: "none", color: "var(--accent, #3b82f6)", cursor: "pointer", padding: 4 }}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); cancel(); }}
            title="Cancel"
            style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 4 }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  const display = String(value || "").trim();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      title="Click to edit"
      aria-label={ariaLabel ? `Edit ${ariaLabel}` : "Edit description"}
      style={{
        position: "relative",
        cursor: "text",
        padding: "6px 26px 6px 10px",
        margin: "0 -10px",
        borderRadius: 6,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-2, rgba(255,255,255,0.04))")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {display ? (
        <div className="datalex-md-prose" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          <ReactMarkdown>{display}</ReactMarkdown>
        </div>
      ) : (
        <span style={{ fontSize: 13.5, color: "var(--text-tertiary)", fontStyle: "italic" }}>
          {placeholder}
        </span>
      )}
      <Pencil
        size={11}
        style={{
          position: "absolute",
          top: 8,
          right: 6,
          opacity: 0.4,
          color: "var(--text-tertiary)",
        }}
      />
    </div>
  );
}
