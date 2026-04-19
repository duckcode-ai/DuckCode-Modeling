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
import SubjectAreaGroup from "./SubjectAreaGroup";
import EnumNode from "./EnumNode";
import CanvasContextMenu from "./CanvasContextMenu";
import DiagramToolbar from "./DiagramToolbar";
import CrowsFootMarkers from "./CrowsFootMarkers";
import useDiagramStore from "../../stores/diagramStore";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { modelToFlow, CARDINALITY_COLOR } from "../../modelToFlow";
import { runModelChecks, computeModelCompleteness } from "../../modelQuality";
import { layoutWithElk, fallbackGridLayout } from "../../lib/elkLayout";
import { buildSchemaColorMap, SCHEMA_COLORS } from "../../lib/schemaColors";
import { removeEntity, removeRelationship, removeEnum, addEntityWithOptions } from "../../lib/yamlRoundTrip";

const SCHEMA_COLORS_HEX = SCHEMA_COLORS.map((c) => c.hex);

const nodeTypes = { entityNode: EntityNode, group: SubjectAreaGroup, enumNode: EnumNode };

const LARGE_MODEL_THRESHOLD = 100;
const COMPACT_MODE_THRESHOLD = 200;
const UNASSIGNED_SUBJECT_AREA_FILTER = "__unassigned_subject_area__";

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
  dimension_table: new Set(["dimension_table", "fact_table", "bridge_table"]),
  data_vault: new Set(["hub", "link", "satellite"]),
};

