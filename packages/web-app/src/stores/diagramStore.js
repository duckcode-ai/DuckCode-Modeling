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
  viewMode: "all", // "all" | "lineage"
  visibleLimit: 0, // 0 = show all, >0 = limit visible entities
  lineageDepth: 1, // how many hops from selected entity in lineage mode

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
  setLineageDepth: (depth) => set({ lineageDepth: depth }),

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
}));

export default useDiagramStore;
