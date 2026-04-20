/* GitBranchDialog — list local branches, switch or create new ones. Opened
   from the branch chip on the Luna project-tabs bar. */
import React, { useEffect, useState } from "react";
import { X, GitBranch, Plus, RefreshCw, AlertCircle, Check } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { fetchGitBranches, fetchGitStatus, createGitBranch } from "../../lib/api";

export default function GitBranchDialog() {
  const { closeModal, addToast } = useUiStore();
  const { activeProjectId, selectProject } = useWorkspaceStore();
  const [branches, setBranches] = useState([]);
  const [current, setCurrent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!activeProjectId) return;
    setLoading(true); setError("");
    try {
      const [list, status] = await Promise.all([
        fetchGitBranches(activeProjectId),
        fetchGitStatus(activeProjectId).catch(() => null),
      ]);
      setBranches(list);
      setCurrent(status?.branch || "");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeProjectId]);

  const switchTo = async (branch, fromRef = "") => {
    if (!activeProjectId) return;
    setBusy(true); setError("");
    try {
      await createGitBranch(activeProjectId, { branch, from: fromRef });
      addToast({ type: "success", message: `Switched to ${branch}` });
      // Refresh project so file list reflects the checked-out branch.
      await selectProject(activeProjectId);
      setCurrent(branch);
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const name = newBranch.trim();
    if (!name) return;
    await switchTo(name, current);
    setNewBranch("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
      <div className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl w-[460px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <GitBranch size={16} className="text-accent-blue" />
            Git Branches
          </h3>
          <button onClick={closeModal} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 text-xs text-status-error bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle size={12} /> {error}
            </div>
          )}

          {loading ? (
            <div className="text-xs text-text-muted flex items-center gap-2 py-4 justify-center">
              <RefreshCw size={12} className="animate-spin" /> Loading branches…
            </div>
          ) : (
            <>
              <div className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Local branches</div>
              <div className="max-h-[280px] overflow-auto border border-border-primary rounded-md">
                {branches.length === 0 && (
                  <div className="px-3 py-4 text-xs text-text-muted text-center">No branches found.</div>
                )}
                {branches.map((b) => (
                  <button
                    key={b}
                    onClick={() => b !== current && switchTo(b)}
                    disabled={busy || b === current}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs border-b border-border-primary/60 last:border-0 text-left transition-colors ${
                      b === current
                        ? "bg-accent-blue/10 text-text-primary cursor-default"
                        : "hover:bg-bg-hover text-text-secondary disabled:opacity-40"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-mono">
                      <GitBranch size={11} className={b === current ? "text-accent-blue" : "text-text-muted"} />
                      {b}
                    </span>
                    {b === current && <Check size={12} className="text-accent-blue" />}
                  </button>
                ))}
              </div>

              <form onSubmit={handleCreate} className="flex items-center gap-2 pt-2 border-t border-border-primary">
                <Plus size={12} className="text-text-muted" />
                <input
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value.replace(/\s/g, "-"))}
                  placeholder="new-branch-name"
                  className="flex-1 bg-bg-primary border border-border-primary rounded-md px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue font-mono"
                />
                <button
                  type="submit"
                  disabled={busy || !newBranch.trim()}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors disabled:opacity-50"
                >
                  Create from {current || "HEAD"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
