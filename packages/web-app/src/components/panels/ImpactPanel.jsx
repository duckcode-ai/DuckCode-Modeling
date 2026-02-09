import React, { useMemo } from "react";
import {
  Network,
  ArrowRight,
  ArrowRightLeft,
  Boxes,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";

export default function ImpactPanel() {
  const { selectedEntityId, selectedEntity, model, edges } = useDiagramStore();

  const impactData = useMemo(() => {
    if (!selectedEntityId || !model) return null;

    const relationships = model.relationships || [];
    const entities = model.entities || [];

    // Direct relationships
    const directRels = relationships.filter((r) => {
      const fromEntity = r.from?.split(".")[0];
      const toEntity = r.to?.split(".")[0];
      return fromEntity === selectedEntityId || toEntity === selectedEntityId;
    });

    // Upstream: entities that point TO this entity
    const upstream = directRels
      .filter((r) => r.to?.split(".")[0] === selectedEntityId)
      .map((r) => ({
        entity: r.from?.split(".")[0],
        field: r.from,
        relationship: r.name,
        cardinality: r.cardinality,
      }));

    // Downstream: entities that this entity points TO
    const downstream = directRels
      .filter((r) => r.from?.split(".")[0] === selectedEntityId)
      .map((r) => ({
        entity: r.to?.split(".")[0],
        field: r.to,
        relationship: r.name,
        cardinality: r.cardinality,
      }));

    // Transitive impact (2nd degree)
    const directEntityNames = new Set([
      ...upstream.map((u) => u.entity),
      ...downstream.map((d) => d.entity),
    ]);

    const transitiveDownstream = [];
    for (const rel of relationships) {
      const fromEntity = rel.from?.split(".")[0];
      const toEntity = rel.to?.split(".")[0];
      if (directEntityNames.has(fromEntity) && toEntity !== selectedEntityId && !directEntityNames.has(toEntity)) {
        transitiveDownstream.push({
          entity: toEntity,
          via: fromEntity,
          relationship: rel.name,
          cardinality: rel.cardinality,
        });
      }
    }

    // Fields used in relationships
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

  if (!selectedEntityId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted text-xs p-4">
        <Network size={28} className="mb-2 text-text-muted/50" />
        <p className="text-sm mb-1">Impact Analysis</p>
        <p className="text-xs text-center">
          Select an entity in the diagram to see its upstream and downstream dependencies
        </p>
      </div>
    );
  }

  if (!impactData) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-primary bg-bg-secondary/50">
        <span className="text-xs font-semibold text-text-primary">
          Impact: {selectedEntityId}
        </span>
        <span className="ml-auto px-2 py-0.5 rounded-full bg-accent-purple/15 text-accent-purple text-[10px] font-semibold">
          {impactData.totalImpact} dependencies
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Upstream */}
        <div>
          <h4 className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1.5">
            <ArrowRight size={10} className="rotate-180" />
            Upstream ({impactData.upstream.length})
          </h4>
          {impactData.upstream.length === 0 ? (
            <p className="text-xs text-text-muted px-2">No upstream dependencies</p>
          ) : (
            <div className="space-y-1">
              {impactData.upstream.map((item) => (
                <div
                  key={item.relationship}
                  className="flex items-center gap-2 px-2 py-1.5 bg-bg-primary border border-border-primary rounded-md text-[11px]"
                >
                  <Boxes size={11} className="text-blue-500 shrink-0" />
                  <span className="text-text-primary font-medium">{item.entity}</span>
                  <ChevronRight size={10} className="text-text-muted" />
                  <code className="text-text-muted text-[10px]">{item.field}</code>
                  <span className={`ml-auto px-1.5 py-0 rounded text-[9px] font-semibold ${
                    item.cardinality?.includes("many") ? "bg-orange-50 text-orange-700" : "bg-blue-50 text-blue-700"
                  }`}>
                    {item.cardinality?.replace(/_/g, ":")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Downstream */}
        <div>
          <h4 className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1.5">
            <ArrowRight size={10} />
            Downstream ({impactData.downstream.length})
          </h4>
          {impactData.downstream.length === 0 ? (
            <p className="text-xs text-text-muted px-2">No downstream dependencies</p>
          ) : (
            <div className="space-y-1">
              {impactData.downstream.map((item) => (
                <div
                  key={item.relationship}
                  className="flex items-center gap-2 px-2 py-1.5 bg-bg-primary border border-border-primary rounded-md text-[11px]"
                >
                  <Boxes size={11} className="text-green-600 shrink-0" />
                  <span className="text-text-primary font-medium">{item.entity}</span>
                  <ChevronRight size={10} className="text-text-muted" />
                  <code className="text-text-muted text-[10px]">{item.field}</code>
                  <span className={`ml-auto px-1.5 py-0 rounded text-[9px] font-semibold ${
                    item.cardinality?.includes("many") ? "bg-orange-50 text-orange-700" : "bg-blue-50 text-blue-700"
                  }`}>
                    {item.cardinality?.replace(/_/g, ":")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transitive */}
        {impactData.transitiveDownstream.length > 0 && (
          <div>
            <h4 className="text-[10px] text-accent-yellow uppercase tracking-wider font-semibold flex items-center gap-1 mb-1.5">
              <AlertTriangle size={10} />
              Transitive Impact ({impactData.transitiveDownstream.length})
            </h4>
            <div className="space-y-1">
              {impactData.transitiveDownstream.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-md text-[11px]"
                >
                  <Boxes size={11} className="text-amber-500 shrink-0" />
                  <span className="text-text-primary font-medium">{item.entity}</span>
                  <span className="text-text-muted text-[10px]">via {item.via}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
