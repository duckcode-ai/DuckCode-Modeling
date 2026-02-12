import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import EntityNode from "./EntityNode";
import AnnotationNode from "./AnnotationNode";
import SchemaOverviewNode from "./SchemaOverviewNode";
import DiagramToolbar from "./DiagramToolbar";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { modelToFlow, CARDINALITY_COLOR } from "../../modelToFlow";
import { runModelChecks } from "../../modelQuality";
import { layoutWithElk, fallbackGridLayout } from "../../lib/elkLayout";
import { buildSchemaColorMap, SCHEMA_COLORS } from "../../lib/schemaColors";

const SCHEMA_COLORS_HEX = SCHEMA_COLORS.map((c) => c.hex);

const nodeTypes = { entityNode: EntityNode, annotation: AnnotationNode, schemaOverview: SchemaOverviewNode };

const LARGE_MODEL_THRESHOLD = 100;
const COMPACT_MODE_THRESHOLD = 200;

// Build adjacency map from edges (undirected)
function adjacencyFromEdges(edges) {
  const map = new Map();
  for (const edge of edges) {
    if (!map.has(edge.source)) map.set(edge.source, new Set());
    if (!map.has(edge.target)) map.set(edge.target, new Set());
    map.get(edge.source).add(edge.target);
    map.get(edge.target).add(edge.source);
  }
  return map;
}

// Groups of entity types that should be shown together when a filter is selected
const TYPE_FILTER_GROUPS = {
  table: new Set(["table", "external_table", "snapshot"]),
  view: new Set(["view", "materialized_view"]),
};

// Apply type/tag filters
function applyFilters(nodes, edges, vizSettings) {
  const filtered = nodes.filter((node) => {
    const entityType = String(node.data?.type || "table");
    if (vizSettings.entityTypeFilter !== "all") {
      const group = TYPE_FILTER_GROUPS[vizSettings.entityTypeFilter];
      if (group ? !group.has(entityType) : entityType !== vizSettings.entityTypeFilter) return false;
    }
    if (vizSettings.tagFilter !== "all") {
      const tags = new Set((node.data?.tags || []).map(String));
      if (!tags.has(vizSettings.tagFilter)) return false;
    }
    return true;
  });
  const ids = new Set(filtered.map((n) => n.id));
  const filteredEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes: filtered, edges: filteredEdges };
}

// Apply visible entity limit (slice top N by relationship count)
function applyLimit(nodes, edges, limit) {
  if (limit <= 0 || limit >= nodes.length) return { nodes, edges };
  const sorted = [...nodes].sort((a, b) => (b.data?.relationshipCount || 0) - (a.data?.relationshipCount || 0));
  const limited = sorted.slice(0, limit);
  const ids = new Set(limited.map((n) => n.id));
  const limitedEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes: limited, edges: limitedEdges };
}

