import { create } from "zustand";

const useDiagramStore = create((set, get) => ({
  // Graph data
  nodes: [],
  edges: [],
  warnings: [],
  model: null,

  // Selection
  selectedEntityId: null,
  selectedEntity: null,

  // Search
  entitySearch: "",

  // Exploration mode
  viewMode: "all", // "all" | "overview"
  modelingViewMode: "physical", // conceptual | logical | physical
  visibleLimit: 0, // 0 = show all, >0 = limit visible entities
  activeSchemaFilter: null, // filter to a specific schema/subject_area
  largeModelBanner: null, // { total, showing } or null
  centerEntityId: null, // entity to center on in diagram
  layoutRefreshTick: 0, // increments when user asks to re-run auto layout
  _lastAutoTuneCount: 0, // track last auto-tune to avoid re-applying

  // Subject-area collapse state (keyed by subject-area name)
  collapsedSubjectAreas: {},

  // Diagrams — project has 1..N diagrams; each is a filtered view of entities
  diagrams: [{ id: "main", name: "Main", entityNames: null }],
  activeDiagramId: "main",
  fitDiagramTick: 0,

  // Layout & viz settings
  vizSettings: {
    fieldView: "all",
    edgeType: "smoothstep",
    showEdgeLabels: true,
    dimUnrelated: true,
    dimSearch: false,
    showBackground: true,
    entityTypeFilter: "all",
    tagFilter: "all",
    layoutMode: "elk",
    layoutDensity: "normal",
    groupBySubjectArea: true,
  },

  // --- Actions ---
  setGraph: ({ nodes, edges, warnings, model }) => {
    const { selectedEntityId, model: previousModel, modelingViewMode } = get();
    const selectedEntity = selectedEntityId
      ? (model?.entities || []).find((e) => e.name === selectedEntityId) || null
      : null;
    const nextKind = model?.model?.kind || "";
    const prevKind = previousModel?.model?.kind || "";
    set({
      nodes,
      edges,
      warnings,
      model,
      selectedEntity,
      modelingViewMode: nextKind && nextKind !== prevKind ? nextKind : modelingViewMode,
    });
  },

  clearGraph: () => {
    set({ nodes: [], edges: [], warnings: [], model: null, selectedEntityId: null, selectedEntity: null });
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  selectEntity: (entityId) => {
    const { model } = get();
    const entity = entityId
      ? (model?.entities || []).find((e) => e.name === entityId) || null
      : null;
    set({ selectedEntityId: entityId, selectedEntity: entity });
  },

  clearSelection: () => {
    set({ selectedEntityId: null, selectedEntity: null });
  },

  setEntitySearch: (search) => set({ entitySearch: search }),

  setViewMode: (mode) => set({ viewMode: mode }),
  setModelingViewMode: (mode) => set({ modelingViewMode: mode }),
  setVisibleLimit: (limit) => set({ visibleLimit: limit }),
  setActiveSchemaFilter: (schema) => set({ activeSchemaFilter: schema }),
  setLargeModelBanner: (banner) => set({ largeModelBanner: banner }),
  setCenterEntityId: (id) => set({ centerEntityId: id }),
  requestLayoutRefresh: () => set((s) => ({ layoutRefreshTick: s.layoutRefreshTick + 1 })),
  requestFitDiagram: () => set((s) => ({ fitDiagramTick: s.fitDiagramTick + 1 })),

  toggleSubjectAreaCollapsed: (name) => {
    if (!name) return;
    set((s) => ({
      collapsedSubjectAreas: {
        ...s.collapsedSubjectAreas,
        [name]: !s.collapsedSubjectAreas[name],
      },
    }));
  },

  setDiagrams: (diagrams, activeDiagramId) =>
    set((s) => ({
      diagrams: Array.isArray(diagrams) && diagrams.length > 0 ? diagrams : s.diagrams,
      activeDiagramId:
        activeDiagramId ||
        (Array.isArray(diagrams) && diagrams[0] ? diagrams[0].id : s.activeDiagramId),
    })),
  selectDiagram: (id) => {
    const { diagrams } = get();
    if (!diagrams.some((d) => d.id === id)) return;
    set({ activeDiagramId: id });
  },
  addDiagram: (name) => {
    const trimmed = (name || "Untitled").trim() || "Untitled";
    const id = `dg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({
      diagrams: [...s.diagrams, { id, name: trimmed, entityNames: null }],
      activeDiagramId: id,
    }));
    return id;
  },
  renameDiagram: (id, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    set((s) => ({
      diagrams: s.diagrams.map((d) => (d.id === id ? { ...d, name: trimmed } : d)),
    }));
  },
  closeDiagram: (id) => {
    const { diagrams, activeDiagramId } = get();
    if (diagrams.length <= 1) return;
    const next = diagrams.filter((d) => d.id !== id);
    const nextActive =
      id === activeDiagramId
        ? next[Math.max(0, diagrams.findIndex((d) => d.id === id) - 1)]?.id || next[0].id
        : activeDiagramId;
    set({ diagrams: next, activeDiagramId: nextActive });
  },

  // Toggle whether an entity is included in the active diagram's scope.
  // Diagrams with entityNames === null show everything; once the user scopes a
  // diagram explicitly, we switch to a maintained include list.
  toggleEntityInActiveDiagram: (entityName) => {
    const name = String(entityName || "").trim();
    if (!name) return;
    const { diagrams, activeDiagramId, model } = get();
    const allNames = (model?.entities || []).map((e) => e.name);
    set({
      diagrams: diagrams.map((d) => {
        if (d.id !== activeDiagramId) return d;
        const current = Array.isArray(d.entityNames) ? d.entityNames : allNames;
        const has = current.includes(name);
        const nextList = has ? current.filter((n) => n !== name) : [...current, name];
        return { ...d, entityNames: nextList };
      }),
    });
  },

  // Replace the active diagram's entity scope wholesale (or clear to "all").
  setActiveDiagramEntities: (entityNames) => {
    const { diagrams, activeDiagramId } = get();
    const next = entityNames === null
      ? null
      : Array.from(new Set((entityNames || []).filter(Boolean)));
    set({
      diagrams: diagrams.map((d) =>
        d.id === activeDiagramId ? { ...d, entityNames: next } : d
      ),
    });
  },

  updateVizSetting: (key, value) => {
    set((s) => ({
      vizSettings: { ...s.vizSettings, [key]: value },
    }));
  },

  setVizSettings: (settings) => {
    set((s) => ({
      vizSettings: { ...s.vizSettings, ...settings },
    }));
  },

  // Get all unique tags from current model
  getTagOptions: () => {
    const { model } = get();
    const tags = new Set();
    (model?.entities || []).forEach((entity) => {
      (entity.tags || []).forEach((tag) => tags.add(String(tag)));
    });
    return Array.from(tags).sort();
  },

  // Get all entity names
  getEntityNames: () => {
    const { model } = get();
    return (model?.entities || []).map((e) => e.name).sort();
  },

  // Get unique schema/subject_area options with counts
  getSchemaOptions: () => {
    const { model, edges } = get();
    const entities = model?.entities || [];
    const schemaMap = new Map();
    for (const entity of entities) {
      const key = entity.subject_area || entity.schema || "(default)";
      if (!schemaMap.has(key)) schemaMap.set(key, { name: key, entityCount: 0, tableCount: 0, viewCount: 0, relCount: 0 });
      const s = schemaMap.get(key);
      s.entityCount++;
      if ((entity.type || "table") === "view") s.viewCount++;
      else s.tableCount++;
    }
    // Count relationships per schema
    const entityToSchema = new Map();
    for (const entity of entities) {
      entityToSchema.set(entity.name, entity.subject_area || entity.schema || "(default)");
    }
    for (const edge of (edges || [])) {
      const srcSchema = entityToSchema.get(edge.source);
      if (srcSchema && schemaMap.has(srcSchema)) schemaMap.get(srcSchema).relCount++;
    }
    return Array.from(schemaMap.values()).sort((a, b) => b.entityCount - a.entityCount);
  },
}));

export default useDiagramStore;
