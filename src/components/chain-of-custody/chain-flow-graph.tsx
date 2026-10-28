"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  getNodesBounds,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useEffect, useState } from "react";
import {
  FLOW_FIT_PADDING,
  FLOW_MAX_ZOOM,
  FLOW_MIN_ZOOM,
  FLOW_NARROW_CANVAS_PX,
  FLOW_NARROW_INSET_PX,
  FLOW_NARROW_ZOOM,
  GRAPH_CANVAS_CLASS,
  GRAPH_CONTROLS_CLASS,
  GRAPH_DOTS,
  type LineageNodeKind,
} from "./chain-constants";
import { ChainEdge, type ChainEdgeData } from "./chain-edge";
import { ChainNode, FlowColumnNode, FlowGroupNode, type FlowGroupNodeData } from "./chain-node";
import { layoutFlow } from "./flow-layout";
import { reachableNodeIds } from "./use-chain-graph";

const nodeTypes: NodeTypes = {
  chainNode: ChainNode,
  flowGroup: FlowGroupNode,
  flowColumn: FlowColumnNode,
};

const edgeTypes = {
  chainEdge: ChainEdge,
};

// Keyboard focus rings the record's square (chain-node.tsx), not the wider
// box around its label, so the wrapper drops the browser ring.
const NODE_WRAPPER_CLASS = "focus-visible:outline-none";

const LEGEND_SAMPLE_WIDTH = 24;
const LEGEND_SAMPLE_HEIGHT = 6;

/**
 * Frames the chart whenever the node set or the canvas size changes (a group
 * expanding or collapsing, a run filter, a resize). Every Flow node carries
 * its own width and height, so the bounds are known without waiting for
 * React Flow to measure the DOM.
 */
function FrameFlow({ nodeCount }: { nodeCount: number }) {
  const { fitBounds, getNodes, setViewport } = useReactFlow();
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  const narrow = canvasWidth < FLOW_NARROW_CANVAS_PX;

  // Imperative canvas sync with React Flow's viewport.
  useEffect(() => {
    if (nodeCount === 0 || canvasWidth === 0 || canvasHeight === 0) return;
    const bounds = getNodesBounds(getNodes());
    if (!narrow) {
      void fitBounds(bounds, { padding: FLOW_FIT_PADDING });
      return;
    }
    void setViewport({
      x: FLOW_NARROW_INSET_PX - bounds.x * FLOW_NARROW_ZOOM,
      y: canvasHeight / 2 - (bounds.y + bounds.height / 2) * FLOW_NARROW_ZOOM,
      zoom: FLOW_NARROW_ZOOM,
    });
  }, [fitBounds, getNodes, setViewport, narrow, canvasWidth, canvasHeight, nodeCount]);

  return null;
}

export interface ChainFlowGraphProps {
  /** Every record, unpositioned (useChainGraph / useBatchChainGraph). */
  nodes: Node[];
  edges: Edge[];
  warnings: string[];
  /** Lit edges show mass (kg) or branch share (%). */
  labelMode: "kg" | "pct";
  /**
   * Persistent cross-surface focus (the shared selection's lineage). Lights
   * it and dims everything else. Hover focus takes precedence while the
   * pointer is over a record.
   */
  focusNodeIds?: Set<string> | null;
  /** A record was clicked (never a column header or a group). */
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  /** A click on the empty canvas. */
  onPaneClick?: () => void;
}

/**
 * The Flow chart, for both the batch roll-up and one application's lineage:
 * records in columns by kind, small squares joined by curves. Hovering or
 * selecting a record lights its lineage and dims the rest; a crowded column
 * is one stacked group until clicked.
 */
