export function relationCardinalityValue(rel) {
  if (rel?.cardinality) return String(rel.cardinality);
  const fromMany = rel?.from?.max === "N";
  const toMany = rel?.to?.max === "N";
  return (
    fromMany && toMany ? "many_to_many" :
    fromMany && !toMany ? "many_to_one" :
    !fromMany && toMany ? "one_to_many" :
    "one_to_one"
  );
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function canonicalTableName(table) {
  return String(table?.name || table?._entityName || table?.id || "").trim();
}

function resolveEndpointEntity(endpointValue, tables = []) {
  const raw = String(endpointValue || "").trim();
  if (!raw) return "";
  const rawKey = normalizeKey(raw);
  const hit = tables.find((table) => {
    const candidates = [
      table?.id,
      table?.name,
      table?._entityName,
      table?.logical_name,
    ].map(normalizeKey).filter(Boolean);
    return candidates.includes(rawKey);
  });
  return canonicalTableName(hit) || raw;
}

function relationshipTableOption(table) {
  const canonical = canonicalTableName(table);
  const displayName = String(table?.name || table?._entityName || table?.id || "").trim();
  return {
    id: canonical || displayName,
    nodeId: table?.id,
    name: displayName || canonical,
    _entityName: canonical || displayName,
    columns: (table?.columns || []).map((column) => ({
      name: column.name,
      pk: column.pk,
      primary_key: column.primary_key,
    })),
  };
}

export function buildRelationshipEditorPayload(rel, tables = [], modelKind = "") {
  if (!rel) return null;
  const entityList = Array.isArray(tables) ? tables : [];
  const layer = normalizeKey(modelKind || rel.modelKind || rel.layer);
  const entityLevel = !rel.from?.col && !rel.to?.col;
  const inferredKind = layer || (entityLevel ? "conceptual" : undefined);
  return {
    mode: "edit",
    relationship: rel,
    modelKind: inferredKind,
    fromEntity: resolveEndpointEntity(rel._fromEntityName || rel.from?.table || "", entityList),
    fromColumn: rel.from?.col || "",
    toEntity: resolveEndpointEntity(rel._toEntityName || rel.to?.table || "", entityList),
    toColumn: rel.to?.col || "",
    conceptualLevel: inferredKind === "conceptual" || (entityLevel && !layer),
    tables: entityList.map(relationshipTableOption),
    name: rel.name || "",
    cardinality: relationCardinalityValue(rel),
    identifying: !!rel.identifying,
    optional: !!rel.dashed,
    onDelete: rel.onDelete || "",
    description: rel.description || "",
    verb: rel.verb || "",
    relationshipType: rel.relationshipType || "",
    fromRole: rel.fromRole || "",
    toRole: rel.toRole || "",
    rationale: rel.rationale || "",
    sourceOfTruth: rel.sourceOfTruth || "",
  };
}

export function openRelationshipEditor(openModal, rel, tables = [], modelKind = "") {
  if (!openModal || !rel) return;
  openModal("newRelationship", buildRelationshipEditorPayload(rel, tables, modelKind));
}
