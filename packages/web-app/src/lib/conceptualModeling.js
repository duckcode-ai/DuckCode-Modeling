import yaml from "js-yaml";
import { NOTATION } from "../design/notation.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^[/\\]+/, "");
}

function parseYamlObject(content) {
  try {
    const doc = yaml.load(content);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    return doc;
  } catch (_err) {
    return null;
  }
}

function collectEntities(doc) {
  if (Array.isArray(doc?.entities)) return doc.entities;
  if (String(doc?.kind || "").toLowerCase() === "model" && doc?.name) {
    return [{
      name: doc.name,
      derived_from: doc.derived_from,
      mapped_from: doc.mapped_from,
      type: doc.type,
    }];
  }
  return [];
}

function matchesConcept(entity, conceptName) {
  const target = normalizeText(conceptName).toLowerCase();
  if (!target) return false;
  const derived = normalizeText(entity?.derived_from).toLowerCase();
  const mapped = normalizeText(entity?.mapped_from).toLowerCase();
  return derived === target || mapped === target;
}

export function conceptualRelationshipLabel(rel) {
  if (!rel) return "";
  const verb = normalizeText(rel.verb);
  if (verb) return verb;
  const type = normalizeText(rel.relationshipType || rel.relationship_type);
  if (type) return type.replace(/_/g, " ");
  if (rel.from?.min && rel.from?.max && rel.to?.min && rel.to?.max) {
    return `${NOTATION.cardinalityLabel(rel.from.min, rel.from.max)} → ${NOTATION.cardinalityLabel(rel.to.min, rel.to.max)}`;
  }
  if (rel.cardinality) return String(rel.cardinality).replace(/_/g, " ");
  return "";
}

export function buildConceptualAreas(tables = [], declaredAreas = []) {
  const groups = new Map();
  (tables || []).forEach((table) => {
    const label = normalizeText(table?.domain || table?.subject_area || table?.subject) || "Unassigned";
    const current = groups.get(label) || [];
    current.push(table);
    groups.set(label, current);
  });

  const areas = [];
  groups.forEach((groupTables, label) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    groupTables.forEach((table) => {
      const x = Number.isFinite(Number(table?.x)) ? Number(table.x) : 0;
      const y = Number.isFinite(Number(table?.y)) ? Number(table.y) : 0;
      const width = Number.isFinite(Number(table?.width)) ? Number(table.width) : 240;
      const height = String(table?.modelKind || "").toLowerCase() === "conceptual" ? 180 : 240;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
    const first = groupTables[0] || {};
    areas.push({
      id: `concept-area-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label,
      cat: first.cat || "users",
      x: Math.max(0, minX - 40),
      y: Math.max(0, minY - 44),
      w: Math.max(260, maxX - minX + 80),
      h: Math.max(180, maxY - minY + 88),
      count: groupTables.length,
    });
  });

  if (areas.length > 0) return areas;
  return (declaredAreas || []).map((area, index) => ({
    id: area.id || `concept-area-${index}`,
    label: area.label || area.name || `Area ${index + 1}`,
    cat: area.cat || "users",
    x: area.x || 40 + index * 20,
    y: area.y || 40 + index * 20,
    w: area.w || 300,
    h: area.h || 180,
    count: area.count || 0,
  }));
}

export function findConceptImplementations({ projectFiles = [], fileContentCache = {}, conceptName = "" } = {}) {
  const implementations = [];
  const seen = new Set();

  (projectFiles || []).forEach((file) => {
    const path = normalizePath(file?.path || file?.fullPath || file?.name || "");
    if (!/\.model\.ya?ml$/i.test(path)) return;
    const content = typeof file?.content === "string" ? file.content : fileContentCache[file?.fullPath] || fileContentCache[file?.path] || "";
    if (!content) return;
    const doc = parseYamlObject(content);
    if (!doc) return;
    const modelKind = normalizeText(doc?.model?.kind || doc?.kind || "physical").toLowerCase() || "physical";
    if (modelKind === "conceptual") return;
    collectEntities(doc).forEach((entity) => {
      if (!matchesConcept(entity, conceptName)) return;
      const signature = `${path}::${entity?.name || ""}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      implementations.push({
        layer: modelKind,
        filePath: path,
        fullPath: file?.fullPath || file?.path || path,
        entityName: normalizeText(entity?.name || ""),
        derivedFrom: normalizeText(entity?.derived_from),
        mappedFrom: normalizeText(entity?.mapped_from),
      });
    });
  });

  return implementations.sort((left, right) =>
    left.layer.localeCompare(right.layer) || left.filePath.localeCompare(right.filePath) || left.entityName.localeCompare(right.entityName)
  );
}