export function ChainFlowGraph({
  nodes,
  edges,
  warnings,
  labelMode,
  focusNodeIds,
  onNodeClick,
  onPaneClick,
}: ChainFlowGraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [expandedKinds, setExpandedKinds] = useState<ReadonlySet<LineageNodeKind>>(new Set());
  const setExpanded = (kind: LineageNodeKind, expanded: boolean) =>
    setExpandedKinds((current) => {
      const next = new Set(current);
      if (expanded) next.add(kind);
      else next.delete(kind);
      return next;
    });

  const layout = layoutFlow(nodes, edges, {
    expandedKinds,
    onCollapse: (kind) => setExpanded(kind, false),
  });
  const selectedDisplayIds = new Set(
    nodes
      .filter((node) => (node.data as { highlighted?: boolean }).highlighted)
      .map((node) => layout.displayIdOf(node.id)),
  );
  const lit = hoveredNodeId
    ? reachableNodeIds(hoveredNodeId, layout.edges)
    : focusNodeIds
      ? new Set(Array.from(focusNodeIds, layout.displayIdOf))
      : null;

  const displayNodes = layout.nodes.map((node) => {
    if (node.type === "flowColumn") return node;
    const isGroup = node.type === "flowGroup";
    return {
      ...node,
      className: NODE_WRAPPER_CLASS,
      data: {
        ...node.data,
        dimmed: lit ? !lit.has(node.id) : false,
        lit: lit?.has(node.id) ?? false,
        current: node.id === hoveredNodeId || (isGroup && selectedDisplayIds.has(node.id)),
      },
    };
  });
  const litEdge = (graphEdge: Edge) => Boolean(lit?.has(graphEdge.source) && lit.has(graphEdge.target));
  // Lit edges draw on top: React Flow paints edges in array order.
  const displayEdges = [...layout.edges]
    .sort((left, right) => Number(litEdge(left)) - Number(litEdge(right)))
    .map((graphEdge) => ({
      ...graphEdge,
      data: {
        ...graphEdge.data,
        labelMode,
        lit: litEdge(graphEdge),
        dimmed: lit ? !litEdge(graphEdge) : false,
      } satisfies ChainEdgeData,
    }));
  const showsInferred = layout.edges.some((graphEdge) => (graphEdge.data as ChainEdgeData | undefined)?.inferred);

  const handleNodeClick = (event: React.MouseEvent, node: Node) => {
    if (node.type === "flowColumn") return;
    if (node.type === "flowGroup") {
      setHoveredNodeId(null);
      setExpanded((node.data as unknown as FlowGroupNodeData).kind, true);
      return;
    }
    onNodeClick(event, node);
  };

  return (
    <div className="h-full w-full">
      {warnings.length > 0 ? (
        <div className="absolute top-16 left-16 z-10 max-w-[min(480px,calc(100%-32px))] border-[1.5px] border-dashed border-[var(--st-wait)] bg-[var(--paper)] p-12">
          <p className="text-[10px] font-medium text-[var(--st-wait)]">
            Missing links
          </p>
          <ul className="mt-8 flex flex-col gap-6">
            {warnings.map((warning) => (
              <li
                key={warning}
                className="body-caption text-[var(--color-text-secondary)]"
              >
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showsInferred ? (
        <p
          data-testid="flow-inferred-legend"
          className="body-caption pointer-events-none absolute right-16 bottom-16 z-10 flex max-w-[calc(100%-96px)] items-center gap-8 border border-[var(--clr-dark-purple-20)] bg-[var(--paper)] px-8 py-6 text-[var(--color-text-secondary)]"
        >
          <svg
            aria-hidden
            width={LEGEND_SAMPLE_WIDTH}
            height={LEGEND_SAMPLE_HEIGHT}
            className="shrink-0"
          >
            <line
              x1={0}
              x2={LEGEND_SAMPLE_WIDTH}
              y1={LEGEND_SAMPLE_HEIGHT / 2}
              y2={LEGEND_SAMPLE_HEIGHT / 2}
              stroke="var(--ink)"
              strokeDasharray="4 4"
            />
          </svg>
          Inferred from the feedstock bin&apos;s draw order
        </p>
      ) : null}

      <ReactFlow
        className={GRAPH_CANVAS_CLASS}
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={onPaneClick}
        onNodeMouseEnter={(_, node) => {
          if (node.type !== "flowColumn") setHoveredNodeId(node.id);
        }}
        onNodeMouseLeave={() => setHoveredNodeId(null)}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={FLOW_MIN_ZOOM}
        maxZoom={FLOW_MAX_ZOOM}
      >
        <FrameFlow nodeCount={displayNodes.length} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={GRAPH_DOTS.gap}
          size={GRAPH_DOTS.size}
          color={GRAPH_DOTS.color}
        />
        <Controls showInteractive={false} className={GRAPH_CONTROLS_CLASS} />
      </ReactFlow>
    </div>
  );
}