// Star schema layout: fact tables centered, dimensions radiating outward
function buildStarSchemaLayout(nodes, edges) {
  const factNodes = nodes.filter((n) => n.data?.type === "fact_table");
  if (factNodes.length === 0) return null;

  const dimNodes = nodes.filter((n) => n.data?.type === "dimension_table");
  const bridgeNodes = nodes.filter((n) => n.data?.type === "bridge_table");
  const otherNodes = nodes.filter(
    (n) => !["fact_table", "dimension_table", "bridge_table"].includes(n.data?.type)
  );

  const NODE_W = 300;
  const NODE_H = 220;
  const FACT_GAP = 420;
  const DIM_RADIUS = 380;
  const CENTER_Y = 500;

  // Place fact tables in a horizontal row at center y
  const factStartX = -(factNodes.length - 1) * (FACT_GAP / 2);
  const positionedFacts = factNodes.map((n, i) => ({
    ...n,
    position: { x: factStartX + i * FACT_GAP, y: CENTER_Y },
  }));

  // Build a map of dimName → fact center positions it's referenced from
  const dimToFactCenters = new Map();
  for (const factNode of positionedFacts) {
    const dimRefs = factNode.data?.dimension_refs || [];
    for (const dimName of dimRefs) {
      if (!dimToFactCenters.has(dimName)) dimToFactCenters.set(dimName, []);
      dimToFactCenters.get(dimName).push(factNode.position);
    }
  }

  // Also collect dimension connections from formal edges
  for (const edge of edges) {
    const sourceNode = positionedFacts.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target && n.data?.type === "dimension_table");
    if (sourceNode && targetNode) {
      if (!dimToFactCenters.has(targetNode.id)) dimToFactCenters.set(targetNode.id, []);
      dimToFactCenters.get(targetNode.id).push(sourceNode.position);
    }
  }

  // Place each dimension node radially from its fact center
  const placedDimIds = new Set();
  const positionedDims = [];
  const angleStep = (2 * Math.PI) / Math.max(dimNodes.length, 1);

  dimNodes.forEach((dimNode, i) => {
    const factCenters = dimToFactCenters.get(dimNode.id) || dimToFactCenters.get(dimNode.data?.name) || [];
    let cx = 0, cy = CENTER_Y;
    if (factCenters.length > 0) {
      cx = factCenters.reduce((sum, p) => sum + p.x, 0) / factCenters.length;
      cy = factCenters.reduce((sum, p) => sum + p.y, 0) / factCenters.length;
    }
    const angle = angleStep * i - Math.PI / 2; // start top
    positionedDims.push({
      ...dimNode,
      position: {
        x: cx + DIM_RADIUS * Math.cos(angle) - NODE_W / 2,
        y: cy + DIM_RADIUS * Math.sin(angle) - NODE_H / 2,
      },
    });
    placedDimIds.add(dimNode.id);
  });

  // Bridge tables: below the fact row
  const positionedBridges = bridgeNodes.map((n, i) => ({
    ...n,
    position: { x: factStartX + i * FACT_GAP, y: CENTER_Y + DIM_RADIUS + 60 },
  }));

  // Other nodes: stacked below everything
  const otherStartY = CENTER_Y + DIM_RADIUS + 340;
  const otherCols = Math.max(1, Math.ceil(Math.sqrt(otherNodes.length)));
  const positionedOther = otherNodes.map((n, i) => ({
    ...n,
    position: {
      x: (i % otherCols) * (NODE_W + 80) - ((otherCols - 1) * (NODE_W + 80)) / 2,
      y: otherStartY + Math.floor(i / otherCols) * (NODE_H + 40),
    },
  }));

  return {
    nodes: [...positionedFacts, ...positionedDims, ...positionedBridges, ...positionedOther],
    edges,
  };
}

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
function applyVisualEffects(nodes, edges, vizSettings, selectedEntityId, entitySearch, modelingViewMode) {
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
      data: { ...node.data, fieldView: vizSettings.fieldView, modelingViewMode },
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

    const relationshipName = edge.data?.name || semanticLabel;
    const physicalLabel =
      edge.data?.fromField && edge.data?.toField
        ? `${edge.data.fromField} -> ${edge.data.toField}`
        : `${edge.data?.fromRef || ""} -> ${edge.data?.toRef || ""}`;
    const edgeLabel =
      modelingViewMode === "conceptual"
        ? `${relationshipName}${semanticLabel ? ` (${semanticLabel})` : ""}`
        : modelingViewMode === "logical"
          ? `${relationshipName} (${semanticLabel})${semanticHints.length ? ` • ${semanticHints.join(", ")}` : ""}`
          : `${physicalLabel} (${semanticLabel})${semanticHints.length ? ` • ${semanticHints.join(", ")}` : ""}`;

    return {
      ...edge,
      type: isSelf ? "smoothstep" : vizSettings.edgeType,
      animated: isFocus || edge.animated,
      label: vizSettings.showEdgeLabels
        ? edgeLabel
        : undefined,
      style: {
        stroke: edgeColor,
        strokeWidth: isFocus ? 3.2 : (isSelf || isPkToFk || isFkToPk ? 2.2 : 1.6),
        strokeDasharray: isSelf ? "6 4" : edge.style?.strokeDasharray,
        opacity: dim ? 0.08 : 0.85,
        transition: "opacity 200ms ease",
      },
      // Preserve crow's-foot markers from modelToFlow. Dim-ref edges (no markers
      // set upstream) and self-references fall back to an arrow head.
      markerStart: edge.markerStart ?? undefined,
      markerEnd: edge.markerEnd ?? {
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

function FlowCanvas() {
  const rf = useReactFlow();
  const canvasSettings = useUiStore((s) => s.userSettings.canvas);
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
    modelingViewMode,
    getSchemaOptions,
    setVizSettings,
    _lastAutoTuneCount,
    collapsedSubjectAreas,
    diagrams,
    activeDiagramId,
    fitDiagramTick,
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

  // Pipeline: filter → schema filter → limit → layout → compact → visual effects
  useEffect(() => {
    if (storeNodes.length === 0) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }

    // Step 1: type/tag filters
    let { nodes: filtered, edges: filteredEdges } = applyFilters(storeNodes, storeEdges, vizSettings);

    // Step 1a: active-diagram filter (subset of entities for the current tab)
    const activeDiagram = (diagrams || []).find((d) => d.id === activeDiagramId);
    if (activeDiagram && Array.isArray(activeDiagram.entityNames) && activeDiagram.entityNames.length > 0) {
      const keep = new Set(activeDiagram.entityNames);
      filtered = filtered.filter((n) => n.type !== "entityNode" || keep.has(n.id));
      const ids = new Set(filtered.map((n) => n.id));
      filteredEdges = filteredEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
    }

    // Step 1b: schema/subject_area filter
    if (activeSchemaFilter) {
      filtered = filtered.filter((n) => {
        const sa = n.data?.subject_area || n.data?.schema || "(default)";
        if (activeSchemaFilter === UNASSIGNED_SUBJECT_AREA_FILTER) {
          return !n.data?.subject_area && !n.data?.schema;
        }
        return sa === activeSchemaFilter;
      });
      const ids = new Set(filtered.map((n) => n.id));
      filteredEdges = filteredEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
    }

    // Step 2: visible limit
    ({ nodes: filtered, edges: filteredEdges } = applyLimit(filtered, filteredEdges, visibleLimit));

    const doLayout = async () => {
      let layoutResult;
      if (vizSettings.layoutMode === "star_schema") {
        const starResult = buildStarSchemaLayout(filtered, filteredEdges);
        layoutResult = starResult || await layoutWithElk(filtered, filteredEdges, {
          density: vizSettings.layoutDensity,
          groupBySubjectArea: vizSettings.groupBySubjectArea,
          fieldView: vizSettings.fieldView,
        });
      } else if (vizSettings.layoutMode === "elk") {
        layoutResult = await layoutWithElk(filtered, filteredEdges, {
          density: vizSettings.layoutDensity,
          groupBySubjectArea: vizSettings.groupBySubjectArea,
          fieldView: vizSettings.fieldView,
        });
      } else {
        layoutResult = fallbackGridLayout(filtered, filteredEdges, {
          density: vizSettings.layoutDensity,
          groupBySubjectArea: vizSettings.groupBySubjectArea,
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
        entitySearch,
        modelingViewMode
      );

      // Count entities per subject area (for collapsed-chip display)
      const subjectAreaCounts = new Map();
      const entityToSa = new Map();
      for (const n of visualNodes) {
        if (n.type !== "entityNode") continue;
        const sa = n.data?.subject_area || n.data?.schema || "(default)";
        subjectAreaCounts.set(sa, (subjectAreaCounts.get(sa) || 0) + 1);
        entityToSa.set(n.id, sa);
      }
      // Count relationships per subject area (same-SA edges)
      const subjectAreaRelCounts = new Map();
      for (const edge of visualEdges) {
        const src = entityToSa.get(edge.source);
        const tgt = entityToSa.get(edge.target);
        if (src && src === tgt) {
          subjectAreaRelCounts.set(src, (subjectAreaRelCounts.get(src) || 0) + 1);
        }
      }
      const collapsed = collapsedSubjectAreas || {};

      // Apply compact mode flag; hide entities inside collapsed subject areas
      let finalNodes = useCompact
        ? visualNodes.map((n) => ({ ...n, data: { ...n.data, compactMode: true }, zIndex: 10 }))
        : visualNodes.map((n) => ({ ...n, zIndex: 10 }));
      finalNodes = finalNodes.filter((n) => {
        if (n.type !== "entityNode") return true;
        const sa = n.data?.subject_area || n.data?.schema || "(default)";
        return !collapsed[sa];
      });

      const groupNodes = (layoutResult.groupNodes || []).map((node) => {
        const sa = node.data?.label;
        const isCollapsed = Boolean(sa && collapsed[sa]);
        const entityCount = sa ? subjectAreaCounts.get(sa) || 0 : 0;
        const relCount = sa ? subjectAreaRelCounts.get(sa) || 0 : 0;
        const baseStyle = node.style || {};
        const nextStyle = isCollapsed
          ? { ...baseStyle, height: 56, width: Math.max(220, Math.min(300, baseStyle.width || 240)) }
          : baseStyle;
        return {
          ...node,
          zIndex: -1,
          style: nextStyle,
          data: { ...(node.data || {}), collapsed: isCollapsed, entityCount, relCount },
        };
      });

      setRfNodes([...groupNodes, ...finalNodes]);
      setRfEdges(visualEdges);
      setLayoutDone(true);
    };

    doLayout();
  }, [storeNodes, storeEdges, vizSettings, selectedEntityId, entitySearch, viewMode, visibleLimit, activeSchemaFilter, layoutRefreshTick, modelingViewMode, collapsedSubjectAreas, diagrams, activeDiagramId, setRfNodes, setRfEdges]);

  // Fit view after layout
  useEffect(() => {
    if (layoutDone && rfNodes.length > 0) {
      requestAnimationFrame(() => {
        rf.fitView({ padding: 0.15, duration: 400 });
      });
      setLayoutDone(false);
    }
  }, [layoutDone, rfNodes.length, rf]);

  // Fit-to-diagram (Shift+F / toolbar / diagram tab click)
  useEffect(() => {
    if (!fitDiagramTick) return;
    requestAnimationFrame(() => {
      rf.fitView({ padding: 0.15, duration: 350 });
    });
  }, [fitDiagramTick, rf]);

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
    if (node.type === "group") return;
    if (node.type === "enumNode") {
      const name = node.id.startsWith("enum:") ? node.id.slice(5) : node.id;
      const ui = useUiStore.getState();
      ui.setSelection?.({ kind: "enum", enumName: name });
      if (!ui.rightPanelOpen) ui.toggleRightPanel?.();
      return;
    }
    selectEntity(node.id);
  }, [selectEntity]);

  const onPaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const [contextMenu, setContextMenu] = useState(null);
  const onNodeContextMenu = useCallback((event, node) => {
    if (node.type === "group") return;
    event.preventDefault();
    const { diagrams: ds, activeDiagramId: adid } = useDiagramStore.getState();
    const active = (ds || []).find((d) => d.id === adid);
    const inActiveDiagram =
      !Array.isArray(active?.entityNames) || active.entityNames.includes(node.id);
    setContextMenu({
      target: node.type === "enumNode" ? "enum" : "entity",
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id,
      inActiveDiagram,
    });
  }, []);
  const onEdgeContextMenu = useCallback((event, edge) => {
    event.preventDefault();
    setContextMenu({
      target: "relationship",
      x: event.clientX,
      y: event.clientY,
      edgeId: edge.id,
    });
  }, []);
  const onPaneContextMenu = useCallback((event) => {
    event.preventDefault();
    setContextMenu({
      target: "pane",
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const handleContextAction = useCallback((actionId, menu) => {
    const ui = useUiStore.getState();
    const diagram = useDiagramStore.getState();
    if (menu.target === "entity") {
      if (actionId === "edit") {
        diagram.selectEntity(menu.nodeId);
        ui.setSelection?.({ kind: "entity", entityName: menu.nodeId });
        if (!ui.rightPanelOpen) ui.toggleRightPanel?.();
      } else if (actionId === "locate") {
        diagram.setCenterEntityId(menu.nodeId);
      } else if (actionId === "delete") {
        if (window.confirm(`Delete entity "${menu.nodeId}"?`)) {
          window.dispatchEvent(new CustomEvent("dl:entity:delete", { detail: { name: menu.nodeId } }));
        }
      } else if (actionId === "duplicate") {
        window.dispatchEvent(new CustomEvent("dl:entity:duplicate", { detail: { name: menu.nodeId } }));
      } else if (actionId === "toggle-diagram") {
        diagram.toggleEntityInActiveDiagram?.(menu.nodeId);
      } else if (actionId === "copy-name") {
        try {
          navigator.clipboard?.writeText?.(menu.nodeId);
          ui.addToast?.({ type: "success", message: `Copied "${menu.nodeId}"` });
        } catch {
          /* clipboard may be unavailable */
        }
      }
    } else if (menu.target === "enum") {
      const enumName = menu.nodeId?.startsWith("enum:") ? menu.nodeId.slice(5) : menu.nodeId;
      if (actionId === "edit") {
        ui.setSelection?.({ kind: "enum", enumName });
        if (!ui.rightPanelOpen) ui.toggleRightPanel?.();
      } else if (actionId === "delete") {
        if (window.confirm(`Delete enum "${enumName}"?`)) {
          window.dispatchEvent(new CustomEvent("dl:enum:delete", { detail: { name: enumName } }));
        }
      }
    } else if (menu.target === "relationship") {
      if (actionId === "edit") {
        ui.setSelection?.({ kind: "relationship", relId: menu.edgeId });
        if (!ui.rightPanelOpen) ui.toggleRightPanel?.();
      } else if (actionId === "delete") {
        window.dispatchEvent(new CustomEvent("dl:relationship:delete", { detail: { id: menu.edgeId } }));
      }
    } else if (menu.target === "pane") {
      if (actionId === "fit") diagram.requestFitDiagram();
      else if (actionId === "add-entity") ui.openModal?.("newEntity", { type: "table" });
      else if (actionId === "add-enum") ui.openModal?.("newEntity", { type: "enum" });
      else if (actionId === "add-relationship") ui.openModal?.("newRelationship");
    }
  }, []);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeContextMenu={onEdgeContextMenu}
      onPaneContextMenu={onPaneContextMenu}
      fitView
      onlyRenderVisibleElements={rfNodes.length > 100}
      proOptions={{ hideAttribution: true }}
      minZoom={0.05}
      maxZoom={3}
      defaultEdgeOptions={{ type: canvasSettings?.edgeType || vizSettings.edgeType }}
      snapToGrid={!!canvasSettings?.snapToGrid}
      snapGrid={[16, 16]}
      style={{ width: "100%", height: "100%" }}
    >
      <Background gap={24} color="#e2e8f0" size={1} />
      {canvasSettings?.showMinimap !== false && (
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
      )}
      <Controls
        showInteractive={false}
        style={{ borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}
      />
      <CanvasContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onAction={handleContextAction}
      />
    </ReactFlow>
  );
}

export default function DiagramCanvas() {
  const { setGraph, largeModelBanner, setLargeModelBanner, setVisibleLimit, setViewMode, setVizSettings } = useDiagramStore();
  const { activeFileContent } = useWorkspaceStore();
  const { diagramFullscreen, setDiagramFullscreen } = useUiStore();

  // Context-menu → YAML mutations (delete entity/relationship, duplicate)
  useEffect(() => {
    const applyMutation = (mutated) => {
      if (mutated && typeof mutated.yaml === "string" && !mutated.error) {
        useWorkspaceStore.getState().updateContent(mutated.yaml);
      } else if (mutated?.error) {
        useUiStore.getState().addToast?.({ type: "error", message: mutated.error });
      }
    };
    const onDeleteEntity = (e) => {
      const name = e.detail?.name;
      const yaml = useWorkspaceStore.getState().activeFileContent;
      if (!name || !yaml) return;
      applyMutation(removeEntity(yaml, name));
    };
    const onDuplicateEntity = (e) => {
      const name = e.detail?.name;
      const yaml = useWorkspaceStore.getState().activeFileContent;
      if (!name || !yaml) return;
      const model = useDiagramStore.getState().model;
      const entity = (model?.entities || []).find((x) => x.name === name);
      if (!entity) return;
      applyMutation(
        addEntityWithOptions(yaml, {
          name: `${name}_copy`,
          type: entity.type,
          description: entity.description,
          subjectArea: entity.subject_area,
          schema: entity.schema,
        })
      );
    };
    const onDeleteRelationship = (e) => {
      const id = e.detail?.id;
      const yaml = useWorkspaceStore.getState().activeFileContent;
      if (!id || !yaml) return;
      // edge ids have shape "rel-<relName>"
      const relName = id.startsWith("rel-") ? id.slice(4) : id;
      applyMutation(removeRelationship(yaml, relName));
    };
    const onDeleteEnum = (e) => {
      const name = e.detail?.name;
      const yaml = useWorkspaceStore.getState().activeFileContent;
      if (!name || !yaml) return;
      applyMutation(removeEnum(yaml, name));
    };
    window.addEventListener("dl:entity:delete", onDeleteEntity);
    window.addEventListener("dl:entity:duplicate", onDuplicateEntity);
    window.addEventListener("dl:relationship:delete", onDeleteRelationship);
    window.addEventListener("dl:enum:delete", onDeleteEnum);
    return () => {
      window.removeEventListener("dl:entity:delete", onDeleteEntity);
      window.removeEventListener("dl:entity:duplicate", onDuplicateEntity);
      window.removeEventListener("dl:relationship:delete", onDeleteRelationship);
      window.removeEventListener("dl:enum:delete", onDeleteEnum);
    };
  }, []);

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
      // Build per-entity completeness score map
      const completenessReport = computeModelCompleteness(check.model);
      const entityScoreMap = {};
      (completenessReport?.entities || []).forEach((e) => {
        entityScoreMap[e.entityName] = e.score;
      });
      const nodesWithRelCount = (graph.nodes || []).map((n) => {
        const schema = n.data?.subject_area || n.data?.schema || "(default)";
        return {
          ...n,
          data: {
            ...n.data,
            relationshipCount: relCounts[n.id] || 0,
            schemaColorIndex: schemaColorMap[schema] ?? 0,
            completenessScore: entityScoreMap[n.data?.name] ?? null,
          },
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
          <span className="text-amber-600">— Showing top {largeModelBanner.showing} by connectivity. Use search or filters to explore.</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => { setVisibleLimit(0); setLargeModelBanner(null); }}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors"
            >
              Show All
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

      <div className="flex-1 min-h-0 min-w-0 w-full h-full relative">
        <CrowsFootMarkers />
        <ReactFlowProvider>
          <FlowCanvas />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
