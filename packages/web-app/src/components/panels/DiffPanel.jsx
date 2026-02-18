import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Plus,
  Minus,
  RefreshCw,
  Shield,
  GitBranch,
  Loader2,
  Clock3,
  FileDiff,
  Upload,
  ArrowUpToLine,
  ArrowDownToLine,
  } from "lucide-react";
  import useWorkspaceStore from "../../stores/workspaceStore";
  import useUiStore from "../../stores/uiStore";
  import { runGate } from "../../modelQuality";
  import {
  fetchGitStatus,
  fetchGitDiff,
  commitGit,
  fetchGitLog,
  stageGitFiles,
  unstageGitFiles,
  createGitBranch,
  pushGitBranch,
  pullGitBranch,
  createGitHubPr,
} from "../../lib/api";

function summarizeFileStatus(file) {
  if (!file) return "";
  if (file.status === "untracked") return "untracked";
  const tags = [];
  if (file.stagedStatus && file.stagedStatus !== " ") tags.push(`staged:${file.stagedStatus}`);
  if (file.unstagedStatus && file.unstagedStatus !== " ") tags.push(`unstaged:${file.unstagedStatus}`);
  return tags.join(" · ") || "clean";
}

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
  const [prBody, setPrBody] = useState("Automated changes generated/managed in DuckCodeModeling.");
  const [prToken, setPrToken] = useState("");
  const [prCreating, setPrCreating] = useState(false);
  const [prUrl, setPrUrl] = useState("");

  const gateResult = useMemo(() => {
    if (!activeFileContent || !baselineContent) return null;
    return runGate(baselineContent, activeFileContent, allowBreaking);
  }, [activeFileContent, baselineContent, allowBreaking]);

  const diff = gateResult?.diff;
  const gatePassed = gateResult?.gatePassed;

  const loadGitWorkspace = useCallback(async () => {
    if (!activeProjectId || offlineMode) return;
    setGitError("");
    setGitLoading(true);
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
      setGitError(err.message);
      setGitStatus(null);
      setGitLog([]);
    } finally {
      setGitLoading(false);
    }
  }, [activeProjectId, activeFile?.path, offlineMode]);

  const loadGitDiffText = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    setGitDiffLoading(true);
    try {
      const data = await fetchGitDiff(activeProjectId, {
        path: selectedPath || "",
        staged: showStagedDiff,
      });
      setGitDiffText(data.diff || "");
    } catch (err) {
      setGitDiffText("");
      setGitError(err.message);
    } finally {
      setGitDiffLoading(false);
    }
  }, [activeProjectId, offlineMode, gitStatus, selectedPath, showStagedDiff]);

  useEffect(() => {
    loadGitWorkspace();
  }, [loadGitWorkspace]);

  useEffect(() => {
    if (!gitStatus?.branch || gitStatus.branch === "HEAD") return;
    setGitBranchInput((prev) => prev || gitStatus.branch);
  }, [gitStatus?.branch]);

  useEffect(() => {
    loadGitDiffText();
  }, [loadGitDiffText]);

  const onCommit = useCallback(async () => {
    if (!activeProjectId || offlineMode) return;
    const message = commitMessage.trim();
    if (!message) {
      setGitError("Commit message is required");
      return;
    }
    setGitError("");
    setCommitLoading(true);
    try {
      const selectedPaths = selectedPath ? [selectedPath] : [];
      const result = await commitGit(activeProjectId, {
        message,
        paths: selectedPaths,
      });
      addToast?.({
        type: "success",
        message: `Committed ${result.commitHash?.slice(0, 7) || ""}`.trim(),
      });
      setCommitMessage("");
      await loadGitWorkspace();
      await loadGitDiffText();
    } catch (err) {
      setGitError(err.message);
    } finally {
      setCommitLoading(false);
    }
  }, [activeProjectId, offlineMode, commitMessage, selectedPath, addToast, loadGitWorkspace, loadGitDiffText]);

  const onStage = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const files = Array.isArray(gitStatus.files) ? gitStatus.files : [];
    const paths = selectedPath
      ? [selectedPath]
      : files
          .filter((f) => f.status === "untracked" || (f.unstagedStatus && f.unstagedStatus !== " "))
          .map((f) => f.path);
    if (paths.length === 0) {
      addToast?.({ type: "info", message: "No files to stage" });
      return;
    }
    setGitActionLoading(true);
    setGitError("");
    try {
      await stageGitFiles(activeProjectId, paths);
      addToast?.({ type: "success", message: paths.length === 1 ? "Staged 1 file" : `Staged ${paths.length} files` });
      await loadGitWorkspace();
      await loadGitDiffText();
    } catch (err) {
      setGitError(err.message);
    } finally {
      setGitActionLoading(false);
    }
  }, [activeProjectId, offlineMode, gitStatus, selectedPath, addToast, loadGitWorkspace, loadGitDiffText]);

  const onUnstage = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const files = Array.isArray(gitStatus.files) ? gitStatus.files : [];
    const paths = selectedPath
      ? [selectedPath]
      : files
          .filter((f) => f.stagedStatus && f.stagedStatus !== " ")
          .map((f) => f.path);
    if (paths.length === 0) {
      addToast?.({ type: "info", message: "No files to unstage" });
      return;
    }
    setGitActionLoading(true);
    setGitError("");
    try {
      await unstageGitFiles(activeProjectId, paths);
      addToast?.({ type: "success", message: paths.length === 1 ? "Unstaged 1 file" : `Unstaged ${paths.length} files` });
      await loadGitWorkspace();
      await loadGitDiffText();
    } catch (err) {
      setGitError(err.message);
    } finally {
      setGitActionLoading(false);
    }
  }, [activeProjectId, offlineMode, gitStatus, selectedPath, addToast, loadGitWorkspace, loadGitDiffText]);


  const onCreateBranch = useCallback(async () => {
    if (!activeProjectId || offlineMode) return;
    const branch = String(gitBranchInput || "").trim();
    if (!branch) {
      setGitError("Branch name is required");
      return;
    }
    setGitBranchLoading(true);
    setGitError("");
    try {
      await createGitBranch(activeProjectId, { branch });
      addToast?.({ type: "success", message: "Checked out " + branch });
      await loadGitWorkspace();
      await loadGitDiffText();
    } catch (err) {
      setGitError(err.message);
    } finally {
      setGitBranchLoading(false);
    }
  }, [activeProjectId, offlineMode, gitBranchInput, addToast, loadGitWorkspace, loadGitDiffText]);

  const onPush = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const branch = String(gitBranchInput || gitStatus.branch || "").trim();
    if (!branch || branch === "HEAD") {
      setGitError("Unable to push: detached HEAD");
      return;
    }
    setGitPushLoading(true);
    setGitError("");
    setGitPushOutput("");
    try {
      const result = await pushGitBranch(activeProjectId, { remote: gitRemote || "origin", branch, setUpstream: true });
      setGitPushOutput(result.output || "Push completed");
      addToast?.({ type: "success", message: "Pushed " + branch });
      await loadGitWorkspace();
      await loadGitDiffText();
    } catch (err) {
      setGitError(err.message);
    } finally {
      setGitPushLoading(false);
    }
  }, [activeProjectId, offlineMode, gitStatus, gitBranchInput, gitRemote, addToast, loadGitWorkspace, loadGitDiffText]);

  const onPull = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const branch = String(gitBranchInput || gitStatus.branch || "").trim();
    if (!branch || branch === "HEAD") {
      setGitError("Unable to pull: detached HEAD");
      return;
    }
    setGitPullLoading(true);
    setGitError("");
    setGitPullOutput("");
    try {
      const result = await pullGitBranch(activeProjectId, { remote: gitRemote || "origin", ffOnly: true });
      setGitPullOutput(result.output || "Pull completed");
      addToast?.({ type: "success", message: "Pulled latest changes" });
      await loadGitWorkspace();
      await loadGitDiffText();
    } catch (err) {
      setGitError(err.message);
    } finally {
      setGitPullLoading(false);
    }
  }, [activeProjectId, offlineMode, gitStatus, gitBranchInput, gitRemote, addToast, loadGitWorkspace, loadGitDiffText]);

  const onCreatePr = useCallback(async () => {
    if (!activeProjectId || offlineMode || !gitStatus) return;
    const token = String(prToken || "").trim();
    if (!token) {
      setGitError("GitHub token is required to open a PR");
      return;
    }
    const title = String(prTitle || "").trim();
    if (!title) {
      setGitError("PR title is required");
      return;
    }
    const head = String(gitBranchInput || gitStatus.branch || "").trim();
    if (!head || head === "HEAD") {
      setGitError("Head branch is required");
      return;
    }

    setPrCreating(true);
    setGitError("");
    setPrUrl("");
    try {
      const pr = await createGitHubPr(activeProjectId, {
        token,
        title,
        body: String(prBody || ""),
        base: String(prBase || "main").trim() || "main",
        head,
        remote: gitRemote || "origin",
      });
      const url = pr?.pullRequest?.url || "";
      setPrUrl(url);
      addToast?.({ type: "success", message: url ? "Opened PR" : "PR created" });
    } catch (err) {
      setGitError(err.message);
    } finally {
      setPrCreating(false);
    }
  }, [activeProjectId, offlineMode, gitStatus, gitBranchInput, gitRemote, prToken, prTitle, prBody, prBase, addToast]);
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-primary bg-bg-secondary/50 shrink-0">
        <span className="text-xs font-semibold text-text-primary">Diff & Gate</span>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={loadGitWorkspace}
            disabled={gitLoading || !activeProjectId || offlineMode}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border-primary text-[10px] text-text-muted hover:bg-bg-hover disabled:opacity-50"
          >
            <RefreshCw size={10} className={gitLoading ? "animate-spin" : ""} />
            Refresh
          </button>
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={allowBreaking}
              onChange={(e) => setAllowBreaking(e.target.checked)}
              className="w-3 h-3 rounded accent-accent-blue"
            />
            Allow breaking
          </label>
          {gateResult && (
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              gatePassed
                ? "bg-green-50 text-green-600"
                : "bg-red-50 text-red-600"
            }`}>
              {gatePassed ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
              Gate {gatePassed ? "PASSED" : "FAILED"}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div className="space-y-2">
          <h4 className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Semantic Gate</h4>
          {!baselineContent ? (
            <div className="px-3 py-2 rounded-md border border-border-primary bg-bg-primary text-xs text-text-muted">
              Select a baseline file to run semantic diff and breaking-change gates.
            </div>
          ) : (
            <>
              {gateResult && (
                <div className={`px-3 py-2 rounded-md border text-xs ${
                  gatePassed
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}>
                  {gateResult.message}
                </div>
              )}
              {diff && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <div className="px-3 py-2 bg-bg-primary border border-border-primary rounded-md">
                      <div className="text-[10px] text-text-muted uppercase mb-1">Entities</div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1 text-green-600"><Plus size={10} /> {diff.summary.added_entities}</span>
                        <span className="flex items-center gap-1 text-red-600"><Minus size={10} /> {diff.summary.removed_entities}</span>
                        <span className="flex items-center gap-1 text-amber-600"><RefreshCw size={10} /> {diff.summary.changed_entities}</span>
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-bg-primary border border-border-primary rounded-md">
                      <div className="text-[10px] text-text-muted uppercase mb-1">Relationships</div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1 text-green-600"><Plus size={10} /> {diff.summary.added_relationships}</span>
                        <span className="flex items-center gap-1 text-red-600"><Minus size={10} /> {diff.summary.removed_relationships}</span>
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-bg-primary border border-border-primary rounded-md">
                      <div className="text-[10px] text-text-muted uppercase mb-1">Indexes</div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1 text-green-600"><Plus size={10} /> {diff.summary.added_indexes || 0}</span>
                        <span className="flex items-center gap-1 text-red-600"><Minus size={10} /> {diff.summary.removed_indexes || 0}</span>
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-bg-primary border border-border-primary rounded-md">
                      <div className="text-[10px] text-text-muted uppercase mb-1">Metrics</div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1 text-green-600"><Plus size={10} /> {diff.summary.added_metrics || 0}</span>
                        <span className="flex items-center gap-1 text-red-600"><Minus size={10} /> {diff.summary.removed_metrics || 0}</span>
                        <span className="flex items-center gap-1 text-amber-600"><RefreshCw size={10} /> {diff.summary.changed_metrics || 0}</span>
                      </div>
                    </div>
                  </div>
                  {(diff.changed_metrics || []).length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                        Metric Contract Changes ({diff.changed_metrics.length})
                      </h4>
                      {diff.changed_metrics.map((metricChange) => (
                        <div
                          key={metricChange.metric}
                          className="px-3 py-2 bg-bg-primary border border-border-primary rounded-md text-xs text-text-secondary"
                        >
                          <span className="font-semibold text-text-primary">{metricChange.metric}</span>
                          <span className="text-text-muted"> changed: </span>
                          <span>{(metricChange.changed_fields || []).join(", ") || "unknown"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {diff.summary.breaking_change_count > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] text-status-error uppercase tracking-wider font-semibold flex items-center gap-1">
                        <Shield size={10} />
                        Breaking Changes ({diff.summary.breaking_change_count})
                      </h4>
                      {(diff.breaking_changes || []).map((change, idx) => (
                        <div key={idx} className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md">
                          <AlertCircle size={12} className="text-red-500 shrink-0 mt-0.5" />
                          <span className="text-xs text-red-700">{change}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Git Workspace</h4>
          {offlineMode || !activeProjectId ? (
            <div className="px-3 py-2 rounded-md border border-border-primary bg-bg-primary text-xs text-text-muted">
              Git features require an active project folder with API server mode enabled.
            </div>
          ) : (
            <div className="space-y-2">
              {gitError && (
                <div className="px-3 py-2 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
                  {gitError}
                </div>
              )}
              {gitLoading && !gitStatus ? (
                <div className="px-3 py-2 rounded-md border border-border-primary bg-bg-primary text-xs text-text-muted inline-flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  Loading git status...
                </div>
              ) : (
                gitStatus && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-2 border border-border-primary bg-bg-primary rounded-md text-xs">
                      <GitBranch size={12} className="text-text-muted" />
                      <span className="font-medium text-text-primary">{gitStatus.branch || "HEAD"}</span>
                      {gitStatus.ahead > 0 && <span className="text-[10px] text-green-700 bg-green-50 border border-green-200 px-1.5 py-0 rounded">ahead {gitStatus.ahead}</span>}
                      {gitStatus.behind > 0 && <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0 rounded">behind {gitStatus.behind}</span>}
                      <span className="ml-auto text-[10px] text-text-muted">
                        {gitStatus.isClean ? "clean" : `${gitStatus.files.length} changed`}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="px-3 py-2 border border-border-primary bg-bg-primary rounded-md text-xs">
                        <div className="text-[10px] text-text-muted uppercase mb-1">Working Tree</div>
                        <div className="space-y-0.5">
                          <div>Staged: {gitStatus.stagedCount}</div>
                          <div>Unstaged: {gitStatus.unstagedCount}</div>
                          <div>Untracked: {gitStatus.untrackedCount}</div>
                        </div>
                      </div>
                      <div className="px-3 py-2 border border-border-primary bg-bg-primary rounded-md text-xs">
                        <div className="text-[10px] text-text-muted uppercase mb-1">Diff Mode</div>
                        <button
                          onClick={() => setShowStagedDiff((v) => !v)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border-primary text-[10px] text-text-secondary hover:bg-bg-hover"
                        >
                          <FileDiff size={10} />
                          {showStagedDiff ? "Showing staged" : "Showing unstaged"}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold block">
                        File
                      </label>
                      <select
                        value={selectedPath}
                        onChange={(e) => setSelectedPath(e.target.value)}
                        className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue font-mono"
                      >
                        <option value="">All changed files</option>
                        {(gitStatus.files || []).map((file) => (
                          <option key={file.path} value={file.path}>
                            {file.path} ({summarizeFileStatus(file)})
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={onStage}
                          disabled={gitActionLoading}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border-primary text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                        >
                          {gitActionLoading ? <Loader2 size={10} className="animate-spin" /> : <ArrowUpToLine size={10} />}
                          Stage {selectedPath ? "Selected" : "All"}
                        </button>
                        <button
                          onClick={onUnstage}
                          disabled={gitActionLoading}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border-primary text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                        >
                          {gitActionLoading ? <Loader2 size={10} className="animate-spin" /> : <ArrowDownToLine size={10} />}
                          Unstage {selectedPath ? "Selected" : "All"}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold block">Unified Diff</label>
                      <div className="border border-border-primary rounded-md bg-bg-primary">
                        {gitDiffLoading ? (
                          <div className="p-2 text-xs text-text-muted inline-flex items-center gap-2">
                            <Loader2 size={12} className="animate-spin" />
                            Loading diff...
                          </div>
                        ) : (
                          <pre className="p-2 text-[10px] leading-relaxed text-text-secondary font-mono overflow-x-auto max-h-56 overflow-y-auto whitespace-pre-wrap break-words">
                            {gitDiffText || "No diff output for current selection."}
                          </pre>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold block">Commit</label>
                      <div className="flex items-center gap-2">
                        <input
                          value={commitMessage}
                          onChange={(e) => setCommitMessage(e.target.value)}
                          placeholder={selectedPath ? `Commit selected: ${selectedPath}` : "Commit all staged/changed files"}
                          className="flex-1 bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue"
                        />
                        <button
                          onClick={onCommit}
                          disabled={commitLoading}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/85 disabled:opacity-60"
                        >
                          {commitLoading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                          Commit
                        </button>
                        <button
                          onClick={onPush}
                          disabled={gitPushLoading || !gitStatus}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                          title="Push current branch to origin"
                        >
                          {gitPushLoading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                          Push
                        </button>
                      </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold block">Git Actions</label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <div>
                          <div className="text-[10px] text-text-muted mb-1">Remote</div>
                          <input
                            value={gitRemote}
                            onChange={(e) => setGitRemote(e.target.value)}
                            placeholder="origin"
                            className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue font-mono"
                          />
                        </div>
                        <div>
                          <div className="text-[10px] text-text-muted mb-1">Branch</div>
                          <input
                            value={gitBranchInput}
                            onChange={(e) => setGitBranchInput(e.target.value)}
                            placeholder={gitStatus?.branch && gitStatus.branch !== "HEAD" ? gitStatus.branch : "feature/my-change"}
                            className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue font-mono"
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <button
                            onClick={onCreateBranch}
                            disabled={gitBranchLoading}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-border-primary text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                          >
                            {gitBranchLoading ? <Loader2 size={10} className="animate-spin" /> : <GitBranch size={10} />}
                            Create/Checkout
                          </button>
                          <button
                            onClick={onPull}
                            disabled={gitPullLoading || !gitStatus}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-border-primary text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                          >
                            {gitPullLoading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                            Pull
                          </button>
                          <button
                            onClick={onPush}
                            disabled={gitPushLoading || !gitStatus}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-border-primary text-[10px] text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                          >
                            {gitPushLoading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                            Push
                          </button>
                        </div>
                      </div>

                      {(gitPullOutput || gitPushOutput) && (
                        <details className="mt-2 border border-border-primary rounded-md bg-bg-primary p-2">
                          <summary className="text-[10px] text-text-muted cursor-pointer">Last git output</summary>
                          <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap break-words max-h-32 overflow-auto">
                            {gitPullOutput || gitPushOutput}
                          </pre>
                        </details>
                      )}

                      <details className="mt-2 border border-border-primary rounded-md bg-bg-primary p-2">
                        <summary className="text-[10px] text-text-muted cursor-pointer">Open GitHub PR</summary>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <div className="text-[10px] text-text-muted mb-1">PR Title</div>
                            <input
                              value={prTitle}
                              onChange={(e) => setPrTitle(e.target.value)}
                              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue"
                            />
                          </div>
                          <div>
                            <div className="text-[10px] text-text-muted mb-1">Base Branch</div>
                            <input
                              value={prBase}
                              onChange={(e) => setPrBase(e.target.value)}
                              placeholder="main"
                              className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue font-mono"
                            />
                          </div>
                        </div>
                        <div className="mt-2">
                          <div className="text-[10px] text-text-muted mb-1">GitHub Token</div>
                          <input
                            type="password"
                            value={prToken}
                            onChange={(e) => setPrToken(e.target.value)}
                            placeholder="ghp_..."
                            className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue font-mono"
                          />
                        </div>
                        <div className="mt-2">
                          <div className="text-[10px] text-text-muted mb-1">Description</div>
                          <textarea
                            value={prBody}
                            onChange={(e) => setPrBody(e.target.value)}
                            rows={3}
                            className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue"
                          />
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={onCreatePr}
                            disabled={prCreating || !gitStatus}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-semibold bg-accent-blue text-white hover:bg-accent-blue/85 disabled:opacity-60"
                          >
                            {prCreating ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                            Open PR
                          </button>
                          {prUrl && (
                            <a href={prUrl} target="_blank" rel="noreferrer" className="text-[10px] text-accent-blue underline">
                              {prUrl}
                            </a>
                          )}
                        </div>
                      </details>
                    </div>

                    </div>

                    {gitLog.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1">
                          <Clock3 size={10} />
                          Recent Commits
                        </div>
                        <div className="border border-border-primary rounded-md bg-bg-primary divide-y divide-border-primary/60">
                          {gitLog.slice(0, 5).map((entry) => (
                            <div key={entry.hash} className="px-3 py-1.5">
                              <div className="text-xs text-text-primary font-medium truncate">{entry.subject}</div>
                              <div className="text-[10px] text-text-muted font-mono">
                                {entry.shortHash} · {entry.author}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
