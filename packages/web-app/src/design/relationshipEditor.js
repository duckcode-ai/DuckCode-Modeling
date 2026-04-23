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

export function buildRelationshipEditorPayload(rel, tables = []) {
  if (!rel) return null;
  const conceptual = !rel.from?.col && !rel.to?.col;
  const entityList = Array.isArray(tables) ? tables : [];
  return {
    mode: "edit",
    relationship: rel,
    modelKind: conceptual ? "conceptual" : undefined,
    fromEntity: rel._fromEntityName || rel.from?.table || "",
    fromColumn: rel.from?.col || "",
    toEntity: rel._toEntityName || rel.to?.table || "",
    toColumn: rel.to?.col || "",
    conceptualLevel: conceptual,
    tables: entityList.map((table) => ({
      id: table.name || table.id,
      name: table.name || table.id,
      columns: (table.columns || []).map((column) => ({ name: column.name })),
    })),
    name: rel.name || "",
    cardinality: relationCardinalityValue(rel),
    identifying: !!rel.identifying,
    optional: !!rel.dashed,
    onDelete: rel.onDelete || "",
    description: rel.description || "",
    verb: rel.verb || "",
    relationshipType: rel.relationshipType || "",
    rationale: rel.rationale || "",
    sourceOfTruth: rel.sourceOfTruth || "",
  };
}

export function openRelationshipEditor(openModal, rel, tables = []) {
  if (!openModal || !rel) return;
  openModal("newRelationship", buildRelationshipEditorPayload(rel, tables));
}
