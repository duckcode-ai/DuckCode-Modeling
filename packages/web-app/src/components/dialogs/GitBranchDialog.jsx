/* GitBranchDialog — list local branches, switch, or create new ones.
   Opened from the branch chip on the project-tabs bar. Distinct from
   CommitDialog (which handles stage+commit+push); this one is the branch
   switcher. Ported to the shared `<Modal>` chrome. */
import React, { useEffect, useState } from "react";
import {
  GitBranch, Plus, RefreshCw, AlertCircle, Check,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import {
  fetchGitBranches,
  fetchGitStatus,
  createGitBranch,
} from "../../lib/api";
import Modal from "./Modal";

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
    <Modal
      icon={<GitBranch size={14} />}
      title="Git Branches"
      subtitle={current ? `Current: ${current}` : "Switch or create a branch."}
      size="md"
      onClose={closeModal}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      footer={
        <button
          type="button"
          className="panel-btn"
          onClick={closeModal}
          disabled={busy}
        >
          Close
        </button>
      }
    >
      {error && (
        <div className="dlx-modal-alert">
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="dlx-modal-hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <RefreshCw size={12} className="animate-spin" /> Loading branches…
        </div>
      ) : (
        <>
          <div className="dlx-modal-section">
            <div className="dlx-modal-section-heading">Local branches</div>
            <div className="dlx-branch-list">
              {branches.length === 0 && (
                <div className="dlx-branch-empty">No branches found.</div>
              )}
              {branches.map((b) => {
                const isCurrent = b === current;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => !isCurrent && switchTo(b)}
                    disabled={busy || isCurrent}
                    className={`dlx-branch-row ${isCurrent ? "current" : ""}`}
                  >
                    <GitBranch size={11} />
                    <span className="dlx-branch-name">{b}</span>
                    {isCurrent && <Check size={12} className="dlx-branch-check" />}
                  </button>
                );
              })}
            </div>
          </div>

          <form className="dlx-modal-section" onSubmit={handleCreate}>
            <div className="dlx-modal-section-heading">New branch</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="panel-input"
                style={{ flex: 1, fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)" }}
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value.replace(/\s/g, "-"))}
                placeholder="feature/my-branch"
              />
              <button
                type="submit"
                className="panel-btn primary"
                disabled={busy || !newBranch.trim()}
                title={`Create from ${current || "HEAD"}`}
              >
                <Plus size={11} />
                Create
              </button>
            </div>
            <p className="dlx-modal-hint">
              Creates a new branch from <code>{current || "HEAD"}</code> and switches to it.
            </p>
          </form>
        </>
      )}
    </Modal>
  );
}
