/* DictionaryPanel — the "Dictionary" tab in the bottom drawer. Shows the
   data-dictionary view of the active model: entities + their fields /
   indexes / relationships, plus the metric contracts catalog and the
   business glossary.

   The previous version relied on hardcoded Tailwind palette classes
   (bg-blue-50, text-purple-600, bg-amber-100, etc.) which didn't play
   well on dark Luna themes. This rewrite:

   • Wraps the whole panel in PanelFrame with a proper search toolbar.
   • Splits content into three PanelSections — Entities, Metric
     Contracts, Business Glossary.
   • Every entity renders inside a PanelCard with a type-semantic tone
     (table → info, view → success, materialized_view → accent,
     external_table → warning, snapshot → neutral).
   • Field attributes (PK / FK / UQ / NN / COMP / sensitivity) become
     StatusPills with semantic tones rather than raw pastels.
   • The field grid uses the shared `.panel-table` class — sticky
     header, zebra rows, hover, theme-safe on all four palettes. */
import React, { useState, useMemo } from "react";
import {
  BookOpen, Search, Table2, Eye, Layers, HardDrive, Camera,
  ChevronDown, ChevronRight, ArrowRightLeft, ListOrdered, Gauge,
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";
import {
  PanelFrame, PanelSection, PanelCard, StatusPill, PanelEmpty,
} from "./PanelFrame";

const TYPE_ICONS = {
  table: Table2,
  view: Eye,
  materialized_view: Layers,
  external_table: HardDrive,
  snapshot: Camera,
};

/* Map entity types to semantic PanelCard tones (theme-aware). */
function toneForType(etype) {
  switch (etype) {
    case "table":              return "info";
    case "view":               return "success";
    case "materialized_view":  return "accent";
    case "external_table":     return "warning";
    case "snapshot":           return "neutral";
    default:                   return "info";
  }
}

/* Field-attribute pills. We map the most common attrs to the tone that
   best matches their visual language across themes. */
function attrTone(attr) {
  switch (attr) {
    case "PK":    return "warning"; // --pk (yellow / gold)
    case "UQ":    return "info";    // indicates constraint
    case "FK":    return "accent";
    case "NN":    return "error";   // not-null = enforced
    case "COMP":  return "success";
    default:      return "warning"; // sensitivity etc.
  }
}

function EntityCard({ entity, classifications, indexes, relationships, isExpanded, onToggle }) {
  const etype = entity.type || "table";
  const TypeIcon = TYPE_ICONS[etype] || Table2;
  const tone = toneForType(etype);
  const fields = entity.fields || [];
  const tags = entity.tags || [];
  const entityIndexes = indexes.filter((idx) => idx.entity === entity.name);
  const entityRels = relationships.filter((r) => {
    const from = (r.from || "").split(".")[0];
    const to = (r.to || "").split(".")[0];
    return from === entity.name || to === entity.name;
  });

  return (
    <PanelCard tone={tone} dense>
      <button
        onClick={onToggle}
        style={{
          width: "100%", background: "transparent", border: "none", padding: 0, margin: 0,
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left",
          color: "var(--text-primary)",
        }}
      >
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <TypeIcon size={13} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-mono, inherit)" }}>{entity.name}</span>
        <StatusPill tone={tone}>{etype}</StatusPill>
        {entity.subject_area && (
          <StatusPill tone="neutral">{entity.subject_area}</StatusPill>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-tertiary)" }}>
          {fields.length} {fields.length === 1 ? "field" : "fields"}
        </span>
      </button>

      {isExpanded && (
        <div style={{ marginTop: 10 }}>
          {/* Meta row */}
          {(entity.description || entity.schema || entity.owner || tags.length > 0 || (entity.grain || []).length > 0) && (
            <div style={{
              padding: "8px 10px", marginBottom: 10,
              background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 6,
              fontSize: 11, color: "var(--text-secondary)",
            }}>
              {entity.description && (
                <div style={{ marginBottom: 6 }}>{entity.description}</div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 10.5 }}>
                {entity.schema && <span>Schema: <strong style={{ color: "var(--text-primary)" }}>{entity.schema}</strong></span>}
                {entity.owner && <span>Owner: <strong style={{ color: "var(--text-primary)" }}>{entity.owner}</strong></span>}
                {(entity.grain || []).length > 0 && <span>Grain: <strong style={{ color: "var(--text-primary)" }}>{(entity.grain || []).join(", ")}</strong></span>}
              </div>
              {tags.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                  {tags.map((t) => (
                    <StatusPill key={t} tone="neutral">{t}</StatusPill>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Fields table */}
          <div style={{ overflowX: "auto" }}>
            <table className="panel-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Attrs</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const clsKey = `${entity.name}.${f.name}`;
                  const cls = classifications[clsKey];
                  return (
                    <tr
                      key={f.name}
                      style={f.deprecated ? { opacity: 0.5, textDecoration: "line-through" } : undefined}
                    >
                      <td style={{ fontFamily: "var(--font-mono, inherit)", fontWeight: 500 }}>{f.name}</td>
                      <td style={{ fontFamily: "var(--font-mono, inherit)", color: "var(--cat-users)" }}>{f.type}</td>
                      <td>
                        <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 3 }}>
                          {f.primary_key && <StatusPill tone={attrTone("PK")}>PK</StatusPill>}
                          {f.unique       && <StatusPill tone={attrTone("UQ")}>UQ</StatusPill>}
                          {f.foreign_key  && <StatusPill tone={attrTone("FK")}>FK</StatusPill>}
                          {f.nullable === false && <StatusPill tone={attrTone("NN")}>NN</StatusPill>}
                          {f.computed     && <StatusPill tone={attrTone("COMP")}>COMP</StatusPill>}
                          {f.sensitivity  && <StatusPill tone="warning">{f.sensitivity}</StatusPill>}
                          {cls            && <StatusPill tone="warning">{cls}</StatusPill>}
                        </div>
                      </td>
                      <td style={{ color: "var(--text-tertiary)" }}>{f.description || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Indexes */}
          {entityIndexes.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--text-tertiary)",
                display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 4,
              }}>
                <ListOrdered size={10} /> Indexes ({entityIndexes.length})
              </div>
              {entityIndexes.map((idx) => (
                <div key={idx.name} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 10.5, color: "var(--text-secondary)", padding: "2px 0",
                }}>
                  <code style={{ fontFamily: "var(--font-mono, inherit)", color: "var(--text-primary)" }}>{idx.name}</code>
                  <span style={{ color: "var(--text-tertiary)" }}>({(idx.fields || []).join(", ")})</span>
                  {idx.unique && <StatusPill tone="info">UNIQUE</StatusPill>}
                </div>
              ))}
            </div>
          )}

          {/* Relationships */}
          {entityRels.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--text-tertiary)",
                display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 4,
              }}>
                <ArrowRightLeft size={10} /> Relationships ({entityRels.length})
              </div>
              {entityRels.map((rel) => (
                <div key={rel.name} style={{
                  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                  fontSize: 10.5, color: "var(--text-secondary)", padding: "2px 0",
                }}>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{rel.name}</span>
                  <code style={{ fontFamily: "var(--font-mono, inherit)", color: "var(--cat-users)" }}>{rel.from}</code>
                  <span style={{ color: "var(--text-tertiary)" }}>→</span>
                  <code style={{ fontFamily: "var(--font-mono, inherit)", color: "var(--cat-users)" }}>{rel.to}</code>
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>({(rel.cardinality || "").replace(/_/g, ":")})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PanelCard>
  );
}

export default function DictionaryPanel() {
  const { model } = useDiagramStore();
  const [search, setSearch] = useState("");
  const [expandedEntities, setExpandedEntities] = useState(new Set());

  const entities = model?.entities || [];
  const relationships = model?.relationships || [];
  const indexes = model?.indexes || [];
  const metrics = model?.metrics || [];
  const glossary = model?.glossary || [];
  const modelLayer = model?.model?.layer || "";
  const classifications = model?.governance?.classification || {};

  const filtered = useMemo(() => {
    if (!search.trim()) return entities;
    const q = search.toLowerCase();
    return entities.filter((e) => {
      const nameMatch = (e.name || "").toLowerCase().includes(q);
      const descMatch = (e.description || "").toLowerCase().includes(q);
      const tagMatch = (e.tags || []).some((t) => String(t).toLowerCase().includes(q));
      const fieldMatch = (e.fields || []).some(
        (f) => (f.name || "").toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q)
      );
      const typeMatch = (e.type || "").toLowerCase().includes(q);
      const areaMatch = (e.subject_area || "").toLowerCase().includes(q);
      return nameMatch || descMatch || tagMatch || fieldMatch || typeMatch || areaMatch;
    });
  }, [entities, search]);

  const filteredGlossary = useMemo(() => {
    if (!search.trim()) return glossary;
    const q = search.toLowerCase();
    return glossary.filter((t) => (
      (t.term || "").toLowerCase().includes(q) ||
      (t.definition || "").toLowerCase().includes(q) ||
      (t.abbreviation || "").toLowerCase().includes(q)
    ));
  }, [glossary, search]);

  const filteredMetrics = useMemo(() => {
    if (!search.trim()) return metrics;
    const q = search.toLowerCase();
    return metrics.filter((metric) => (
      (metric.name || "").toLowerCase().includes(q) ||
      (metric.entity || "").toLowerCase().includes(q) ||
      (metric.description || "").toLowerCase().includes(q) ||
      (metric.expression || "").toLowerCase().includes(q) ||
      (metric.aggregation || "").toLowerCase().includes(q) ||
      (metric.time_dimension || "").toLowerCase().includes(q) ||
      (metric.grain || []).some((item) => String(item).toLowerCase().includes(q)) ||
      (metric.dimensions || []).some((item) => String(item).toLowerCase().includes(q)) ||
      (metric.tags || []).some((item) => String(item).toLowerCase().includes(q))
    ));
  }, [metrics, search]);

  const toggleEntity = (name) => {
    setExpandedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const expandAll = () => setExpandedEntities(new Set(entities.map((e) => e.name)));
  const collapseAll = () => setExpandedEntities(new Set());

  if (!model || entities.length === 0) {
    return (
      <PanelFrame icon={<BookOpen size={14} />} eyebrow="Overview" title="Data Dictionary">
        <PanelEmpty
          icon={BookOpen}
          title="No model loaded"
          description="Open a model file to view its data dictionary."
        />
      </PanelFrame>
    );
  }

  const totalFields = entities.reduce((sum, e) => sum + (e.fields || []).length, 0);

  /* Header toolbar — search box + expand/collapse actions */
  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <Search
          size={12}
          style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            color: "var(--text-tertiary)", pointerEvents: "none",
          }}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entities, fields, tags, metrics, glossary…"
          style={{
            width: "100%",
            padding: "6px 10px 6px 28px",
            borderRadius: 6,
            background: "var(--bg-1)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
            fontSize: 12,
            outline: "none",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={expandAll}
          style={{
            padding: "4px 8px", borderRadius: 5,
            background: "transparent", border: "1px solid var(--border-default)",
            color: "var(--text-secondary)", fontSize: 10.5, cursor: "pointer",
          }}
        >Expand all</button>
        <button
          onClick={collapseAll}
          style={{
            padding: "4px 8px", borderRadius: 5,
            background: "transparent", border: "1px solid var(--border-default)",
            color: "var(--text-secondary)", fontSize: 10.5, cursor: "pointer",
          }}
        >Collapse</button>
      </div>
    </div>
  );

  const titleStatus = modelLayer ? <StatusPill tone="info">{modelLayer}</StatusPill> : null;

  return (
    <PanelFrame
      icon={<BookOpen size={14} />}
      eyebrow="Reference"
      title="Data Dictionary"
      subtitle={`${entities.length} entities · ${totalFields} fields · ${metrics.length} metrics`}
      status={titleStatus}
      toolbar={toolbar}
    >
      {/* Entities */}
      <PanelSection title="Entities" count={filtered.length}>
        {filtered.length === 0 && search ? (
          <PanelEmpty title={`No entities match “${search}”`} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((entity) => (
              <EntityCard
                key={entity.name}
                entity={entity}
                classifications={classifications}
                indexes={indexes}
                relationships={relationships}
                isExpanded={expandedEntities.has(entity.name)}
                onToggle={() => toggleEntity(entity.name)}
              />
            ))}
          </div>
        )}
      </PanelSection>

      {/* Metric Contracts */}
      {filteredMetrics.length > 0 && (
        <PanelSection title="Metric Contracts" count={filteredMetrics.length} icon={<Gauge size={11} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredMetrics.map((metric) => (
              <PanelCard key={metric.name} tone="success" dense>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>{metric.name}</span>
                  {metric.aggregation && <StatusPill tone="success">{metric.aggregation}</StatusPill>}
                  {metric.entity && (
                    <code style={{
                      fontSize: 10.5, padding: "1px 6px", borderRadius: 4,
                      background: "var(--bg-1)", border: "1px solid var(--border-default)",
                      color: "var(--cat-users)", fontFamily: "var(--font-mono, inherit)",
                    }}>{metric.entity}</code>
                  )}
                </div>
                {metric.description && (
                  <p style={{ fontSize: 11.5, color: "var(--text-tertiary)", margin: "4px 0 0 0" }}>
                    {metric.description}
                  </p>
                )}
                <div style={{ fontSize: 10.5, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.6 }}>
                  {(metric.grain || []).length > 0 && <div>Grain: {(metric.grain || []).join(", ")}</div>}
                  {(metric.dimensions || []).length > 0 && <div>Dimensions: {(metric.dimensions || []).join(", ")}</div>}
                  {metric.time_dimension && <div>Time: {metric.time_dimension}</div>}
                </div>
                {(metric.tags || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {(metric.tags || []).map((tag) => (
                      <StatusPill key={`${metric.name}-${tag}`} tone="neutral">{tag}</StatusPill>
                    ))}
                  </div>
                )}
              </PanelCard>
            ))}
          </div>
        </PanelSection>
      )}

      {/* Business Glossary */}
      {filteredGlossary.length > 0 && (
        <PanelSection title="Business Glossary" count={filteredGlossary.length} icon={<BookOpen size={11} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredGlossary.map((term) => (
              <PanelCard key={term.term} tone="accent" dense>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>{term.term}</span>
                  {term.abbreviation && (
                    <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>({term.abbreviation})</span>
                  )}
                </div>
                {term.definition && (
                  <p style={{ fontSize: 11.5, color: "var(--text-tertiary)", margin: "4px 0 0 0" }}>
                    {term.definition}
                  </p>
                )}
                {(term.related_fields || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {term.related_fields.map((f) => (
                      <code
                        key={f}
                        style={{
                          fontSize: 10, padding: "1px 6px", borderRadius: 4,
                          background: "var(--bg-1)", border: "1px solid var(--border-default)",
                          color: "var(--cat-users)", fontFamily: "var(--font-mono, inherit)",
                        }}
                      >
                        {f}
                      </code>
                    ))}
                  </div>
                )}
              </PanelCard>
            ))}
          </div>
        </PanelSection>
      )}
    </PanelFrame>
  );
}
