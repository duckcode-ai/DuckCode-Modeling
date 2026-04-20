/* YamlEditorShell — wraps the lazy-loaded YamlEditor so it fills the
   PanelFrame body cleanly. Rendered only when the YAML tab is active.
   Shows a placeholder when no file is open. */
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
