export function getTableRelationships(table, relationships) {
  const id = String(table?.id || table?.name || "").toLowerCase();
  return (relationships || []).filter((r) =>
    String(r.from?.table || "").toLowerCase() === id || String(r.to?.table || "").toLowerCase() === id
  );
}
