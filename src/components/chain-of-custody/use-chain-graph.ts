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

interface LineageGraphNode {
  id: string;
  kind: LineageNodeKind;
  code: string;
  href: string | null;
  status?: string | null;
  detailLines: string[];
}

const EDGE_STYLE = {
  type: "smoothstep" as const,
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--clr-purple)" },
  style: { stroke: "var(--clr-purple)", strokeWidth: 1.5 },
};

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

function buildLineageNodes(data: ChainOfCustodyData): LineageGraphNode[] {
  const nodes: LineageGraphNode[] = [];

  if (data.reactor) {
    nodes.push({
      id: `reactor:${data.reactor.id}`,
      kind: "reactor",
      code: data.reactor.code,
      href: data.reactor.href,
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
    addLine(detailLines, formatKg(feedstock.massUsedKg));
    addLine(detailLines, formatKg(feedstock.massDryKg));
    addLine(detailLines, formatDateOrNull(feedstock.deliveryDate));

    nodes.push({
      id: `feedstock:${feedstock.id}`,
      kind: "feedstock",
      code: feedstock.code,
      href: feedstock.href,
      status: feedstock.status,
      detailLines,
    });
  }

  if (data.productionRun) {
    const detailLines: string[] = [];
    addLine(detailLines, formatDateOrNull(data.productionRun.date));
    addLine(detailLines, formatKg(data.productionRun.feedstockMassDryKg));
    addLine(detailLines, formatKg(data.productionRun.biocharDryMassKg));

    nodes.push({
      id: `production-run:${data.productionRun.id}`,
      kind: "productionRun",
      code: data.productionRun.code,
      href: data.productionRun.href,
      status: data.productionRun.status,
      detailLines,
    });
  }

  if (data.biocharProduct) {
    const detailLines: string[] = [];
    addLine(detailLines, formatDateOrNull(data.biocharProduct.productionDate));
    addLine(detailLines, formatKg(data.biocharProduct.massKg));

    nodes.push({
      id: `biochar-product:${data.biocharProduct.id}`,
      kind: "biocharProduct",
      code: data.biocharProduct.code,
      href: data.biocharProduct.href,
      status: data.biocharProduct.status,
      detailLines,
    });
  }

  if (data.order) {
    const detailLines: string[] = [];
    addLine(detailLines, formatDateOrNull(data.order.orderDate));
    addLine(detailLines, formatKg(data.order.quantityKg));

    nodes.push({
      id: `order:${data.order.id}`,
      kind: "order",
      code: data.order.code,
      href: data.order.href,
      detailLines,
    });
  }

  {
    const detailLines: string[] = [];
    addLine(detailLines, formatDateOrNull(data.delivery.deliveryDate));
    addLine(detailLines, formatKg(data.delivery.massDryKg));

    nodes.push({
      id: `delivery:${data.delivery.id}`,
      kind: "delivery",
      code: data.delivery.code,
      href: data.delivery.href,
      status: data.delivery.status,
      detailLines,
    });
  }

  {
    const detailLines: string[] = [];
    addLine(detailLines, formatDateOrNull(data.application.applicationDate));
    addLine(detailLines, data.application.fieldIdentifier ?? undefined);
    addLine(detailLines, formatDryTons(data.application.biocharAppliedDryTons));

    nodes.push({
      id: `application:${data.application.id}`,
      kind: "application",
      code: data.application.code,
      href: data.application.href,
      status: data.application.status,
      detailLines,
    });
  }

  return nodes;
}

function edge(source: string, target: string): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    ...EDGE_STYLE,
  };
}

function buildLineageEdges(data: ChainOfCustodyData): Edge[] {
  const edges: Edge[] = [];

  if (data.productionRun) {
    for (const feedstock of data.feedstocks) {
      edges.push(edge(`feedstock:${feedstock.id}`, `production-run:${data.productionRun.id}`));
    }

    if (data.reactor) {
      edges.push(edge(`reactor:${data.reactor.id}`, `production-run:${data.productionRun.id}`));
    }
  }

  if (data.productionRun && data.biocharProduct) {
    edges.push(edge(`production-run:${data.productionRun.id}`, `biochar-product:${data.biocharProduct.id}`));
  }

  if (data.biocharProduct && data.order) {
    edges.push(edge(`biochar-product:${data.biocharProduct.id}`, `order:${data.order.id}`));
  }

  if (data.order) {
    edges.push(edge(`order:${data.order.id}`, `delivery:${data.delivery.id}`));
  } else if (data.biocharProduct) {
    edges.push(edge(`biochar-product:${data.biocharProduct.id}`, `delivery:${data.delivery.id}`));
  }

  edges.push(edge(`delivery:${data.delivery.id}`, `application:${data.application.id}`));

  return edges;
}

function buildGraph(data: ChainOfCustodyData): { nodes: Node[]; edges: Edge[] } {
  const lineageNodes = buildLineageNodes(data);
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph(DAGRE_CONFIG);

  for (const node of lineageNodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const edges = buildLineageEdges(data);
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
      data: {
        label: style.label,
        code: node.code,
        icon: style.icon,
        accent: style.accent,
        href: node.href,
        status: node.status,
        detailLines: node.detailLines,
      } satisfies ChainNodeData,
    };
  });

  return { nodes, edges };
}

export function useChainGraph(data: ChainOfCustodyData | undefined) {
  if (!data) {
    return { nodes: [], edges: [] };
  }

  return buildGraph(data);
}
