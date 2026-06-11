import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { formatSafeDate } from "@/lib/format-utils";
import type { ChainNodeData } from "./chain-node";
import {
  DAGRE_CONFIG,
  LINEAGE_NODE_STYLES,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LineageNodeKind,
} from "./chain-constants";

export interface LineageGraphNode {
  id: string;
  kind: LineageNodeKind;
  code: string;
  href: string | null;
  status?: string | null;
  /** Formatted event date — the card's primary line (code is secondary). */
  date: string | null;
  /** Headline quantity for the card (mass in/out at this step). */
  stat: string | null;
  detailLines: string[];
}

const EDGE_STYLE = {
  type: "smoothstep" as const,
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--clr-purple)" },
  style: { stroke: "var(--clr-purple)", strokeWidth: 1.5 },
};

/** Mono chip rendered on an edge — the mass moving between the two records. */
const EDGE_LABEL_STYLE = {
  labelStyle: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.04em",
    fill: "var(--clr-dark-purple)",
  },
  labelBgStyle: {
    fill: "var(--color-background-white)",
    stroke: "var(--clr-dark-purple-20)",
    strokeWidth: 1,
  },
  labelBgPadding: [6, 4] as [number, number],
  labelBgBorderRadius: 0,
};

/** Residual smaller than this is rounding noise, not a storage remainder. */
const STORAGE_REMAINDER_EPSILON_KG = 0.5;

function formatKg(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${Math.round(value).toLocaleString()} kg`;
}

function formatDryTons(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${value.toFixed(2)} t dry`;
}

function formatDateOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const formatted = formatSafeDate(value, "MMM d, yyyy");
  return formatted === "—" ? null : formatted;
}

function addLine(lines: string[], value: string | null | undefined) {
  if (value) {
    lines.push(value);
  }
}

/** Also feeds the Carbon Viewer's marker popups (same codes + detail lines). */
export function buildLineageNodes(data: ChainOfCustodyData): LineageGraphNode[] {
  const nodes: LineageGraphNode[] = [];

  if (data.reactor) {
    nodes.push({
      id: `reactor:${data.reactor.id}`,
      kind: "reactor",
      code: data.reactor.code,
      href: data.reactor.href,
      date: null,
      stat: null,
      detailLines: [
        data.reactor.identifier,
        data.reactor.reactorType ?? "Type not set",
      ],
    });
  }

  const sortedFeedstocks = [...data.feedstocks].sort((left, right) =>
    left.code.localeCompare(right.code)
  );
  for (const feedstock of sortedFeedstocks) {
    const detailLines: string[] = [];
    addLine(detailLines, feedstock.feedstockTypeName ?? undefined);
    addLine(
      detailLines,
      feedstock.supplierName ? `Supplier ${feedstock.supplierName}` : undefined
    );
    addLine(
      detailLines,
      feedstock.feedstockDeliveryCode
        ? `Inbound ${feedstock.feedstockDeliveryCode}`
        : undefined
    );
    const massUsed = formatKg(feedstock.massUsedKg);
    const massDry = formatKg(feedstock.massDryKg);
    if (massUsed && massDry) {
      addLine(detailLines, `${massDry} dry`);
    }

    nodes.push({
      id: `feedstock:${feedstock.id}`,
      kind: "feedstock",
      code: feedstock.code,
      href: feedstock.href,
      status: feedstock.status,
      date: formatDateOrNull(feedstock.deliveryDate),
      stat: massUsed ? `${massUsed} used` : massDry ? `${massDry} dry` : null,
      detailLines,
    });
  }

  if (data.productionRun) {
    const detailLines: string[] = [];
    const feedstockIn = formatKg(data.productionRun.feedstockMassDryKg);
    addLine(detailLines, feedstockIn ? `${feedstockIn} feedstock in` : undefined);
    const biocharOut = formatKg(data.productionRun.biocharDryMassKg);

    nodes.push({
      id: `production-run:${data.productionRun.id}`,
      kind: "productionRun",
      code: data.productionRun.code,
      href: data.productionRun.href,
      status: data.productionRun.status,
      date: formatDateOrNull(data.productionRun.date),
      stat: biocharOut ? `${biocharOut} biochar out` : null,
      detailLines,
    });
  }

  if (data.biocharProduct) {
    const detailLines: string[] = [];
    // The unsold remainder sitting in storage — material that entered the
    // bin instead of moving on (per this rollback's order).
    if (
      data.order &&
      data.biocharProduct.massKg != null &&
      data.order.quantityKg != null
    ) {
      const remainderKg = data.biocharProduct.massKg - data.order.quantityKg;
      if (remainderKg > STORAGE_REMAINDER_EPSILON_KG) {
        addLine(detailLines, `${formatKg(remainderKg)} in storage`);
      }
    }

    nodes.push({
      id: `biochar-product:${data.biocharProduct.id}`,
      kind: "biocharProduct",
      code: data.biocharProduct.code,
      href: data.biocharProduct.href,
      status: data.biocharProduct.status,
      date: formatDateOrNull(data.biocharProduct.productionDate),
      stat: formatKg(data.biocharProduct.massKg),
      detailLines,
    });
  }

  if (data.order) {
    nodes.push({
      id: `order:${data.order.id}`,
      kind: "order",
      code: data.order.code,
      href: data.order.href,
      date: formatDateOrNull(data.order.orderDate),
      stat: formatKg(data.order.quantityKg),
      detailLines: [],
    });
  }

  {
    const massDry = formatKg(data.delivery.massDryKg);
    nodes.push({
      id: `delivery:${data.delivery.id}`,
      kind: "delivery",
      code: data.delivery.code,
      href: data.delivery.href,
      status: data.delivery.status,
      date: formatDateOrNull(data.delivery.deliveryDate),
      stat: massDry ? `${massDry} dry` : null,
      detailLines: [],
    });
  }

  {
    const detailLines: string[] = [];
    addLine(detailLines, data.application.fieldIdentifier ?? undefined);
    const applied = formatDryTons(data.application.biocharAppliedDryTons);

    nodes.push({
      id: `application:${data.application.id}`,
      kind: "application",
      code: data.application.code,
      href: data.application.href,
      status: data.application.status,
      date: formatDateOrNull(data.application.applicationDate),
      stat: applied ? `${applied} applied` : null,
      detailLines,
    });
  }

  return nodes;
}

