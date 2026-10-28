import type {
  ChainBiocharProductLineage,
  ChainDeliveryLineage,
  ChainOfCustodyData,
  ChainSourceLineage,
} from "@/data-access/chain-of-custody";
import type { ChainRunRollForward } from "@/data-access/chain-of-custody-roll-forward";
import {
  applicationNodeId,
  buildRollbackMassTotals,
  buildRollForwardMassTotals,
  deliveryNodeId,
  edgeMass,
  flowEdgeId,
  nodeMass,
  productNodeId,
  productionRunNodeId,
  sourceAllocationMass,
  type LineageMassTotals,
} from "@/lib/chain-of-custody/lineage-mass-totals";
import { resolveChainSources } from "@/lib/chain-of-custody/sources";
import { isMissingValueCopy, MISSING_VALUE } from "@/lib/copy-utils";
import { formatCalendarDate, formatDate, formatFacilityDay } from "@/lib/format-utils";
import { formatWetDryMass } from "@/lib/mass-moisture";
import type { Edge, Node } from "@xyflow/react";
import { LINEAGE_NODE_STYLES, type LineageNodeKind } from "./chain-constants";
import {
  computeEdgeShareLabels,
  formatKg,
  massLabel,
  type ChainEdgeBuildData,
  type EdgeMass,
  type EdgeMassBasis,
} from "./chain-edge-mass";
import type { ChainNodeData } from "./chain-node";
import { expandProductLineages } from "./expand-product-lineages";

export type { ChainEdgeBuildData, EdgeMassBasis } from "./chain-edge-mass";

/** One label/value row in a record's detail sheet and map popup. */
export interface LineageDetailRow {
  label: string;
  value: string;
}

/**
 * The node's lineage: every node upstream of it (walking edges backwards to
 * its sources) and every node downstream (walking them forwards), plus the
 * node itself. Siblings that only share a parent are left out, so focusing
 * one run in a batch lights that run's intakes, products, deliveries and
 * applications, not every other run that fed the same product. Used by the
 * Flow chart's hover and selection and by the cross-surface focus (bar ⇄ map
 * ⇄ Flow). Returns null when no node is given (nothing focused → everything
 * full strength).
 */
