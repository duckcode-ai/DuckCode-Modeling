/* Import dbt Repo — entry point for the "I just want to try this with my dbt
 * project" flow. Three input modes share one submit path:
 *   1. Local folder (absolute path on the server)
 *   2. Public git URL + optional ref
 *   3. "Load jaffle-shop demo" — one-click load of a known-good dbt project
 *
 * On submit we call `POST /api/dbt/import` (wraps `dm dbt import`) which
 * returns `{tree: [{path, content}], report, project?}`. For local-folder
 * imports with "Edit in place" checked, the server also registers the folder
 * as a DataLex project and returns it; the web-app then binds the tree to
 * that project so Save All writes edits back into the original dbt repo
 * at each file's source path. Without "Edit in place" (or for git/demo
 * imports), the tree lives in memory only.
 *
 * The jaffle-shop demo tries a checked-in local fixture first (via Vite's
 * `import.meta.glob`) and falls back to the public git URL so `dm serve`
 * works offline when the fixture is present and degrades gracefully when
 * it isn't.
 */
import React, { useState } from "react";
import { GitBranch, FolderOpen, Sparkles, AlertCircle, Loader2 } from "lucide-react";
import Modal from "./Modal";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { importDbtProject } from "../../lib/api";

// Vite-native glob-import of the checked-in jaffle-shop fixture.
// `{as: "raw"}` returns the file content as a plain string (YAML text), and
// the `eager: true` default we set below loads all files at build time so
// "Load demo" is instant and offline-ready. The bundle cost is ~few KB
// because the fixture is small — much cheaper than a round-trip to
// GitHub every time a user clicks the button.
//
// When the fixture directory doesn't exist, the glob resolves to an empty
// object and the demo falls back to the network path automatically.
const JAFFLE_FIXTURE = (() => {
  try {
    // eslint-disable-next-line no-undef
    return import.meta.glob("../../fixtures/jaffle-shop/**/*.{yaml,yml}", {
      query: "?raw",
      import: "default",
      eager: true,
    });
  } catch (_err) {
    return {};
  }
})();

const JAFFLE_GIT_URL = "https://github.com/dbt-labs/jaffle-shop.git";
const JAFFLE_GIT_REF = "main";

function loadJaffleFixture() {
  // With `eager: true`, values are strings — no async loader to await.
  const entries = Object.entries(JAFFLE_FIXTURE);
  if (entries.length === 0) return null;
  const tree = [];
  for (const [fullPath, content] of entries) {
    const rel = fullPath.replace(/^.*\/fixtures\/jaffle-shop\//, "");
    tree.push({ path: rel, content: String(content || "") });
  }
  return tree.length > 0 ? tree : null;
}

const TABS = [
  { id: "demo",   label: "Demo",         icon: Sparkles },
  { id: "folder", label: "Local folder", icon: FolderOpen },
  { id: "git",    label: "Git URL",      icon: GitBranch },
];

export default function ImportDbtRepoDialog() {
  const { closeModal, addToast } = useUiStore();
  const { loadDbtImportTree, loadDbtImportTreeAsProject } = useWorkspaceStore();

  const [tab, setTab] = useState("demo");

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

  const canSubmit =
    !submitting &&
    ((tab === "demo") ||
      (tab === "folder" && folder.trim()) ||
      (tab === "git" && gitUrl.trim()));

  const ingestTree = async (tree, label) => {
    await loadDbtImportTree(tree, { sourceLabel: label });
    addToast({
      type: "success",
      message: `Loaded ${tree.length} file${tree.length === 1 ? "" : "s"} from ${label}.`,
    });
    closeModal();
  };

  const handleDemo = async () => {
    setProgress("Loading bundled jaffle-shop fixture…");
    const local = loadJaffleFixture();
    if (local) {
      await ingestTree(local, "jaffle-shop demo");
      return;
    }
    // Fall back to network import via the api-server.
    setProgress("No bundled fixture — cloning from GitHub…");
    const res = await importDbtProject({
      gitUrl: JAFFLE_GIT_URL,
      gitRef: JAFFLE_GIT_REF,
      skipWarehouse: true,
    });
    await ingestTree(res.tree || [], "jaffle-shop (github)");
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
    // When the api-server registered a project for us, bind the tree to it so
    // Save All writes back into the dbt repo. Otherwise fall back to the
    // in-memory loader (explore-only).
    if (editInPlace && res.project && res.project.id) {
      await loadDbtImportTreeAsProject(tree, res.project);
      const n = tree.length;
      addToast({
        type: "success",
        message: `Opened ${dir} in place — ${n} file${n === 1 ? "" : "s"}. Save All writes back into this folder.`,
      });
      // Collision warning: shared schema.yml files will clobber sibling
      // models on save until the Phase-2 merge path lands.
      const collisions = useWorkspaceStore.getState().dbtImportCollisions || [];
      if (collisions.length) {
        addToast({
          type: "warning",
          message: `${collisions.length} shared schema file${collisions.length === 1 ? "" : "s"} detected; saves may overwrite sibling models. See Save All preview.`,
        });
      }
      closeModal();
      return;
    }
    await ingestTree(tree, dir);
  };

  const handleGit = async () => {
    setProgress(`Cloning ${gitUrl.trim()}…`);
    const res = await importDbtProject({
      gitUrl: gitUrl.trim(),
      gitRef: gitRef.trim() || "main",
      skipWarehouse,
    });
    await ingestTree(res.tree || [], gitUrl.trim());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    setProgress("");
    try {
      if (tab === "demo") await handleDemo();
      else if (tab === "folder") await handleFolder();
      else if (tab === "git") await handleGit();
    } catch (err) {
      setError(err?.message || String(err) || "Import failed.");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

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
            ) : tab === "demo" ? (
              "Load demo"
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

        {tab === "demo" && (
          <div className="dlx-modal-section">
            <div
              style={{
                display: "flex",
                gap: 12,
                padding: 14,
                background: "var(--bg-2)",
                border: "1px solid var(--border-default)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "var(--accent-dim)",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Sparkles size={16} color="var(--accent)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  dbt-labs / jaffle-shop
                </div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                  The canonical dbt demo project — staging models, marts, seeds, tests.
                  Great for exploring DataLex without wiring up your own repo.
                </div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8, fontFamily: "var(--font-mono)" }}>
                  {Object.keys(JAFFLE_FIXTURE).length > 0
                    ? `${Object.keys(JAFFLE_FIXTURE).length} bundled files • offline`
                    : `via ${JAFFLE_GIT_URL.replace(/\.git$/, "")}`}
                </div>
              </div>
            </div>
          </div>
        )}

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
                Public HTTPS URL. For private repos, clone locally and use the{" "}
                <strong>Local folder</strong> tab.
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

        {(tab === "folder" || tab === "git") && (
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
        )}

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