function edge(source: string, target: string, label?: string | null): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    ...EDGE_STYLE,
    ...(label ? { label, ...EDGE_LABEL_STYLE } : {}),
  };
}

/**
 * Every flow edge is labeled with the mass moving along it, so the hand-offs
 * between records read directly off the graph. (Per-step CO₂e isn't recorded
 * along the lineage — the batch-level net removal lives on the Sankey.)
 */
function buildLineageEdges(data: ChainOfCustodyData): Edge[] {
  const edges: Edge[] = [];

  if (data.productionRun) {
    for (const feedstock of data.feedstocks) {
      edges.push(
        edge(
          `feedstock:${feedstock.id}`,
          `production-run:${data.productionRun.id}`,
          formatKg(feedstock.massUsedKg)
        )
      );
    }

    if (data.reactor) {
      edges.push(edge(`reactor:${data.reactor.id}`, `production-run:${data.productionRun.id}`));
    }
  }

  if (data.productionRun && data.biocharProduct) {
    edges.push(
      edge(
        `production-run:${data.productionRun.id}`,
        `biochar-product:${data.biocharProduct.id}`,
        formatKg(data.biocharProduct.massKg)
      )
    );
  }

  if (data.biocharProduct && data.order) {
    edges.push(
      edge(
        `biochar-product:${data.biocharProduct.id}`,
        `order:${data.order.id}`,
        formatKg(data.order.quantityKg)
      )
    );
  }

  const deliveryLabel = formatKg(data.delivery.massDryKg);
  if (data.order) {
    edges.push(
      edge(`order:${data.order.id}`, `delivery:${data.delivery.id}`, deliveryLabel)
    );
  } else if (data.biocharProduct) {
    edges.push(
      edge(
        `biochar-product:${data.biocharProduct.id}`,
        `delivery:${data.delivery.id}`,
        deliveryLabel
      )
    );
  }

  edges.push(
    edge(
      `delivery:${data.delivery.id}`,
      `application:${data.application.id}`,
      formatDryTons(data.application.biocharAppliedDryTons)
    )
  );

  return edges;
}

export interface ChainGraphOptions {
  /**
   * Split/map cross-linking: card clicks highlight the map marker instead of
   * navigating, so the cards drop their links.
   */
  disableLinks?: boolean;
  /** Node to ring-highlight (selected via map marker / rail / chip). */
  highlightedNodeId?: string | null;
}

function layoutGraph(
  lineageNodes: LineageGraphNode[],
  edges: Edge[],
  options: ChainGraphOptions
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph(DAGRE_CONFIG);

  for (const node of lineageNodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const nodes: Node[] = lineageNodes.map((node) => {
    const position = g.node(node.id);
    const style = LINEAGE_NODE_STYLES[node.kind];

    return {
      id: node.id,
      type: "chainNode",
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
      // Pre-measure dimensions so the MiniMap can draw nodes (it reads the
      // user node, which never receives `measured`); real size still wins.
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT,
      data: {
        label: style.label,
        code: node.code,
        icon: style.icon,
        accent: style.accent,
        href: options.disableLinks ? null : node.href,
        status: node.status,
        date: node.date,
        stat: node.stat,
        detailLines: node.detailLines,
        highlighted: node.id === options.highlightedNodeId,
      } satisfies ChainNodeData,
    };
  });

  return { nodes, edges };
}

export function useChainGraph(
  data: ChainOfCustodyData | undefined,
  options: ChainGraphOptions = {}
) {
  if (!data) {
    return { nodes: [], edges: [] };
  }

  return layoutGraph(buildLineageNodes(data), buildLineageEdges(data), options);
}

/**
 * Batch roll-up DAG: the member applications' lineage graphs merged into one
 * fan-out (plan decision 2). Nodes and edges dedupe by id, so a production
 * run / lot / feedstock shared by several applications appears once with all
 * its downstream branches attached.
 */
export function useBatchChainGraph(
  lineages: ChainOfCustodyData[] | undefined,
  options: ChainGraphOptions = {}
) {
  if (!lineages || lineages.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodeById = new Map<string, LineageGraphNode>();
  const edgeById = new Map<string, Edge>();
  for (const lineage of lineages) {
    for (const node of buildLineageNodes(lineage)) {
      if (!nodeById.has(node.id)) nodeById.set(node.id, node);
    }
    for (const lineageEdge of buildLineageEdges(lineage)) {
      if (!edgeById.has(lineageEdge.id)) edgeById.set(lineageEdge.id, lineageEdge);
    }
  }

  return layoutGraph(
    Array.from(nodeById.values()),
    Array.from(edgeById.values()),
    options
  );
}
