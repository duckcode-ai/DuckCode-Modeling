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
  visibleLimit: 0, // 0 = show all, >0 = limit visible entities
  activeSchemaFilter: null, // filter to a specific schema/subject_area
  largeModelBanner: null, // { total, showing } or null
  centerEntityId: null, // entity to center on in diagram
  layoutRefreshTick: 0, // increments when user asks to re-run auto layout
  _lastAutoTuneCount: 0, // track last auto-tune to avoid re-applying

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
    set({ nodes, edges, warnings, model });
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
  setVisibleLimit: (limit) => set({ visibleLimit: limit }),
  setActiveSchemaFilter: (schema) => set({ activeSchemaFilter: schema }),
  setLargeModelBanner: (banner) => set({ largeModelBanner: banner }),
  setCenterEntityId: (id) => set({ centerEntityId: id }),
  requestLayoutRefresh: () => set((s) => ({ layoutRefreshTick: s.layoutRefreshTick + 1 })),

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
