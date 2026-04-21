/* ModelGraphPanel — lists dbt models (or their DataLex equivalent) with
   their owned entities, imports, and any cross-model relationships.

   The previous version cycled through six hardcoded Tailwind pastels
   (bg-blue-50, bg-emerald-50, …) which looked fine on Paper/Arctic but
   glared on Midnight/Obsidian. This rewrite maps every model to one of
   the six Luna categorical tokens (--cat-users/billing/product/system/
   access/audit) which are defined for all four themes, so the badges
   adopt the palette automatically. Each model is rendered inside a
   PanelCard with a coloured left-border, and entities are laid out as
   a responsive grid of StatusPills instead of a single run-on line. */
import React, { useState, useEffect, useMemo } from "react";
import {
  Network, ArrowRight, ExternalLink, Package, RefreshCw, AlertCircle,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import { fetchModelGraph } from "../../lib/api";
import { PanelFrame, PanelSection, PanelCard, StatusPill, PanelEmpty } from "./PanelFrame";

/* Six Luna categorical tokens, cycled by model index. Every token is
   theme-aware across midnight / obsidian / paper / arctic. */
const CAT_TOKENS = ["users", "billing", "product", "system", "access", "audit"];
function catFor(i) { return CAT_TOKENS[i % CAT_TOKENS.length]; }
function catVars(cat) {
  return {
    "--cat-color": `var(--cat-${cat})`,
    "--cat-soft":  `var(--cat-${cat}-soft)`,
  };
}

function ModelCard({ model, idx, colorMap, onOpen }) {
  const cat = colorMap[model.name] || catFor(idx);
  return (
    <div
      className="panel-card"
      style={{
        borderLeft: `3px solid var(--cat-${cat})`,
        background: `linear-gradient(to right, var(--cat-${cat}-soft), var(--bg-2) 120px)`,
      }}
    >
      <div className="panel-card-header" style={{ marginBottom: 10 }}>
        <div className="panel-card-heading">
          <span
            className="panel-card-icon"
            style={{ background: `var(--cat-${cat}-soft)`, color: `var(--cat-${cat})` }}
          >
            <Network size={12} />
          </span>
          <div className="panel-card-title-col">
            <div className="panel-card-title" style={{ fontFamily: "var(--font-mono)" }}>
              {model.name}
            </div>
            <div className="panel-card-subtitle">
              {model.entity_count} {model.entity_count === 1 ? "entity" : "entities"}
              {model.path && <> · <code style={{ fontSize: 10 }}>{model.path}</code></>}
            </div>
          </div>
        </div>
        {model.file && (
          <div className="panel-card-actions">
            <button
              onClick={() => onOpen(model.file)}
              title={`Open ${model.path || model.file}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 8px", borderRadius: 6,
                background: "transparent", border: "1px solid var(--border-default)",
                color: "var(--text-secondary)", fontSize: 10.5, cursor: "pointer",
              }}
            >
              <ExternalLink size={10} />
              Open
            </button>
          </div>
        )}
      </div>

      {/* Imports (small chip row, neutral tone so it stays visually below the primary colour) */}
      {model.imports && model.imports.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          <Package size={10} style={{ color: "var(--text-tertiary)" }} />
          <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>imports:</span>
          {model.imports.map((imp) => {
            const impCat = colorMap[imp] || catFor(idx);
            return (
              <span
                key={imp}
                className="status-pill"
                style={{
                  background: `var(--cat-${impCat}-soft)`,
                  color: `var(--cat-${impCat})`,
                  borderColor: `var(--cat-${impCat})`,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {imp}
              </span>
            );
          })}
        </div>
      )}

      {/* Entity grid — auto-fill so a wide drawer shows 4–6 columns, narrow drawers drop to 2 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 6,
        }}
      >
        {model.entities.map((entity) => (
          <div
            key={entity}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              background: "var(--bg-2)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={entity}
          >
            {entity}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ModelGraphPanel() {
  const { activeProjectId, offlineMode, projectFiles, openFile, modelGraphVersion } = useWorkspaceStore();
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadGraph = async () => {
    if (!activeProjectId || offlineMode) return;
    setLoading(true); setError(null);
    try {
      const data = await fetchModelGraph(activeProjectId);
      setGraphData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Refetch when the project changes OR when any model-graph-affecting
  // write bumps `modelGraphVersion` (save, entity delete, file delete,
  // rename). Without the version dependency the panel showed stale data
  // until the user manually clicked Refresh.
  useEffect(() => { loadGraph(); }, [activeProjectId, modelGraphVersion]);

  const colorMap = useMemo(() => {
    if (!graphData?.models) return {};
    const map = {};
    graphData.models.forEach((m, i) => { map[m.name] = catFor(i); });
    return map;
  }, [graphData]);

  const handleOpenFile = (filePath) => {
    const file = projectFiles.find((f) => f.fullPath === filePath);
    if (file) openFile(file);
  };

  const refreshAction = (
    <button
      onClick={loadGraph}
      title="Refresh"
      aria-label="Refresh model graph"
      style={{
        width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: 6, background: "transparent", border: "1px solid var(--border-default)",
        color: "var(--text-secondary)", cursor: "pointer",
      }}
    >
      <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
    </button>
  );

  /* Zero / error / offline states all render through PanelFrame so they
     inherit the same header + chrome as the loaded view. */
  if (offlineMode) {
    return (
      <PanelFrame icon={<Network size={14} />} eyebrow="Overview" title="Model Graph" actions={refreshAction}>
        <PanelEmpty icon={AlertCircle} title="API server offline" description="Model graph requires a live API connection." />
      </PanelFrame>
    );
  }
  if (loading && !graphData) {
    return (
      <PanelFrame icon={<Network size={14} />} eyebrow="Overview" title="Model Graph" actions={refreshAction}>
        <PanelEmpty icon={RefreshCw} title="Loading model graph…" description="Fetching models and their relationships." />
      </PanelFrame>
    );
  }
  if (error) {
    return (
      <PanelFrame icon={<Network size={14} />} eyebrow="Overview" title="Model Graph" actions={refreshAction}>
        <PanelEmpty
          icon={AlertCircle}
          title="Could not load model graph"
          description={error}
          action={
            <button
              onClick={loadGraph}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 6,
                background: "var(--accent)", color: "#fff", border: "none",
                fontSize: 11, fontWeight: 500, cursor: "pointer",
              }}
            >
              <RefreshCw size={11} /> Retry
            </button>
          }
        />
      </PanelFrame>
    );
  }
  if (!graphData || !graphData.models || graphData.models.length === 0) {
    return (
      <PanelFrame icon={<Network size={14} />} eyebrow="Overview" title="Model Graph" actions={refreshAction}>
        <PanelEmpty title="No models found" description="This project doesn’t have any model files yet." />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      icon={<Network size={14} />}
      eyebrow="Overview"
      title="Model Graph"
      subtitle={`${graphData.model_count} models · ${graphData.total_entities} entities`}
      actions={refreshAction}
    >
      <PanelSection title="Models" count={graphData.models.length}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {graphData.models.map((model, idx) => (
            <ModelCard
              key={model.name}
              model={model}
              idx={idx}
              colorMap={colorMap}
              onOpen={handleOpenFile}
            />
          ))}
        </div>
      </PanelSection>

      {graphData.cross_model_relationships && graphData.cross_model_relationships.length > 0 && (
        <PanelSection
          title="Cross-Model Relationships"
          count={graphData.cross_model_relationships.length}
          icon={<ArrowRight size={11} />}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {graphData.cross_model_relationships.map((rel, i) => {
              const fromCat = colorMap[rel.from_model] || "users";
              const toCat = colorMap[rel.to_model] || "users";
              return (
                <div
                  key={i}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                    padding: "8px 10px",
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 6,
                    fontSize: 11.5,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <StatusPill
                    tone="neutral"
                    style={{
                      background: `var(--cat-${fromCat}-soft)`,
                      color: `var(--cat-${fromCat})`,
                      borderColor: `var(--cat-${fromCat})`,
                    }}
                  >
                    {rel.from_model}
                  </StatusPill>
                  <code style={{ color: "var(--text-primary)" }}>{rel.from_entity}</code>
                  <ArrowRight size={11} style={{ color: "var(--text-tertiary)" }} />
                  <StatusPill
                    tone="neutral"
                    style={{
                      background: `var(--cat-${toCat}-soft)`,
                      color: `var(--cat-${toCat})`,
                      borderColor: `var(--cat-${toCat})`,
                    }}
                  >
                    {rel.to_model}
                  </StatusPill>
                  <code style={{ color: "var(--text-primary)" }}>{rel.to_entity}</code>
                </div>
              );
            })}
          </div>
        </PanelSection>
      )}
    </PanelFrame>
  );
}
