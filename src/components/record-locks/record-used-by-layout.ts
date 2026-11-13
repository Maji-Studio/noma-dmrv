import { usedByNodeKey, type RecordUsedByBatch, type RecordUsedByChain, type RecordUsedByEdge } from "@/lib/record-used-by-chain";
import type { RecordLockLink } from "@/lib/record-lock-view";
import { recordLockLinkTitle } from "./record-lock-labels";
import { CUSTODY_KINDS, kindHeading, kindRank, type UsedByNode } from "./record-used-by-kinds";

/**
 * Geometry, px at the narrowest column. Columns stretch with the sheet up to
 * COL_MAX; below one COL per column the chart scrolls inside its own frame.
 */
export const COL = 76;
export const COL_MAX = 112;
export const SQUARE = 28;
export const NODE_H = 48;
export const ROW = 56;
export const BAND_LABEL_H = 32;
export const HEADER_H = 40;
export const BOTTOM_PAD = 8;
export const BAND_INSET = 2;
/** A column with more records than this stacks into a group. */
export const GROUP_THRESHOLD = 4;
const UPSTREAM_MIXED_HEADING = "Came from";

export interface Placed { key: string; x: number; y: number }
export interface Column { kind: string; nodes: UsedByNode[]; role: "upstream" | "self" | "downstream" }
export interface PlacedNode { node: UsedByNode; at: Placed; self: boolean }
export interface PlacedGroup { kind: string; count: number; at: Placed }

/** The chain with the users the lock read names but the chain read does not reach. */
export interface UsedByGraph {
  self: UsedByNode;
  upstream: UsedByNode[];
  downstream: UsedByNode[];
  edges: RecordUsedByEdge[];
  creditBatches: RecordUsedByBatch[];
}

export interface UsedByLayout {
  columns: Column[];
  selfIndex: number;
  hasBand: boolean;
  width: number;
  height: number;
  nodes: PlacedNode[];
  groups: PlacedGroup[];
  /** Edge paths keyed `from>to`, in the chart's own coordinates. */
  paths: Map<string, string>;
  /** Anything not in the custody chain, by kind, listed under the chart. */
  asides: Map<string, UsedByNode[]>;
}

/**
 * Users the chain read does not reach (a stock count, a bin reference) still
 * show, as a column or under the chart, so nothing in "Used by" goes missing.
 * Credit batches stay context, never a node.
 */
export function withUnmatchedUsers(chain: RecordUsedByChain, usedBy: RecordLockLink[]): UsedByGraph {
  const known = new Set(chain.downstream.map((node) => usedByNodeKey(node.kind, node.id)));
  const selfKey = usedByNodeKey(chain.self.kind, chain.self.id);
  const extra: UsedByNode[] = usedBy
    .filter((link) => link.kind !== "creditBatch" && !known.has(usedByNodeKey(link.kind, link.id)))
    .map((link) => ({
      kind: link.kind, id: link.id, code: link.label ?? recordLockLinkTitle(link), name: null,
      facilityId: link.facilityId, at: link.period?.completedOn ?? null, calendarDay: true,
    }));
  const edges = extra.map((node) => ({ from: selfKey, to: usedByNodeKey(node.kind, node.id), mass: null }));
  return { ...chain, downstream: [...chain.downstream, ...extra], edges: [...chain.edges, ...edges] };
}

export function buildColumns(graph: UsedByGraph): Column[] {
  const byKind = new Map<string, UsedByNode[]>();
  for (const node of graph.downstream) if (CUSTODY_KINDS.includes(node.kind)) byKind.set(node.kind, [...(byKind.get(node.kind) ?? []), node]);
  const downstream = [...byKind].sort(([a], [b]) => kindRank(a) - kindRank(b)).map(([kind, nodes]) => ({ kind, nodes, role: "downstream" as const }));
  return [
    ...(graph.upstream.length ? [{ kind: graph.upstream[0].kind, nodes: graph.upstream, role: "upstream" as const }] : []),
    { kind: graph.self.kind, nodes: [graph.self], role: "self" as const },
    ...downstream,
  ];
}

