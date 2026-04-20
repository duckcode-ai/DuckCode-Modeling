/* EnumsView — dedicated enum manager surface. Fills the main canvas cell
   when the top-bar view switcher selects "Enums". Promotes today's cramped
   Libraries-panel enum section into a first-class page: each enum is its
   own PanelCard with an inline chip editor (add value, remove value,
   reorder implicitly by input order). New-enum form pinned at the top.

   Uses `addEnum`, `updateEnumValues`, `removeEnum` from yamlRoundTrip so
   changes round-trip through YAML like every other model mutation. */
import React, { useMemo, useState } from "react";
import { ListChecks, Plus, Trash2, X, Check } from "lucide-react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import {
  addEnum,
  updateEnumValues,
  removeEnum,
} from "../../lib/yamlRoundTrip";
import {
  PanelFrame,
  PanelCard,
  PanelEmpty,
  PanelToolbar,
  StatusPill,
} from "../../components/panels/PanelFrame";

function parseEnums(text) {
  try {
    const doc = yaml.load(text);
    if (!doc || typeof doc !== "object") return [];
    return Array.isArray(doc.enums) ? doc.enums : [];
  } catch (_e) {
    return [];
  }
}

/* Per-enum chip editor: shows existing values as chips (click × to remove),
   plus an input that adds on Enter. Delegates the actual YAML mutation to
   the parent via `onChange(nextValues)`. */
function EnumChipEditor({ values, onChange }) {
  const [draft, setDraft] = useState("");

  const addValue = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  };

  const removeValue = (v) => {
    onChange(values.filter((x) => x !== v));
  };

  return (
    <div>
      <div className="panel-chip-list" style={{ padding: 0, marginBottom: 8 }}>
        {values.length === 0 && <span className="panel-chip empty">No values yet</span>}
        {values.map((v) => (
          <span
            key={v}
            className="panel-chip"
            style={{ gap: 6, paddingRight: 4 }}
          >
            {v}
            <button
              onClick={() => removeValue(v)}
              title={`Remove ${v}`}
              style={{
                border: 0,
                background: "transparent",
                color: "var(--text-tertiary)",
                padding: 2,
                cursor: "pointer",
                display: "inline-flex",
                borderRadius: 3,
              }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="panel-input"
          placeholder="Add value… (Enter)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue();
            }
          }}
          style={{ flex: 1 }}
        />
        <button
          className="panel-btn"
          onClick={addValue}
          disabled={!draft.trim()}
          title="Add value"
        >
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}

export default function EnumsView() {
  const { activeFileContent, updateContent, activeFile } = useWorkspaceStore();
  const addToast = useUiStore((s) => s.addToast);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newValues, setNewValues] = useState("");

  const allEnums = useMemo(() => parseEnums(activeFileContent), [activeFileContent]);
  const enums = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allEnums;
    return allEnums.filter((e) => {
      const hay = `${e.name} ${(e.values || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allEnums, query]);

  const guardFile = () => {
    if (!activeFile) {
      addToast({ type: "error", message: "Open a file first." });
      return false;
    }
    return true;
  };

  const handleCreate = () => {
    if (!guardFile()) return;
    const name = newName.trim();
    if (!name) {
      addToast({ type: "error", message: "Enum name is required." });
      return;
    }
    if (allEnums.some((e) => String(e.name).toLowerCase() === name.toLowerCase())) {
      addToast({ type: "error", message: `Enum “${name}” already exists.` });
      return;
    }
    const values = newValues
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const next = addEnum(activeFileContent, name, values);
    if (next == null) {
      addToast({ type: "error", message: "Could not add enum — invalid YAML." });
      return;
    }
    updateContent(next);
    addToast({ type: "success", message: `Added enum “${name}”.` });
    setNewName("");
    setNewValues("");
  };

  const handleUpdateValues = (name, nextValues) => {
    if (!guardFile()) return;
    const next = updateEnumValues(activeFileContent, name, nextValues);
    if (next == null) {
      addToast({ type: "error", message: "Could not update enum — invalid YAML." });
      return;
    }
    updateContent(next);
  };

  const handleRemove = (name) => {
    if (!guardFile()) return;
    if (!window.confirm(`Delete enum “${name}”? Fields referencing it will keep their type as-is.`)) return;
    const next = removeEnum(activeFileContent, name);
    if (next == null) {
      addToast({ type: "error", message: "Could not delete — invalid YAML." });
      return;
    }
    updateContent(next);
    addToast({ type: "success", message: `Deleted enum “${name}”.` });
  };

  const toolbar = (
    <PanelToolbar
      left={
        <input
          className="panel-input"
          placeholder="Search enums or values…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      }
      right={
        <div style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
          {allEnums.length} total · {allEnums.reduce((n, e) => n + (e.values || []).length, 0)} values
        </div>
      }
    />
  );

  return (
    <div className="shell-view">
      <PanelFrame
        icon={<ListChecks size={14} />}
        eyebrow="Libraries"
        title="Enums"
        subtitle="Named string domains referenced by entity fields. Added values round-trip through YAML."
        toolbar={toolbar}
      >
        {/* New-enum form pinned at the top */}
        <PanelCard
          tone="accent"
          icon={<Plus size={14} />}
          title="New enum"
          subtitle="Name plus an optional initial list of values (comma- or newline-separated)."
        >
          <div className="panel-form-grid">
            <div className="panel-form-row">
              <label className="panel-form-label">Name</label>
              <input
                className="panel-input"
                placeholder="e.g. order_status"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="panel-form-row" style={{ gridColumn: "span 2" }}>
              <label className="panel-form-label">Initial values</label>
              <textarea
                className="panel-textarea"
                placeholder="pending, confirmed, cancelled"
                value={newValues}
                onChange={(e) => setNewValues(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <div className="panel-btn-row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
            <button
              className="panel-btn"
              onClick={() => {
                setNewName("");
                setNewValues("");
              }}
              disabled={!newName && !newValues}
            >
              Reset
            </button>
            <button
              className="panel-btn primary"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              <Check size={12} /> Add enum
            </button>
          </div>
        </PanelCard>

        <div style={{ height: 12 }} />

        {enums.length === 0 ? (
          <PanelEmpty
            icon={ListChecks}
            title={allEnums.length === 0 ? "No enums yet" : "No matches"}
            description={
              allEnums.length === 0
                ? "Define enums to constrain string fields to a known value set. Values round-trip through YAML."
                : "Adjust your search."
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {enums.map((e) => (
              <PanelCard
                key={e.name}
                icon={<ListChecks size={14} />}
                tone="neutral"
                title={e.name}
                eyebrow={`${(e.values || []).length} value${(e.values || []).length === 1 ? "" : "s"}`}
                actions={
                  <div style={{ display: "inline-flex", gap: 6 }}>
                    <StatusPill tone="neutral">ENUM</StatusPill>
                    <button
                      className="panel-btn danger"
                      onClick={() => handleRemove(e.name)}
                      title="Delete enum"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                }
              >
                <EnumChipEditor
                  values={Array.isArray(e.values) ? e.values : []}
                  onChange={(next) => handleUpdateValues(e.name, next)}
                />
              </PanelCard>
            ))}
          </div>
        )}
      </PanelFrame>
    </div>
  );
}
