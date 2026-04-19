import React, { useEffect, useState } from "react";
import { X, GitCommit, UploadCloud, FileDiff } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import {
  fetchGitStatus,
  commitGit,
  pushGitBranch,
} from "../../lib/api";

export default function CommitDialog() {
  const { closeModal, addToast, userSettings } = useUiStore();
  const { activeProjectId } = useWorkspaceStore();
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState(userSettings?.git?.commitTemplate || "");
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!activeProjectId) return;
    setLoading(true);
    setError("");
    try {
      const s = await fetchGitStatus(activeProjectId);
      setStatus(s);
      setSelected(new Set((s.files || []).map((f) => f.path)));
    } catch (e) {
      setError(e.message || "Failed to read git status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [activeProjectId]);

  const toggle = (path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const doCommit = async (andPush) => {
    if (!activeProjectId || !message.trim()) {
      setError("Commit message is required.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      await commitGit(activeProjectId, {
        message: message.trim(),
        paths: Array.from(selected),
      });
      if (andPush) {
        await pushGitBranch(activeProjectId, {});
        addToast?.({ type: "success", message: "Committed and pushed." });
      } else {
        addToast?.({ type: "success", message: "Committed." });
      }
      closeModal();
    } catch (e) {
      setError(e.message || "Commit failed.");
    } finally {
      setWorking(false);
    }
  };

  const files = status?.files || [];
  const branch = status?.branch || "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={closeModal}
    >
      <div
        className="w-[680px] max-w-[94vw] max-h-[86vh] rounded-xl border border-border-primary bg-bg-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-border-primary bg-bg-secondary shrink-0">
          <div className="flex items-center gap-2">
            <GitCommit size={14} className="text-text-accent" />
            <h2 className="t-subtitle text-text-primary">Commit changes</h2>
            {branch && (
              <span className="text-xs text-text-muted font-mono ml-1">on {branch}</span>
            )}
          </div>
          <button onClick={closeModal} className="dl-toolbar-btn dl-toolbar-btn--ghost-icon" title="Close">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {loading && <div className="text-sm text-text-muted">Reading git status…</div>}
          {!loading && files.length === 0 && (
            <div className="text-sm text-text-muted">No changes to commit.</div>
          )}
          {!loading && files.length > 0 && (
            <div className="rounded-lg border border-border-primary overflow-hidden">
              <div className="t-overline text-text-muted px-3 py-1.5 bg-bg-secondary border-b border-border-primary">
                Changed files ({files.length})
              </div>
              <div className="max-h-[240px] overflow-y-auto">
                {files.map((f) => (
                  <label
                    key={f.path}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-primary hover:bg-bg-hover cursor-pointer border-b border-border-primary/60 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(f.path)}
                      onChange={() => toggle(f.path)}
                    />
                    <FileDiff size={12} className="text-text-muted shrink-0" />
                    <span className="font-mono text-xs truncate">{f.path}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-text-muted">
                      {f.status}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="t-overline text-text-muted mb-1">Message</div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Describe your change…"
              className="w-full text-sm px-3 py-2 rounded-md border border-border-primary bg-bg-primary text-text-primary outline-none focus:border-accent-blue resize-none"
            />
          </div>

          {error && (
            <div className="text-sm text-status-error">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 h-12 border-t border-border-primary bg-bg-secondary shrink-0">
          <button
            onClick={closeModal}
            className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
            disabled={working}
          >
            Cancel
          </button>
          <button
            onClick={() => doCommit(false)}
            className="dl-toolbar-btn"
            disabled={working || files.length === 0 || !message.trim() || selected.size === 0}
          >
            <GitCommit size={13} />
            Commit
          </button>
          <button
            onClick={() => doCommit(true)}
            className="dl-toolbar-btn dl-toolbar-btn--primary"
            disabled={working || files.length === 0 || !message.trim() || selected.size === 0}
          >
            <UploadCloud size={13} />
            Commit & Push
          </button>
        </div>
      </div>
    </div>
  );
}
