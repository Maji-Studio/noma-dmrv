/**
 * The Flow view's model and layout, pure. One quantity at a time flows from
 * the source records into credit batches (or Not yet allocated) and on into
 * Removals. Every node and band is drawn to scale in that quantity.
 */
import type { AllocationRecord, Unit } from "@/types/emission-allocation";
import { recordName } from "./allocation-format";
import { NOT_YET_LABEL, NOT_YET_OWNER, amountsOf, fractionFor, percentFor, type Owner } from "./allocation-model";

export type StreamKey = "feedstock" | "delivery" | "diesel" | "electricity";

export interface Stream {
  key: StreamKey;
  label: string;
  unit: Unit;
  /** The record's figure in this stream, or null when it has none recorded. */
  pick: (record: AllocationRecord) => number | null;
}

const unitAmount = (record: AllocationRecord, unit: Unit) => amountsOf(record).find((amount) => amount.unit === unit)?.value ?? null;

export const STREAMS: Stream[] = [
  { key: "feedstock", label: "Feedstock", unit: "t·km", pick: (r) => (r.group === "feedstockTransport" ? unitAmount(r, "t·km") : null) },
  { key: "delivery", label: "Delivery", unit: "t·km", pick: (r) => (r.group === "deliveryTransport" ? unitAmount(r, "t·km") : null) },
  { key: "diesel", label: "Diesel", unit: "L", pick: (r) => unitAmount(r, "L") },
  { key: "electricity", label: "Electricity", unit: "kWh", pick: (r) => unitAmount(r, "kWh") },
];

type NodeKind = "record" | "batch" | "notYet" | "removal";

export interface GraphNode {
  key: string;
  col: 0 | 1 | 2;
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
  batches: Owner[];
  removals: Owner[];
  /** Records that have this quantity in their group but no recorded figure, so they are not drawn. */
  undrawn: number;
}

export function buildGraph(stream: Stream, records: AllocationRecord[], batches: Owner[], removals: Owner[]): Graph {
  const picked = records.map((record) => ({ record, value: stream.pick(record) }));
  const items = picked.filter((item): item is { record: AllocationRecord; value: number } => item.value !== null && item.value > 0);
  const nodes: GraphNode[] = [];
  const bands: Band[] = [];
  const columnOne = [...batches, NOT_YET_OWNER];
  for (const { record, value } of items) {
    nodes.push({ key: record.id, col: 0, kind: "record", label: recordName(record), value, record });
    for (const owner of columnOne) {
      const part = value * fractionFor(record, owner);
      if (part > 0) bands.push({ from: record.id, to: owner.key, value: part });
    }
  }
  const valueOf = (owner: Owner) => items.reduce((sum, item) => sum + item.value * fractionFor(item.record, owner), 0);
  for (const owner of columnOne) {
    const value = valueOf(owner);
    if (value > 0) nodes.push({ key: owner.key, col: 1, kind: owner.notYet ? "notYet" : "batch", label: owner.notYet ? NOT_YET_LABEL : owner.label, value, owner });
  }
  for (const removal of removals) {
    const value = valueOf(removal);
    if (value <= 0) continue;
    nodes.push({ key: removal.key, col: 2, kind: "removal", label: removal.label, value, owner: removal });
    for (const id of removal.members) {
      const batch = batches.find((owner) => owner.key === id);
      const batchValue = batch ? valueOf(batch) : 0;
      if (batchValue > 0) bands.push({ from: id, to: removal.key, value: batchValue });
    }
  }
  const undrawn = picked.filter((item) => item.value === null && recordsInStream(stream, item.record)).length;
  return { nodes, bands, batches, removals, undrawn };
}

