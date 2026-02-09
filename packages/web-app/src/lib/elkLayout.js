import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "80",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.layered.spacing.edgeNodeBetweenLayers": "40",
  "elk.padding": "[top=50,left=50,bottom=50,right=50]",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
};

export async function layoutWithElk(nodes, edges, options = {}) {
  if (!nodes || nodes.length === 0) {
    return { nodes: [], edges };
  }

  const direction = options.direction || "RIGHT";
  const density = options.density || "normal";

  const spacingMultiplier = density === "compact" ? 0.7 : density === "wide" ? 1.4 : 1;
  const nodeSpacing = Math.round(80 * spacingMultiplier);
  const layerSpacing = Math.round(120 * spacingMultiplier);

  const elkNodes = nodes.map((node) => ({
    id: node.id,
    width: node.measured?.width || 300,
    height: node.measured?.height || 200,
  }));

  const elkEdges = edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

  const graph = {
    id: "root",
    layoutOptions: {
      ...LAYOUT_OPTIONS,
      "elk.direction": direction,
      "elk.spacing.nodeNode": String(nodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
    },
    children: elkNodes,
    edges: elkEdges,
  };

  try {
    const result = await elk.layout(graph);
    const positionMap = new Map();
    (result.children || []).forEach((child) => {
      positionMap.set(child.id, { x: child.x || 0, y: child.y || 0 });
    });

    const layoutedNodes = nodes.map((node) => {
      const pos = positionMap.get(node.id);
      return {
        ...node,
        position: pos || node.position,
      };
    });

    return { nodes: layoutedNodes, edges };
  } catch (err) {
    console.warn("[elk] Layout failed, falling back to grid:", err);
    return fallbackGridLayout(nodes, edges, density);
  }
}

export function fallbackGridLayout(nodes, edges, density = "normal") {
  const scale = density === "compact" ? 0.8 : density === "wide" ? 1.3 : 1;
  const spacingX = 380 * scale;
  const spacingY = 280 * scale;
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));

  const layoutedNodes = nodes.map((node, index) => ({
    ...node,
    position: {
      x: 60 + (index % columns) * spacingX,
      y: 60 + Math.floor(index / columns) * spacingY,
    },
  }));

  return { nodes: layoutedNodes, edges };
}