// Apply visual styling (dim, highlight, selection glow)
function applyVisualEffects(nodes, edges, vizSettings, selectedEntityId, entitySearch) {
  const search = entitySearch.trim().toLowerCase();
  const adjacency = adjacencyFromEdges(edges);

  const connected = new Set();
  if (selectedEntityId && adjacency.has(selectedEntityId)) {
    connected.add(selectedEntityId);
    for (const n of adjacency.get(selectedEntityId)) connected.add(n);
  }

  const matched = new Set();
  if (search) {
    for (const node of nodes) {
      const name = String(node.data?.name || node.id || "").toLowerCase();
      const fieldMatch = (node.data?.fields || []).some((f) =>
        String(f.name || "").toLowerCase().includes(search)
      );
      if (name.includes(search) || fieldMatch) matched.add(node.id);
    }
  }

  const styledNodes = nodes.map((node) => {
    const isSelected = selectedEntityId === node.id;
    const isMatched = search ? matched.has(node.id) : false;
    let dim = false;
    if (vizSettings.dimUnrelated && selectedEntityId && connected.size > 0 && !connected.has(node.id)) dim = true;
    if (vizSettings.dimSearch && search && !isMatched) dim = true;

    return {
      ...node,
      style: {
        ...(node.style || {}),
        opacity: dim ? 0.12 : 1,
        transition: "opacity 200ms ease",
        ...(isSelected ? { filter: "drop-shadow(0 0 10px rgba(59,130,246,0.6))" } : {}),
      },
      data: { ...node.data, fieldView: vizSettings.fieldView },
    };
  });

  const styledEdges = edges.map((edge) => {
    const cardinality = edge.data?.cardinality || "one_to_many";
    const semanticLabel = edge.data?.cardinalityLabel || cardinality.replace(/_/g, ":");
    const isSelf = Boolean(edge.data?.isSelf);
    const isPkToFk = Boolean(edge.data?.pkToFk);
    const isFkToPk = Boolean(edge.data?.fkToPk);
    const isSharedTarget = Boolean(edge.data?.sharedTarget);
    const sharedTargetCount = edge.data?.sharedTargetCount || 1;

    let edgeColor =
      isSelf ? "#f59e0b" :
      isPkToFk ? "#0ea5e9" :
      isFkToPk ? "#8b5cf6" :
      CARDINALITY_COLOR[cardinality] || "#94a3b8";
    if (isSharedTarget && !isSelf && !isPkToFk && !isFkToPk) edgeColor = "#0f766e";

    const isFocus = selectedEntityId && (edge.source === selectedEntityId || edge.target === selectedEntityId);
    let dim = false;
    if (vizSettings.dimUnrelated && selectedEntityId && connected.size > 0) {
      if (!(connected.has(edge.source) && connected.has(edge.target))) dim = true;
    }

    const semanticHints = [];
    if (isPkToFk) semanticHints.push("PK->FK");
    if (isFkToPk) semanticHints.push("FK->PK");
    if (isSelf) semanticHints.push("SELF");
    if (isSharedTarget) semanticHints.push(`shared-target x${sharedTargetCount}`);

    const edgeFieldLabel =
      edge.data?.fromField && edge.data?.toField
        ? `${edge.data.fromField} -> ${edge.data.toField}`
        : `${edge.data?.fromRef || ""} -> ${edge.data?.toRef || ""}`;

    return {
      ...edge,
      type: isSelf ? "smoothstep" : vizSettings.edgeType,
      animated: isFocus || edge.animated,
      label: vizSettings.showEdgeLabels
        ? `${edgeFieldLabel} (${semanticLabel})${semanticHints.length ? ` • ${semanticHints.join(", ")}` : ""}`
        : undefined,
      style: {
        stroke: edgeColor,
        strokeWidth: isFocus ? 3.2 : (isSelf || isPkToFk || isFkToPk ? 2.2 : 1.6),
        strokeDasharray: isSelf ? "6 4" : edge.style?.strokeDasharray,
        opacity: dim ? 0.08 : 0.85,
        transition: "opacity 200ms ease",
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edgeColor,
        width: isFocus ? 18 : 15,
        height: isFocus ? 18 : 15,
      },
      pathOptions: isSelf ? { borderRadius: 20, offset: 40 } : edge.pathOptions,
      labelStyle: { fill: "#475569", fontSize: 9, fontWeight: 600 },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 3,
    };
  });

  return { nodes: styledNodes, edges: styledEdges };
}

// Build schema overview nodes from the store's schema options
function buildSchemaOverviewNodes(schemaOptions, onDrillIn) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(schemaOptions.length)));
  return schemaOptions.map((s, i) => ({
    id: `__schema_${s.name}`,
    type: "schemaOverview",
    position: { x: 60 + (i % cols) * 280, y: 60 + Math.floor(i / cols) * 200 },
    data: {
      schemaName: s.name,
      entityCount: s.entityCount,
      tableCount: s.tableCount,
      viewCount: s.viewCount,
      relCount: s.relCount,
      colorIndex: i,
      onDrillIn,
    },
  }));
}

