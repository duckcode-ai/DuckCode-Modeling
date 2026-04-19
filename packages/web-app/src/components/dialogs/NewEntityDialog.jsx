import React, { useState } from "react";
import { X, Table2 } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { addEntityWithOptions, addEnum } from "../../lib/yamlRoundTrip";
import { OBJECT_TYPE_DISPLAY_ORDER, getObjectTypeMeta } from "../../lib/objectTypeMeta";

// Unified modal for creating an entity. Opened with modalPayload.type
// ("table" | "view" | "enum" | "dimension" | ...). Enums take a values list;
// everything else routes through addEntityWithOptions.
export default function NewEntityDialog() {
  const { closeModal, modalPayload, addToast } = useUiStore();
  const { activeFileContent, updateContent } = useWorkspaceStore();

  const initialType = String(modalPayload?.type || "table");
  const [name, setName] = useState("");
  const [type, setType] = useState(initialType);
  const [description, setDescription] = useState("");
  const [enumValues, setEnumValues] = useState("");
  const [error, setError] = useState("");

  const typeOptions = OBJECT_TYPE_DISPLAY_ORDER.map((kind) => ({
    value: kind,
    label: getObjectTypeMeta(kind).label,
  }));

  const isEnum = type === "enum";

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    if (!activeFileContent) {
      setError("No active model file");
      return;
    }

    let result;
    if (isEnum) {
      const values = enumValues.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
      if (values.length === 0) {
        setError("Enum needs at least one value");
        return;
      }
      result = addEnum(activeFileContent, trimmedName, values);
    } else {
      result = addEntityWithOptions(activeFileContent, {
        name: trimmedName,
        type,
        description: description.trim(),
      });
    }

    if (result.error) {
      setError(result.error);
      return;
    }
    updateContent(result.yaml);
    addToast?.({ type: "success", message: `Created ${isEnum ? "enum" : type} "${trimmedName}"` });
    closeModal();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={closeModal}
    >
      <div
        className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl w-[420px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Table2 size={16} className="text-accent-blue" />
            New {isEnum ? "Enum" : getObjectTypeMeta(type).label}
          </h3>
          <button
            onClick={closeModal}
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
            >
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
              <option value="enum">Enum</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-text-muted font-medium block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-accent-blue"
              placeholder={isEnum ? "order_status" : "customer"}
              autoFocus
            />
          </div>

          {isEnum ? (
            <div>
              <label className="text-xs text-text-muted font-medium block mb-1">
                Values <span className="text-text-muted/60">(comma or newline separated)</span>
              </label>
              <textarea
                value={enumValues}
                onChange={(e) => setEnumValues(e.target.value)}
                rows={4}
                className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-accent-blue"
                placeholder="placed, paid, shipped, delivered, cancelled"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs text-text-muted font-medium block mb-1">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
                placeholder="Optional"
              />
            </div>
          )}

          {error && <p className="text-xs text-accent-red">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={closeModal}
              className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
