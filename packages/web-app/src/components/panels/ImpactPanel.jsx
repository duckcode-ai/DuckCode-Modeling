/* ImpactPanel — shows upstream / downstream / transitive dependencies
   for the entity currently selected in the diagram.

   The previous version used hardcoded Tailwind pastels (bg-orange-50,
   bg-blue-50, bg-amber-50) that clashed with Luna's dark themes. This
   rewrite adopts PanelFrame + StatusPill + PanelCard so cardinality
   badges, transitive warnings, and the impact total all follow the
   active theme. Upstream and downstream lists render side-by-side on
   wide drawers (auto-fit grid) and stack on narrow ones. */
import React, { useMemo } from "react";
import {
  Network,
  ArrowRight,
  Boxes,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";
import {
  PanelFrame,
  PanelSection,
  PanelCard,
  StatusPill,
  PanelEmpty,
} from "./PanelFrame";

/* Map a cardinality string to a semantic StatusPill tone.
   one-to-many / many-to-many → warning (spread, care required)
   one-to-one                 → info   (simple, 1:1 join)             */
function cardinalityTone(cardinality) {
  if (!cardinality) return "neutral";
  if (cardinality.includes("many_to_many")) return "warning";
  if (cardinality.includes("many")) return "info";
  return "accent";
}
function prettyCardinality(c) {
  return c ? c.replace(/_/g, ":") : "—";
}

/* One row in the upstream / downstream / transitive lists. Uses a
   shared row shape with a directional colour accent on the left. */
function DependencyRow({ item, direction }) {
  // direction: "upstream" | "downstream" | "transitive"
  const accent =
    direction === "upstream"
      ? "var(--cat-product)"
      : direction === "downstream"
      ? "var(--cat-billing)"
      : "var(--pk)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 10px",
        borderRadius: 6,
        background: "var(--bg-1)",
        border: "1px solid var(--border-default)",
        borderLeft: `2px solid ${accent}`,
        fontSize: 11.5,
        flexWrap: "wrap",
      }}
    >
      <Boxes size={12} style={{ color: accent, flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
        {item.entity}
      </span>
      {item.field && (
        <>
          <ChevronRight size={10} style={{ color: "var(--text-tertiary)" }} />
          <code style={{ fontSize: 10.5, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
            {item.field}
          </code>
        </>
      )}
      {item.via && (
        <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>
          via <code style={{ fontFamily: "var(--font-mono)" }}>{item.via}</code>
        </span>
      )}
      {item.cardinality && (
        <StatusPill
          tone={cardinalityTone(item.cardinality)}
          style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}
        >
          {prettyCardinality(item.cardinality)}
        </StatusPill>
      )}
    </div>
  );
}

export default function ImpactPanel() {
  const { selectedEntityId, model, edges } = useDiagramStore();

  const impactData = useMemo(() => {
    if (!selectedEntityId || !model) return null;

    const relationships = model.relationships || [];

    const directRels = relationships.filter((r) => {
      const fromEntity = r.from?.split(".")[0];
      const toEntity = r.to?.split(".")[0];
      return fromEntity === selectedEntityId || toEntity === selectedEntityId;
    });

    const upstream = directRels
      .filter((r) => r.to?.split(".")[0] === selectedEntityId)
      .map((r) => ({
        entity: r.from?.split(".")[0],
        field: r.from,
        relationship: r.name,
        cardinality: r.cardinality,
      }));

    const downstream = directRels
      .filter((r) => r.from?.split(".")[0] === selectedEntityId)
      .map((r) => ({
        entity: r.to?.split(".")[0],
        field: r.to,
        relationship: r.name,
        cardinality: r.cardinality,
      }));

    const directEntityNames = new Set([
      ...upstream.map((u) => u.entity),
      ...downstream.map((d) => d.entity),
    ]);

    const transitiveDownstream = [];
    for (const rel of relationships) {
      const fromEntity = rel.from?.split(".")[0];
      const toEntity = rel.to?.split(".")[0];
      if (
        directEntityNames.has(fromEntity) &&
        toEntity !== selectedEntityId &&
        !directEntityNames.has(toEntity)
      ) {
        transitiveDownstream.push({
          entity: toEntity,
          via: fromEntity,
          relationship: rel.name,
          cardinality: rel.cardinality,
        });
      }
    }

    const affectedFields = directRels.map((r) => {
      const fromEntity = r.from?.split(".")[0];
      return fromEntity === selectedEntityId ? r.from : r.to;
    });

    return {
      upstream,
      downstream,
      transitiveDownstream,
      affectedFields,
      totalImpact: upstream.length + downstream.length + transitiveDownstream.length,
    };
  }, [selectedEntityId, model, edges]);

  /* No selection: show a friendly empty state with the same frame. */
  if (!selectedEntityId) {
    return (
      <PanelFrame icon={<Network size={14} />} eyebrow="Analysis" title="Impact Analysis">
        <PanelEmpty
          icon={Network}
          title="No entity selected"
          description="Select an entity in the diagram to see its upstream and downstream dependencies."
        />
      </PanelFrame>
    );
  }

  if (!impactData) return null;

  const { upstream, downstream, transitiveDownstream, totalImpact } = impactData;

  return (
    <PanelFrame
      icon={<Network size={14} />}
      eyebrow="Analysis"
      title={selectedEntityId}
      subtitle="Impact analysis"
      actions={
        <StatusPill tone="accent">
          {totalImpact} {totalImpact === 1 ? "dependency" : "dependencies"}
        </StatusPill>
      }
    >
      {/* Upstream + Downstream side-by-side on wide drawers, stacked on
          narrow ones. auto-fit + minmax(320px, 1fr) achieves that without
          any JS width measuring. */}
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        }}
      >
        <PanelCard
          tone="info"
          icon={<ArrowRight size={12} style={{ transform: "rotate(180deg)" }} />}
          title="Upstream"
          eyebrow={`${upstream.length} ${upstream.length === 1 ? "source" : "sources"}`}
          subtitle="Entities that flow into this one"
        >
          {upstream.length === 0 ? (
            <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: 0 }}>
              No upstream dependencies.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {upstream.map((item) => (
                <DependencyRow key={item.relationship || item.field} item={item} direction="upstream" />
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard
          tone="success"
          icon={<ArrowRight size={12} />}
          title="Downstream"
          eyebrow={`${downstream.length} ${downstream.length === 1 ? "consumer" : "consumers"}`}
          subtitle="Entities that consume this one"
        >
          {downstream.length === 0 ? (
            <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: 0 }}>
              No downstream dependencies.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {downstream.map((item) => (
                <DependencyRow key={item.relationship || item.field} item={item} direction="downstream" />
              ))}
            </div>
          )}
        </PanelCard>
      </div>

      {/* Transitive impact — only shown when there are 2nd-degree hits.
          Wrapped in a warning-toned card so it reads as "care required". */}
      {transitiveDownstream.length > 0 && (
        <PanelSection
          title="Transitive Impact"
          count={transitiveDownstream.length}
          icon={<AlertTriangle size={11} style={{ color: "var(--pk)" }} />}
          description="Second-degree downstream — changes here may ripple through these entities via a neighbour."
        >
          <PanelCard tone="warning" dense>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {transitiveDownstream.map((item, idx) => (
                <DependencyRow key={idx} item={item} direction="transitive" />
              ))}
            </div>
          </PanelCard>
        </PanelSection>
      )}
    </PanelFrame>
  );
}
