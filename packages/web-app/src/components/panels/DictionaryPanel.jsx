import React, { useState, useMemo } from "react";
import {
  BookOpen,
  Search,
  Table2,
  Eye,
  Layers,
  HardDrive,
  Camera,
  Tag,
  Key,
  Shield,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
  ListOrdered,
  Gauge,
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";

const TYPE_ICONS = {
  table: Table2,
  view: Eye,
  materialized_view: Layers,
  external_table: HardDrive,
  snapshot: Camera,
};

const TYPE_COLORS = {
  table: "bg-blue-50 text-blue-700",
  view: "bg-green-50 text-green-700",
  materialized_view: "bg-purple-50 text-purple-700",
  external_table: "bg-orange-50 text-orange-700",
  snapshot: "bg-rose-50 text-rose-700",
};

function FieldBadge({ label, className }) {
  return (
    <span className={`inline-block px-1 py-0 rounded text-[8px] font-semibold ${className}`}>
      {label}
    </span>
  );
}

function EntitySection({ entity, classifications, indexes, relationships, isExpanded, onToggle, onSelectEntity }) {
  const etype = entity.type || "table";
  const TypeIcon = TYPE_ICONS[etype] || Table2;
  const typeColor = TYPE_COLORS[etype] || TYPE_COLORS.table;
  const fields = entity.fields || [];
  const tags = entity.tags || [];
  const entityIndexes = indexes.filter((idx) => idx.entity === entity.name);
  const entityRels = relationships.filter((r) => {
    const from = (r.from || "").split(".")[0];
    const to = (r.to || "").split(".")[0];
    return from === entity.name || to === entity.name;
  });

  return (
    <div className="border border-border-primary rounded-lg overflow-hidden bg-bg-primary">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-bg-hover transition-colors"
      >
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <TypeIcon size={13} className="shrink-0" />
        <span className="text-xs font-semibold text-text-primary">{entity.name}</span>
        <span className={`px-1.5 py-0 rounded text-[9px] font-semibold ${typeColor}`}>{etype}</span>
        <span className="ml-auto text-[10px] text-text-muted">{fields.length} fields</span>
      </button>

      {isExpanded && (
        <div className="border-t border-border-primary">
          {/* Meta */}
          {(entity.description || entity.schema || entity.subject_area || entity.owner || tags.length > 0 || (entity.grain || []).length > 0) && (
            <div className="px-3 py-1.5 text-[11px] text-text-muted space-y-0.5 border-b border-border-primary bg-bg-secondary/30">
              {entity.description && <div>{entity.description}</div>}
              <div className="flex flex-wrap gap-2">
                {entity.schema && <span>Schema: <strong>{entity.schema}</strong></span>}
                {entity.subject_area && <span>Area: <strong>{entity.subject_area}</strong></span>}
                {entity.owner && <span>Owner: <strong>{entity.owner}</strong></span>}
                {(entity.grain || []).length > 0 && <span>Grain: <strong>{(entity.grain || []).join(", ")}</strong></span>}
              </div>
              {tags.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {tags.map((t) => (
                    <span key={t} className="px-1 py-0 rounded bg-bg-primary border border-border-primary text-[9px]">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Fields */}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-bg-secondary/50">
                  <th className="text-left px-3 py-1 font-semibold text-text-muted">Field</th>
                  <th className="text-left px-2 py-1 font-semibold text-text-muted">Type</th>
                  <th className="text-left px-2 py-1 font-semibold text-text-muted">Attrs</th>
                  <th className="text-left px-2 py-1 font-semibold text-text-muted">Description</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const clsKey = `${entity.name}.${f.name}`;
                  const cls = classifications[clsKey];
                  return (
                    <tr key={f.name} className={`border-t border-border-primary hover:bg-bg-hover ${f.deprecated ? "opacity-50 line-through" : ""}`}>
                      <td className="px-3 py-1 font-mono font-medium text-text-primary">{f.name}</td>
                      <td className="px-2 py-1 font-mono text-purple-600">{f.type}</td>
                      <td className="px-2 py-1 space-x-0.5">
                        {f.primary_key && <FieldBadge label="PK" className="bg-amber-100 text-amber-800" />}
                        {f.unique && <FieldBadge label="UQ" className="bg-cyan-100 text-cyan-800" />}
                        {f.foreign_key && <FieldBadge label="FK" className="bg-blue-100 text-blue-800" />}
                        {f.nullable === false && <FieldBadge label="NN" className="bg-rose-100 text-rose-800" />}
                        {f.computed && <FieldBadge label="COMP" className="bg-green-100 text-green-800" />}
                        {f.sensitivity && <FieldBadge label={f.sensitivity} className="bg-amber-100 text-amber-800" />}
                        {cls && <FieldBadge label={cls} className="bg-amber-100 text-amber-800" />}
                      </td>
                      <td className="px-2 py-1 text-text-muted">{f.description || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Indexes */}
          {entityIndexes.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border-primary">
              <div className="text-[10px] text-text-muted font-semibold uppercase mb-1 flex items-center gap-1">
                <ListOrdered size={10} /> Indexes ({entityIndexes.length})
              </div>
              {entityIndexes.map((idx) => (
                <div key={idx.name} className="flex items-center gap-1.5 text-[10px] text-text-secondary py-0.5">
                  <code className="font-mono">{idx.name}</code>
                  <span className="text-text-muted">({(idx.fields || []).join(", ")})</span>
                  {idx.unique && <FieldBadge label="UNIQUE" className="bg-cyan-100 text-cyan-800" />}
                </div>
              ))}
            </div>
          )}

          {/* Relationships */}
          {entityRels.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border-primary">
              <div className="text-[10px] text-text-muted font-semibold uppercase mb-1 flex items-center gap-1">
                <ArrowRightLeft size={10} /> Relationships ({entityRels.length})
              </div>
              {entityRels.map((rel) => (
                <div key={rel.name} className="flex items-center gap-1.5 text-[10px] text-text-secondary py-0.5">
                  <span className="font-semibold">{rel.name}</span>
                  <code className="font-mono text-purple-600">{rel.from}</code>
                  <span className="text-text-muted">→</span>
                  <code className="font-mono text-purple-600">{rel.to}</code>
                  <span className="text-[9px] text-text-muted">({(rel.cardinality || "").replace(/_/g, ":")})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
    return glossary.filter((t) => {
      return (
        (t.term || "").toLowerCase().includes(q) ||
        (t.definition || "").toLowerCase().includes(q) ||
        (t.abbreviation || "").toLowerCase().includes(q)
      );
    });
  }, [glossary, search]);

  const filteredMetrics = useMemo(() => {
    if (!search.trim()) return metrics;
    const q = search.toLowerCase();
    return metrics.filter((metric) => {
      return (
        (metric.name || "").toLowerCase().includes(q) ||
        (metric.entity || "").toLowerCase().includes(q) ||
        (metric.description || "").toLowerCase().includes(q) ||
        (metric.expression || "").toLowerCase().includes(q) ||
        (metric.aggregation || "").toLowerCase().includes(q) ||
        (metric.time_dimension || "").toLowerCase().includes(q) ||
        (metric.grain || []).some((item) => String(item).toLowerCase().includes(q)) ||
        (metric.dimensions || []).some((item) => String(item).toLowerCase().includes(q)) ||
        (metric.tags || []).some((item) => String(item).toLowerCase().includes(q))
      );
    });
  }, [metrics, search]);

  const toggleEntity = (name) => {
    setExpandedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const expandAll = () => setExpandedEntities(new Set(entities.map((e) => e.name)));
  const collapseAll = () => setExpandedEntities(new Set());

  if (!model || entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-xs p-4">
        <BookOpen size={12} className="mr-1" />
        Open a model file to view its data dictionary
      </div>
    );
  }

  const totalFields = entities.reduce((sum, e) => sum + (e.fields || []).length, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-primary bg-bg-secondary/50 shrink-0">
        <div className="flex items-center gap-1.5">
          <BookOpen size={12} className="text-accent-blue" />
          <span className="text-xs font-semibold text-text-primary">Data Dictionary</span>
          {modelLayer && (
            <span className="px-1.5 py-0 rounded text-[9px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              {modelLayer}
            </span>
          )}
          <span className="text-[10px] text-text-muted">
            {entities.length} entities · {totalFields} fields · {metrics.length} metrics
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={expandAll} className="px-1.5 py-0.5 rounded text-[9px] text-text-muted hover:text-text-primary hover:bg-bg-hover">
            Expand All
          </button>
          <button onClick={collapseAll} className="px-1.5 py-0.5 rounded text-[9px] text-text-muted hover:text-text-primary hover:bg-bg-hover">
            Collapse
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border-primary shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities, fields, tags, glossary..."
            className="w-full pl-7 pr-3 py-1.5 bg-bg-primary border border-border-primary rounded-md text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Entities */}
        {filtered.map((entity) => (
          <EntitySection
            key={entity.name}
            entity={entity}
            classifications={classifications}
            indexes={indexes}
            relationships={relationships}
            isExpanded={expandedEntities.has(entity.name)}
            onToggle={() => toggleEntity(entity.name)}
          />
        ))}

        {filtered.length === 0 && search && (
          <div className="text-xs text-text-muted text-center py-4">
            No entities match "{search}"
          </div>
        )}

        {/* Metrics */}
        {filteredMetrics.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1.5">
              <Gauge size={10} />
              Metric Contracts ({filteredMetrics.length})
            </div>
            <div className="space-y-1.5">
              {filteredMetrics.map((metric) => (
                <div key={metric.name} className="border border-border-primary rounded-lg p-2.5 bg-bg-primary">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-semibold text-text-primary">{metric.name}</span>
                    {metric.aggregation && (
                      <span className="px-1 py-0 rounded text-[9px] font-semibold bg-green-50 text-green-700 border border-green-200">
                        {metric.aggregation}
                      </span>
                    )}
                    {metric.entity && (
                      <code className="text-[9px] font-mono px-1 py-0 rounded bg-bg-secondary border border-border-primary text-purple-600">
                        {metric.entity}
                      </code>
                    )}
                  </div>
                  {metric.description && (
                    <p className="text-[11px] text-text-muted">{metric.description}</p>
                  )}
                  <div className="text-[10px] text-text-secondary mt-1 space-y-0.5">
                    {(metric.grain || []).length > 0 && <div>Grain: {(metric.grain || []).join(", ")}</div>}
                    {(metric.dimensions || []).length > 0 && <div>Dimensions: {(metric.dimensions || []).join(", ")}</div>}
                    {metric.time_dimension && <div>Time: {metric.time_dimension}</div>}
                  </div>
                  {(metric.tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(metric.tags || []).map((tag) => (
                        <span key={`${metric.name}-${tag}`} className="px-1 py-0 rounded bg-bg-secondary border border-border-primary text-[9px]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Glossary */}
        {filteredGlossary.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1.5">
              <BookOpen size={10} />
              Business Glossary ({filteredGlossary.length})
            </div>
            <div className="space-y-1.5">
              {filteredGlossary.map((term) => (
                <div key={term.term} className="border border-border-primary rounded-lg p-2.5 bg-bg-primary">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-semibold text-text-primary">{term.term}</span>
                    {term.abbreviation && (
                      <span className="text-[10px] text-text-muted">({term.abbreviation})</span>
                    )}
                  </div>
                  {term.definition && (
                    <p className="text-[11px] text-text-muted">{term.definition}</p>
                  )}
                  {(term.related_fields || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {term.related_fields.map((f) => (
                        <code key={f} className="text-[9px] font-mono px-1 py-0 rounded bg-bg-secondary border border-border-primary text-purple-600">
                          {f}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
