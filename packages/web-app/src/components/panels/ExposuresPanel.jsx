/* ExposuresPanel — read-only viewer for dbt exposures in the active YAML.
   Surfaces owner, maturity, and depends_on so stale exposures stand out
   visually (warning tone when owner.email or maturity is missing). */
import React, { useMemo } from "react";
import { Eye, Mail, AlertTriangle } from "lucide-react";
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

function collectExposures(doc) {
  if (!doc) return [];
  if (Array.isArray(doc.exposures)) return doc.exposures;
  if (doc.kind === "exposure") return [doc];
  return [];
}

const MATURITY_TONE = { high: "success", medium: "info", low: "warning" };

export default function ExposuresPanel() {
  const { activeFileContent } = useWorkspaceStore();
  const exposures = useMemo(() => collectExposures(safeLoad(activeFileContent || "")), [activeFileContent]);

  if (!exposures.length) {
    return (
      <PanelFrame icon={<Eye size={14} />} eyebrow="dbt resources" title="Exposures">
        <PanelEmpty
          icon={Eye}
          title="No exposures"
          description="The active YAML has no exposures: section. Exposures describe downstream consumers (dashboards, ML models, notebooks)."
        />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      icon={<Eye size={14} />}
      eyebrow="dbt resources"
      title="Exposures"
      subtitle={`${exposures.length} exposure${exposures.length === 1 ? "" : "s"}`}
    >
      <PanelSection title="Downstream consumers" count={exposures.length}>
        {exposures.map((exp, idx) => {
          const owner = exp.owner || {};
          const maturity = String(exp.maturity || "").toLowerCase();
          const ownerEmail = owner.email || "";
          const stale = !ownerEmail || !maturity;
          const depends = Array.isArray(exp.depends_on) ? exp.depends_on : [];
          return (
            <PanelCard
              key={exp.name || idx}
              title={exp.label || exp.name || `exposure_${idx}`}
              subtitle={exp.description || ""}
              tone={stale ? "warning" : "neutral"}
              icon={stale ? <AlertTriangle size={11} /> : null}
              actions={
                <>
                  {maturity ? (
                    <StatusPill tone={MATURITY_TONE[maturity] || "info"}>{maturity}</StatusPill>
                  ) : (
                    <StatusPill tone="warning">no maturity</StatusPill>
                  )}
                </>
              }
            >
              <KeyValueGrid
                items={[
                  { label: "type", value: exp.type || "—" },
                  { label: "owner", value: owner.name || "—" },
                  {
                    label: "owner.email",
                    value: ownerEmail ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Mail size={10} />
                        <a href={`mailto:${ownerEmail}`}>{ownerEmail}</a>
                      </span>
                    ) : "—",
                  },
                  { label: "url", value: exp.url || "—" },
                  {
                    label: "depends_on",
                    value: depends.length
                      ? depends.map((d) => d.ref || (d.source ? `${d.source.source}.${d.source.name}` : "?")).join(", ")
                      : "—",
                  },
                ]}
              />
            </PanelCard>
          );
        })}
      </PanelSection>
    </PanelFrame>
  );
}
