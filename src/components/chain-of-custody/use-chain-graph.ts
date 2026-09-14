import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { resolveChainSources } from "@/lib/chain-of-custody/sources";
import { isMissingValueCopy, MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate } from "@/lib/format-utils";
import { formatWetDryMass, splitWetMass } from "@/lib/mass-moisture";
import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import {
  DAGRE_CONFIG,
  LINEAGE_NODE_STYLES,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LineageNodeKind,
} from "./chain-constants";
import type { ChainNodeData } from "./chain-node";
import { expandProductLineages } from "./expand-product-lineages";

/** One label/value row on a lineage card (mono micro-label left, value right). */
export interface LineageDetailRow {
  label: string;
  value: string;
}

/**
 * The node's full connected lineage — every node reachable by walking the flow
 * edges in either direction from it (ancestors + descendants). Used both by the
 * DAG's hover focus and by the cross-surface selection focus (bar ⇄ map ⇄ DAG):
 * focusing a feedstock lights its run → product → reachable deliveries /
 * applications and dims the rest. Returns null when no node is given (nothing
 * focused → everything full strength).
 */
export function reachableNodeIds(
  nodeId: string | null,
  edges: Edge[]
): Set<string> | null {
  if (!nodeId) return null;
  const adjacency = new Map<string, string[]>();
  for (const graphEdge of edges) {
    if (!adjacency.has(graphEdge.source)) adjacency.set(graphEdge.source, []);
    if (!adjacency.has(graphEdge.target)) adjacency.set(graphEdge.target, []);
    adjacency.get(graphEdge.source)!.push(graphEdge.target);
    adjacency.get(graphEdge.target)!.push(graphEdge.source);
  }

  const reachable = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of adjacency.get(current) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  return reachable;
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
// Mass-flow lines are dark purple for contrast on the tinted canvas; the
// reactor's equipment link is a quieter dashed tint of the same ink.
const FLOW_EDGE_COLOR = "var(--clr-dark-purple)";
const EQUIPMENT_EDGE_COLOR = "var(--clr-dark-purple-40)";

/** Residual smaller than this is rounding noise, not a storage remainder. */

/** Below this share, round-to-percent would read as a misleading "0%". */
const SUB_ONE_PERCENT = 0.01;
const NEAR_FULL_PERCENT = 0.995;

/** Preferred separation between parallel fan routes, in graph coordinates. */
const EDGE_ROUTE_LANE_GAP = 28;
/**
 * Keeps large fans inside the corridor between adjacent Dagre ranks. 70 is
 * safe only because `DAGRE_CONFIG.ranksep` is 208 (`chain-constants.ts`):
 * xyflow's smooth-step path reserves a 20px gap point at each end, leaving a
 * midpoint band of ±84, so 70 keeps 14px of clearance. Lowering `ranksep`
 * means lowering this too, or the outer lanes cross into the node rows.
 */
const EDGE_ROUTE_MAX_OFFSET = 70;

/** A unit must never be mixed within one fan when normalizing to a share. */
type EdgeMassUnit = "kg" | "tDry";

interface EdgeMass {
  value: number | null;
  unit: EdgeMassUnit;
}

/**
 * Data carried on every flow edge. `mass`/`unit` feed the branch-share %;
 * `kgLabel`/`pctLabel` are the pre-formatted strings the toggle swaps between;
 * `variant` distinguishes mass flow from the reactor's mass-less equipment
 * link; `color` is the source-accent stroke.
 */
export interface ChainEdgeBuildData {
  variant: "flow" | "equipment";
  color: string;
  mass: number | null;
  unit: EdgeMassUnit | null;
  kgLabel: string | null;
  pctLabel: string | null;
  /** Horizontal offset from the default midpoint for split/merge fan routing. */
  routeOffsetX: number | null;
  [key: string]: unknown;
}

function formatKg(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${Math.round(value).toLocaleString()} kg`;
}

function formatDryTons(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${value.toFixed(2)} t dry`;
}

function formatWetDryTonnes(
  wetTons: number | null | undefined,
  dryTons: number | null | undefined,
): string {
  return formatWetDryMass({
    wetKg: wetTons == null ? null : tonnesToKg(wetTons),
    dryKg: dryTons == null ? null : tonnesToKg(dryTons),
  });
}

function massLabel(mass: EdgeMass | null): string | null {
  if (!mass || mass.value == null) return null;
  return mass.unit === "kg" ? formatKg(mass.value) : formatDryTons(mass.value);
}

function formatShare(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) {
    return MISSING_VALUE.notAvailable;
  }
  if (fraction < SUB_ONE_PERCENT) return "<1%";
  if (fraction >= NEAR_FULL_PERCENT) return "100%";
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Branch-share % per edge (plan decision): an edge in a fan reads as its
 * share of that fan. A split (one source → many targets) normalizes against
 * the source's total outflow; a merge (many sources → one target) against the
 * target's total inflow; a straight 1:1 hand-off reads 100%. Sums stay within
 * one unit, since a fan never mixes kg and dry-tons.
 */
function computeEdgeShareLabels(edges: Edge[]): void {
  const outSum = new Map<string, number>();
  const outCount = new Map<string, number>();
  const inSum = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const edge of edges) {
    const data = edge.data as ChainEdgeBuildData | undefined;
    if (!data || data.mass == null || data.unit == null) continue;
    const outKey = `${edge.source}|${data.unit}`;
    const inKey = `${edge.target}|${data.unit}`;
    outSum.set(outKey, (outSum.get(outKey) ?? 0) + data.mass);
    outCount.set(outKey, (outCount.get(outKey) ?? 0) + 1);
    inSum.set(inKey, (inSum.get(inKey) ?? 0) + data.mass);
    inCount.set(inKey, (inCount.get(inKey) ?? 0) + 1);
  }
  for (const edge of edges) {
    const data = edge.data as ChainEdgeBuildData | undefined;
    if (!data || data.mass == null || data.unit == null) continue;
    const outKey = `${edge.source}|${data.unit}`;
    const inKey = `${edge.target}|${data.unit}`;
    let fraction: number;
    if ((outCount.get(outKey) ?? 0) > 1) {
      fraction = data.mass / (outSum.get(outKey) || 1);
    } else if ((inCount.get(inKey) ?? 0) > 1) {
      fraction = data.mass / (inSum.get(inKey) || 1);
    } else {
      fraction = 1;
    }
    data.pctLabel = formatShare(fraction);
  }
}