export function reachableNodeIds(
  nodeId: string | null,
  edges: Edge[]
): Set<string> | null {
  if (!nodeId) return null;
  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  for (const graphEdge of edges) {
    downstream.set(graphEdge.source, [...(downstream.get(graphEdge.source) ?? []), graphEdge.target]);
    upstream.set(graphEdge.target, [...(upstream.get(graphEdge.target) ?? []), graphEdge.source]);
  }

  const reachable = new Set<string>([nodeId]);
  for (const adjacency of [upstream, downstream]) {
    const seen = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

export interface LineageGraphNode {
  id: string;
  kind: LineageNodeKind;
  /** Sheet heading. */
  code: string;
  /** The record's own code, shown under its Flow chart node. */
  shortCode: string;
  href: string | null;
  status?: string | null;
  /** Formatted event date, shown in the detail sheet. */
  date: string | null;
  /** Label/value rows below the primary line (masses, parties, identifiers). */
  details: LineageDetailRow[];
}

// Stroke and the mass label chip live in ChainEdge (chain-edge.tsx).
const APPLIED_FROM_SOURCE_LABEL = "Applied from source";

function formatDateOrNull(value: Date | string | null | undefined, calendarDay = false): string | null {
  if (!value) return null;
  const formatted = calendarDay ? formatCalendarDate(value) : formatDate(value);
  return isMissingValueCopy(formatted) ? null : formatted;
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

/** Reactor, feedstock and production-run records for a set of chain sources. */
function buildSourceNodes(
  sources: ChainSourceLineage[],
  totals?: LineageMassTotals,
): LineageGraphNode[] {
  const nodes: LineageGraphNode[] = [];
  const seenNodeIds = new Set<string>();

  for (const source of sources) {
    const reactor = source.reactor;
    if (!reactor || seenNodeIds.has(`reactor:${reactor.id}`)) continue;
    const details: LineageDetailRow[] = [];
    addRow(details, "Unit", reactor.identifier);
    addRow(details, "Type", reactor.reactorType ?? MISSING_VALUE.notSet);

    nodes.push({
      id: `reactor:${reactor.id}`,
      kind: "reactor",
      code: reactor.code,
      shortCode: reactor.code,
      href: reactor.href,
      date: null,
      details,
    });
    seenNodeIds.add(`reactor:${reactor.id}`);
  }

  const sortedFeedstocks = sources
    .flatMap((source) => source.feedstocks)
    .sort((left, right) =>
    left.code.localeCompare(right.code)
  );
  for (const feedstock of sortedFeedstocks) {
    if (seenNodeIds.has(`feedstock:${feedstock.id}`)) continue;
    const details: LineageDetailRow[] = [];
    addRow(details, "Type", feedstock.feedstockTypeName);
    addRow(details, "Supplier", feedstock.supplierName);
    addRow(details, "Wet allocation", formatKg(feedstock.wetMassUsedKg));
    addRow(details, "Intake dry mass", formatKg(feedstock.massDryKg));

    nodes.push({
      id: `feedstock:${feedstock.id}`,
      kind: "feedstock",
      code: feedstock.code,
      shortCode: feedstock.code,
      href: feedstock.href,
      status: feedstock.status,
      date: formatDateOrNull(feedstock.deliveryDate, true),
      details,
    });
    seenNodeIds.add(`feedstock:${feedstock.id}`);
  }

  for (const source of sources) {
    const productionRun = source.productionRun;
    const allocated = (totals ? nodeMass(totals, productionRunNodeId(productionRun.id)) : null) ?? {
      wetKg: source.allocatedWetMassKg,
      dryKg: source.allocatedDryMassKg,
    };
    const details: LineageDetailRow[] = [];
    addRow(details, "Feedstock in", formatKg(productionRun.feedstockMassDryKg));
    addRow(
      details,
      "Biochar out",
      formatWetDryMass({
        wetKg: productionRun.biocharOutputKg,
        dryKg: productionRun.biocharDryMassKg,
      }),
    );
    if (
      allocated.wetKg != null ||
      allocated.dryKg != null
    ) {
      addRow(
        details,
        APPLIED_FROM_SOURCE_LABEL,
        formatWetDryMass(allocated),
      );
    }

    nodes.push({
      id: productionRunNodeId(productionRun.id),
      kind: "productionRun",
      code: productionRun.biocharStorageName ?? productionRun.code,
      shortCode: productionRun.code,
      href: productionRun.href,
      status: productionRun.status,
      date: formatDateOrNull(productionRun.date),
      details,
    });
  }

  return nodes;
}

function productCardCode(product: ChainBiocharProductLineage): string {
  return `${product.code} · ${product.formulationName ?? "Pure biochar"}`;
}

function buildDeliveryNode(delivery: Omit<ChainDeliveryLineage, "proofOfDeliveryCount">, timeZone: string): LineageGraphNode {
  const details: LineageDetailRow[] = [];
  addRow(
    details,
    "Biochar delivered",
    formatWetDryMass({
      wetKg: delivery.deliveredWetMassKg,
      dryKg: delivery.massDryKg,
    }),
  );
  return {
    id: deliveryNodeId(delivery.id),
    kind: "delivery",
    code: "Delivery",
    shortCode: delivery.code,
    href: delivery.href,
    status: delivery.status,
    date: formatFacilityDay(delivery.deliveryDate, timeZone),
    details,
  };
}

/** Also feeds the Carbon Viewer's marker popups (same codes + detail rows). */
export function buildLineageNodes(
  data: ChainOfCustodyData,
  timeZone: string,
  totals: LineageMassTotals = buildRollbackMassTotals(expandProductLineages(data)),
  productMassBasis: "sourceAllocation" | "applied" = "sourceAllocation",
): LineageGraphNode[] {
  if (data.products?.length) {
    const nodes = expandProductLineages(data).flatMap(slice => buildLineageNodes(slice, timeZone, totals, productMassBasis));
    return [...new Map(nodes.map(node => [node.id, node])).values()];
  }
  const sources = resolveChainSources(data);
  const nodes = buildSourceNodes(sources, totals);

  if (data.biocharProduct) {
    const productId = productNodeId(data.biocharProduct.id);
    const details: LineageDetailRow[] = [];
    addRow(details, "Applied from batch", formatWetDryMass(
      productMassBasis === "applied" ? nodeMass(totals, productId) : sourceAllocationMass(totals, productId),
    ));

    nodes.push({
      id: productNodeId(data.biocharProduct.id),
      kind: "biocharProduct",
      code: productCardCode(data.biocharProduct),
      shortCode: data.biocharProduct.code,
      href: data.biocharProduct.href,
      status: data.biocharProduct.status,
      date: formatDateOrNull(data.biocharProduct.productionDate),
      details,
    });
  }

  if (data.order) {
    const details: LineageDetailRow[] = [];
    addRow(
      details,
      "Quantity",
      formatWetDryMass({
        wetKg: data.order.quantityKg,
        dryKg: null,
      }),
    );

    nodes.push({
      id: `order:${data.order.id}`,
      kind: "order",
      code: "Order",
      shortCode: data.order.code,
      href: data.order.href,
      date: formatDateOrNull(data.order.orderDate, true),
      details,
    });
  }

  nodes.push(buildDeliveryNode(data.delivery, timeZone));

  {
    const details: LineageDetailRow[] = [];
    addRow(details, "Field", data.application.fieldIdentifier);
    addRow(
      details,
      "Biochar applied",
      formatWetDryMass(nodeMass(totals, applicationNodeId(data.application.id))),
    );

    nodes.push({
      id: applicationNodeId(data.application.id),
      kind: "application",
      code:
        data.application.fieldIdentifier ?? "Field application",
      shortCode: data.application.fieldIdentifier ?? data.application.code,
      href: data.application.href,
      status: data.application.status,
      date: formatDateOrNull(data.application.applicationDate, true),
      details,
    });
  }

  return nodes;
}

function edge(
  source: string,
  target: string,
  opts?: {
    mass?: EdgeMass | null;
    massLabel?: string | null;
    wetKg?: number | null;
    dryKg?: number | null;
    variant?: "flow" | "equipment";
    inferred?: boolean;
    massBasis?: EdgeMassBasis;
  },
): Edge {
  const mass = opts?.mass ?? null;
  return {
    id: flowEdgeId(source, target),
    source,
    target,
    type: "chainEdge",
    data: {
      variant: opts?.variant ?? "flow",
      inferred: opts?.inferred ?? false,
      mass: mass?.value ?? null,
      unit: mass?.unit ?? null,
      wetKg: opts?.wetKg ?? null,
      dryKg: opts?.dryKg ?? null,
      kgLabel: opts?.massLabel ?? massLabel(mass),
      pctLabel: null,
      massBasis: opts?.massBasis ?? "applied",
    } satisfies ChainEdgeBuildData,
  };
}

/**
 * Feedstock → run flows and the reactor's equipment link for one source. A run
 * records what it drew from a feedstock bin; which intakes that wood came from
 * follows from the bin's draw order, so the intake links are inferred.
 */
function buildSourceEdges(source: ChainSourceLineage): Edge[] {
  const edges: Edge[] = [];
  const productionRun = source.productionRun;
  for (const feedstock of source.feedstocks) {
    edges.push(
      edge(`feedstock:${feedstock.id}`, productionRunNodeId(productionRun.id), {
        mass: { value: feedstock.wetMassUsedKg, unit: "kg" },
        inferred: true,
      })
    );
  }

  if (source.reactor) {
    // Equipment association, not a mass flow — drawn as a quiet dashed link.
    edges.push(
      edge(`reactor:${source.reactor.id}`, productionRunNodeId(productionRun.id), {
        variant: "equipment",
      })
    );
  }
  return edges;
}

/**
 * Every flow edge is labeled with the mass moving along it, so the hand-offs
 * between records read directly off the graph. (Per-step CO₂e isn't recorded
 * along the lineage — the batch-level net removal lives on the Sankey.)
 */
function buildLineageEdges(data: ChainOfCustodyData, totals: LineageMassTotals): Edge[] {
  const edges: Edge[] = [];
  const sources = resolveChainSources(data);

  for (const source of sources) {
    edges.push(...buildSourceEdges(source));
    if (data.biocharProduct) {
      edges.push(massFlowEdge(
        productionRunNodeId(source.productionRun.id),
        productNodeId(data.biocharProduct.id),
        totals,
      ));
    }
  }
  if (data.order) {
    edges.push(edge(`order:${data.order.id}`, deliveryNodeId(data.delivery.id)));
  }
  if (data.biocharProduct) {
    edges.push(massFlowEdge(
      productNodeId(data.biocharProduct.id),
      deliveryNodeId(data.delivery.id),
      totals,
    ));
  }
  edges.push(massFlowEdge(
    deliveryNodeId(data.delivery.id),
    applicationNodeId(data.application.id),
    totals,
  ));
  return edges;
}

/** Render the roll-up's native branch-share value and wet/dry label. */
function massFlowEdge(
  source: string,
  target: string,
  totals: LineageMassTotals,
  massBasis: EdgeMassBasis = "applied",
): Edge {
  const mass = edgeMass(totals, source, target);
  return edge(source, target, {
    mass: {
      value: mass.mass,
      unit: mass.unit,
    },
    wetKg: mass.wetKg,
    dryKg: mass.dryKg,
    massLabel: formatWetDryMass(mass),
    massBasis,
  });
}

/**
 * A member run's roll-forward as graph records: its upstream block, the
 * product layers drawn from it, and the deliveries that shipped those layers.
 * Node and edge ids match the rollback builders, so merging dedupes them.
 */
export function buildRollForwardGraph(
  rollForward: ChainRunRollForward,
  timeZone: string,
  totals: LineageMassTotals = buildRollForwardMassTotals([rollForward]),
): {
  nodes: LineageGraphNode[];
  edges: Edge[];
} {
  const { source } = rollForward;
  const nodes = buildSourceNodes([source]);
  const edges = buildSourceEdges(source);
  const runNodeId = productionRunNodeId(source.productionRun.id);
  for (const { product, deliveries } of rollForward.products) {
    const productId = productNodeId(product.id);
    nodes.push({
      id: productId,
      kind: "biocharProduct",
      code: productCardCode(product),
      shortCode: product.code,
      href: product.href,
      status: product.status,
      date: formatDateOrNull(product.productionDate),
      details: [],
    });
    edges.push(massFlowEdge(runNodeId, productId, totals, "recorded"));
    for (const shipped of deliveries) {
      nodes.push(buildDeliveryNode(shipped.delivery, timeZone));
      edges.push(massFlowEdge(productId, deliveryNodeId(shipped.delivery.id), totals, "recorded"));
    }
  }
  return { nodes, edges };
}

/**
 * Every roll-forward record, deduped, with each product's "Drawn from runs"
 * total across member runs. Shared by the Flow chart merge and the map popups.
 */
export function buildRollForwardNodes(
  rollForwards: ChainRunRollForward[],
  timeZone: string,
  totals: LineageMassTotals = buildRollForwardMassTotals(rollForwards),
): LineageGraphNode[] {
  const nodeById = new Map<string, LineageGraphNode>();
  for (const rollForward of rollForwards) {
    for (const node of buildRollForwardGraph(rollForward, timeZone, totals).nodes) {
      if (nodeById.has(node.id)) continue;
      const drawn = totals.nodes.get(node.id);
      if (drawn) node.details = [{ label: "Drawn from runs", value: formatWetDryMass(drawn) }];
      nodeById.set(node.id, node);
    }
  }
  return Array.from(nodeById.values());
}

export interface ChainGraphOptions {
  /** Facility zone for delivery instants; other node dates are calendar days. */
  timeZone: string;
  /**
   * Split/map cross-linking: record clicks highlight the map marker instead
   * of navigating, so the records drop their links.
   */
  disableLinks?: boolean;
  /** Node to ring-highlight (selected via map marker / rail / chip). */
  highlightedNodeId?: string | null;
  /** Batch Flow: application records drill into the rollback. */
  drillApplications?: boolean;
}

/**
 * Graph records as React Flow nodes, unpositioned: the Flow chart lays them
 * out in columns (flow-layout.ts), and the map and sheets read their data.
 */
function toGraph(
  lineageNodes: LineageGraphNode[],
  edges: Edge[],
  options: ChainGraphOptions
): { nodes: Node[]; edges: Edge[] } {
  // Branch shares depend on the full (merged + deduped) edge set, so annotate
  // here: covers both the single-rollback and batch roll-up graphs.
  computeEdgeShareLabels(edges);

  const nodes: Node[] = lineageNodes.map((node) => {
    const style = LINEAGE_NODE_STYLES[node.kind];
    return {
      id: node.id,
      type: "chainNode",
      position: { x: 0, y: 0 },
      data: {
        kind: node.kind,
        label: style.label,
        code: node.code,
        shortCode: node.shortCode,
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
  options: ChainGraphOptions
) {
  if (!data) {
    return { nodes: [], edges: [] };
  }

  return buildMergedChainGraph(expandProductLineages(data), options);
}

/**
 * Batch roll-up Flow: the member applications' lineage graphs merged into one
 * fan-out (plan decision 2). Nodes and edges dedupe by id, so a production
 * run / lot / feedstock shared by several applications appears once with all
 * its downstream branches attached.
 *
 * Member runs' roll-forwards merge in last and only add what the rollbacks
 * lack, so applied masses are never summed with drawn or shipped masses.
 */
function buildMergedChainGraph(
  lineages: ChainOfCustodyData[] | undefined,
  options: ChainGraphOptions,
  rollForwards: ChainRunRollForward[] = [],
) {
  if ((!lineages || lineages.length === 0) && rollForwards.length === 0) {
    return { nodes: [], edges: [] };
  }

  lineages = (lineages ?? []).flatMap(expandProductLineages);
  const totals = buildRollbackMassTotals(lineages);
  const nodeById = new Map<string, LineageGraphNode>();
  const edgeById = new Map<string, Edge>();
  for (const lineage of lineages) {
    for (const node of buildLineageNodes(lineage, options.timeZone, totals, "applied")) {
      if (!nodeById.has(node.id)) nodeById.set(node.id, node);
    }
    for (const lineageEdge of buildLineageEdges(lineage, totals)) {
      if (!edgeById.has(lineageEdge.id)) edgeById.set(lineageEdge.id, lineageEdge);
    }
  }

  const forwardTotals = buildRollForwardMassTotals(rollForwards);
  for (const node of buildRollForwardNodes(rollForwards, options.timeZone, forwardTotals)) {
    if (!nodeById.has(node.id)) nodeById.set(node.id, node);
  }
  // Roll-forward shipments are per-run shares, so two member runs feeding one
  // product sum on its delivery edge. They never sum into a rollback edge.
  for (const rollForward of rollForwards) {
    for (const rollForwardEdge of buildRollForwardGraph(rollForward, options.timeZone, forwardTotals).edges) {
      if (!edgeById.has(rollForwardEdge.id)) edgeById.set(rollForwardEdge.id, rollForwardEdge);
    }
  }

  return toGraph(
    Array.from(nodeById.values()),
    Array.from(edgeById.values()),
    { ...options, drillApplications: true }
  );
}

export function useBatchChainGraph(
  lineages: ChainOfCustodyData[] | undefined,
  rollForwards: ChainRunRollForward[] | undefined,
  options: ChainGraphOptions,
) {
  return buildMergedChainGraph(lineages, options, rollForwards);
}
