/**
 * The Flow view's model and layout, pure. One quantity at a time flows from
 * the source records into the page's owners (credit batches on a batch page,
 * Removals on a Removal sheet) and Not yet allocated. A record's bands come
 * from its own parts, so they always add to the record and never exceed it.
 */
import type { AllocationRecord, Unit } from "@/types/emission-allocation";
import { recordName } from "./allocation-format";
import { NOT_YET_LABEL, amountsOf, fractionFor, percentFor, type Owner } from "./allocation-model";

export type StreamKey = "feedstock" | "delivery" | "diesel" | "electricity" | "manual";

export interface Stream {
  key: StreamKey;
  label: string;
  /** What the figures are, for a sentence: "transport", "diesel". */
  noun: string;
  /** Where the figure comes from: the next step for an empty quantity. */
  emptyHint: string;
  unit: Unit;
  /** The record's figure in this stream, or null when it has none recorded. */
  pick: (record: AllocationRecord) => number | null;
  /** Whether the record belongs in this stream at all, recorded or not. */
  has: (record: AllocationRecord) => boolean;
}

const unitAmount = (record: AllocationRecord, unit: Unit) => amountsOf(record).find((amount) => amount.unit === unit)?.value ?? null;
const hasUnit = (record: AllocationRecord, unit: Unit) => record.quantities.some((quantity) => quantity.unit === unit);
const inGroupWithUnit = (group: AllocationRecord["group"], unit: Unit) => (record: AllocationRecord) => record.group === group && hasUnit(record, unit);

export const STREAMS: Stream[] = [
  { key: "feedstock", label: "Feedstock", noun: "transport", emptyHint: "Feedstock transport shows here once a feedstock delivery has its distance and load recorded.", unit: "t·km", pick: (r) => (r.group === "feedstockTransport" ? unitAmount(r, "t·km") : null), has: (r) => r.group === "feedstockTransport" },
  { key: "delivery", label: "Delivery", noun: "transport", emptyHint: "Delivery transport shows here once a biochar delivery has its distance and mass recorded.", unit: "t·km", pick: (r) => (r.group === "deliveryTransport" ? unitAmount(r, "t·km") : null), has: (r) => r.group === "deliveryTransport" },
  { key: "diesel", label: "Diesel", noun: "diesel", emptyHint: "Diesel shows here once a production run or a manual entry records it.", unit: "L", pick: (r) => unitAmount(r, "L"), has: (r) => hasUnit(r, "L") },
  { key: "electricity", label: "Electricity", noun: "electricity", emptyHint: "Electricity shows here once a production run or a manual entry records it.", unit: "kWh", pick: (r) => unitAmount(r, "kWh"), has: (r) => hasUnit(r, "kWh") },
  { key: "manual", label: "Manual transport", noun: "transport", emptyHint: "Manual transport shows here once a manual entry records t·km.", unit: "t·km", pick: (r) => (r.group === "manual" ? unitAmount(r, "t·km") : null), has: inGroupWithUnit("manual", "t·km") },
];

/** Streams worth a tab: the four standing ones, and manual transport only when an entry has it. */
export function visibleStreams(records: AllocationRecord[]): Stream[] {
  return STREAMS.filter((stream) => stream.key !== "manual" || records.some(stream.has));
}

type NodeKind = "record" | "owner" | "notYet";

export interface GraphNode {
  key: string;
  col: 0 | 1;
  kind: NodeKind;
  label: string;
  value: number;
  record?: AllocationRecord;
  owner?: Owner;
}

export interface Band {
  from: string;
  to: string;
  value: number;
}

export interface Graph {
  nodes: GraphNode[];
  bands: Band[];
  owners: Owner[];
  notYet: Owner;
  /** Records in this stream that have no recorded figure, so they are not drawn. */
  undrawn: number;
}

export function buildGraph(stream: Stream, records: AllocationRecord[], owners: Owner[], notYet: Owner): Graph {
  const picked = records.map((record) => ({ record, value: stream.pick(record) }));
  const items = picked.filter((item): item is { record: AllocationRecord; value: number } => item.value !== null && item.value > 0);
  const columnOne = [...owners, notYet];
  const nodes: GraphNode[] = [];
  const bands: Band[] = [];
  for (const { record, value } of items) {
    nodes.push({ key: record.id, col: 0, kind: "record", label: recordName(record), value, record });
    for (const owner of columnOne) {
      const part = value * fractionFor(record, owner);
      if (part > 0) bands.push({ from: record.id, to: owner.key, value: part });
    }
  }
  for (const owner of columnOne) {
    const value = items.reduce((sum, item) => sum + item.value * fractionFor(item.record, owner), 0);
    if (value > 0) nodes.push({ key: owner.key, col: 1, kind: owner.notYet ? "notYet" : "owner", label: owner.notYet ? NOT_YET_LABEL : owner.label, value, owner });
  }
  const undrawn = picked.filter((item) => item.value === null && stream.has(item.record)).length;
  return { nodes, bands, owners, notYet, undrawn };
}

