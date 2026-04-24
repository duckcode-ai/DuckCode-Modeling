/* Import dbt Repo — entry point for the "I just want to try this with my dbt
 * project" flow. Two input modes share one submit path:
 *   1. Local folder (absolute path on the server)
 *   2. Public git URL + optional ref
 *
 * On submit we call `POST /api/dbt/import` (wraps `dm dbt import`) which
 * returns `{tree: [{path, content}], report, project?}`. For local-folder
 * imports with "Edit in place" checked, the server also registers the folder
 * as a DataLex project and returns it; the web-app then binds the tree to
 * that project so Save All writes edits back into the original dbt repo
 * at each file's source path. Without "Edit in place" (or for git imports),
 * the tree lives in memory only.
 *
 * To try DataLex with a canonical dbt project, paste the public jaffle-shop
 * repo URL into the Git URL tab: https://github.com/dbt-labs/jaffle-shop
 */
import React, { useState } from "react";
import { GitBranch, FolderOpen, AlertCircle, Loader2 } from "lucide-react";
import Modal from "./Modal";
import ImportResultsPanel from "./ImportResultsPanel";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { importDbtProject } from "../../lib/api";

const TABS = [
  { id: "git",    label: "Git URL",      icon: GitBranch },
  { id: "folder", label: "Local folder", icon: FolderOpen },
];

