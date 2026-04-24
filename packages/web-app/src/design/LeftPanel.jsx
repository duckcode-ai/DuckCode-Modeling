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
import { rebuildAiIndex } from "../lib/api";

function filterTreeNodes(nodes, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return nodes || [];
  const visit = (items) => {
    const out = [];
    for (const node of items || []) {
      if (node.kind === "folder") {
        const children = visit(node.children || []);
        const selfMatch = String(node.name || "").toLowerCase().includes(needle)
          || String(node.path || "").toLowerCase().includes(needle);
        if (selfMatch || children.length > 0) {
          out.push({ ...node, children });
        }
      } else {
        const haystack = `${node.name || ""} ${node.path || ""}`.toLowerCase();
        if (haystack.includes(needle)) out.push(node);
      }
    }
    return out;
  };
  return visit(nodes || []);
}

function artifactMeta(path, name, kind = "file") {
  const p = String(path || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  const isDiagramConceptual = /^diagrams\/conceptual(\/|$)/.test(p);
  const isDiagramLogical = /^diagrams\/logical(\/|$)/.test(p);
  const isDiagramPhysical = /^diagrams\/physical(\/|$)/.test(p);
  const isModelConceptual = /^models\/conceptual(\/|$)/.test(p);
  const isModelLogical = /^models\/logical(\/|$)/.test(p);
  const isModelPhysical = /^models\/physical(\/|$)/.test(p);
  const isGeneratedDbt = /^generated-sql\//.test(p) || /^datalex\/generated\/dbt(\/|$)/.test(p);
  if (kind === "folder") {
    if (isDiagramConceptual) return { tone: "conceptual", label: "conceptual", icon: "diagram" };
    if (isDiagramLogical) return { tone: "logical", label: "logical", icon: "diagram" };
    if (isDiagramPhysical) return { tone: "physical", label: "physical", icon: "diagram" };
    if (isModelConceptual) return { tone: "conceptual", label: "conceptual", icon: "folder" };
    if (isModelLogical) return { tone: "logical", label: "logical", icon: "folder" };
    if (isModelPhysical) return { tone: "physical", label: "physical", icon: "folder" };
    if (isGeneratedDbt) return { tone: "dbt", label: "generated", icon: "dbt" };
    if (p === "datalex" || p.startsWith("datalex/")) return { tone: "diagram", label: "DataLex", icon: "folder" };
    if (p.includes("conceptual")) return { tone: "conceptual", label: "conceptual", icon: "folder" };
    if (p.includes("logical")) return { tone: "logical", label: "logical", icon: "folder" };
    if (p.includes("physical")) return { tone: "physical", label: "physical", icon: "folder" };
    if (p === "models" || p.startsWith("models/")) return { tone: "models", label: "models", icon: "folder" };
    if (p === "diagrams" || p.startsWith("diagrams/") || p.endsWith("diagrams")) return { tone: "diagram", label: "diagrams", icon: "diagram" };
    if (p.startsWith("semantic")) return { tone: "semantic", label: "semantic", icon: "semantic" };
    if (p.startsWith("relationships")) return { tone: "relationship", label: "relationships", icon: "relationship" };
    if (p.startsWith("data_types")) return { tone: "datatype", label: "types", icon: "datatype" };
    return { tone: "folder", label: "", icon: "folder" };
  }
  if (/\.diagram\.ya?ml$/i.test(n)) {
    if (isDiagramConceptual) return { tone: "conceptual", label: "diagram", icon: "diagram" };
    if (isDiagramLogical) return { tone: "logical", label: "diagram", icon: "diagram" };
    if (isDiagramPhysical) return { tone: "physical", label: "diagram", icon: "diagram" };
    return { tone: "diagram", label: "diagram", icon: "diagram" };
  }
  if (isGeneratedDbt && /\.sql$/i.test(n)) return { tone: "dbt", label: "sql", icon: "dbt" };
  if (isGeneratedDbt && /\.ya?ml$/i.test(n)) return { tone: "dbt", label: "dbt", icon: "dbt" };
  if (p.includes("/conceptual/")) return { tone: "conceptual", label: "concept", icon: "entity" };
  if (p.includes("/logical/")) return { tone: "logical", label: "logical", icon: "entity" };
  if (p.includes("/physical/")) return { tone: "physical", label: "physical", icon: "entity" };
  if (p.startsWith("semantic/")) return { tone: "semantic", label: "semantic", icon: "semantic" };
  if (p.startsWith("relationships/")) return { tone: "relationship", label: "relation", icon: "relationship" };
  if (p.startsWith("data_types/")) return { tone: "datatype", label: "type", icon: "datatype" };
  if (n === "dbt_project.yml" || n === "dbt_project.yaml" || n === "schema.yml" || n === "schema.yaml" || p.includes("/schema.y")) {
    return { tone: "dbt", label: "dbt", icon: "dbt" };
  }
  if (/\.ya?ml$/i.test(n) && /^(models|seeds|snapshots|analyses|macros)\//i.test(p)) {
    return { tone: "dbt", label: "dbt", icon: "dbt" };
  }
  return { tone: "file", label: "yaml", icon: "entity" };
}

function ArtifactIcon({ I, meta }) {
  const key = meta?.icon || "entity";
  if (key === "diagram") return <I.Layers />;
  if (key === "relationship") return <I.Relation />;
  if (key === "datatype") return <I.Enum />;
  if (key === "semantic") return <I.View />;
  if (key === "dbt") return <I.Dep />;
  if (key === "folder") return <I.Folder />;
  return <I.Table />;
}

const SKILL_TEMPLATES = [
  {
    id: "conceptual",
    name: "conceptual-business-modeling",
    title: "Conceptual",
    description: "Business concepts, domains, owners, glossary terms, and business relationships.",
    useWhen: "conceptual model\nbusiness concept\nbusiness scenario\ndomain model\nbounded context",
    tags: "conceptual,business,glossary",
    layers: "conceptual",
    agentModes: "conceptual_architect\nrelationship_modeler",
    body: "- Create concepts, not tables.\n- Require description, owner, subject_area, domain, tags, and glossary terms when known.\n- Use relationship verbs in business language.\n- Ask follow-up questions when business meaning is unclear.",
  },
  {
    id: "logical",
    name: "logical-modeling-standards",
    title: "Logical",
    description: "Entities, attributes, candidate keys, optionality, and lineage.",
    useWhen: "logical model\nattribute\ncandidate key\nnormalization\npromote to logical",
    tags: "logical,attributes,keys",
    layers: "logical",
    agentModes: "logical_modeler\nyaml_patch_engineer",
    body: "- Preserve conceptual lineage with derived_from or mapped_from metadata.\n- Define attributes with business names and descriptions.\n- Identify candidate keys and optionality from business meaning.\n- Avoid warehouse-only implementation choices.",
  },
  {
    id: "physical",
    name: "physical-dbt-modeling",
    title: "Physical dbt",
    description: "dbt YAML, columns, datatypes, tests, constraints, and contracts.",
    useWhen: "physical model\ndbt\nschema.yml\ncolumn\ndatatype\ntest\nconstraint",
    tags: "physical,dbt,tests,constraints",
    layers: "physical",
    agentModes: "physical_dbt_developer\nyaml_patch_engineer",
    body: "- Preserve existing dbt YAML, descriptions, tests, tags, meta, and contracts.\n- Prefer focused YAML patches over full-file rewrites.\n- Infer datatypes from existing YAML, SQL, catalog metadata, or clear naming conventions.\n- Do not run dbt or apply DDL.",
  },
  {
    id: "governance",
    name: "governance-and-validation",
    title: "Governance",
    description: "Validation, coverage, ownership, policy, and quality rules.",
    useWhen: "validation\ncoverage\ngovernance\nmissing description\nmissing owner\npolicy",
    tags: "governance,validation,quality",
    layers: "conceptual,logical,physical",
    agentModes: "governance_reviewer\nyaml_patch_engineer",
    body: "- Explain what is missing, why it matters, and the smallest safe YAML fix.\n- Separate blockers from documentation quality improvements.\n- Prioritize owner, description, glossary, keys, tests, and relationship endpoints by layer.",
  },
];
const DATALEX_SKILL_FOLDER = "Skills";

function skillSlug(value) {
  return String(value || "modeling-skill")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "modeling-skill";
}

function skillList(value, fallback = []) {
  const items = String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function buildSkillContent({ name, description, useWhen, tags, layers, agentModes, body }) {
  const title = String(name || "modeling-skill").trim();
  const useWhenList = skillList(useWhen, ["modeling assistance"]);
  const tagList = skillList(tags, ["modeling"]);
  const layerList = skillList(layers, ["conceptual", "logical", "physical"]);
  const agentModeList = skillList(agentModes, ["governance_reviewer"]);
  return [
    "---",
    `name: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(String(description || "DataLex AI modeling skill").trim())}`,
    "use_when:",
    ...useWhenList.map((item) => `  - ${JSON.stringify(item)}`),
    "tags:",
    ...tagList.map((item) => `  - ${JSON.stringify(item)}`),
    "layers:",
    ...layerList.map((item) => `  - ${JSON.stringify(item)}`),
    "agent_modes:",
    ...agentModeList.map((item) => `  - ${JSON.stringify(item)}`),
    "priority: 1",
    "---",
    "",
    `# ${title}`,
    "",
    "## When to use",
    ...useWhenList.map((item) => `- ${item}`),
    "",
    "## Instructions",
    String(body || "- Add your team's modeling standards here.").trim(),
    "",
  ].join("\n");
}

export default function LeftPanel({ activeTable, onSelectTable, tables, theme, setTheme, subjectAreas = [], connectionLabel = "workspace", connectionDsn = "", schemas = [], onAddEntity, projects = [], activeProjectId = null, onSelectProject = null }) {
  const I = Icon;
  const [tab, setTab] = React.useState("OBJECTS");
  const [query, setQuery] = React.useState("");
  const [explorerQuery, setExplorerQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState({});
  const [selectedSkillTemplate, setSelectedSkillTemplate] = React.useState(SKILL_TEMPLATES[0].id);
  const initialSkillTemplate = SKILL_TEMPLATES[0];
  const [skillName, setSkillName] = React.useState(initialSkillTemplate.name);
  const [skillDescription, setSkillDescription] = React.useState(initialSkillTemplate.description);
  const [skillUseWhen, setSkillUseWhen] = React.useState(initialSkillTemplate.useWhen);
  const [skillTags, setSkillTags] = React.useState(initialSkillTemplate.tags);
  const [skillLayers, setSkillLayers] = React.useState(initialSkillTemplate.layers);
  const [skillAgentModes, setSkillAgentModes] = React.useState(initialSkillTemplate.agentModes);
  const [skillBody, setSkillBody] = React.useState(initialSkillTemplate.body);
  const [skillStatus, setSkillStatus] = React.useState("");
  const [skillBusy, setSkillBusy] = React.useState(false);
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
  const createNewFile = useWorkspaceStore((s) => s.createNewFile);
  const createFolderAction = useWorkspaceStore((s) => s.createFolder);
  const renameFileAction = useWorkspaceStore((s) => s.renameFile);
  const moveFileAction = useWorkspaceStore((s) => s.moveFile);
  const renameFolderAction = useWorkspaceStore((s) => s.renameFolder);
  const deleteFileAction = useWorkspaceStore((s) => s.deleteFile);
  const deleteFolderAction = useWorkspaceStore((s) => s.deleteFolder);
  const addToast = useUiStore((s) => s.addToast);
  const openModal = useUiStore((s) => s.openModal);
  const openAiPanel = useUiStore((s) => s.openAiPanel);
  const explorerReady = !offlineMode && !!activeProjectId;
  const fileTree = React.useMemo(
    () => buildFileTree(projectFiles || [], optimisticFolders || []),
    [projectFiles, optimisticFolders]
  );
  const filteredFileTree = React.useMemo(
    () => filterTreeNodes(fileTree, explorerQuery),
    [fileTree, explorerQuery]
  );
  const skillFiles = React.useMemo(() => (
    (projectFiles || [])
      .filter((file) => {
        const path = String(file.path || file.name || "").replace(/\\/g, "/").toLowerCase();
        return path.startsWith(`${DATALEX_SKILL_FOLDER.toLowerCase()}/`);
      })
      .sort((a, b) => String(a.path || a.name || "").localeCompare(String(b.path || b.name || "")))
  ), [projectFiles]);

  React.useEffect(() => {
    const onTab = (event) => {
      const next = event?.detail?.tab;
      if (next) setTab(String(next).toUpperCase());
    };
    window.addEventListener("datalex:left-tab", onTab);
    return () => window.removeEventListener("datalex:left-tab", onTab);
  }, []);

  const applySkillTemplate = React.useCallback((templateId) => {
    const template = SKILL_TEMPLATES.find((item) => item.id === templateId) || SKILL_TEMPLATES[0];
    setSelectedSkillTemplate(template.id);
    setSkillName(template.name);
    setSkillDescription(template.description);
    setSkillUseWhen(template.useWhen);
    setSkillTags(template.tags);
    setSkillLayers(template.layers);
    setSkillAgentModes(template.agentModes);
    setSkillBody(template.body);
  }, []);

  const createSkill = React.useCallback(async () => {
    if (!explorerReady) {
      setSkillStatus("Open a local project before creating skills.");
      return;
    }
    const slug = skillSlug(skillName);
    const content = buildSkillContent({
      name: skillName,
      description: skillDescription,
      useWhen: skillUseWhen,
      tags: skillTags,
      layers: skillLayers,
      agentModes: skillAgentModes,
      body: skillBody,
    });
    setSkillBusy(true);
    setSkillStatus("");
    try {
      const skillPath = `${DATALEX_SKILL_FOLDER}/${slug}.md`;
      await createNewFile(skillPath, content);
      await rebuildAiIndex(activeProjectId).catch(() => null);
      addToast?.({ type: "success", message: `Created AI skill ${skillPath}` });
      setSkillStatus(`Created and indexed ${skillPath}.`);
    } catch (err) {
      setSkillStatus(`Skill create failed: ${err?.message || err}`);
    } finally {
      setSkillBusy(false);
    }
  }, [activeProjectId, addToast, createNewFile, explorerReady, skillAgentModes, skillBody, skillDescription, skillLayers, skillName, skillTags, skillUseWhen]);

  const [folded, setFolded] = React.useState({});
  const toggleFolder = (path) => setFolded((s) => ({ ...s, [path]: !s[path] }));

  // Context menu + drag state. `ctxMenu` is `{x, y, target, path}` or null.
  const [ctxMenu, setCtxMenu] = React.useState(null);
  const dragStateRef = React.useRef({ path: "", at: 0 });

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
      if (actionId === "ask-ai") {
        openAiPanel({
          source: "explorer",
          targetName: menu.path || "workspace",
          context: {
            kind: menu.target === "file" ? "file" : menu.target === "folder" ? "folder" : "workspace",
            filePath: menu.target === "file" ? menu.path : "",
            folderPath: menu.target === "folder" ? menu.path : "",
          },
        });
      } else if (actionId === "new-file") {
        openModal("newFile", { targetFolder: menu.target === "folder" ? menu.path : "" });
      } else if (actionId === "new-folder") {
        const name = window.prompt("New folder name:", "new_folder");
        if (!name) return;
        const fullRel = joinChild(menu.target === "folder" ? menu.path : "", name);
        await createFolderAction(fullRel);
      } else if (actionId === "new-diagram") {
        openModal("newFile", { artifact: "diagram", targetFolder: menu.target === "folder" ? menu.path : "" });
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
    createFolderAction,
    renameFileAction,
    renameFolderAction,
    moveFileAction,
    deleteFileAction,
    deleteFolderAction,
    addToast,
    openModal,
    openAiPanel,
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
        {["OBJECTS", "EXPLORER", "SKILLS", "THEMES"].map((t) => (
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
          <div className="left-search" style={{ padding: 0, marginBottom: 12 }}>
            <div className="search-field">
              <I.Search />
              <input
                placeholder="Find YAML or model file…"
                value={explorerQuery}
                onChange={(e) => setExplorerQuery(e.target.value)}
              />
            </div>
            {explorerQuery ? (
              <button className="icon-btn" title="Clear search" onClick={() => setExplorerQuery("")}>
                <I.X />
              </button>
            ) : (
              <button className="icon-btn" title="Search workspace files">
                <I.Filter />
              </button>
            )}
          </div>

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

          <div data-tour="explorer-files" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Files</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {explorerReady && (
                <>
                  <button
                    className="icon-btn"
                    title="New modeling asset"
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
                    data-tour="new-diagram"
                    className="icon-btn"
                    title="New diagram"
                    onClick={() => openModal("newFile", { artifact: "diagram" })}
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
          ) : (explorerQuery && filteredFileTree.length === 0) ? (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", padding: "8px 2px", lineHeight: 1.5 }}>
              No matching files for “{explorerQuery}”.
            </div>
          ) : (
            <TreeRender
              nodes={filteredFileTree}
              folded={folded}
              toggleFolder={toggleFolder}
              activeFullPath={activeFullPath}
              onOpenFile={openFile}
              I={I}
              depth={0}
              onContextMenu={explorerReady ? openCtxMenu : null}
              onDropOnFolder={explorerReady ? handleDropOnFolder : null}
              dragStateRef={dragStateRef}
            />
          )}

          <ExplorerContextMenu
            menu={ctxMenu}
            onClose={closeCtxMenu}
            onAction={handleCtxAction}
          />
        </div>
      )}

      {tab === "SKILLS" && (
        <div className="left-skills-panel">
          <div className="left-skills-hero">
            <div className="left-skills-icon"><I.Sparkle /></div>
            <div>
              <div className="left-skills-title">Agent Skills</div>
              <div className="left-skills-sub">Teach DataLex when to use your business, dbt, and governance standards.</div>
            </div>
          </div>

          <div className="left-skills-templates">
            {SKILL_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`left-skill-template ${selectedSkillTemplate === template.id ? "active" : ""}`}
                onClick={() => applySkillTemplate(template.id)}
              >
                <strong>{template.title}</strong>
                <span>{template.description}</span>
              </button>
            ))}
          </div>

          <div className="left-skill-form">
            <label>
              <span>Name</span>
              <input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="business-modeling-standards" />
            </label>
            <label>
              <span>Description</span>
              <input value={skillDescription} onChange={(e) => setSkillDescription(e.target.value)} placeholder="When this skill should guide the AI" />
            </label>
            <label>
              <span>Use when</span>
              <textarea rows={3} value={skillUseWhen} onChange={(e) => setSkillUseWhen(e.target.value)} placeholder="One trigger per line" />
            </label>
            <div className="left-skill-grid">
              <label>
                <span>Tags</span>
                <input value={skillTags} onChange={(e) => setSkillTags(e.target.value)} placeholder="dbt,governance" />
              </label>
              <label>
                <span>Layers</span>
                <input value={skillLayers} onChange={(e) => setSkillLayers(e.target.value)} placeholder="conceptual,logical,physical" />
              </label>
            </div>
            <label>
              <span>Agent modes</span>
              <textarea rows={2} value={skillAgentModes} onChange={(e) => setSkillAgentModes(e.target.value)} placeholder="physical_dbt_developer" />
            </label>
            <label>
              <span>Instructions</span>
              <textarea rows={6} value={skillBody} onChange={(e) => setSkillBody(e.target.value)} placeholder="Write the rules this skill should enforce..." />
            </label>
            <button className="left-skill-create" type="button" onClick={createSkill} disabled={skillBusy || !explorerReady}>
              <I.Plus /> {skillBusy ? "Creating..." : "Create Skill"}
            </button>
            {skillStatus && <div className="left-skill-status">{skillStatus}</div>}
          </div>

          <div className="left-skills-existing">
            <div className="left-skills-heading">Existing Skills <span>{skillFiles.length}</span></div>
            {skillFiles.length === 0 ? (
              <div className="left-skills-empty">No skill files yet. Create one from a template above.</div>
            ) : skillFiles.map((file) => (
              <button
                key={file.fullPath || file.path || file.name}
                type="button"
                className="left-skill-file"
                onClick={() => openFile(file)}
              >
                <I.Dep />
                <span>{file.path || file.name}</span>
              </button>
            ))}
          </div>
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
  dragStateRef = null,
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
          const meta = artifactMeta(n.path, n.name, "folder");
          return (
            <div key={`f:${n.path}`}>
              <div
                className={`tree-item tree-artifact tree-artifact-${meta.tone}`}
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
                <span className="tree-artifact-icon"><ArtifactIcon I={I} meta={meta} /></span>
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
                  dragStateRef={dragStateRef}
                />
              )}
            </div>
          );
        }

        const fd = n.file || {};
        const fullPath = fd.fullPath || fd.path || n.path;
        const isActive = activeFullPath && fullPath === activeFullPath;
        const meta = artifactMeta(n.path, n.name, "file");
        return (
          <div
            key={`l:${n.path}`}
            className={`tree-item tree-artifact tree-artifact-${meta.tone} ${isActive ? "active" : ""}`}
            onClick={() => {
              const dragState = dragStateRef?.current;
              if (
                dragState &&
                dragState.path === n.path &&
                Date.now() - dragState.at < 500
              ) {
                dragState.path = "";
                return;
              }
              if (onOpenFile && fd) onOpenFile(fd);
            }}
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, "file", n.path) : undefined}
            draggable={!!onDropOnFolder}
            onDragStart={onDropOnFolder ? (e) => {
              if (dragStateRef?.current) {
                dragStateRef.current.path = n.path;
                dragStateRef.current.at = Date.now();
              }
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
                e.dataTransfer.setData("text/plain", fullPath);
              }
              e.dataTransfer.effectAllowed = "copyMove";
            } : undefined}
            onDragEnd={onDropOnFolder ? () => {
              if (!dragStateRef?.current) return;
              window.setTimeout(() => {
                dragStateRef.current.path = "";
                dragStateRef.current.at = 0;
              }, 0);
            } : undefined}
            title={fullPath || n.path}
            style={{ paddingLeft: indent + 10, cursor: onDropOnFolder ? "grab" : undefined }}
          >
            <span className="tree-artifact-icon"><ArtifactIcon I={I} meta={meta} /></span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
          </div>
        );
      })}
    </>
  );
}