/** Rows follow their parents' rows, so edges cross as little as they can. */
function orderColumn(nodes: UsedByNode[], graph: UsedByGraph, rowOf: Map<string, number>): UsedByNode[] {
  const parentRow = (node: UsedByNode) => {
    const rows = graph.edges.filter((edge) => edge.to === usedByNodeKey(node.kind, node.id)).map((edge) => rowOf.get(edge.from) ?? 0);
    return rows.length ? Math.min(...rows) : 0;
  };
  return [...nodes].sort((a, b) => parentRow(a) - parentRow(b) || (a.at ?? "").localeCompare(b.at ?? "") || a.code.localeCompare(b.code));
}

/** A cubic bezier from one square's right edge to the next one's left edge, like Flow's edges. */
function edgePath(from: Placed, to: Placed): string {
  const x1 = from.x + SQUARE / 2;
  const x2 = to.x - SQUARE / 2;
  const y1 = from.y + SQUARE / 2;
  const y2 = to.y + SQUARE / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

/** The column's heading; what the record came from can mix kinds, so it is only named by its kind when it is one. */
export function columnHeading(column: Column): string {
  const mixed = column.role === "upstream" && new Set(column.nodes.map((node) => node.kind)).size > 1;
  return mixed ? UPSTREAM_MIXED_HEADING : kindHeading(column.kind, column.nodes.length);
}

/** Whether a column stacks into a group (it holds more than GROUP_THRESHOLD records); this record's own column never does. */
export function stacks(column: Column): boolean {
  return column.role !== "self" && column.nodes.length > GROUP_THRESHOLD;
}

/** Places every column; a stacked column that is not open collapses to one group square. */
export function layoutUsedBy(graph: UsedByGraph, open: ReadonlySet<string>): UsedByLayout {
  const columns = buildColumns(graph);
  const hasBand = graph.creditBatches.length > 0;
  const top = hasBand ? BAND_LABEL_H : 0;
  const placed = new Map<string, Placed>();
  const rowOf = new Map<string, number>();
  const groups: PlacedGroup[] = [];
  const nodes: PlacedNode[] = [];
  let maxRows = 1;
  columns.forEach((column, index) => {
    const x = index * COL + COL / 2;
    const ordered = orderColumn(column.nodes, graph, rowOf);
    if (stacks(column) && !open.has(column.kind)) {
      const at = { key: `group:${column.kind}`, x, y: top + HEADER_H };
      groups.push({ kind: column.kind, count: ordered.length, at });
      for (const node of ordered) {
        placed.set(usedByNodeKey(node.kind, node.id), at);
        rowOf.set(usedByNodeKey(node.kind, node.id), 0);
      }
      return;
    }
    ordered.forEach((node, row) => {
      const key = usedByNodeKey(node.kind, node.id);
      const at = { key, x, y: top + HEADER_H + row * ROW };
      placed.set(key, at);
      rowOf.set(key, row);
      nodes.push({ node, at, self: column.role === "self" });
    });
    maxRows = Math.max(maxRows, ordered.length);
  });
  const paths = new Map<string, string>();
  for (const edge of graph.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to || from.key === to.key || to.x <= from.x) continue;
    paths.set(`${from.key}>${to.key}`, edgePath(from, to));
  }
  const asides = new Map<string, UsedByNode[]>();
  // A credit batch the band already names is not listed twice.
  const banded = new Set(graph.creditBatches.map((batch) => batch.id));
  for (const node of graph.downstream) {
    if (CUSTODY_KINDS.includes(node.kind) || (node.kind === "creditBatch" && banded.has(node.id))) continue;
    asides.set(node.kind, [...(asides.get(node.kind) ?? []), node]);
  }
  return {
    columns,
    selfIndex: columns.findIndex((column) => column.role === "self"),
    hasBand,
    width: columns.length * COL,
    height: top + HEADER_H + (maxRows - 1) * ROW + NODE_H + BOTTOM_PAD,
    nodes,
    groups,
    paths,
    asides,
  };
}

