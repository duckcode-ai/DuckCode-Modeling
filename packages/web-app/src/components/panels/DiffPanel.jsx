/* DiffPanel — the "Diff & Gate" tab in the bottom drawer. Shows two
   things: a semantic-diff gate against a baseline (entities / relationships
   / indexes / metrics added-removed-changed, breaking changes, metric
   contract changes) and a full git workspace console (status, staging,
   unified diff, commit, push/pull, create branch, open PR).

   Laid out on the shared panel-form-* primitives so every input,
   select, button, and label renders through one Luna-aware style
   (same look across midnight / obsidian / paper / arctic). Sections
   are separated by PanelSection; each labelled field follows the
   .panel-form-row > .panel-form-label + .panel-input pattern, and
   every button is a .panel-btn (primary when it is the main action). */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  AlertCircle, CheckCircle2, Plus, Minus, RefreshCw, Shield, GitBranch,
  Loader2, Clock3, FileDiff, Upload, ArrowUpToLine, ArrowDownToLine,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import { runGate } from "../../modelQuality";
import {
  fetchGitStatus, fetchGitDiff, commitGit, fetchGitLog, stageGitFiles,
  unstageGitFiles, createGitBranch, pushGitBranch, pullGitBranch, createGitHubPr,
} from "../../lib/api";
import {
  PanelFrame, PanelSection, PanelCard, StatusPill, KeyValueGrid, PanelEmpty,
} from "./PanelFrame";

function summarizeFileStatus(file) {
  if (!file) return "";
  if (file.status === "untracked") return "untracked";
  const tags = [];
  if (file.stagedStatus && file.stagedStatus !== " ") tags.push(`staged:${file.stagedStatus}`);
  if (file.unstagedStatus && file.unstagedStatus !== " ") tags.push(`unstaged:${file.unstagedStatus}`);
  return tags.join(" · ") || "clean";
}

/* Colourise unified-diff lines using Luna tokens so both themes are happy. */
function DiffBlock({ text, loading }) {
  if (loading) {
    return (
      <div style={{
        padding: "10px 12px", fontSize: 11, color: "var(--text-tertiary)",
        display: "inline-flex", alignItems: "center", gap: 6,
      }}>
        <Loader2 size={12} className="animate-spin" /> Loading diff…
      </div>
    );
  }
  if (!text) {
    return (
      <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-tertiary)" }}>
        No diff output for the current selection.
      </div>
    );
  }
  const lines = text.split("\n");
  return (
    <pre
      style={{
        margin: 0, padding: 8,
        fontFamily: "var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace)",
        fontSize: 11, lineHeight: 1.5,
        color: "var(--text-primary)",
        maxHeight: 260, overflow: "auto",
        background: "var(--bg-canvas, var(--bg-1))",
        whiteSpace: "pre",
      }}
    >
      {lines.map((ln, i) => {
        let bg = "transparent";
        let color = "var(--text-secondary)";
        if (ln.startsWith("+++") || ln.startsWith("---")) {
          color = "var(--text-tertiary)";
        } else if (ln.startsWith("@@")) {
          color = "var(--accent)";
          bg = "var(--accent-dim)";
        } else if (ln.startsWith("+")) {
          color = "var(--cat-billing)";
          bg = "var(--cat-billing-soft)";
        } else if (ln.startsWith("-")) {
          color = "#ef4444";
          bg = "rgba(239, 68, 68, 0.10)";
        }
        return (
          <div key={i} style={{ background: bg, color, padding: "0 6px" }}>
            {ln || " "}
          </div>
        );
      })}
    </pre>
  );
}

