/* CommitDialog — stage → commit → optional push for the active project.
   Ported to the shared `<Modal>` chrome + `.panel-*` primitives. Raw HTML
   checkboxes are replaced with the styled `.dlx-commit-file-row` that
   themes correctly across midnight/obsidian/paper/arctic. */
import React, { useEffect, useState } from "react";
import {
  GitCommit, UploadCloud, FileDiff, RefreshCw, AlertCircle, Check,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import {
  fetchGitStatus,
  commitGit,
  pushGitBranch,
} from "../../lib/api";
import Modal from "./Modal";

const STATUS_TONE = {
  A: "accent",   // added
  M: "warn",     // modified
  D: "error",    // deleted
  "?": "muted",  // untracked
  R: "accent",   // renamed
  U: "error",    // unmerged
};

function statusTone(status) {
  const first = String(status || "").trim().charAt(0);
  return STATUS_TONE[first] || "muted";
}

export default function CommitDialog() {
  const { closeModal, addToast } = useUiStore();
  const { activeProjectId, projectConfig, updateProjectConfig } = useWorkspaceStore();
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const autoCommitEnabled = !!projectConfig?.autoCommit?.enabled;
  const [togglingAuto, setTogglingAuto] = useState(false);

  const toggleAutoCommit = async () => {
    setTogglingAuto(true);
    try {
      await updateProjectConfig({
        autoCommit: {
          enabled: !autoCommitEnabled,
          messageTemplate: projectConfig?.autoCommit?.messageTemplate || "DataLex: autosave {path}",
        },
      });
      addToast?.({
        type: "success",
        message: !autoCommitEnabled
          ? "Auto-commit enabled — autosaves now produce commits (2s debounce)."
          : "Auto-commit disabled.",
      });
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Failed to update project config." });
    } finally {
      setTogglingAuto(false);
    }
  };

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

  const toggleAll = () => {
    const all = (status?.files || []).map((f) => f.path);
    if (selected.size === all.length) setSelected(new Set());
    else setSelected(new Set(all));
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
  const allSelected = files.length > 0 && selected.size === files.length;
  const commitDisabled = working || files.length === 0 || !message.trim() || selected.size === 0;

  return (
    <Modal
      icon={<GitCommit size={14} />}
      title="Commit changes"
      subtitle={branch ? `on ${branch}` : "Stage files and write a commit message."}
      size="lg"
      onClose={closeModal}
      closeOnBackdrop={!working}
      closeOnEscape={!working}
      footer={
        <>
          <button
            type="button"
            className="panel-btn"
            onClick={closeModal}
            disabled={working}
          >
            Cancel
          </button>
          <button
            type="button"
            className="panel-btn"
            onClick={() => doCommit(false)}
            disabled={commitDisabled}
          >
            <GitCommit size={12} />
            Commit
          </button>
          <button
            type="button"
            className="panel-btn primary"
            onClick={() => doCommit(true)}
            disabled={commitDisabled}
          >
            <UploadCloud size={12} />
            Commit &amp; Push
          </button>
        </>
      }
    >
      {loading && (
        <div className="dlx-modal-hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <RefreshCw size={12} className="animate-spin" /> Reading git status…
        </div>
      )}

      {!loading && files.length === 0 && !error && (
        <div className="dlx-modal-alert info">
          <Check size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Working tree is clean — no changes to commit.</span>
        </div>
      )}

      {/* Auto-commit toggle — lives in the commit dialog so users who already
          think about commits can discover it. Default off; the debounce
          coalesces bursty autosaves into one commit per project. */}
      {activeProjectId && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px",
            background: "var(--bg-2)",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            marginBottom: 10,
            fontSize: 12,
            color: "var(--text-primary)",
          }}
        >
          <input
            id="autocommit-toggle"
            type="checkbox"
            checked={autoCommitEnabled}
            onChange={toggleAutoCommit}
            disabled={togglingAuto}
          />
          <label htmlFor="autocommit-toggle" style={{ flex: 1, cursor: "pointer" }}>
            <div style={{ fontWeight: 500 }}>Auto-commit on save</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
              Coalesces bursty autosaves into a single commit (2s debounce). Commit failures are surfaced as toasts — the save itself still succeeds.
            </div>
          </label>
        </div>
      )}

      {!loading && files.length > 0 && (
        <div className="dlx-modal-section">
          <div className="dlx-commit-list-header">
            <button
              type="button"
              className="dlx-commit-toggle-all"
              onClick={toggleAll}
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            <span className="dlx-commit-list-count">
              {selected.size} / {files.length} staged
            </span>
          </div>
          <div className="dlx-commit-list">
            {files.map((f) => {
              const on = selected.has(f.path);
              const tone = statusTone(f.status);
              return (
                <label
                  key={f.path}
                  className={`dlx-commit-file-row ${on ? "on" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(f.path)}
                  />
                  <FileDiff size={11} aria-hidden="true" />
                  <span className="dlx-commit-file-path">{f.path}</span>
                  <span className={`dlx-commit-file-status tone-${tone}`}>
                    {String(f.status || "").trim() || "·"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="dlx-modal-section">
        <label className="dlx-modal-field-label" htmlFor="commit-message">
          Commit message
        </label>
        <textarea
          id="commit-message"
          className="panel-textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Describe your change…"
          disabled={working}
        />
      </div>

      {error && (
        <div className="dlx-modal-alert">
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
}
