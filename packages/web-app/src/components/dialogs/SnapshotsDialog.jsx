/* SnapshotsDialog — versioned diagram snapshots, backed by git tags.
 *
 * A "snapshot" is a lightweight-annotated tag on the current HEAD. The
 * user types a name (e.g. `v1.2-review`) and an optional message; we
 * call POST /api/git/tags which runs `git tag -a`. Existing tags show
 * in a list with commit hash, date, and subject line, each row offering
 * a Delete action (local only — remote cleanup requires the separate
 * push flow).
 *
 * Design mirrors GitBranchDialog and ExportDdlDialog: Modal chrome +
 * primary-action row at the top + result list below. Kept deliberately
 * minimal for v0.5.0 — a "restore this snapshot" flow would require a
 * detached-HEAD checkout and is a power-user path we'll add later.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Tag, Plus, RefreshCw, Trash2, AlertCircle, Check, GitBranch } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { fetchGitTags, createGitTag, deleteGitTag } from "../../lib/api";
import Modal from "./Modal";

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function SnapshotsDialog() {
  const { closeModal, addToast } = useUiStore();
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);

  const [tags, setTags]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const [newName, setNewName]       = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [creating, setCreating]     = useState(false);

  const refresh = async () => {
    if (!activeProjectId) return;
    setLoading(true); setError("");
    try {
      const list = await fetchGitTags(activeProjectId);
      setTags(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeProjectId]);

  const create = async () => {
    const name = newName.trim();
    if (!name) { setError("Snapshot name is required"); return; }
    if (!activeProjectId) { setError("No active project"); return; }
    setCreating(true); setError("");
    try {
      const res = await createGitTag(activeProjectId, { name, message: newMessage.trim() || undefined });
      if (res?.tag) {
        setTags((prev) => [res.tag, ...prev.filter((t) => t.name !== res.tag.name)]);
      } else {
        await refresh();
      }
      setNewName("");
      setNewMessage("");
      addToast?.({ type: "success", message: `Snapshot "${name}" created` });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (name) => {
    if (!window.confirm(`Delete snapshot "${name}"? This only removes the local tag — any pushed copy remains on the remote until you run \`git push --delete origin ${name}\`.`)) return;
    try {
      await deleteGitTag(activeProjectId, name);
      setTags((prev) => prev.filter((t) => t.name !== name));
      addToast?.({ type: "info", message: `Snapshot "${name}" deleted locally` });
    } catch (err) {
      setError(err.message || String(err));
    }
  };

  const suggested = useMemo(() => {
    // Suggest the next increment of the highest vN.M-style tag, else a
    // date-stamped fallback so the input is never empty.
    const versions = tags
      .map((t) => t.name)
      .map((n) => n.match(/^v?(\d+)\.(\d+)/))
      .filter(Boolean)
      .map((m) => [Number(m[1]), Number(m[2])]);
    if (versions.length) {
      const [maj, min] = versions.reduce((a, b) => (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? a : b));
      return `v${maj}.${min + 1}`;
    }
    const today = new Date().toISOString().slice(0, 10);
    return `v1.0-${today}`;
  }, [tags]);

  const canCreate = !!activeProjectId && !creating && !loading;

  return (
    <Modal
      icon={<Tag size={14} />}
      title="Snapshots"
      subtitle="Tag the current state for stakeholder review · backed by git tags"
      size="md"
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal}>Close</button>
          <button type="button" className="panel-btn" onClick={refresh} disabled={loading}>
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </>
      }
    >
      {!activeProjectId && (
        <div className="dlx-modal-alert">
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Open a project first.</span>
        </div>
      )}

      {activeProjectId && (
        <>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto",
            gap: 8,
            alignItems: "end",
            padding: "10px 12px",
            background: "var(--bg-1)",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            marginBottom: 12,
          }}>
            <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-secondary)" }}>
              <span>Snapshot name</span>
              <input
                type="text"
                className="panel-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                placeholder={suggested}
                spellCheck={false}
                autoCapitalize="off"
                style={{ fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-secondary)" }}>
              <span>Message (optional)</span>
              <input
                type="text"
                className="panel-input"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                placeholder="Q2 review · locked schema for BI team"
              />
            </label>
            <button
              type="button"
              className="panel-btn primary"
              onClick={create}
              disabled={!canCreate || !newName.trim()}
              style={{ height: 28, justifyContent: "center" }}
            >
              {creating ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}
              Create
            </button>
          </div>

          {error && (
            <div className="dlx-modal-alert">
              <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
            textTransform: "uppercase", color: "var(--text-tertiary)",
            padding: "6px 2px 8px",
          }}>
            {tags.length ? `${tags.length} snapshot${tags.length === 1 ? "" : "s"}` : "No snapshots yet"}
          </div>

          {tags.length === 0 && !loading && (
            <p className="dlx-modal-hint" style={{ marginTop: 0 }}>
              Snapshots tag the current commit so stakeholders can reference
              a frozen version of the model. Commit your changes first, then
              create a snapshot above. Tags push to the remote via{" "}
              <code>git push --tags</code> (or the commit dialog's push step).
            </p>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            {tags.map((t) => (
              <div key={t.name} style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                border: "1px solid var(--border-default)",
                borderRadius: 6,
                background: "var(--bg-2)",
              }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "3px 7px",
                  border: "1px solid var(--accent)",
                  borderRadius: 4,
                  background: "var(--accent-dim)",
                  color: "var(--accent)",
                  fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)",
                  fontSize: 11, fontWeight: 600,
                }}>
                  <Tag size={10} /> {t.name}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.subject || <em style={{ color: "var(--text-tertiary)" }}>(no message)</em>}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)", display: "flex", gap: 8 }}>
                    <span><GitBranch size={9} style={{ verticalAlign: "-1px" }} /> {t.commit}</span>
                    <span>{formatDate(t.date)}</span>
                    {!t.annotated && <span style={{ color: "var(--text-muted)" }}>(lightweight)</span>}
                  </span>
                </div>
                <button
                  type="button"
                  className="panel-btn"
                  onClick={() => remove(t.name)}
                  title="Delete local tag"
                  style={{ padding: "3px 8px" }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
