/* YamlEditorShell — wraps the lazy-loaded YamlEditor + new DocsView so the
   user can toggle between Code, Split, and Docs views over the same active
   file. The toggle persists via localStorage (`datalex.editor.viewMode`).

   For YAML files (`.yaml` / `.yml`) we default to Docs view; everything
   else defaults to Code so we don't try to parse non-YAML as docs. */
import React, { useMemo, useState } from "react";
import { Allotment } from "allotment";
import useWorkspaceStore from "../../stores/workspaceStore";
import { PanelEmpty } from "../../components/panels/PanelFrame";
import { FileText } from "lucide-react";
import CodeDocsToggle, {
  readViewMode,
  VIEW_DOCS,
  VIEW_SPLIT,
  VIEW_CODE,
} from "../../components/docs/CodeDocsToggle";

const YamlEditor = React.lazy(() => import("../../components/editor/YamlEditor"));
const DocsView = React.lazy(() => import("../../components/docs/DocsView"));

function isYamlFile(file) {
  if (!file) return false;
  const name = String(file.name || file.path || "").toLowerCase();
  return name.endsWith(".yaml") || name.endsWith(".yml");
}

export default function YamlEditorShell() {
  const activeFile = useWorkspaceStore((s) => s.activeFile);

  // Default to Docs for YAML files, Code for everything else. The user's
  // last explicit choice (in localStorage) overrides this default.
  const initialMode = useMemo(
    () => readViewMode(isYamlFile(activeFile) ? VIEW_DOCS : VIEW_CODE),
    // Re-evaluate when file changes type (e.g., switching from .yaml to .sql),
    // but the persisted choice still wins if set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeFile?.path]
  );
  const [viewMode, setViewMode] = useState(initialMode);

  if (!activeFile) {
    return (
      <PanelEmpty
        icon={FileText}
        title="No file open"
        description="Open a project file to edit its YAML here."
      />
    );
  }

  const yamlAware = isYamlFile(activeFile);
  const effectiveMode = yamlAware ? viewMode : VIEW_CODE;

  const codePane = (
    <React.Suspense
      fallback={<div style={{ padding: 20, fontSize: 12, color: "var(--text-tertiary)" }}>Loading editor…</div>}
    >
      <YamlEditor />
    </React.Suspense>
  );

  const docsPane = (
    <React.Suspense
      fallback={<div style={{ padding: 20, fontSize: 12, color: "var(--text-tertiary)" }}>Rendering docs…</div>}
    >
      <DocsView />
    </React.Suspense>
  );

  return (
    <div style={{ height: "100%", minHeight: 240, display: "flex", flexDirection: "column" }}>
      {/* Toggle bar — only meaningful for YAML files. */}
      {yamlAware && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "6px 10px",
            borderBottom: "1px solid var(--border-default)",
            background: "var(--bg-2)",
          }}
        >
          <CodeDocsToggle value={viewMode} onChange={setViewMode} />
        </div>
      )}

      {/* Body. Split renders both panes via Allotment (already a project dep). */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {effectiveMode === VIEW_SPLIT ? (
          <Allotment defaultSizes={[50, 50]}>
            <Allotment.Pane minSize={200}>{docsPane}</Allotment.Pane>
            <Allotment.Pane minSize={200}>{codePane}</Allotment.Pane>
          </Allotment>
        ) : effectiveMode === VIEW_DOCS ? (
          docsPane
        ) : (
          codePane
        )}
      </div>
    </div>
  );
}