/**
 * React Flow's smooth-step default sends every edge between two ranks through
 * the same midpoint. In a split/merge fan that makes distinct allocations
 * look like one shared line carrying several labels. Give each connected fan
 * edge its own midpoint lane while leaving ordinary 1:1 hand-offs unchanged.
 *
 * Call this **after** `dagre.layout`: `getNodeY` reports each node's laid-out
 * centre, and lanes are ordered by their endpoints' vertical position so the
 * routes do not cross. Without it, lanes fall back to edge-id order, which is
 * only stable, not geometrically sensible.
 */
export function assignEdgeRouteOffsets(
  edges: Edge[],
  getNodeY?: (nodeId: string) => number,
): void {
  const flowEdges = edges.filter((graphEdge) => {
    const data = graphEdge.data as ChainEdgeBuildData | undefined;
    return data?.variant === "flow";
  });
  const bySource = new Map<string, Edge[]>();
  const byTarget = new Map<string, Edge[]>();

  for (const graphEdge of flowEdges) {
    const sourceEdges = bySource.get(graphEdge.source) ?? [];
    sourceEdges.push(graphEdge);
    bySource.set(graphEdge.source, sourceEdges);

    const targetEdges = byTarget.get(graphEdge.target) ?? [];
    targetEdges.push(graphEdge);
    byTarget.set(graphEdge.target, targetEdges);
  }

  const fanEdges = new Set(
    flowEdges.filter(
      (graphEdge) =>
        (bySource.get(graphEdge.source)?.length ?? 0) > 1 ||
        (byTarget.get(graphEdge.target)?.length ?? 0) > 1,
    ),
  );
  const visited = new Set<Edge>();

  for (const firstEdge of fanEdges) {
    if (visited.has(firstEdge)) continue;
    const component: Edge[] = [];
    const queue = [firstEdge];
    visited.add(firstEdge);

    while (queue.length > 0) {
      const graphEdge = queue.pop()!;
      component.push(graphEdge);
      const neighbors = [
        ...(bySource.get(graphEdge.source) ?? []),
        ...(byTarget.get(graphEdge.target) ?? []),
      ];
      for (const neighbor of neighbors) {
        if (!fanEdges.has(neighbor) || visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    // Endpoint midpoint: an edge between two high cards takes a high lane.
    const laneKeys = new Map(
      component.map((graphEdge) => [
        graphEdge,
        getNodeY
          ? getNodeY(graphEdge.source) + getNodeY(graphEdge.target)
          : 0,
      ]),
    );
    component.sort((left, right) => {
      const delta = (laneKeys.get(left) ?? 0) - (laneKeys.get(right) ?? 0);
      return delta !== 0 ? delta : left.id.localeCompare(right.id);
    });
    const preferredSpan = (component.length - 1) * EDGE_ROUTE_LANE_GAP;
    const span = Math.min(preferredSpan, EDGE_ROUTE_MAX_OFFSET * 2);
    const laneGap = component.length > 1 ? span / (component.length - 1) : 0;
    const centerIndex = (component.length - 1) / 2;

    component.forEach((graphEdge, index) => {
      const data = graphEdge.data as ChainEdgeBuildData;
      data.routeOffsetX = (index - centerIndex) * laneGap;
    });
  }
}

function formatDateOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const formatted = formatDate(value);
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

/** Also feeds the Carbon Viewer's marker popups (same codes + detail rows). */
export function buildLineageNodes(data: ChainOfCustodyData): LineageGraphNode[] {
  const nodes: LineageGraphNode[] = [];
  const sources = resolveChainSources(data);
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
    addRow(details, "Inbound", feedstock.feedstockDeliveryCode);
    addRow(details, "Wet allocation", formatKg(feedstock.wetMassUsedKg));
    addRow(details, "Intake dry mass", formatKg(feedstock.massDryKg));

    nodes.push({
      id: `feedstock:${feedstock.id}`,
      kind: "feedstock",
      code: feedstock.code,
      href: feedstock.href,
      status: feedstock.status,
      date: formatDateOrNull(feedstock.deliveryDate),
      details,
    });
    seenNodeIds.add(`feedstock:${feedstock.id}`);
  }

  for (const source of sources) {
    const productionRun = source.productionRun;
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
      source.allocatedWetMassKg != null ||
      source.allocatedDryMassKg != null
    ) {
      addRow(
        details,
        "Applied from source",
        formatWetDryMass({
          wetKg: source.allocatedWetMassKg,
          dryKg: source.allocatedDryMassKg,
        }),
      );
    }

    nodes.push({
      id: `production-run:${productionRun.id}`,
      kind: "productionRun",
      code: productionRun.biocharStorageName ?? productionRun.code,
      href: productionRun.href,
      status: productionRun.status,
      date: formatDateOrNull(productionRun.date),
      details,
    });
  }

  if (data.biocharProduct) {
    const details: LineageDetailRow[] = [];
    addRow(details, "Applied from batch", formatWetDryMass({
      wetKg: sources.reduce((n, source) => n + (source.allocatedWetMassKg ?? 0), 0),
      dryKg: sources.reduce((n, source) => n + (source.allocatedDryMassKg ?? 0), 0),
    }));

    nodes.push({
      id: `biochar-product:${data.biocharProduct.id}`,
      kind: "biocharProduct",
      code:
        `${data.biocharProduct.code} · ${data.biocharProduct.formulationName ?? "Pure biochar"}`,
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
      href: data.order.href,
      date: formatDateOrNull(data.order.orderDate),
      details,
    });
  }

  {
    const details: LineageDetailRow[] = [];
    addRow(
      details,
      "Biochar delivered",
      formatWetDryMass({
        wetKg: data.delivery.deliveredWetMassKg,
        dryKg: data.delivery.massDryKg,
      }),
    );

    nodes.push({
      id: `delivery:${data.delivery.id}`,
      kind: "delivery",
      code: "Delivery",
      href: data.delivery.href,
      status: data.delivery.status,
      date: formatDateOrNull(data.delivery.deliveryDate),
      details,
    });
  }

  {
    const details: LineageDetailRow[] = [];
    addRow(details, "Field", data.application.fieldIdentifier);
    addRow(
      details,
      "Biochar applied",
      formatWetDryTonnes(
        data.application.biocharAppliedTons,
        data.application.biocharAppliedDryTons,
      ),
    );

    nodes.push({
      id: `application:${data.application.id}`,
      kind: "application",
      code:
        data.application.fieldIdentifier ?? "Field application",
      href: data.application.href,
      status: data.application.status,
      date: formatDateOrNull(data.application.applicationDate),
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
    variant?: "flow" | "equipment";
  },
): Edge {
  const variant = opts?.variant ?? "flow";
  const mass = opts?.mass ?? null;
  const color = variant === "equipment" ? EQUIPMENT_EDGE_COLOR : FLOW_EDGE_COLOR;
  return {
    id: `${source}->${target}`,
    source,
    target,
    type: "chainEdge",
    markerEnd: { type: MarkerType.ArrowClosed, color },
    data: {
      variant,
      color,
      mass: mass?.value ?? null,
      unit: mass?.unit ?? null,
      wetKg: opts?.wetKg ?? null,
      kgLabel: opts?.massLabel ?? massLabel(mass),
      pctLabel: null,
      routeOffsetX: null,
    } satisfies ChainEdgeBuildData,
  };
}

/**
 * Every flow edge is labeled with the mass moving along it, so the hand-offs
 * between records read directly off the graph. (Per-step CO₂e isn't recorded
 * along the lineage — the batch-level net removal lives on the Sankey.)
 */
function buildLineageEdges(data: ChainOfCustodyData): Edge[] {
  const edges: Edge[] = [];
  const sources = resolveChainSources(data);

  for (const source of sources) {
    const productionRun = source.productionRun;
    for (const feedstock of source.feedstocks) {
      edges.push(
        edge(`feedstock:${feedstock.id}`, `production-run:${productionRun.id}`, {
          mass: { value: feedstock.wetMassUsedKg, unit: "kg" },
        })
      );
    }

    if (source.reactor) {
      // Equipment association, not a mass flow — drawn as a quiet dashed link.
      edges.push(
        edge(`reactor:${source.reactor.id}`, `production-run:${productionRun.id}`, {
          variant: "equipment",
        })
      );
    }

    if (data.biocharProduct) {
      const legacyDryMassKg = splitWetMass(
        data.biocharProduct.massKg,
        data.biocharProduct.moistureContentPercent,
      )?.dryKg;
      const wetMassKg =
        source.allocatedWetMassKg ??
        (sources.length === 1 ? data.biocharProduct.massKg : null);
      const dryMassKg =
        source.allocatedDryMassKg ??
        (sources.length === 1 ? legacyDryMassKg : null);
      edges.push(
        edge(
          `production-run:${productionRun.id}`,
          `biochar-product:${data.biocharProduct.id}`,
          {
            mass: { value: dryMassKg ?? wetMassKg, unit: "kg" },
            wetKg: wetMassKg,
            massLabel: formatWetDryMass({
              wetKg: wetMassKg,
              dryKg: dryMassKg,
            }),
          },
        ),
      );
    }
  }

  if (data.order) {
    edges.push(edge(`order:${data.order.id}`, `delivery:${data.delivery.id}`));
  }
  if (data.biocharProduct) {
    edges.push(edge(`biochar-product:${data.biocharProduct.id}`, `delivery:${data.delivery.id}`, {
      mass: { value: data.application.biocharAppliedDryTons, unit: "tDry" },
      massLabel: formatWetDryTonnes(data.application.biocharAppliedTons, data.application.biocharAppliedDryTons),
      wetKg: data.application.biocharAppliedTons == null ? null : tonnesToKg(data.application.biocharAppliedTons),
    }));
  }

  edges.push(
    edge(`delivery:${data.delivery.id}`, `application:${data.application.id}`, {
      // Branch-share accounting stays on the authoritative dry value. The
      // visible label carries both bases so operators never have to infer
      // whether the application figure is wet or dry.
      mass: { value: data.application.biocharAppliedDryTons, unit: "tDry" },
      wetKg: data.application.biocharAppliedTons == null ? null : tonnesToKg(data.application.biocharAppliedTons),
      massLabel: formatWetDryTonnes(
        data.application.biocharAppliedTons,
        data.application.biocharAppliedDryTons,
      ),
    }),
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
  // Branch shares depend on the full (merged + deduped) edge set, so annotate
  // here — covers both the single-rollback and batch roll-up graphs.
  computeEdgeShareLabels(edges);

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

  // Fan lanes read the laid-out vertical positions, so they are assigned once
  // the ranks exist.
  assignEdgeRouteOffsets(edges, (nodeId) => g.node(nodeId)?.y ?? 0);

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

  return buildMergedChainGraph(expandProductLineages(data), options);
}

/**
 * Batch roll-up DAG: the member applications' lineage graphs merged into one
 * fan-out (plan decision 2). Nodes and edges dedupe by id, so a production
 * run / lot / feedstock shared by several applications appears once with all
 * its downstream branches attached.
 */
function buildMergedChainGraph(
  lineages: ChainOfCustodyData[] | undefined,
  options: ChainGraphOptions = {}
) {
  if (!lineages || lineages.length === 0) {
    return { nodes: [], edges: [] };
  }

  lineages = lineages.flatMap(expandProductLineages);
  const applicationMasses = new Map<
    string,
    { wetTons: number | null; dryTons: number | null }
  >();
  for (const lineage of lineages) {
    const totals = applicationMasses.get(lineage.application.id) ?? {
      wetTons: null,
      dryTons: null,
    };
    if (lineage.application.biocharAppliedTons != null) {
      totals.wetTons =
        (totals.wetTons ?? 0) +
        lineage.application.biocharAppliedTons;
    }
    if (lineage.application.biocharAppliedDryTons != null) {
      totals.dryTons =
        (totals.dryTons ?? 0) +
        lineage.application.biocharAppliedDryTons;
    }
    applicationMasses.set(lineage.application.id, totals);
  }
  const productMasses = new Map<string, { wetKg: number; dryKg: number }>();
  for (const lineage of lineages) {
    if (!lineage.biocharProduct) continue;
    const total = productMasses.get(lineage.biocharProduct.id) ?? { wetKg: 0, dryKg: 0 };
    total.wetKg += tonnesToKg(lineage.application.biocharAppliedTons ?? 0);
    total.dryKg += tonnesToKg(lineage.application.biocharAppliedDryTons ?? 0);
    productMasses.set(lineage.biocharProduct.id, total);
  }
  const normalizedLineages = lineages.map((lineage) => {
    const totals = applicationMasses.get(lineage.application.id);
    return {
      ...lineage,
      application: {
        ...lineage.application,
        biocharAppliedTons: totals?.wetTons ?? null,
        biocharAppliedDryTons: totals?.dryTons ?? null,
      },
    };
  });

  const nodeById = new Map<string, LineageGraphNode>();
  const edgeById = new Map<string, Edge>();
  for (const [index, lineage] of lineages.entries()) {
    for (const node of buildLineageNodes(normalizedLineages[index])) {
      if (node.kind === "biocharProduct" && lineage.biocharProduct) {
        const total = productMasses.get(lineage.biocharProduct.id);
        if (total) node.details = [{ label: "Applied from batch", value: formatWetDryMass(total) }];
      }
      if (!nodeById.has(node.id)) nodeById.set(node.id, node);
    }
    for (const lineageEdge of buildLineageEdges(lineage)) {
      const existing = edgeById.get(lineageEdge.id);
      if (!existing) edgeById.set(lineageEdge.id, lineageEdge);
      else if ((lineageEdge.source.startsWith("production-run:") || lineageEdge.source.startsWith("biochar-product:") || lineageEdge.source.startsWith("delivery:")) && existing.data && lineageEdge.data && existing.data.mass != null && lineageEdge.data.mass != null) {
        const mass = Number(existing.data.mass) + Number(lineageEdge.data.mass);
        const wetKg = existing.data.wetKg != null && lineageEdge.data.wetKg != null ? Number(existing.data.wetKg) + Number(lineageEdge.data.wetKg) : null;
        existing.data = { ...existing.data, mass, wetKg, kgLabel: wetKg != null ? formatWetDryMass({ wetKg, dryKg: existing.data.unit === "tDry" ? tonnesToKg(mass) : mass }) : existing.data.unit === "tDry" ? formatDryTons(mass) : formatKg(mass) };
      }
    }
  }

  return layoutGraph(
    Array.from(nodeById.values()),
    Array.from(edgeById.values()),
    { ...options, drillApplications: true }
  );
}

export function useBatchChainGraph(lineages: ChainOfCustodyData[] | undefined, options: ChainGraphOptions = {}) {
  return buildMergedChainGraph(lineages, options);
}
