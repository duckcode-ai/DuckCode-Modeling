import React from "react";
import yaml from "js-yaml";

function cleanName(value, fallback = "Item") {
  const text = String(value || "").trim();
  return text || fallback;
}

function endpointName(endpoint) {
  if (endpoint == null) return "";
  if (typeof endpoint === "string") return endpoint;
  return endpoint.entity || endpoint.table || endpoint.name || endpoint.model || "";
}

function entityName(entity, index) {
  return cleanName(entity?.entity || entity?.name || entity?.table || entity?.model, `Entity ${index + 1}`);
}

function entityFields(entity) {
  const raw = entity?.fields || entity?.columns || entity?.attributes || [];
  return Array.isArray(raw)
    ? raw.map((field) => cleanName(field?.name || field?.field || field?.column || field, "")).filter(Boolean)
    : [];
}

function parseContent(change) {
  const content = change?.content ?? change?.yaml_content ?? change?.yamlContent ?? "";
  if (!content || typeof content !== "string") return null;
  try {
    return yaml.load(content) || null;
  } catch (_err) {
    return null;
  }
}

export function buildAiProposalPreviewData(change) {
  const doc = parseContent(change);
  const type = String(change?.type || change?.operation || change?.action || "").toLowerCase();
  const path = String(change?.path || change?.fullPath || change?.toPath || "");
  const isDiagram = type.includes("diagram") || /\.diagram\.ya?ml$/i.test(path) || doc?.kind === "diagram";
  const rawEntities = Array.isArray(change?.entities)
    ? change.entities
    : Array.isArray(doc?.entities)
      ? doc.entities
      : [];
  const relationships = Array.isArray(change?.relationships)
    ? change.relationships
    : Array.isArray(doc?.relationships)
      ? doc.relationships
      : [];
  const previewable = rawEntities.length > 0 || relationships.length > 0 || isDiagram;
  if (!previewable) return null;

  const generated = rawEntities.map((entity, index) => {
    const rawX = entity?.x;
    const rawY = entity?.y;
    return {
      id: entityName(entity, index),
      name: entityName(entity, index),
      type: cleanName(entity?.type || (isDiagram ? "diagram node" : "entity"), ""),
      fields: entityFields(entity),
      x: Number.isFinite(Number(rawX)) ? Number(rawX) : null,
      y: Number.isFinite(Number(rawY)) ? Number(rawY) : null,
      subjectArea: entity?.subject_area || entity?.subjectArea || entity?.domain || "",
    };
  });

  const count = Math.max(generated.length, 1);
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))));
  const nodes = generated.map((entity, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return {
      ...entity,
      x: entity.x ?? 58 + col * 190,
      y: entity.y ?? 54 + row * 120,
    };
  });

  return {
    title: cleanName(change?.title || doc?.title || change?.name || doc?.name || doc?.model?.name || path.split("/").pop(), "AI proposal"),
    layer: cleanName(change?.layer || doc?.layer || doc?.model?.kind || "", ""),
    domain: cleanName(change?.domain || doc?.domain || doc?.model?.domain || "", ""),
    path,
    kind: isDiagram ? "diagram" : "model",
    nodes,
    relationships: relationships.map((relationship, index) => ({
      name: cleanName(relationship?.name || relationship?.verb || `relationship_${index + 1}`),
      from: endpointName(relationship?.from),
      to: endpointName(relationship?.to),
      cardinality: cleanName(relationship?.cardinality || relationship?.type || relationship?.relationship_type || "", ""),
      verb: cleanName(relationship?.verb || relationship?.description || "", ""),
    })).filter((relationship) => relationship.from && relationship.to),
  };
}

function relationshipLabel(relationship) {
  if (relationship.verb) return relationship.verb;
  if (relationship.cardinality) return relationship.cardinality.replace(/_/g, " ");
  return relationship.name;
}

export default function AiProposalPreview({ change, compact = false }) {
  const preview = buildAiProposalPreviewData(change);
  if (!preview) return null;
  const nodeByName = new Map(preview.nodes.map((node) => [node.name, node]));
  const width = Math.max(520, ...preview.nodes.map((node) => node.x + 170), 520);
  const height = Math.max(260, ...preview.nodes.map((node) => node.y + 92), 260);
  const nodeWidth = compact ? 132 : 154;
  const nodeHeight = compact ? 58 : 72;

  return (
    <div className="ai-proposal-preview">
      <div className="ai-proposal-preview-head">
        <div>
          <strong>{preview.title}</strong>
          <span>{preview.path || `${preview.domain || "domain"} · ${preview.layer || preview.kind}`}</span>
        </div>
        <div className="ai-proposal-preview-pills">
          {preview.layer && <span className="status-pill tone-info">{preview.layer}</span>}
          {preview.domain && <span className="status-pill tone-neutral">{preview.domain}</span>}
          <span className="status-pill tone-success">{preview.nodes.length} object{preview.nodes.length === 1 ? "" : "s"}</span>
          <span className="status-pill tone-accent">{preview.relationships.length} relation{preview.relationships.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="ai-proposal-preview-canvas">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Preview of ${preview.title}`}>
          <defs>
            <marker id="ai-preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          {preview.relationships.map((relationship, index) => {
            const from = nodeByName.get(relationship.from);
            const to = nodeByName.get(relationship.to);
            if (!from || !to) return null;
            const x1 = from.x + nodeWidth;
            const y1 = from.y + nodeHeight / 2;
            const x2 = to.x;
            const y2 = to.y + nodeHeight / 2;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            return (
              <g key={`${relationship.name}-${index}`} className="ai-proposal-preview-edge">
                <path d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`} markerEnd="url(#ai-preview-arrow)" />
                <text x={midX} y={midY - 8} textAnchor="middle">{relationshipLabel(relationship)}</text>
              </g>
            );
          })}
          {preview.nodes.map((node) => (
            <g key={node.name} className="ai-proposal-preview-node" transform={`translate(${node.x}, ${node.y})`}>
              <rect width={nodeWidth} height={nodeHeight} rx="12" />
              <text className="node-title" x="12" y="22">{node.name}</text>
              <text className="node-meta" x="12" y="40">{node.type || node.subjectArea || preview.layer || "model object"}</text>
              {!compact && node.fields.slice(0, 2).map((field, index) => (
                <text key={field} className="node-field" x="12" y={57 + index * 12}>{field}</text>
              ))}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
