/* YamlEditorShell — wraps the lazy-loaded YamlEditor so it fills the
   PanelFrame body cleanly. Rendered only when the YAML tab is active.
   Shows a placeholder when no file is open.

   Note: the readable Docs view used to live here too (with a
   Code/Docs/Split toggle), but it duplicated content the right panel
   already shows per-entity. The full-file Docs view now lives at the
   top-level workspace tab (`shellViewMode === "docs"`); this panel is
   back to being the raw-YAML editor only. */
import React from "react";
import useWorkspaceStore from "../../stores/workspaceStore";
import { PanelEmpty } from "../../components/panels/PanelFrame";
import { FileText } from "lucide-react";

const YamlEditor = React.lazy(() => import("../../components/editor/YamlEditor"));

export default function YamlEditorShell() {
  const activeFile = useWorkspaceStore((s) => s.activeFile);

  if (!activeFile) {
    return (
      <PanelEmpty
        icon={FileText}
        title="No file open"
        description="Open a project file to edit its YAML here."
      />
    );
  }

  return (
    <div style={{ height: "100%", minHeight: 240, display: "flex", flexDirection: "column" }}>
      <React.Suspense
        fallback={
          <div style={{ padding: 20, fontSize: 12, color: "var(--text-tertiary)" }}>
            Loading editor…
          </div>
        }
      >
        <YamlEditor />
      </React.Suspense>
    </div>
  );
}
