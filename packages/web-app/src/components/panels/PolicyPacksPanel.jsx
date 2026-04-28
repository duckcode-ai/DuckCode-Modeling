/* PolicyPacksPanel — list + edit custom policy packs that live under
   <project>/.datalex/policies/. Backed by GET/PUT /api/policy/packs.

   The panel is intentionally lean: a left rail of pack files, a textarea
   for the active pack, and a save button. Schema validation is enforced
   server-side by the policy engine on save; the editor doesn't try to
   replicate the JSON schema in JS. */
import React, { useEffect, useMemo, useState } from "react";
import { Shield, Save, RefreshCcw, Plus, FileText } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { fetchPolicyPacks, savePolicyPack } from "../../lib/api";
import { PanelFrame, PanelSection, PanelEmpty, PanelCard, StatusPill } from "./PanelFrame";

const STARTER_PACK = `pack:
  name: my-org-standards
  version: 0.1.0
  description: Org-specific dbt modeling rules.
  extends: datalex/standards/base.yaml

policies:
  - id: stg_naming
    type: regex_per_layer
    severity: warn
    params:
      patterns:
        stg: "^stg_[a-z][a-z0-9_]*$"

  - id: fct_meta_keys
    type: required_meta_keys
    severity: warn
    params:
      keys: [owner, grain]
      selectors:
        layer: fct
`;

export default function PolicyPacksPanel() {
  const { activeProjectId } = useWorkspaceStore();
  const { addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();

  const [loading, setLoading] = useState(false);
  const [packs, setPacks] = useState([]);
  const [activeName, setActiveName] = useState("");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const reload = async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const result = await fetchPolicyPacks(activeProjectId);
      setPacks(result.packs || []);
      if (!activeName && result.packs?.length) {
        setActiveName(result.packs[0].name);
        setDraft(result.packs[0].content);
      }
    } catch (err) {
      addToast?.({ type: "error", message: `Failed to load policy packs: ${err?.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setActiveName("");
    setDraft("");
    setDirty(false);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  const activePack = useMemo(() => packs.find((p) => p.name === activeName) || null, [packs, activeName]);

  const selectPack = (name) => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    const pack = packs.find((p) => p.name === name);
    if (!pack) return;
    setActiveName(name);
    setDraft(pack.content);
    setDirty(false);
  };

  const handleSave = async () => {
    if (!activePack || !canEdit) return;
    try {
      await savePolicyPack(activeProjectId, { name: activePack.name, content: draft });
      addToast?.({ type: "success", message: `Saved ${activePack.name}.` });
      setDirty(false);
      await reload();
    } catch (err) {
      addToast?.({ type: "error", message: `Save failed: ${err?.message || err}` });
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    if (!/^[A-Za-z0-9._-]+\.(ya?ml)$/i.test(name)) {
      addToast?.({ type: "error", message: "Name must be a *.yaml or *.yml filename without slashes." });
      return;
    }
    try {
      await savePolicyPack(activeProjectId, { name, content: STARTER_PACK });
      addToast?.({ type: "success", message: `Created ${name}.` });
      setCreating(false);
      setNewName("");
      await reload();
      setActiveName(name);
      setDraft(STARTER_PACK);
      setDirty(false);
    } catch (err) {
      addToast?.({ type: "error", message: `Create failed: ${err?.message || err}` });
    }
  };

  if (!activeProjectId) {
    return (
      <PanelFrame icon={<Shield size={14} />} eyebrow="Standards" title="Policy Packs">
        <PanelEmpty
          icon={Shield}
          title="No project open"
          description="Open a DataLex project to view custom policy packs under .datalex/policies/."
        />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      icon={<Shield size={14} />}
      eyebrow="Standards"
      title="Policy Packs"
      subtitle={loading ? "Loading…" : `${packs.length} pack${packs.length === 1 ? "" : "s"} in .datalex/policies/`}
      actions={
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={reload}
            title="Refresh"
            className="px-2 py-1 rounded-md text-xs text-text-muted hover:bg-bg-hover"
          >
            <RefreshCcw size={11} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="px-2 py-1 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80"
            >
              <Plus size={11} style={{ display: "inline", marginRight: 4 }} /> New pack
            </button>
          )}
        </div>
      }
    >
      {creating && (
        <PanelSection title="Create pack" icon={<Plus size={11} />}>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my-rules.yaml"
              className="flex-1 bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue"
            />
            <button
              type="button"
              onClick={handleCreate}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(""); }}
              className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:bg-bg-hover"
            >
              Cancel
            </button>
          </div>
        </PanelSection>
      )}

      {packs.length === 0 ? (
        <PanelEmpty
          icon={Shield}
          title="No policy packs yet"
          description="Custom rules live under <project>/.datalex/policies/. Create your first pack to encode org-specific naming, meta, and contract conventions."
        />
      ) : (
        <PanelSection title="Packs" count={packs.length}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 2fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {packs.map((pack) => (
                <button
                  key={pack.name}
                  type="button"
                  onClick={() => selectPack(pack.name)}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                    activeName === pack.name
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border-primary hover:bg-bg-hover"
                  }`}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <FileText size={11} />
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{pack.name}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
                    {pack.path}
                  </div>
                </button>
              ))}
            </div>

            {activePack && (
              <PanelCard
                title={activePack.name}
                subtitle={activePack.path}
                actions={
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {dirty && <StatusPill tone="warning">unsaved</StatusPill>}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={!dirty}
                        className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-50"
                      >
                        <Save size={11} style={{ display: "inline", marginRight: 4 }} />
                        Save
                      </button>
                    )}
                  </div>
                }
              >
                <textarea
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
                  readOnly={!canEdit}
                  rows={20}
                  spellCheck={false}
                  className="w-full font-mono text-xs bg-bg-primary border border-border-primary rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent-blue"
                  style={{ minHeight: 320 }}
                />
              </PanelCard>
            )}
          </div>
        </PanelSection>
      )}
    </PanelFrame>
  );
}
