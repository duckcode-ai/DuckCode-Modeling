import React, { useMemo, useState } from "react";
import { X, Link2 } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import useDiagramStore from "../../stores/diagramStore";
import { addRelationship } from "../../lib/yamlRoundTrip";

const CARDINALITY_OPTIONS = [
  { value: "one_to_many",  label: "One to many (1:N)" },
  { value: "many_to_one",  label: "Many to one (N:1)" },
  { value: "one_to_one",   label: "One to one (1:1)" },
  { value: "many_to_many", label: "Many to many (N:N)" },
];

export default function NewRelationshipDialog() {
  const { closeModal, addToast } = useUiStore();
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { model } = useDiagramStore();

  const entityNames = useMemo(
    () => (model?.entities || []).map((e) => e.name).sort(),
    [model],
  );

  const [name, setName] = useState("");
  const [from, setFrom] = useState(entityNames[0] || "");
  const [to, setTo] = useState(entityNames[1] || "");
  const [cardinality, setCardinality] = useState("one_to_many");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return setError("Name is required");
    if (!from || !to) return setError("Select both endpoints");
    if (from === to) return setError("From and To must be different entities");
    if (!activeFileContent) return setError("No active model file");

    const result = addRelationship(activeFileContent, trimmedName, from, to, cardinality);
    if (result.error) return setError(result.error);
    updateContent(result.yaml);
    addToast?.({ type: "success", message: `Created relationship "${trimmedName}"` });
    closeModal();
  };

  const disabled = entityNames.length < 2;

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
            <Link2 size={16} className="text-accent-blue" />
            New Relationship
          </h3>
          <button
            onClick={closeModal}
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {disabled ? (
          <div className="p-6 text-sm text-text-muted">
            You need at least two entities before you can add a relationship.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-3">
            <div>
              <label className="text-xs text-text-muted font-medium block mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-accent-blue"
                placeholder="customer_to_order"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-text-muted font-medium block mb-1">From</label>
                <select
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
                >
                  {entityNames.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-text-muted font-medium block mb-1">To</label>
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
                >
                  {entityNames.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-text-muted font-medium block mb-1">Cardinality</label>
              <select
                value={cardinality}
                onChange={(e) => setCardinality(e.target.value)}
                className="w-full bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
              >
                {CARDINALITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

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
        )}
      </div>
    </div>
  );
}
