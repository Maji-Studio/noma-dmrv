/**
 * useChainGraph — Transforms chain-of-custody data into React Flow nodes + edges.
 * Uses dagre for automatic directed-graph layout.
 */
import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import { MarkerType, type Node, type Edge } from "@xyflow/react";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { ChainNodeData } from "./chain-node";
import {
  CHAIN_NODE_DEFS,
  CHAIN_EDGE_DEFS,
  DAGRE_CONFIG,
  NODE_WIDTH,
  NODE_HEIGHT,
  IN_PROGRESS_STATUSES,
} from "./chain-constants";

function hasInProgressItems(byStatus: Record<string, number>): boolean {
  return Object.entries(byStatus).some(
    ([status, count]) => count > 0 && IN_PROGRESS_STATUSES.has(status)
  );
}

function buildGraph(data: ChainOfCustodyData): { nodes: Node[]; edges: Edge[] } {
  const summaryMap = new Map(
    data.entitySummaries.map((s) => [s.entityType, s])
  );

  // Configure dagre graph
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph(DAGRE_CONFIG);

  // Add nodes
  for (const def of CHAIN_NODE_DEFS) {
    g.setNode(def.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Add edges
  for (const e of CHAIN_EDGE_DEFS) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  // Build React Flow nodes from dagre positions
  const rfNodes: Node[] = CHAIN_NODE_DEFS.map((def) => {
    const pos = g.node(def.id);
    const summary = summaryMap.get(def.id);
    const total = summary?.total ?? 0;
    const byStatus = summary?.byStatus ?? {};
    const items = summary?.items ?? [];

    return {
      id: def.id,
      type: "chainNode",
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      data: {
        label: def.label,
        icon: def.icon,
        accent: def.accent,
        href: def.href,
        total,
        byStatus,
        items,
      } satisfies ChainNodeData,
    };
  });

  // Build React Flow edges
  const rfEdges: Edge[] = CHAIN_EDGE_DEFS.map((e) => {
    const sourceSummary = summaryMap.get(e.source);
    const animated = sourceSummary
      ? hasInProgressItems(sourceSummary.byStatus)
      : false;

    return {
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated,
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--clr-purple)" },
      style: {
        stroke: "var(--clr-purple)",
        strokeWidth: 1.5,
      },
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}

export function useChainGraph(data: ChainOfCustodyData | undefined) {
  return useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    return buildGraph(data);
  }, [data]);
}
