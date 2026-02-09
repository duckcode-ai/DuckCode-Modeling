import React, { useCallback, useEffect, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import EntityNode from "./EntityNode";
import DiagramToolbar from "./DiagramToolbar";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { modelToFlow, CARDINALITY_COLOR } from "../../modelToFlow";
import { runModelChecks } from "../../modelQuality";
import { layoutWithElk, fallbackGridLayout } from "../../lib/elkLayout";

const nodeTypes = { entityNode: EntityNode };

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

// BFS from a root entity up to `depth` hops — returns set of reachable entity IDs
function bfsReachable(rootId, edges, depth) {
  const adj = adjacencyFromEdges(edges);
  const visited = new Set([rootId]);
  let frontier = [rootId];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next = [];
    for (const id of frontier) {
      for (const neighbor of adj.get(id) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

// Apply type/tag filters
function applyFilters(nodes, edges, vizSettings) {
  const filtered = nodes.filter((node) => {
    const entityType = String(node.data?.type || "table");
    if (vizSettings.entityTypeFilter !== "all" && entityType !== vizSettings.entityTypeFilter) return false;
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

// Apply lineage mode: only show entities within `depth` hops of selected entity
function applyLineage(nodes, edges, selectedEntityId, depth) {
  if (!selectedEntityId) return { nodes, edges };
  const reachable = bfsReachable(selectedEntityId, edges, depth);
  const lineageNodes = nodes.filter((n) => reachable.has(n.id));
  const ids = new Set(lineageNodes.map((n) => n.id));
  const lineageEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes: lineageNodes, edges: lineageEdges };
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
    const edgeColor = CARDINALITY_COLOR[cardinality] || "#94a3b8";
    const isFocus = selectedEntityId && (edge.source === selectedEntityId || edge.target === selectedEntityId);
    let dim = false;
    if (vizSettings.dimUnrelated && selectedEntityId && connected.size > 0) {
      if (!(connected.has(edge.source) && connected.has(edge.target))) dim = true;
    }

    return {
      ...edge,
      type: vizSettings.edgeType,
      animated: isFocus || edge.animated,
      label: vizSettings.showEdgeLabels
        ? `${edge.data?.name || ""} (${cardinality.replace(/_/g, ":")})`
        : undefined,
      style: {
        stroke: edgeColor,
        strokeWidth: isFocus ? 3 : 1.5,
        opacity: dim ? 0.08 : 0.85,
        transition: "opacity 200ms ease",
      },
      labelStyle: { fill: "#475569", fontSize: 9, fontWeight: 600 },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 3,
    };
  });

  return { nodes: styledNodes, edges: styledEdges };
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
    visibleLimit,
    lineageDepth,
  } = useDiagramStore();

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [layoutDone, setLayoutDone] = useState(false);

  // Pipeline: filter → lineage → limit → layout → visual effects
  useEffect(() => {
    if (storeNodes.length === 0) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }

    // Step 1: type/tag filters
    let { nodes: filtered, edges: filteredEdges } = applyFilters(storeNodes, storeEdges, vizSettings);

    // Step 2: lineage mode
    if (viewMode === "lineage" && selectedEntityId) {
      ({ nodes: filtered, edges: filteredEdges } = applyLineage(filtered, filteredEdges, selectedEntityId, lineageDepth));
    }

    // Step 3: visible limit
    ({ nodes: filtered, edges: filteredEdges } = applyLimit(filtered, filteredEdges, visibleLimit));

    const doLayout = async () => {
      let layoutResult;
      if (vizSettings.layoutMode === "elk") {
        layoutResult = await layoutWithElk(filtered, filteredEdges, {
          density: vizSettings.layoutDensity,
        });
      } else {
        layoutResult = fallbackGridLayout(filtered, filteredEdges, vizSettings.layoutDensity);
      }

      // Step 4: visual effects
      const { nodes: visualNodes, edges: visualEdges } = applyVisualEffects(
        layoutResult.nodes,
        layoutResult.edges,
        vizSettings,
        selectedEntityId,
        entitySearch
      );

      setRfNodes(visualNodes);
      setRfEdges(visualEdges);
      setLayoutDone(true);
    };

    doLayout();
  }, [storeNodes, storeEdges, vizSettings, selectedEntityId, entitySearch, viewMode, visibleLimit, lineageDepth, setRfNodes, setRfEdges]);

  // Fit view after layout
  useEffect(() => {
    if (layoutDone && rfNodes.length > 0) {
      requestAnimationFrame(() => {
        rf.fitView({ padding: 0.15, duration: 400 });
      });
      setLayoutDone(false);
    }
  }, [layoutDone, rfNodes.length, rf]);

  const onNodeClick = useCallback((_event, node) => {
    selectEntity(node.id);
  }, [selectEntity]);

  const onPaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

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
      proOptions={{ hideAttribution: true }}
      minZoom={0.05}
      maxZoom={3}
      defaultEdgeOptions={{ type: vizSettings.edgeType }}
    >
      <Background gap={24} color="#e2e8f0" size={1} />
      <MiniMap
        zoomable
        pannable
        nodeColor={() => "#3b82f6"}
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
  const { setGraph } = useDiagramStore();
  const { activeFileContent } = useWorkspaceStore();
  const { diagramFullscreen, setDiagramFullscreen } = useUiStore();

  // Parse model → graph
  useEffect(() => {
    if (!activeFileContent) {
      setGraph({ nodes: [], edges: [], warnings: [], model: null });
      return;
    }
    const check = runModelChecks(activeFileContent);
    if (check.hasErrors || !check.model) {
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
      const nodesWithRelCount = (graph.nodes || []).map((n) => ({
        ...n,
        data: { ...n.data, relationshipCount: relCounts[n.id] || 0 },
      }));
      setGraph({
        nodes: nodesWithRelCount,
        edges: graph.edges || [],
        warnings: graph.warnings || [],
        model: check.model,
      });
    } catch (_err) {
      setGraph({ nodes: [], edges: [], warnings: [], model: null });
    }
  }, [activeFileContent, setGraph]);

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
      <div className="flex-1 min-h-0">
        <ReactFlowProvider>
          <FlowCanvas />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
