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

/** One label/value row on a lineage card (mono micro-label left, value right). */
export interface LineageDetailRow {
  label: string;
  value: string;
}

export interface LineageGraphNode {
  id: string;
  kind: LineageNodeKind;
  code: string;
  href: string | null;
  status?: string | null;
  /** Formatted event date — the card's primary line (code is secondary). */
  date: string | null;
  /** Label/value rows below the primary line (masses, parties, identifiers). */
  details: LineageDetailRow[];
}

// Stroke, casing, and the mass label chip live in ChainEdge (chain-edge.tsx).
const EDGE_STYLE = {
  type: "chainEdge" as const,
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--clr-purple)" },
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

function addRow(
  rows: LineageDetailRow[],
  label: string,
  value: string | null | undefined
) {
  if (value) {
    rows.push({ label, value });
  }
}

/** Also feeds the Carbon Viewer's marker popups (same codes + detail rows). */
export function buildLineageNodes(data: ChainOfCustodyData): LineageGraphNode[] {
  const nodes: LineageGraphNode[] = [];

  if (data.reactor) {
    const details: LineageDetailRow[] = [];
    addRow(details, "Unit", data.reactor.identifier);
    addRow(details, "Type", data.reactor.reactorType ?? "Not set");

    nodes.push({
      id: `reactor:${data.reactor.id}`,
      kind: "reactor",
      code: data.reactor.code,
      href: data.reactor.href,
      date: null,
      details,
    });
  }

  const sortedFeedstocks = [...data.feedstocks].sort((left, right) =>
    left.code.localeCompare(right.code)
  );
  for (const feedstock of sortedFeedstocks) {
    const details: LineageDetailRow[] = [];
    addRow(details, "Type", feedstock.feedstockTypeName);
    addRow(details, "Supplier", feedstock.supplierName);
    addRow(details, "Inbound", feedstock.feedstockDeliveryCode);
    addRow(details, "Used", formatKg(feedstock.massUsedKg));
    addRow(details, "Dry mass", formatKg(feedstock.massDryKg));

    nodes.push({
      id: `feedstock:${feedstock.id}`,
      kind: "feedstock",
      code: feedstock.code,
      href: feedstock.href,
      status: feedstock.status,
      date: formatDateOrNull(feedstock.deliveryDate),
      details,
    });
  }

  if (data.productionRun) {
    const details: LineageDetailRow[] = [];
    addRow(details, "Feedstock in", formatKg(data.productionRun.feedstockMassDryKg));
    addRow(details, "Biochar out", formatKg(data.productionRun.biocharDryMassKg));

    nodes.push({
      id: `production-run:${data.productionRun.id}`,
      kind: "productionRun",
      code: data.productionRun.code,
      href: data.productionRun.href,
      status: data.productionRun.status,
      date: formatDateOrNull(data.productionRun.date),
      details,
    });
  }

  if (data.biocharProduct) {
    const details: LineageDetailRow[] = [];
    addRow(details, "Mass", formatKg(data.biocharProduct.massKg));
    // The unsold remainder sitting in storage — material that entered the
    // bin instead of moving on (per this rollback's order).
    if (
      data.order &&
      data.biocharProduct.massKg != null &&
      data.order.quantityKg != null
    ) {
      const remainderKg = data.biocharProduct.massKg - data.order.quantityKg;
      if (remainderKg > STORAGE_REMAINDER_EPSILON_KG) {
        addRow(details, "In storage", formatKg(remainderKg));
      }
    }

    nodes.push({
      id: `biochar-product:${data.biocharProduct.id}`,
      kind: "biocharProduct",
      code: data.biocharProduct.code,
      href: data.biocharProduct.href,
      status: data.biocharProduct.status,
      date: formatDateOrNull(data.biocharProduct.productionDate),
      details,
    });
  }

  if (data.order) {
    const details: LineageDetailRow[] = [];
    addRow(details, "Quantity", formatKg(data.order.quantityKg));

    nodes.push({
      id: `order:${data.order.id}`,
      kind: "order",
      code: data.order.code,
      href: data.order.href,
      date: formatDateOrNull(data.order.orderDate),
      details,
    });
  }

  {
    const details: LineageDetailRow[] = [];
    addRow(details, "Dry mass", formatKg(data.delivery.massDryKg));

    nodes.push({
      id: `delivery:${data.delivery.id}`,
      kind: "delivery",
      code: data.delivery.code,
      href: data.delivery.href,
      status: data.delivery.status,
      date: formatDateOrNull(data.delivery.deliveryDate),
      details,
    });
  }

  {
    const details: LineageDetailRow[] = [];
    addRow(details, "Field", data.application.fieldIdentifier);
    addRow(details, "Applied", formatDryTons(data.application.biocharAppliedDryTons));

    nodes.push({
      id: `application:${data.application.id}`,
      kind: "application",
      code: data.application.code,
      href: data.application.href,
      status: data.application.status,
      date: formatDateOrNull(data.application.applicationDate),
      details,
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
    ...(label ? { label } : {}),
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
  /** Batch DAG: application cards drill into the rollback (hover hint). */
  drillApplications?: boolean;
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
        accentInk: style.accentInk,
        href: options.disableLinks ? null : node.href,
        status: node.status,
        date: node.date,
        details: node.details,
        highlighted: node.id === options.highlightedNodeId,
        drillable:
          options.drillApplications === true && node.kind === "application",
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
    { ...options, drillApplications: true }
  );
}