export default function ImportDbtRepoDialog() {
  const { closeModal, addToast } = useUiStore();
  const { loadDbtImportTree, loadDbtImportTreeAsProject } = useWorkspaceStore();

  const [tab, setTab] = useState("git");

  // Folder mode
  const [folder, setFolder] = useState("");
  // When true, the api-server registers `folder` as a DataLex project and
  // Save All writes edits back into that folder at each model's original
  // dbt path. When false, the import stays in-memory (explore-only).
  const [editInPlace, setEditInPlace] = useState(true);

  // Git mode
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("main");

  // Shared
  const [skipWarehouse, setSkipWarehouse] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(""); // human-readable current step
  const [error, setError] = useState("");

  // Import Results panel state — after a successful import we stash the
  // SyncReport + tree and keep the dialog open so the user can inspect
  // gaps (unknown types, unresolved rels, manifest-only banner) before
  // jumping into the canvas. `openProject` is the deferred action we
  // invoke when the user clicks "Open project" in the panel.
  const [results, setResults] = useState(null); // { report, tree, sourceLabel, openProject }

  const canSubmit =
    !submitting &&
    ((tab === "folder" && folder.trim()) ||
      (tab === "git" && gitUrl.trim()));

  // Show the Import Results panel instead of closing. The actual load of
  // the tree into the workspace is deferred to the panel's "Open project"
  // button via `openProject`.
  const showResults = ({ tree, report, sourceLabel, openProject }) => {
    setResults({ tree: tree || [], report: report || null, sourceLabel, openProject });
  };

  const handleFolder = async () => {
    const dir = folder.trim();
    setProgress(`Importing ${dir}…`);
    const res = await importDbtProject({
      projectDir: dir,
      skipWarehouse,
      editInPlace: !!editInPlace,
    });
    const tree = res.tree || [];

    const openProject = async () => {
      if (editInPlace && res.project && res.project.id) {
        await loadDbtImportTreeAsProject(tree, res.project);
        addToast({
          type: "success",
          message: `Opened ${dir} in place — ${tree.length} file${tree.length === 1 ? "" : "s"}. AI indexed ${res.aiIndex?.recordCount || 0} dbt/DataLex facts.`,
        });
        if (res.aiIndexError) {
          addToast({
            type: "warning",
            message: `dbt import succeeded, but AI index rebuild failed: ${res.aiIndexError}`,
          });
        }
        const collisions = useWorkspaceStore.getState().dbtImportCollisions || [];
        if (collisions.length) {
          addToast({
            type: "warning",
            message: `${collisions.length} shared schema file${collisions.length === 1 ? "" : "s"} detected; saves may overwrite sibling models. See Save All preview.`,
          });
        }
      } else {
        await loadDbtImportTree(tree, { sourceLabel: dir });
        addToast({
          type: "success",
          message: `Loaded ${tree.length} file${tree.length === 1 ? "" : "s"} from ${dir}.`,
        });
      }
    };

    showResults({ tree, report: res.report || null, sourceLabel: dir, openProject });
  };

  const handleGit = async () => {
    const label = gitUrl.trim();
    setProgress(`Cloning ${label}…`);
    const res = await importDbtProject({
      gitUrl: label,
      gitRef: gitRef.trim() || "main",
      skipWarehouse,
    });
    showResults({
      tree: res.tree || [],
      report: res.report || null,
      sourceLabel: label,
      openProject: async () => {
        await loadDbtImportTree(res.tree || [], { sourceLabel: label });
        addToast({
          type: "success",
          message: `Loaded ${(res.tree || []).length} file${(res.tree || []).length === 1 ? "" : "s"} from ${label}.`,
        });
      },
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    setProgress("");
    try {
      if (tab === "folder") await handleFolder();
      else if (tab === "git") await handleGit();
    } catch (err) {
      setError(err?.message || String(err) || "Import failed.");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  // Once the import resolves we swap the form out for the Results panel.
  if (results) {
    const handleOpen = async () => {
      try {
        if (results.openProject) await results.openProject();
      } finally {
        closeModal();
      }
    };
    return (
      <Modal
        icon={<GitBranch size={14} />}
        title="Import complete"
        subtitle="Review the report below, then open the project."
        size="lg"
        onClose={closeModal}
        footer={
          <button type="button" className="panel-btn" onClick={closeModal}>
            Close
          </button>
        }
      >
        <ImportResultsPanel
          report={results.report}
          tree={results.tree}
          sourceLabel={results.sourceLabel}
          onClose={handleOpen}
        />
      </Modal>
    );
  }

  return (
    <Modal
      icon={<GitBranch size={14} />}
      title="Import dbt repo"
      subtitle="Load a dbt project's YAML into DataLex. Folder structure is preserved."
      size="lg"
      onClose={submitting ? undefined : closeModal}
      footer={
        <>
          <button
            type="button"
            className="panel-btn"
            onClick={closeModal}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="import-dbt-form"
            className="panel-btn primary"
            disabled={!canSubmit}
          >
            {submitting ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                Importing…
              </span>
            ) : (
              "Import"
            )}
          </button>
        </>
      }
    >
      <form id="import-dbt-form" onSubmit={handleSubmit} style={{ display: "contents" }}>
        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 4,
            background: "var(--bg-2)",
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                disabled={submitting}
                style={{
                  flex: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid transparent",
                  background: active ? "var(--bg-1)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  cursor: submitting ? "not-allowed" : "pointer",
                  transition: "all 120ms var(--ease)",
                }}
              >
                <Icon size={12} />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "folder" && (
          <div className="dlx-modal-section">
            <label className="dlx-modal-field-label" htmlFor="import-dbt-folder">
              Local folder (absolute path)
            </label>
            <input
              id="import-dbt-folder"
              className="panel-input"
              style={{ fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)", fontSize: 11.5 }}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="/Users/you/src/my-dbt-project"
              disabled={submitting}
              autoFocus
            />
            <p className="dlx-modal-hint">
              Must contain <code>dbt_project.yml</code>. The folder is read, parsed, and
              laid out under its original <code>models/</code> and <code>seeds/</code> tree.
            </p>

            <label
              className="dlx-check"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                marginTop: 12,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={editInPlace}
                onChange={(e) => setEditInPlace(e.target.checked)}
                disabled={submitting}
                style={{ marginTop: 2 }}
              />
              <span style={{ fontSize: 12 }}>
                <strong>Edit in place</strong> — save changes back into this folder
                <span style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginTop: 2, lineHeight: 1.5 }}>
                  Registers this folder as a DataLex project. <strong>Save All</strong>{" "}
                  writes edits back to each model's original <code>.yml</code> path so
                  <code> git diff</code> shows normal dbt changes. Uncheck to explore
                  read-only in memory.
                </span>
              </span>
            </label>
          </div>
        )}

        {tab === "git" && (
          <>
            <div className="dlx-modal-section">
              <label className="dlx-modal-field-label" htmlFor="import-dbt-url">
                Git URL
              </label>
              <input
                id="import-dbt-url"
                className="panel-input"
                style={{ fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)", fontSize: 11.5 }}
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/org/my-dbt-project.git"
                disabled={submitting}
                autoFocus
              />
              <p className="dlx-modal-hint">
                Public HTTPS URL. To try it with a canonical dbt project, paste{" "}
                <code>https://github.com/dbt-labs/jaffle-shop</code>. For private repos,
                clone locally and use the <strong>Local folder</strong> tab.
              </p>
            </div>
            <div className="dlx-modal-section">
              <label className="dlx-modal-field-label" htmlFor="import-dbt-ref">
                Branch / tag / commit
              </label>
              <input
                id="import-dbt-ref"
                className="panel-input"
                style={{ fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)", fontSize: 11.5 }}
                value={gitRef}
                onChange={(e) => setGitRef(e.target.value)}
                placeholder="main"
                disabled={submitting}
              />
            </div>
          </>
        )}

        <div className="dlx-modal-section">
          <label
            className="dlx-check"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: submitting ? "not-allowed" : "pointer" }}
          >
            <input
              type="checkbox"
              checked={skipWarehouse}
              onChange={(e) => setSkipWarehouse(e.target.checked)}
              disabled={submitting}
            />
            <span style={{ fontSize: 12 }}>
              Skip live warehouse introspection
              <span style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                Recommended. Uses <code>manifest.json</code> only — avoids needing dbt
                profiles or warehouse credentials for the import.
              </span>
            </span>
          </label>
        </div>

        {progress && !error && (
          <div
            className="dlx-modal-alert"
            style={{ background: "var(--accent-dim)", borderColor: "var(--accent)", color: "var(--text-primary)" }}
          >
            <Loader2 size={12} style={{ marginTop: 1, flexShrink: 0, animation: "spin 1s linear infinite" }} />
            <span>{progress}</span>
          </div>
        )}

        {error && (
          <div className="dlx-modal-alert">
            <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}