/** The first stream that has anything to draw, so the section never opens on an empty chart. */
export function firstStreamWithData(records: AllocationRecord[]): StreamKey {
  return STREAMS.find((stream) => records.some((record) => (stream.pick(record) ?? 0) > 0))?.key ?? "feedstock";
}

/** The bands and nodes a node lights: its own paths through the graph. */
export function litSet(graph: Graph, key: string | null): { bands: Set<number>; nodes: Set<string> } {
  const bands = new Set<number>();
  const nodes = new Set<string>();
  const node = graph.nodes.find((candidate) => candidate.key === key);
  if (!node) return { bands, nodes };
  nodes.add(node.key);
  graph.bands.forEach((band, index) => {
    if (band.from !== node.key && band.to !== node.key) return;
    bands.add(index);
    nodes.add(band.from);
    nodes.add(band.to);
  });
  return { bands, nodes };
}

/** The percent a node carries of one record, matching the record's table row. */
export function ownerPercent(record: AllocationRecord, node: GraphNode, graph: Graph): number {
  return node.owner ? percentFor(record, node.owner, [...graph.owners, graph.notYet]) : 0;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Below this width the record context moves out of a side lane into the detail list. */
const LANE_FROM_PX = 760;
export const LANE_W = 200;
const LANE_GAP = 12;
const MAX_BLOCK_W = 120;
const MIN_BLOCK_W = 64;
const MIN_BAND_W = 40;
const TARGET_HEIGHT_WIDE = 440;
const TARGET_HEIGHT_NARROW = 380;
/** Two caption lines inside a block: a small quantity is drawn this tall, never smaller. */
const MIN_NODE_H = 42;
/** "Not yet allocated" wraps to two lines in a narrow block, plus the figure. */
const MIN_NOT_YET_H_NARROW = 60;
const NARROW_BLOCK_W = 100;
const MIN_GAP = 12;
const MAX_GAP = 40;
export const PAD_Y = 4;
const PCT_LINE = 14;

export interface Placed extends GraphNode {
  x: number;
  y: number;
  h: number;
}

/**
 * Heights follow the quantity, scaled so the tallest column fills the target.
 * A node never goes below its label height, so a tiny quantity beside a huge
 * one costs at most that minimum, and the chart stays bounded by the target
 * plus one minimum per small node. Bands are cut from each node in proportion
 * to its height, so they always fit inside both ends.
 */
export function place(graph: Graph, width: number) {
  const lane = width >= LANE_FROM_PX ? LANE_W + LANE_GAP : 0;
  const avail = width - lane;
  const blockW = Math.max(MIN_BLOCK_W, Math.min(MAX_BLOCK_W, Math.floor((avail - MIN_BAND_W) / 2)));
  const bandW = avail - 2 * blockW;
  const colX = [lane, lane + blockW + bandW];
  const narrow = blockW < NARROW_BLOCK_W;
  const cols = [0, 1].map((col) => graph.nodes.filter((node) => node.col === col));
  const totals = cols.map((nodes) => nodes.reduce((sum, node) => sum + node.value, 0));
  const target = lane ? TARGET_HEIGHT_WIDE : TARGET_HEIGHT_NARROW;
  const scale = Math.min(...cols.map((nodes, index) => (nodes.length && totals[index] > 0 ? (target - (nodes.length - 1) * MIN_GAP) / totals[index] : Infinity)));
  const minH = (node: GraphNode) => (node.kind === "notYet" && narrow ? MIN_NOT_YET_H_NARROW : MIN_NODE_H);
  const heightOf = (node: GraphNode) => Math.max(node.value * scale, minH(node));
  const colHeight = (nodes: GraphNode[]) => nodes.reduce((sum, node) => sum + heightOf(node), 0) + Math.max(0, nodes.length - 1) * MIN_GAP;
  const height = Math.max(...cols.map(colHeight)) + PAD_Y * 2;
  const placed: Placed[] = [];
  cols.forEach((nodes, col) => {
    const used = nodes.reduce((sum, node) => sum + heightOf(node), 0);
    const gap = nodes.length > 1 ? Math.min(MAX_GAP, (height - PAD_Y * 2 - used) / (nodes.length - 1)) : 0;
    let y = PAD_Y + (height - PAD_Y * 2 - (used + gap * Math.max(0, nodes.length - 1))) / 2;
    for (const node of nodes) {
      const h = heightOf(node);
      placed.push({ ...node, x: colX[col], y, h });
      y += h + gap;
    }
  });
  return { placed, height, blockW, lane };
}

/** A ribbon from a source of height h0 to a target of height h1. */
export function bandPath(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): string {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h1} C${xm},${y1 + h1} ${xm},${y0 + h0} ${x0},${y0 + h0} Z`;
}

/** Labels at one x never closer than a line: push later ones down. */
export function spread(labels: { y: number }[]) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].y - sorted[index - 1].y < PCT_LINE) sorted[index].y = sorted[index - 1].y + PCT_LINE;
  }
}
