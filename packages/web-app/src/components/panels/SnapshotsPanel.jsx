/* SnapshotsPanel — read-only viewer for dbt snapshots in the active YAML.
   P1.B added round-trip support for snapshots; this panel surfaces SCD
   strategy + unique_key + columns so reviewers don't have to read raw YAML. */
import React, { useMemo } from "react";
import { Camera, AlertTriangle } from "lucide-react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import { PanelFrame, PanelSection, PanelEmpty, PanelCard, StatusPill, KeyValueGrid } from "./PanelFrame";

function safeLoad(text) {
  try {
    const doc = yaml.load(text);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch (_) {
    return null;
  }
}

function collectSnapshots(doc) {
  if (!doc) return [];
  if (Array.isArray(doc.snapshots)) return doc.snapshots;
  if (doc.kind === "snapshot") return [doc];
  return [];
}

export default function SnapshotsPanel() {
  const { activeFileContent } = useWorkspaceStore();
  const snapshots = useMemo(() => collectSnapshots(safeLoad(activeFileContent || "")), [activeFileContent]);

  if (!snapshots.length) {
    return (
      <PanelFrame icon={<Camera size={14} />} eyebrow="dbt resources" title="Snapshots">
        <PanelEmpty
          icon={Camera}
          title="No snapshots"
          description="The active YAML has no snapshots: section. Open a schema.yml that declares dbt snapshots to see SCD strategy and columns."
        />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      icon={<Camera size={14} />}
      eyebrow="dbt resources"
      title="Snapshots"
      subtitle={`${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"}`}
    >
      <PanelSection title="SCD configuration" count={snapshots.length}>
        {snapshots.map((snap, idx) => {
          const config = snap.snapshot || snap.config || {};
          const cols = Array.isArray(snap.columns) ? snap.columns : [];
          const missing = !config.strategy || !config.unique_key;
          return (
            <PanelCard
              key={snap.name || idx}
              title={snap.name || `snapshot_${idx}`}
              subtitle={snap.description || ""}
              tone={missing ? "warning" : "neutral"}
              icon={missing ? <AlertTriangle size={11} /> : null}
              actions={
                <StatusPill tone={missing ? "warning" : "info"}>
                  {config.strategy || "no strategy"}
                </StatusPill>
              }
            >
              <KeyValueGrid
                items={[
                  { label: "strategy", value: config.strategy || "—" },
                  { label: "unique_key", value: config.unique_key || "—" },
                  { label: "updated_at", value: config.updated_at || "—" },
                  { label: "check_cols", value: Array.isArray(config.check_cols) ? config.check_cols.join(", ") : "—" },
                  { label: "invalidate_hard_deletes", value: String(config.invalidate_hard_deletes ?? "—") },
                  { label: "columns", value: cols.length },
                ]}
              />
            </PanelCard>
          );
        })}
      </PanelSection>
    </PanelFrame>
  );
}