function FlowCanvas() {
  const rf = useReactFlow();
  const {
    nodes: storeNodes,
    edges: storeEdges,
    vizSettings,
    selectedEntityId,
    entitySearch,
    selectEntity,
    clearSelection,
    viewMode,
    setViewMode,
    visibleLimit,
    setVisibleLimit,
    activeSchemaFilter,
    setActiveSchemaFilter,
    setLargeModelBanner,
    centerEntityId,
    setCenterEntityId,
    layoutRefreshTick,
    getSchemaOptions,
    setVizSettings,
    _lastAutoTuneCount,
  } = useDiagramStore();

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [layoutDone, setLayoutDone] = useState(false);
  const autoTuneRef = useRef(0);

  // Auto-tune: apply smart defaults when a large model is first loaded
  useEffect(() => {
    const total = storeNodes.length;
    if (total > LARGE_MODEL_THRESHOLD && autoTuneRef.current !== total) {
      autoTuneRef.current = total;
      const showCount = Math.min(50, total);
      setVisibleLimit(showCount);
      setVizSettings({
        fieldView: "keys",
        layoutDensity: "compact",
        showEdgeLabels: false,
      });
      setLargeModelBanner({ total, showing: showCount });
    } else if (total <= LARGE_MODEL_THRESHOLD && autoTuneRef.current !== total) {
      autoTuneRef.current = total;
      setLargeModelBanner(null);
    }
  }, [storeNodes.length, setVisibleLimit, setVizSettings, setLargeModelBanner]);

  // Schema overview drill-in handler
  const handleSchemaOverviewDrillIn = useCallback((schemaName) => {
    setActiveSchemaFilter(schemaName);
    setViewMode("all");
  }, [setActiveSchemaFilter, setViewMode]);

  // Pipeline: filter → schema filter → limit → layout → compact → visual effects
  useEffect(() => {
    if (storeNodes.length === 0) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }

    // Schema overview mode: show schema summary cards instead of entities
    if (viewMode === "overview") {
      const schemaOptions = getSchemaOptions();
      const overviewNodes = buildSchemaOverviewNodes(schemaOptions, handleSchemaOverviewDrillIn);
      setRfNodes(overviewNodes);
      setRfEdges([]);
      setLayoutDone(true);
      return;
    }

    // Step 1: type/tag filters
    let { nodes: filtered, edges: filteredEdges } = applyFilters(storeNodes, storeEdges, vizSettings);

    // Step 1b: schema/subject_area filter
    if (activeSchemaFilter) {
      filtered = filtered.filter((n) => {
        const sa = n.data?.subject_area || n.data?.schema || "(default)";
        return sa === activeSchemaFilter;
      });
      const ids = new Set(filtered.map((n) => n.id));
      filteredEdges = filteredEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
    }

    // Step 2: visible limit
    ({ nodes: filtered, edges: filteredEdges } = applyLimit(filtered, filteredEdges, visibleLimit));

    const doLayout = async () => {
      let layoutResult;
      if (vizSettings.layoutMode === "elk") {
        layoutResult = await layoutWithElk(filtered, filteredEdges, {
          density: vizSettings.layoutDensity,
          groupBySubjectArea: vizSettings.groupBySubjectArea,
          fieldView: vizSettings.fieldView,
        });
      } else {
        layoutResult = fallbackGridLayout(filtered, filteredEdges, {
          density: vizSettings.layoutDensity,
          fieldView: vizSettings.fieldView,
        });
      }

      // Inject compact mode for large visible sets
      const useCompact = layoutResult.nodes.length > COMPACT_MODE_THRESHOLD;

      // Step 4: visual effects
      const { nodes: visualNodes, edges: visualEdges } = applyVisualEffects(
        layoutResult.nodes,
        layoutResult.edges,
        vizSettings,
        selectedEntityId,
        entitySearch
      );

      // Apply compact mode flag
      const finalNodes = useCompact
        ? visualNodes.map((n) => ({ ...n, data: { ...n.data, compactMode: true } }))
        : visualNodes;

      setRfNodes(finalNodes);
      setRfEdges(visualEdges);
      setLayoutDone(true);
    };

    doLayout();
  }, [storeNodes, storeEdges, vizSettings, selectedEntityId, entitySearch, viewMode, visibleLimit, activeSchemaFilter, layoutRefreshTick, setRfNodes, setRfEdges, getSchemaOptions, handleSchemaOverviewDrillIn]);

  // Fit view after layout
  useEffect(() => {
    if (layoutDone && rfNodes.length > 0) {
      requestAnimationFrame(() => {
        rf.fitView({ padding: 0.15, duration: 400 });
      });
      setLayoutDone(false);
    }
  }, [layoutDone, rfNodes.length, rf]);

  // Center on entity when requested from entity list panel
  useEffect(() => {
    if (centerEntityId && rfNodes.length > 0) {
      const targetNode = rfNodes.find((n) => n.id === centerEntityId);
      if (targetNode) {
        requestAnimationFrame(() => {
          rf.fitView({ nodes: [{ id: centerEntityId }], padding: 0.5, duration: 500 });
        });
      }
      setCenterEntityId(null);
    }
  }, [centerEntityId, rfNodes, rf, setCenterEntityId]);

  const onNodeClick = useCallback((_event, node) => {
    // Schema overview nodes handle their own click
    if (node.type === "schemaOverview") return;
    selectEntity(node.id);
  }, [selectEntity]);

  const onPaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // Annotation management
  const addAnnotation = useCallback((position) => {
    const id = `__annotation_${Date.now()}`;
    const newNode = {
      id,
      type: "annotation",
      position: position || { x: 100, y: 100 },
      data: {
        text: "",
        colorIndex: Math.floor(Math.random() * 5),
        onDelete: (nid) => setRfNodes((nds) => nds.filter((n) => n.id !== nid)),
        onUpdate: (nid, text) => setRfNodes((nds) => nds.map((n) => n.id === nid ? { ...n, data: { ...n.data, text } } : n)),
      },
      draggable: true,
    };
    setRfNodes((nds) => [...nds, newNode]);
  }, [setRfNodes]);

  // Expose addAnnotation via window for toolbar access
  React.useEffect(() => {
    window.__dlAddAnnotation = addAnnotation;
    return () => { delete window.__dlAddAnnotation; };
  }, [addAnnotation]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      fitView
      onlyRenderVisibleElements={rfNodes.length > 100}
      proOptions={{ hideAttribution: true }}
      minZoom={0.05}
      maxZoom={3}
      defaultEdgeOptions={{ type: vizSettings.edgeType }}
      style={{ width: "100%", height: "100%" }}
    >
      <Background gap={24} color="#e2e8f0" size={1} />
      <MiniMap
        zoomable
        pannable
        nodeColor={(node) => {
          const idx = node.data?.schemaColorIndex;
          return idx != null ? SCHEMA_COLORS_HEX[idx % SCHEMA_COLORS_HEX.length] : "#3b82f6";
        }}
        maskColor="rgba(248, 250, 252, 0.8)"
        style={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
      />
      <Controls
        showInteractive={false}
        style={{ borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}
      />
    </ReactFlow>
  );
}

export default function DiagramCanvas() {
  const { setGraph, largeModelBanner, setLargeModelBanner, setVisibleLimit, setViewMode, setVizSettings } = useDiagramStore();
  const { activeFileContent } = useWorkspaceStore();
  const { diagramFullscreen, setDiagramFullscreen } = useUiStore();

  // Parse model → graph
  useEffect(() => {
    if (!activeFileContent) {
      setGraph({ nodes: [], edges: [], warnings: [], model: null });
      return;
    }
    // Reset entity type filter so all types are visible for every new file
    setVizSettings({ entityTypeFilter: "all" });
    const check = runModelChecks(activeFileContent);
    // Keep rendering whenever YAML parses to a model shape; validation issues
    // are surfaced in Validation/Status panels instead of hiding the diagram.
    if (!check.model) {
      setGraph({ nodes: [], edges: [], warnings: [], model: null });
      return;
    }
    try {
      const graph = modelToFlow(check.model);
      const relCounts = {};
      (graph.edges || []).forEach((e) => {
        relCounts[e.source] = (relCounts[e.source] || 0) + 1;
        relCounts[e.target] = (relCounts[e.target] || 0) + 1;
      });
      // Build schema→color map from entities
      const schemaColorMap = buildSchemaColorMap(check.model.entities || []);
      const nodesWithRelCount = (graph.nodes || []).map((n) => {
        const schema = n.data?.subject_area || n.data?.schema || "(default)";
        return {
          ...n,
          data: { ...n.data, relationshipCount: relCounts[n.id] || 0, schemaColorIndex: schemaColorMap[schema] ?? 0 },
        };
      });
      setGraph({
        nodes: nodesWithRelCount,
        edges: graph.edges || [],
        warnings: graph.warnings || [],
        model: check.model,
      });
    } catch (_err) {
      setGraph({ nodes: [], edges: [], warnings: [], model: null });
    }
  }, [activeFileContent, setGraph, setVizSettings]);

  // Escape key exits fullscreen
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && diagramFullscreen) {
        setDiagramFullscreen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [diagramFullscreen, setDiagramFullscreen]);

  const containerClass = diagramFullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-white"
    : "flex flex-col h-full";

  return (
    <div className={containerClass}>
      <DiagramToolbar />

      {/* Large model info banner */}
      {largeModelBanner && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800">
          <span className="font-semibold">Large model ({largeModelBanner.total} entities)</span>
          <span className="text-amber-600">— Showing top {largeModelBanner.showing} by connectivity. Use search, filters, or Overview to explore.</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => { setVisibleLimit(0); setLargeModelBanner(null); }}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors"
            >
              Show All
            </button>
            <button
              onClick={() => setViewMode("overview")}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors"
            >
              Overview
            </button>
            <button
              onClick={() => setLargeModelBanner(null)}
              className="p-0.5 rounded hover:bg-amber-200 text-amber-500 transition-colors"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 min-w-0 w-full h-full">
        <ReactFlowProvider>
          <FlowCanvas />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
