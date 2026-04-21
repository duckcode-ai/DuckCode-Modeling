/* Left panel — Object List / Explorer / Themes. Ported from DataLex design prototype.
 *
 * The EXPLORER tab renders the active project's file tree. We build it on the
 * fly with `buildFileTree` (pure, memo-friendly) so adding a file anywhere in
 * the store is reflected on next render without tree-state bookkeeping here.
 * Folder fold/unfold is local component state, keyed by slash-joined folder
 * path — that key survives tree rebuilds because paths don't change when a
 * sibling file is added or removed.
 */
import React from "react";
import Icon from "./icons";
import { THEMES } from "./notation";
import { buildFileTree, countFiles } from "../lib/fileTree";
import useWorkspaceStore from "../stores/workspaceStore";
import useUiStore from "../stores/uiStore";
import ExplorerContextMenu from "../components/panels/ExplorerContextMenu";

export default function LeftPanel({ activeTable, onSelectTable, tables, theme, setTheme, subjectAreas = [], connectionLabel = "workspace", connectionDsn = "", schemas = [], onAddEntity, projects = [], activeProjectId = null, onSelectProject = null }) {
  const I = Icon;
  const [tab, setTab] = React.useState("OBJECTS");
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState({});
  const toggle = (k) => setCollapsed((s) => ({ ...s, [k]: !s[k] }));

  /* Explorer: pull the file list + open-file action from the store directly.
     LeftPanel already subscribes to the shell's theme / tables props, and the
     explorer tree is self-contained — no need to thread two more props
     through Shell.jsx just to reach the workspace. */
  const projectFiles = useWorkspaceStore((s) => s.projectFiles);
  const optimisticFolders = useWorkspaceStore((s) => s.optimisticFolders);
  const activeFullPath = useWorkspaceStore((s) => s.activeFile?.fullPath || "");
  const offlineMode = useWorkspaceStore((s) => s.offlineMode);
  // Note: `activeProjectId` comes from props (threaded from Shell) — don't
  // re-subscribe here or it shadows the prop. Use prop directly below.
  // `switchTab` branches on offline vs api-backed mode internally — so a user
  // who loaded the jaffle-shop demo (offline) and a user with a real project
  // on disk both route through the same click handler.
  const openFile = useWorkspaceStore((s) => s.switchTab);
  const createFolderAction = useWorkspaceStore((s) => s.createFolder);
  const renameFileAction = useWorkspaceStore((s) => s.renameFile);
  const moveFileAction = useWorkspaceStore((s) => s.moveFile);
  const renameFolderAction = useWorkspaceStore((s) => s.renameFolder);
  const deleteFileAction = useWorkspaceStore((s) => s.deleteFile);
  const deleteFolderAction = useWorkspaceStore((s) => s.deleteFolder);
  const addToast = useUiStore((s) => s.addToast);
  const createNewFile = useWorkspaceStore((s) => s.createNewFile);
  const createNewDiagram = useWorkspaceStore((s) => s.createNewDiagram);
  const fileTree = React.useMemo(
    () => buildFileTree(projectFiles || [], optimisticFolders || []),
    [projectFiles, optimisticFolders]
  );

  const [folded, setFolded] = React.useState({});
  const toggleFolder = (path) => setFolded((s) => ({ ...s, [path]: !s[path] }));

  // Context menu + drag state. `ctxMenu` is `{x, y, target, path}` or null.
  const [ctxMenu, setCtxMenu] = React.useState(null);
  const explorerReady = !offlineMode && !!activeProjectId;

  const openCtxMenu = React.useCallback((e, target, path) => {
    if (!explorerReady) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target, path: path || "" });
  }, [explorerReady]);

  const closeCtxMenu = React.useCallback(() => setCtxMenu(null), []);

  // Combine a parent folder path with a child name into a POSIX subpath.
  const joinChild = React.useCallback((parent, name) => {
    const base = String(parent || "").replace(/\/+$/, "");
    const clean = String(name || "").replace(/^\/+|\/+$/g, "");
    return base ? `${base}/${clean}` : clean;
  }, []);

  const handleCtxAction = React.useCallback(async (actionId, menu) => {
    try {
      if (actionId === "new-file") {
        const name = window.prompt("New file name (e.g. stg_orders.yml):", "new_model.yml");
        if (!name) return;
        const fullRel = joinChild(menu.target === "folder" ? menu.path : "", name);
        // createNewFile treats `name` as a POSIX subpath relative to project model root.
        await createNewFile(fullRel, "");
      } else if (actionId === "new-folder") {
        const name = window.prompt("New folder name:", "new_folder");
        if (!name) return;
        const fullRel = joinChild(menu.target === "folder" ? menu.path : "", name);
        await createFolderAction(fullRel);
      } else if (actionId === "new-diagram") {
        const name = window.prompt("New diagram name:", "untitled");
        if (!name) return;
        // Drop the new .diagram.yaml into the clicked folder. Root target
        // falls through to the default datalex/diagrams/ location.
        const folder = menu.target === "folder" ? menu.path || "" : "";
        await createNewDiagram(name, folder);
      } else if (actionId === "rename") {
        const current = menu.path || "";
        const next = window.prompt("Rename to (full path from model root):", current);
        if (!next || next === current) return;
        // Phase 3.3 — preview reference-rewrite impact before we actually
        // execute the rename. User sees the list of diagrams + manifests
        // that will be rewritten so there's no surprise cascade.
        const scope = menu.target === "folder" ? "folder" : "file";
        const impact = await useWorkspaceStore.getState().previewRenameImpact(current, next, scope);
        const promptText = useWorkspaceStore.getState().formatRenameImpactPrompt(current, next, impact);
        const proceed = window.confirm(promptText);
        if (!proceed) return;
        if (menu.target === "folder") await renameFolderAction(current, next);
        else await renameFileAction(current, next);
        const cascade = useWorkspaceStore.getState().lastRenameCascade;
        if (cascade?.filesUpdated?.length) {
          addToast({
            type: "info",
            message: `Renamed to "${next}". Rewrote ${cascade.filesUpdated.length} related file${cascade.filesUpdated.length === 1 ? "" : "s"}.`,
          });
        }
        if (cascade?.failures?.length) {
          addToast({
            type: "warning",
            message: `Rename-cascade partially failed (${cascade.failures.length} file${cascade.failures.length === 1 ? "" : "s"}). See console.`,
          });
          console.warn("[datalex] rename-cascade failures:", cascade.failures);
        }
      } else if (actionId === "move") {
        const current = menu.path || "";
        const next = window.prompt("Move to (full path from model root):", current);
        if (!next || next === current) return;
        await moveFileAction(current, next);
      } else if (actionId === "delete") {
        // Phase 3.4 — preview the cascade before confirming. User sees how
        // many diagrams + relationships will be affected so there's no
        // silent data loss.
        const scope = menu.target === "folder" ? "folder" : "file";
        const impact = await useWorkspaceStore.getState().previewDeleteImpact(menu.path, scope);
        const promptText = useWorkspaceStore.getState().formatDeleteImpactPrompt(menu.path, scope, impact);
        const confirmed = window.confirm(promptText);
        if (!confirmed) return;
        if (scope === "folder") await deleteFolderAction(menu.path);
        else await deleteFileAction(menu.path);
        // Surface the cascade: "also rewrote N file(s) to remove M reference(s)"
        // so the user isn't surprised by silent edits to sibling model files.
        const cascade = useWorkspaceStore.getState().lastDeleteCascade;
        if (cascade && cascade.filesUpdated && cascade.filesUpdated.length) {
          addToast({
            type: "info",
            message: `Removed ${cascade.entities.length} entity${cascade.entities.length === 1 ? "" : "s"} and rewrote ${cascade.filesUpdated.length} related file${cascade.filesUpdated.length === 1 ? "" : "s"}.`,
          });
        }
        if (cascade && cascade.failures && cascade.failures.length) {
          addToast({
            type: "warning",
            message: `Cascade partially failed (${cascade.failures.length} file${cascade.failures.length === 1 ? "" : "s"}). See console.`,
          });
          console.warn("[datalex] delete-cascade failures:", cascade.failures);
        }
      }
    } catch (err) {
      window.alert(`Action failed: ${err?.message || err}`);
    }
  }, [
    joinChild,
    createNewFile,
    createNewDiagram,
    createFolderAction,
    renameFileAction,
    renameFolderAction,
    moveFileAction,
    deleteFileAction,
    deleteFolderAction,
    addToast,
  ]);

  // Drag-and-drop: drop a file onto a folder to move it there.
  const handleDropOnFolder = React.useCallback(async (sourcePath, folderPath) => {
    if (!explorerReady || !sourcePath) return;
    const name = sourcePath.split("/").pop();
    const destPath = joinChild(folderPath, name);
    if (destPath === sourcePath) return;
    try {
      await moveFileAction(sourcePath, destPath);
    } catch (err) {
      window.alert(`Move failed: ${err?.message || err}`);
    }
  }, [explorerReady, joinChild, moveFileAction]);

  const filteredTables = tables.filter((t) => !query || t.name.toLowerCase().includes(query.toLowerCase()));

  const byKind = {
    TABLES:    filteredTables.filter((t) => t.kind !== "ENUM"),
    VIEWS:     [],
    ENUMS:     filteredTables.filter((t) => t.kind === "ENUM"),
    FUNCTIONS: [],
    SEQUENCES: [],
    TRIGGERS:  [],
  };

  const section = (key, label, items, renderItem) => (
    <div key={key} className={`tree-section ${collapsed[key] ? "collapsed" : ""}`}>
      <div className="tree-section-header" onClick={() => toggle(key)}>
        <svg className="tree-caret" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="currentColor" /></svg>
        <span>{label}</span>
        <span className="count">({items.length})</span>
        <button className="add" onClick={(e) => { e.stopPropagation(); onAddEntity && onAddEntity(key); }}><I.Plus /></button>
      </div>
      <div className="tree-items">{items.map(renderItem)}</div>
    </div>
  );

  const schemaList = schemas.length ? schemas : [{ name: "public", count: tables.length }];

  return (
    <div className="left">
      <div className="left-tabs">
        {["OBJECTS", "EXPLORER", "THEMES"].map((t) => (
          <button key={t} className={`left-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "OBJECTS" && (
        <>
          <div className="left-search">
            <div className="search-field">
              <I.Search />
              <input placeholder="Filter objects…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button className="icon-btn" title="Filter"><I.Filter /></button>
          </div>
          <div className="tree">
            {section("TABLES", "Tables", byKind.TABLES, (t) => (
              <div key={t.id}
                   className={`tree-item ${activeTable === t.id ? "active" : ""}`}
                   onClick={() => onSelectTable(t.id)}>
                <I.Table />
                <span>{t.name}</span>
                <span className="badge">{t.columns.length}</span>
              </div>
            ))}
            {byKind.VIEWS.length > 0 && section("VIEWS", "Views", byKind.VIEWS, (v) => (
              <div key={v.id} className="tree-item"><I.View /><span>{v.name}</span></div>
            ))}
            {byKind.ENUMS.length > 0 && section("ENUMS", "Enums", byKind.ENUMS, (e) => (
              <div key={e.id}
                   className={`tree-item ${activeTable === e.id ? "active" : ""}`}
                   onClick={() => onSelectTable(e.id)}>
                <I.Enum /><span>{e.name}</span>
              </div>
            ))}
            {subjectAreas.length > 0 && (
              <div className="tree-section">
                <div className="tree-section-header">
                  <svg className="tree-caret" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="currentColor" /></svg>
                  <span>Subject Areas</span><span className="count">({subjectAreas.length})</span>
                </div>
                <div className="tree-items">
                  {subjectAreas.map((s) => (
                    <div key={s.id || s.label} className="tree-item">
                      <span className="swatch" style={{ background: s.color || `var(--cat-${s.cat})` }} />
                      <span>{s.label}</span>
                      <I.Eye />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "EXPLORER" && (
        <div
          className="tree"
          style={{ padding: "14px 16px" }}
          onContextMenu={(e) => {
            // Right-click on empty space in the Explorer falls through to the
            // "root" menu. Nodes stopPropagation so they take precedence.
            if (!explorerReady) return;
            e.preventDefault();
            setCtxMenu({ x: e.clientX, y: e.clientY, target: "root", path: "" });
          }}
        >
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>Workspace</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--border-default)", borderRadius: 6, marginBottom: 12 }}>
            <I.Db />
            <div style={{ flex: 1, minWidth: 0 }}>
              {projects.length > 1 && onSelectProject ? (
                <select
                  value={activeProjectId || ""}
                  onChange={(e) => onSelectProject(e.target.value)}
                  style={{
                    width: "100%",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    background: "transparent",
                    color: "var(--text-primary)",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                  title="Switch project"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connectionLabel}</div>
              )}
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connectionDsn}</div>
            </div>
            <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-success)" }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Files</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {explorerReady && (
                <>
                  <button
                    className="icon-btn"
                    title="New file"
                    onClick={() => handleCtxAction("new-file", { target: "root", path: "" })}
                    style={{ padding: 2 }}
                  >
                    <I.Plus />
                  </button>
                  <button
                    className="icon-btn"
                    title="New folder"
                    onClick={() => handleCtxAction("new-folder", { target: "root", path: "" })}
                    style={{ padding: 2 }}
                  >
                    <I.Folder />
                  </button>
                  <button
                    className="icon-btn"
                    title="New diagram"
                    onClick={async () => {
                      const name = window.prompt(
                        "Diagram name (saved as datalex/diagrams/<name>.diagram.yaml):",
                        "untitled"
                      );
                      if (!name || !name.trim()) return;
                      try {
                        await createNewDiagram(name.trim());
                      } catch (err) {
                        window.alert(`Could not create diagram: ${err?.message || err}`);
                      }
                    }}
                    style={{ padding: 2 }}
                  >
                    <I.Layers />
                  </button>
                </>
              )}
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{(projectFiles || []).length}</div>
            </div>
          </div>

          {(!projectFiles || projectFiles.length === 0) ? (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", padding: "8px 2px", lineHeight: 1.5 }}>
              No files yet. Open a project or import a dbt repo.
            </div>
          ) : (
            <TreeRender
              nodes={fileTree}
              folded={folded}
              toggleFolder={toggleFolder}
              activeFullPath={activeFullPath}
              onOpenFile={openFile}
              I={I}
              depth={0}
              onContextMenu={explorerReady ? openCtxMenu : null}
              onDropOnFolder={explorerReady ? handleDropOnFolder : null}
            />
          )}

          <ExplorerContextMenu
            menu={ctxMenu}
            onClose={closeCtxMenu}
            onAction={handleCtxAction}
          />
        </div>
      )}

      {tab === "THEMES" && (
        <div style={{ padding: "14px 16px", overflowY: "auto" }}>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Appearance</div>
          {THEMES.map((t) => {
            const active = t.id === theme;
            return (
              <button key={t.id} onClick={() => setTheme(t.id)}
                style={{
                  width: "100%", textAlign: "left",
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 10px", marginBottom: 6,
                  border: `1px solid ${active ? "var(--accent)" : "var(--border-default)"}`,
                  borderRadius: 8,
                  background: active ? "var(--accent-dim)" : "var(--bg-2)",
                  cursor: "pointer", transition: "all 120ms var(--ease)",
                }}>
                <div style={{ display: "flex", gap: 0, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border-default)" }}>
                  {t.colors.map((c, i) => <div key={i} style={{ width: 12, height: 28, background: c }} />)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                    {t.name}
                    <span style={{
                      fontSize: 9, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase",
                      padding: "1px 5px", borderRadius: 3, background: "var(--bg-3)", color: "var(--text-tertiary)",
                    }}>{t.mode}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>{t.sub}</div>
                </div>
                {active && <I.Check />}
              </button>
            );
          })}
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", margin: "18px 0 8px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Keyboard</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 2px" }}>
            <span>Cycle themes</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, padding: "2px 6px", background: "var(--bg-3)", borderRadius: 4, border: "1px solid var(--border-default)" }}>⌘⇧T</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Recursive file-tree renderer for the EXPLORER tab.
 *
 * A `TreeNode` is either a folder `{kind:"folder", name, path, children}` or
 * a file `{kind:"file", name, path, file}`. Indentation is computed from
 * `depth` so nested folders visually nest without an extra per-row style.
 * Folder rows are fold/unfold triggers; file rows open the file in the
 * workspace (same code path as the legacy flat list). Clicking the active
 * file re-opens it — harmless but consistent with "click a row to focus".
 * ------------------------------------------------------------------ */
function TreeRender({
  nodes,
  folded,
  toggleFolder,
  activeFullPath,
  onOpenFile,
  I,
  depth,
  onContextMenu = null,
  onDropOnFolder = null,
}) {
  if (!nodes || nodes.length === 0) return null;
  // `dragOver` toggles a visual highlight on folder rows while a file is
  // dragged over them. Keyed by folder path to keep the state local.
  const [dragOverPath, setDragOverPath] = React.useState("");
  return (
    <>
      {nodes.map((n) => {
        const indent = 8 + depth * 12;
        if (n.kind === "folder") {
          const isFolded = !!folded[n.path];
          const count = countFiles(n);
          const isDragOver = dragOverPath === n.path;
          return (
            <div key={`f:${n.path}`}>
              <div
                className="tree-item"
                onClick={() => toggleFolder(n.path)}
                onContextMenu={onContextMenu ? (e) => onContextMenu(e, "folder", n.path) : undefined}
                title={n.path}
                style={{
                  paddingLeft: indent,
                  cursor: "pointer",
                  background: isDragOver ? "var(--accent-dim, var(--bg-3))" : undefined,
                  outline: isDragOver ? "1px solid var(--accent, var(--border-default))" : undefined,
                  transition: "background 80ms var(--ease)",
                }}
                onDragOver={onDropOnFolder ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverPath !== n.path) setDragOverPath(n.path);
                } : undefined}
                onDragLeave={onDropOnFolder ? () => {
                  if (dragOverPath === n.path) setDragOverPath("");
                } : undefined}
                onDrop={onDropOnFolder ? (e) => {
                  e.preventDefault();
                  setDragOverPath("");
                  const sourcePath = e.dataTransfer.getData("application/x-datalex-file-path");
                  if (sourcePath) onDropOnFolder(sourcePath, n.path);
                } : undefined}
              >
                <svg
                  className="tree-caret"
                  viewBox="0 0 10 10"
                  style={{
                    transform: isFolded ? "rotate(0deg)" : "rotate(90deg)",
                    transition: "transform 120ms var(--ease)",
                    flex: "0 0 10px",
                  }}
                >
                  <path d="M3 2l4 3-4 3" fill="currentColor" />
                </svg>
                <I.Folder />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                <span className="badge">{count}</span>
              </div>
              {!isFolded && (
                <TreeRender
                  nodes={n.children}
                  folded={folded}
                  toggleFolder={toggleFolder}
                  activeFullPath={activeFullPath}
                  onOpenFile={onOpenFile}
                  I={I}
                  depth={depth + 1}
                  onContextMenu={onContextMenu}
                  onDropOnFolder={onDropOnFolder}
                />
              )}
            </div>
          );
        }

        const fd = n.file || {};
        const fullPath = fd.fullPath || fd.path || n.path;
        const isActive = activeFullPath && fullPath === activeFullPath;
        return (
          <div
            key={`l:${n.path}`}
            className={`tree-item ${isActive ? "active" : ""}`}
            onClick={() => onOpenFile && fd && onOpenFile(fd)}
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, "file", n.path) : undefined}
            draggable={!!onDropOnFolder}
            onDragStart={onDropOnFolder ? (e) => {
              // Carry the source file's subpath through the drag payload.
              // The drop target is a folder row that knows how to move it.
              e.dataTransfer.setData("application/x-datalex-file-path", n.path);
              // YAML sources also carry a second payload so the canvas drop
              // zone can reject non-YAML drags cleanly. We don't peek at the
              // content here — the canvas adapter figures out dbt-schema vs
              // datalex-model shape at render time.
              if (/\.ya?ml$/i.test(n.name || "")) {
                const fullPath = (fd.fullPath || fd.path || n.path || "").replace(/^[/\\]+/, "");
                e.dataTransfer.setData(
                  "application/x-datalex-yaml-source",
                  JSON.stringify({ path: fullPath })
                );
              }
              e.dataTransfer.effectAllowed = "copyMove";
            } : undefined}
            title={fullPath || n.path}
            style={{ paddingLeft: indent + 10, cursor: onDropOnFolder ? "grab" : undefined }}
          >
            {/* Distinct icon for diagram files so the Explorer surfaces them
                at a glance — same column as table icons, but a Layers glyph
                signals "multi-file composition". */}
            {/\.diagram\.ya?ml$/i.test(n.name || "") ? <I.Layers /> : <I.Table />}
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
          </div>
        );
      })}
    </>
  );
}