/* Little stat box used in the diff-summary grid */
function DiffStat({ label, stats }) {
  return (
    <div className="panel-summary-card" style={{ padding: "8px 10px" }}>
      <div className="label">{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, marginTop: 4 }}>
        {stats.map((s, i) => {
          const color = s.tone === "success" ? "var(--cat-billing)"
                      : s.tone === "error"   ? "#ef4444"
                      : s.tone === "warning" ? "var(--pk)"
                      : "var(--text-secondary)";
          const Icon = s.icon;
          return (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3, color }}>
              <Icon size={10} /> {s.value}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
export default function DiffPanel() {
  const { activeFileContent, baselineContent, activeProjectId, activeFile, offlineMode } = useWorkspaceStore();
  const { addToast } = useUiStore();

  const [allowBreaking, setAllowBreaking] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState("");
  const [gitStatus, setGitStatus] = useState(null);
  const [gitLog, setGitLog] = useState([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [showStagedDiff, setShowStagedDiff] = useState(false);
  const [gitDiffText, setGitDiffText] = useState("");
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitLoading, setCommitLoading] = useState(false);
  const [gitActionLoading, setGitActionLoading] = useState(false);

  const [gitRemote, setGitRemote] = useState("origin");
  const [gitBranchInput, setGitBranchInput] = useState("");
  const [gitBranchLoading, setGitBranchLoading] = useState(false);
  const [gitPushLoading, setGitPushLoading] = useState(false);
  const [gitPullLoading, setGitPullLoading] = useState(false);
  const [gitPushOutput, setGitPushOutput] = useState("");
  const [gitPullOutput, setGitPullOutput] = useState("");

  const [prTitle, setPrTitle] = useState("chore: model updates");
  const [prBase, setPrBase] = useState("main");
  const [prBody, setPrBody] = useState("Automated changes generated/managed in DataLex.");
  const [prToken, setPrToken] = useState("");
  const [prCreating, setPrCreating] = useState(false);
  const [prUrl, setPrUrl] = useState("");

  const gateResult = useMemo(() => {
    if (!activeFileContent || !baselineContent) return null;
    return runGate(baselineContent, activeFileContent, allowBreaking);
  }, [activeFileContent, baselineContent, allowBreaking]);

  const diff = gateResult?.diff;
  const gatePassed = gateResult?.gatePassed;

  /* ── Async handlers (unchanged business logic) ─────────────────────── */
  const loadGitWorkspace = useCallback(async () => {
    if (!activeProjectId || offlineMode) return;
    setGitError(""); setGitLoading(true);
    try {
      const [status, log] = await Promise.all([
        fetchGitStatus(activeProjectId),
        fetchGitLog(activeProjectId, 8),
      ]);
      setGitStatus(status);
      setGitLog(Array.isArray(log.commits) ? log.commits : []);
      const files = Array.isArray(status.files) ? status.files : [];
      const activePath = activeFile?.path || "";
      const hasActive = activePath && files.some((f) => f.path === activePath);
      setSelectedPath((prev) => {
        if (hasActive) return activePath;
        if (prev && files.some((f) => f.path === prev)) return prev;
        if (files.length > 0) return files[0].path;
        return "";
      });
    } catch (err) {
      setGitError(err.message); setGitStatus(null); setGitLog([]);
    } finally {
      setGitLoading(false);
    }
  }, [activeProjectId, activeFile?.path, offlineMode]);

  const loadGitDiffText = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    setGitDiffLoading(true);
    try {
      const data = await fetchGitDiff(activeProjectId, { path: selectedPath || "", staged: showStagedDiff });
      setGitDiffText(data.diff || "");
    } catch (err) {
      setGitDiffText(""); setGitError(err.message);
    } finally {
      setGitDiffLoading(false);
    }
  }, [activeProjectId, offlineMode, gitStatus, selectedPath, showStagedDiff]);

  useEffect(() => { loadGitWorkspace(); }, [loadGitWorkspace]);
  useEffect(() => {
    if (!gitStatus?.branch || gitStatus.branch === "HEAD") return;
    setGitBranchInput((prev) => prev || gitStatus.branch);
  }, [gitStatus?.branch]);
  useEffect(() => { loadGitDiffText(); }, [loadGitDiffText]);

  const onCommit = useCallback(async () => {
    if (!activeProjectId || offlineMode) return;
    const message = commitMessage.trim();
    if (!message) { setGitError("Commit message is required"); return; }
    setGitError(""); setCommitLoading(true);
    try {
      const selectedPaths = selectedPath ? [selectedPath] : [];
      const result = await commitGit(activeProjectId, { message, paths: selectedPaths });
      addToast?.({ type: "success", message: `Committed ${result.commitHash?.slice(0, 7) || ""}`.trim() });
      setCommitMessage("");
      await loadGitWorkspace(); await loadGitDiffText();
    } catch (err) { setGitError(err.message); }
    finally { setCommitLoading(false); }
  }, [activeProjectId, offlineMode, commitMessage, selectedPath, addToast, loadGitWorkspace, loadGitDiffText]);

  const onStage = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const files = Array.isArray(gitStatus.files) ? gitStatus.files : [];
    const paths = selectedPath ? [selectedPath]
      : files.filter((f) => f.status === "untracked" || (f.unstagedStatus && f.unstagedStatus !== " ")).map((f) => f.path);
    if (paths.length === 0) { addToast?.({ type: "info", message: "No files to stage" }); return; }
    setGitActionLoading(true); setGitError("");
    try {
      await stageGitFiles(activeProjectId, paths);
      addToast?.({ type: "success", message: paths.length === 1 ? "Staged 1 file" : `Staged ${paths.length} files` });
      await loadGitWorkspace(); await loadGitDiffText();
    } catch (err) { setGitError(err.message); }
    finally { setGitActionLoading(false); }
  }, [activeProjectId, offlineMode, gitStatus, selectedPath, addToast, loadGitWorkspace, loadGitDiffText]);

  const onUnstage = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const files = Array.isArray(gitStatus.files) ? gitStatus.files : [];
    const paths = selectedPath ? [selectedPath]
      : files.filter((f) => f.stagedStatus && f.stagedStatus !== " ").map((f) => f.path);
    if (paths.length === 0) { addToast?.({ type: "info", message: "No files to unstage" }); return; }
    setGitActionLoading(true); setGitError("");
    try {
      await unstageGitFiles(activeProjectId, paths);
      addToast?.({ type: "success", message: paths.length === 1 ? "Unstaged 1 file" : `Unstaged ${paths.length} files` });
      await loadGitWorkspace(); await loadGitDiffText();
    } catch (err) { setGitError(err.message); }
    finally { setGitActionLoading(false); }
  }, [activeProjectId, offlineMode, gitStatus, selectedPath, addToast, loadGitWorkspace, loadGitDiffText]);

  const onCreateBranch = useCallback(async () => {
    if (!activeProjectId || offlineMode) return;
    const branch = String(gitBranchInput || "").trim();
    if (!branch) { setGitError("Branch name is required"); return; }
    setGitBranchLoading(true); setGitError("");
    try {
      await createGitBranch(activeProjectId, { branch });
      addToast?.({ type: "success", message: "Checked out " + branch });
      await loadGitWorkspace(); await loadGitDiffText();
    } catch (err) { setGitError(err.message); }
    finally { setGitBranchLoading(false); }
  }, [activeProjectId, offlineMode, gitBranchInput, addToast, loadGitWorkspace, loadGitDiffText]);

  const onPush = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const branch = String(gitBranchInput || gitStatus.branch || "").trim();
    if (!branch || branch === "HEAD") { setGitError("Unable to push: detached HEAD"); return; }
    setGitPushLoading(true); setGitError(""); setGitPushOutput("");
    try {
      const result = await pushGitBranch(activeProjectId, { remote: gitRemote || "origin", branch, setUpstream: true });
      setGitPushOutput(result.output || "Push completed");
      addToast?.({ type: "success", message: "Pushed " + branch });
      await loadGitWorkspace(); await loadGitDiffText();
    } catch (err) { setGitError(err.message); }
    finally { setGitPushLoading(false); }
  }, [activeProjectId, offlineMode, gitStatus, gitBranchInput, gitRemote, addToast, loadGitWorkspace, loadGitDiffText]);

  const onPull = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const branch = String(gitBranchInput || gitStatus.branch || "").trim();
    if (!branch || branch === "HEAD") { setGitError("Unable to pull: detached HEAD"); return; }
    setGitPullLoading(true); setGitError(""); setGitPullOutput("");
    try {
      const result = await pullGitBranch(activeProjectId, { remote: gitRemote || "origin", ffOnly: true });
      setGitPullOutput(result.output || "Pull completed");
      addToast?.({ type: "success", message: "Pulled latest changes" });
      await loadGitWorkspace(); await loadGitDiffText();
    } catch (err) { setGitError(err.message); }
    finally { setGitPullLoading(false); }
  }, [activeProjectId, offlineMode, gitStatus, gitBranchInput, gitRemote, addToast, loadGitWorkspace, loadGitDiffText]);

  const onCreatePr = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const token = String(prToken || "").trim();
    if (!token) { setGitError("GitHub token is required to open a PR"); return; }
    const title = String(prTitle || "").trim();
    if (!title) { setGitError("PR title is required"); return; }
    const head = String(gitBranchInput || gitStatus.branch || "").trim();
    if (!head || head === "HEAD") { setGitError("Head branch is required"); return; }
    setPrCreating(true); setGitError(""); setPrUrl("");
    try {
      const pr = await createGitHubPr(activeProjectId, {
        token, title, body: String(prBody || ""),
        base: String(prBase || "main").trim() || "main", head,
        remote: gitRemote || "origin",
      });
      const url = pr?.pullRequest?.url || "";
      setPrUrl(url);
      addToast?.({ type: "success", message: url ? "Opened PR" : "PR created" });
    } catch (err) { setGitError(err.message); }
    finally { setPrCreating(false); }
  }, [activeProjectId, offlineMode, gitStatus, gitBranchInput, gitRemote, prToken, prTitle, prBody, prBase, addToast]);

  /* ── Header actions (refresh + gate pill + allow-breaking toggle) ─── */
  const headerActions = (
    <>
      <label style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 11, color: "var(--text-secondary)", cursor: "pointer",
        padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border-default)",
        background: "var(--bg-1)",
      }}>
        <input
          type="checkbox"
          checked={allowBreaking}
          onChange={(e) => setAllowBreaking(e.target.checked)}
          style={{ width: 12, height: 12, accentColor: "var(--accent)" }}
        />
        Allow breaking
      </label>
      <button
        onClick={loadGitWorkspace}
        disabled={gitLoading || !activeProjectId || offlineMode}
        className="panel-btn"
        title="Refresh git status"
      >
        <RefreshCw size={11} className={gitLoading ? "animate-spin" : ""} />
        Refresh
      </button>
    </>
  );

  const gateStatus = gateResult ? (
    <StatusPill tone={gatePassed ? "success" : "error"} icon={gatePassed ? <CheckCircle2 /> : <AlertCircle />}>
      Gate {gatePassed ? "PASSED" : "FAILED"}
    </StatusPill>
  ) : null;

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <PanelFrame
      icon={<FileDiff size={14} />}
      eyebrow="Quality Check"
      title="Diff & Gate"
      subtitle={activeFile?.name ? `Comparing ${activeFile.name} against baseline` : "Compare against a baseline to surface breaking changes"}
      status={gateStatus}
      actions={headerActions}
    >
      {/* ── Semantic Gate ──────────────────────────────────────────── */}
      <PanelSection title="Semantic Gate" icon={<Shield size={11} />}>
        {!baselineContent ? (
          <PanelCard tone="info" dense>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Select a baseline file to run semantic diff and breaking-change gates.
            </div>
          </PanelCard>
        ) : (
          <>
            {gateResult && (
              <PanelCard tone={gatePassed ? "success" : "error"}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  {gatePassed ? <CheckCircle2 size={14} style={{ color: "var(--cat-billing)" }} /> : <AlertCircle size={14} style={{ color: "#ef4444" }} />}
                  {gateResult.message}
                </div>
              </PanelCard>
            )}

            {diff && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 10 }}>
                  <DiffStat label="Entities" stats={[
                    { icon: Plus, value: diff.summary.added_entities, tone: "success" },
                    { icon: Minus, value: diff.summary.removed_entities, tone: "error" },
                    { icon: RefreshCw, value: diff.summary.changed_entities, tone: "warning" },
                  ]} />
                  <DiffStat label="Relationships" stats={[
                    { icon: Plus, value: diff.summary.added_relationships, tone: "success" },
                    { icon: Minus, value: diff.summary.removed_relationships, tone: "error" },
                  ]} />
                  <DiffStat label="Indexes" stats={[
                    { icon: Plus, value: diff.summary.added_indexes || 0, tone: "success" },
                    { icon: Minus, value: diff.summary.removed_indexes || 0, tone: "error" },
                  ]} />
                  <DiffStat label="Metrics" stats={[
                    { icon: Plus, value: diff.summary.added_metrics || 0, tone: "success" },
                    { icon: Minus, value: diff.summary.removed_metrics || 0, tone: "error" },
                    { icon: RefreshCw, value: diff.summary.changed_metrics || 0, tone: "warning" },
                  ]} />
                </div>

                {(diff.changed_metrics || []).length > 0 && (
                  <PanelSection title="Metric Contract Changes" count={diff.changed_metrics.length}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {diff.changed_metrics.map((m) => (
                        <PanelCard key={m.metric} tone="warning" dense>
                          <div style={{ fontSize: 12 }}>
                            <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{m.metric}</span>
                            <span style={{ color: "var(--text-tertiary)" }}> changed: </span>
                            <span style={{ color: "var(--text-secondary)" }}>{(m.changed_fields || []).join(", ") || "unknown"}</span>
                          </div>
                        </PanelCard>
                      ))}
                    </div>
                  </PanelSection>
                )}

                {diff.summary.breaking_change_count > 0 && (
                  <PanelSection
                    title="Breaking Changes"
                    count={diff.summary.breaking_change_count}
                    icon={<Shield size={11} />}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(diff.breaking_changes || []).map((change, idx) => (
                        <PanelCard key={idx} tone="error" dense>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
                            <AlertCircle size={12} style={{ color: "#ef4444", flexShrink: 0, marginTop: 2 }} />
                            <span style={{ color: "var(--text-primary)" }}>{change}</span>
                          </div>
                        </PanelCard>
                      ))}
                    </div>
                  </PanelSection>
                )}
              </>
            )}
          </>
        )}
      </PanelSection>

      {/* ── Git Workspace ──────────────────────────────────────────── */}
      <PanelSection title="Git Workspace" icon={<GitBranch size={11} />}>
        {offlineMode || !activeProjectId ? (
          <PanelCard tone="neutral" dense>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Git features require an active project folder with API server mode enabled.
            </div>
          </PanelCard>
        ) : gitError ? (
          <PanelCard tone="error" dense>
            <div style={{ fontSize: 12, color: "var(--text-primary)" }}>{gitError}</div>
          </PanelCard>
        ) : gitLoading && !gitStatus ? (
          <PanelEmpty icon={Loader2} title="Loading git status…" />
        ) : gitStatus ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Current branch + ahead/behind + dirty count */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "8px 12px", borderRadius: 6,
              background: "var(--bg-2)", border: "1px solid var(--border-default)",
            }}>
              <GitBranch size={12} style={{ color: "var(--text-tertiary)" }} />
              <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-primary)", fontFamily: "var(--font-mono, inherit)" }}>
                {gitStatus.branch || "HEAD"}
              </span>
              {gitStatus.ahead > 0 && <StatusPill tone="success">ahead {gitStatus.ahead}</StatusPill>}
              {gitStatus.behind > 0 && <StatusPill tone="warning">behind {gitStatus.behind}</StatusPill>}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-tertiary)" }}>
                {gitStatus.isClean ? "clean" : `${gitStatus.files.length} changed`}
              </span>
            </div>

            {/* Working tree KV grid + diff-mode segmented toggle */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <KeyValueGrid items={[
                { label: "Staged",    value: gitStatus.stagedCount },
                { label: "Unstaged",  value: gitStatus.unstagedCount },
                { label: "Untracked", value: gitStatus.untrackedCount },
              ]} />
              <div style={{
                padding: 8, borderRadius: 6,
                background: "var(--bg-2)", border: "1px solid var(--border-default)",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                <div className="panel-form-label">Diff Mode</div>
                <div style={{ display: "flex", background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 5, padding: 2, gap: 2 }}>
                  {[
                    { id: false, label: "Unstaged" },
                    { id: true,  label: "Staged" },
                  ].map((opt) => {
                    const active = showStagedDiff === opt.id;
                    return (
                      <button
                        key={String(opt.id)}
                        onClick={() => setShowStagedDiff(opt.id)}
                        style={{
                          flex: 1,
                          padding: "4px 6px", borderRadius: 3,
                          border: "none", cursor: "pointer",
                          fontSize: 10.5, fontWeight: 500,
                          background: active ? "var(--accent-dim)" : "transparent",
                          color: active ? "var(--accent)" : "var(--text-secondary)",
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* File picker + stage/unstage */}
            <div className="panel-form-grid">
              <div className="panel-form-row" style={{ gridColumn: "1 / -1" }}>
                <label className="panel-form-label">File</label>
                <select
                  className="panel-select"
                  value={selectedPath}
                  onChange={(e) => setSelectedPath(e.target.value)}
                >
                  <option value="">All changed files</option>
                  {(gitStatus.files || []).map((file) => (
                    <option key={file.path} value={file.path}>
                      {file.path} ({summarizeFileStatus(file)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="panel-btn-row">
              <button onClick={onStage} disabled={gitActionLoading} className="panel-btn">
                {gitActionLoading ? <Loader2 size={11} className="animate-spin" /> : <ArrowUpToLine size={11} />}
                Stage {selectedPath ? "Selected" : "All"}
              </button>
              <button onClick={onUnstage} disabled={gitActionLoading} className="panel-btn">
                {gitActionLoading ? <Loader2 size={11} className="animate-spin" /> : <ArrowDownToLine size={11} />}
                Unstage {selectedPath ? "Selected" : "All"}
              </button>
            </div>

            {/* Unified diff */}
            <div className="panel-form-row">
              <label className="panel-form-label">Unified Diff</label>
              <div style={{ borderRadius: 6, border: "1px solid var(--border-default)", background: "var(--bg-canvas)", overflow: "hidden" }}>
                <DiffBlock text={gitDiffText} loading={gitDiffLoading} />
              </div>
            </div>

            {/* Commit form */}
            <div className="panel-form-grid">
              <div className="panel-form-row" style={{ gridColumn: "1 / -1" }}>
                <label className="panel-form-label">Commit Message</label>
                <input
                  className="panel-input"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder={selectedPath ? `Commit selected: ${selectedPath}` : "Commit all staged/changed files"}
                />
              </div>
            </div>
            <div className="panel-btn-row">
              <button onClick={onCommit} disabled={commitLoading} className="panel-btn primary">
                {commitLoading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                Commit
              </button>
            </div>

            {/* Remote / branch actions */}
            <div style={{
              padding: 12, borderRadius: 6,
              background: "var(--bg-2)", border: "1px solid var(--border-default)",
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              <div className="panel-form-label">Remote Actions</div>
              <div className="panel-form-grid">
                <div className="panel-form-row">
                  <label className="panel-form-label">Remote</label>
                  <input
                    className="panel-input"
                    value={gitRemote}
                    onChange={(e) => setGitRemote(e.target.value)}
                    placeholder="origin"
                  />
                </div>
                <div className="panel-form-row">
                  <label className="panel-form-label">Branch</label>
                  <input
                    className="panel-input"
                    value={gitBranchInput}
                    onChange={(e) => setGitBranchInput(e.target.value)}
                    placeholder={gitStatus?.branch && gitStatus.branch !== "HEAD" ? gitStatus.branch : "feature/my-change"}
                  />
                </div>
              </div>
              <div className="panel-btn-row">
                <button onClick={onCreateBranch} disabled={gitBranchLoading} className="panel-btn">
                  {gitBranchLoading ? <Loader2 size={11} className="animate-spin" /> : <GitBranch size={11} />}
                  Create / Checkout
                </button>
                <button onClick={onPull} disabled={gitPullLoading || !gitStatus} className="panel-btn">
                  {gitPullLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Pull
                </button>
                <button onClick={onPush} disabled={gitPushLoading || !gitStatus} className="panel-btn primary">
                  {gitPushLoading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                  Push
                </button>
              </div>

              {(gitPullOutput || gitPushOutput) && (
                <details style={{ background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 6, padding: 8 }}>
                  <summary style={{ fontSize: 10.5, color: "var(--text-tertiary)", cursor: "pointer" }}>Last git output</summary>
                  <pre style={{
                    marginTop: 8, fontSize: 10.5, fontFamily: "var(--font-mono, inherit)",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                    maxHeight: 140, overflow: "auto", color: "var(--text-secondary)",
                  }}>{gitPullOutput || gitPushOutput}</pre>
                </details>
              )}

              <details style={{ background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 6, padding: 12 }}>
                <summary style={{ fontSize: 11, fontWeight: 500, color: "var(--text-secondary)", cursor: "pointer" }}>Open GitHub PR</summary>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="panel-form-grid">
                    <div className="panel-form-row">
                      <label className="panel-form-label">PR Title</label>
                      <input
                        className="panel-input"
                        value={prTitle}
                        onChange={(e) => setPrTitle(e.target.value)}
                      />
                    </div>
                    <div className="panel-form-row">
                      <label className="panel-form-label">Base Branch</label>
                      <input
                        className="panel-input"
                        value={prBase}
                        onChange={(e) => setPrBase(e.target.value)}
                        placeholder="main"
                      />
                    </div>
                    <div className="panel-form-row" style={{ gridColumn: "1 / -1" }}>
                      <label className="panel-form-label">GitHub Token</label>
                      <input
                        className="panel-input"
                        type="password"
                        value={prToken}
                        onChange={(e) => setPrToken(e.target.value)}
                        placeholder="ghp_…"
                      />
                    </div>
                    <div className="panel-form-row" style={{ gridColumn: "1 / -1" }}>
                      <label className="panel-form-label">Description</label>
                      <textarea
                        className="panel-textarea"
                        value={prBody}
                        onChange={(e) => setPrBody(e.target.value)}
                        rows={3}
                      />
                    </div>
                  </div>
                  <div className="panel-btn-row">
                    <button onClick={onCreatePr} disabled={prCreating || !gitStatus} className="panel-btn primary">
                      {prCreating ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      Open PR
                    </button>
                    {prUrl && (
                      <a href={prUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "underline" }}>
                        {prUrl}
                      </a>
                    )}
                  </div>
                </div>
              </details>
            </div>
          </div>
        ) : null}
      </PanelSection>

      {/* ── Recent Commits ─────────────────────────────────────────── */}
      {gitLog.length > 0 && (
        <PanelSection title="Recent Commits" count={Math.min(gitLog.length, 5)} icon={<Clock3 size={11} />}>
          <div style={{ border: "1px solid var(--border-default)", borderRadius: 6, overflow: "hidden", background: "var(--bg-1)" }}>
            {gitLog.slice(0, 5).map((entry, i) => (
              <div
                key={entry.hash}
                style={{
                  padding: "8px 12px",
                  borderBottom: i < Math.min(gitLog.length, 5) - 1 ? "1px solid var(--border-subtle)" : "none",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entry.subject}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontFamily: "var(--font-mono, inherit)", marginTop: 2 }}>
                  {entry.shortHash} · {entry.author}
                </div>
              </div>
            ))}
          </div>
        </PanelSection>
      )}
    </PanelFrame>
  );
}