/** A record belongs to a stream when its group or one of its units does. */
function recordsInStream(stream: Stream, record: AllocationRecord): boolean {
  if (stream.key === "feedstock") return record.group === "feedstockTransport";
  if (stream.key === "delivery") return record.group === "deliveryTransport";
  return record.quantities.some((quantity) => quantity.unit === stream.unit);
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
  const light = (predicate: (band: Band) => boolean) =>
    graph.bands.forEach((band, index) => {
      if (!predicate(band)) return;
      bands.add(index);
      nodes.add(band.from);
      nodes.add(band.to);
    });
  if (node.kind === "record") light((band) => band.from === node.key);
  if (node.kind === "batch") light((band) => band.to === node.key || band.from === node.key);
  if (node.kind === "notYet") light((band) => band.to === node.key);
  if (node.kind === "removal") {
    const members = node.owner?.members ?? [];
    light((band) => band.to === node.key || members.includes(band.to));
  }
  return { bands, nodes };
}

/** The percent a lit node carries of one record, matching the record's table row. */
export function ownerPercent(record: AllocationRecord, node: GraphNode, graph: Graph, removalNotYet: Owner): number {
  if (!node.owner) return 0;
  if (node.kind === "notYet") return percentFor(record, NOT_YET_OWNER, [...graph.batches, NOT_YET_OWNER]);
  if (node.kind === "removal") return percentFor(record, node.owner, [...graph.removals, removalNotYet]);
  return percentFor(record, node.owner, [...graph.batches, NOT_YET_OWNER]);
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
/** Two caption lines inside a block. */
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

export function place(graph: Graph, width: number) {
  const lane = width >= LANE_FROM_PX ? LANE_W + LANE_GAP : 0;
  const avail = width - lane;
  // Without any Removal the chart is two columns, so the bands get the room a third column would take.
  const columns = graph.nodes.some((node) => node.col === 2) ? 3 : 2;
  const blockW = Math.max(MIN_BLOCK_W, Math.min(MAX_BLOCK_W, Math.floor((avail - (columns - 1) * MIN_BAND_W) / columns)));
  const bandW = (avail - columns * blockW) / (columns - 1);
  const colX = [lane, lane + blockW + bandW, lane + 2 * (blockW + bandW)];
  const narrow = blockW < NARROW_BLOCK_W;
  const cols = [0, 1, 2].map((col) => graph.nodes.filter((node) => node.col === col));
  const totals = cols.map((nodes) => nodes.reduce((sum, node) => sum + node.value, 0));
  const target = lane ? TARGET_HEIGHT_WIDE : TARGET_HEIGHT_NARROW;
  const need = (node: GraphNode) => (node.kind === "notYet" && narrow ? MIN_NOT_YET_H_NARROW : MIN_NODE_H) / node.value;
  // The tallest column fills the target height; then every block grows to hold its two label lines.
  const fit = Math.min(...cols.map((nodes, index) => (nodes.length && totals[index] > 0 ? (target - (nodes.length - 1) * MIN_GAP) / totals[index] : Infinity)));
  const scale = Math.max(fit, ...graph.nodes.map(need));
  const heightOf = (nodes: GraphNode[]) => nodes.reduce((sum, node) => sum + node.value * scale, 0) + Math.max(0, nodes.length - 1) * MIN_GAP;
  const height = Math.max(...cols.map(heightOf)) + PAD_Y * 2;
  const placed: Placed[] = [];
  cols.forEach((nodes, col) => {
    const used = nodes.reduce((sum, node) => sum + node.value * scale, 0);
    const gap = nodes.length > 1 ? Math.min(MAX_GAP, (height - PAD_Y * 2 - used) / (nodes.length - 1)) : 0;
    let y = PAD_Y + (height - PAD_Y * 2 - (used + gap * Math.max(0, nodes.length - 1))) / 2;
    for (const node of nodes) {
      const h = node.value * scale;
      placed.push({ ...node, x: colX[col], y, h });
      y += h + gap;
    }
  });
  return { placed, scale, height, blockW, lane };
}

export function bandPath(x0: number, y0: number, x1: number, y1: number, h: number): string {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h} Z`;
}

/** Labels at one x never closer than a line: push later ones down. */
export function spread(labels: { y: number }[]) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].y - sorted[index - 1].y < PCT_LINE) sorted[index].y = sorted[index - 1].y + PCT_LINE;
  }
}
