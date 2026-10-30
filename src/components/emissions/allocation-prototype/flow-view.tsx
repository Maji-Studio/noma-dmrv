/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). The Flow
 * view of the allocation: one quantity at a time flowing from the source
 * records into credit batches and on into Removals. Every node and band is
 * drawn to scale in that quantity, so each record appears whole and once.
 *
 * Visual language of the Traceability Sankey waterfall: light plum blocks
 * with a 1.25px plum stroke, the lit set in the pink accent, Not yet
 * allocated in the same hatch as water driven off. Like the waterfall, the
 * SVG only draws; an HTML button sits over every node, so hover, keyboard
 * focus and tap go through one element. The page's own batch or Removal is
 * lit until another node is hovered, focused or tapped.
 */
"use client";

import { useId, useState } from "react";
import {
  HATCH_STROKE,
  LIT_FILL,
  LIT_INK,
  START_FILL,
  START_STROKE,
  useMeasuredWidth,
} from "@/components/chain-of-custody/sankey/waterfall-parts";
import { cn } from "@/lib/utils";
import {
  NOT_YET_LABEL,
  NOT_YET_OWNER,
  RECORDS,
  basisFor,
  batchOwners,
  formatDay,
  formatKg,
  formatValue,
  fractionFor,
  percentFor,
  removalOwners,
  type Focus,
  type Owner,
  type RemovalFixture,
  type SourceRecord,
  type Unit,
} from "./fixture";
import { MUTED, SegmentGroup } from "./parts";

// ---------------------------------------------------------------------------
// Streams: one quantity, one unit
// ---------------------------------------------------------------------------

export type StreamKey = "feedstock" | "delivery" | "diesel" | "electricity";

interface Stream {
  key: StreamKey;
  label: string;
  unit: Unit;
  pick: (record: SourceRecord) => number | null;
}

export const STREAMS: Stream[] = [
  { key: "feedstock", label: "Feedstock", unit: "t·km", pick: (r) => (r.group === "feedstockTransport" ? r.quantities[0].value : null) },
  { key: "delivery", label: "Delivery", unit: "t·km", pick: (r) => (r.group === "deliveryTransport" ? r.quantities[0].value : null) },
  { key: "diesel", label: "Diesel", unit: "L", pick: (r) => r.quantities.find((q) => q.unit === "L")?.value ?? null },
  { key: "electricity", label: "Electricity", unit: "kWh", pick: (r) => r.quantities.find((q) => q.unit === "kWh")?.value ?? null },
];

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

type NodeKind = "record" | "batch" | "notYet" | "removal";

interface GraphNode {
  key: string;
  col: 0 | 1 | 2;
  kind: NodeKind;
  label: string;
  value: number;
  record?: SourceRecord;
  owner?: Owner;
}

interface Band {
  from: string;
  to: string;
  value: number;
}

interface Graph {
  nodes: GraphNode[];
  bands: Band[];
  batches: Owner[];
  removals: Owner[];
}

function buildGraph(stream: Stream, fixture: RemovalFixture): Graph {
  const batches = batchOwners();
  const removals = removalOwners(fixture);
  const items = RECORDS.map((record) => ({ record, value: stream.pick(record) ?? 0 })).filter((item) => item.value > 0);
  const nodes: GraphNode[] = [];
  const bands: Band[] = [];
  for (const { record, value } of items) {
    nodes.push({ key: record.id, col: 0, kind: "record", label: record.code, value, record });
    for (const owner of [...batches, NOT_YET_OWNER]) {
      const part = value * fractionFor(record, owner);
      if (part > 0) bands.push({ from: record.id, to: owner.key, value: part });
    }
  }
  const valueOf = (owner: Owner) => items.reduce((sum, item) => sum + item.value * fractionFor(item.record, owner), 0);
  for (const owner of [...batches, NOT_YET_OWNER]) {
    const value = valueOf(owner);
    if (value > 0) nodes.push({ key: owner.key, col: 1, kind: owner.notYet ? "notYet" : "batch", label: owner.notYet ? NOT_YET_LABEL : owner.label, value, owner });
  }
  for (const removal of removals) {
    const value = valueOf(removal);
    if (value <= 0) continue;
    nodes.push({ key: removal.key, col: 2, kind: "removal", label: removal.label, value, owner: removal });
    for (const code of removal.batches) {
      const batch = batches.find((owner) => owner.key === code);
      const batchValue = batch ? valueOf(batch) : 0;
      if (batchValue > 0) bands.push({ from: code, to: removal.key, value: batchValue });
    }
  }
  return { nodes, bands, batches, removals };
}

/** The bands and nodes a node lights: its own paths through the graph. */
function litSet(graph: Graph, key: string | null): { bands: Set<number>; nodes: Set<string> } {
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
    const members = node.owner?.batches ?? [];
    light((band) => band.to === node.key || members.includes(band.to as never));
  }
  return { bands, nodes };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Below this width the record context moves out of a side lane into the detail list. */
const LANE_FROM_PX = 760;
const LANE_W = 200;
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
const PAD_Y = 4;
const HIT_MIN_H = 44;
const STROKE = 1.25;
const LIT_STROKE = 1.5;
const HATCH_CELL = 6;
const PCT_GAP = 6;
const PCT_LINE = 14;

interface Placed extends GraphNode {
  x: number;
  y: number;
  h: number;
}

function place(graph: Graph, width: number) {
  const lane = width >= LANE_FROM_PX ? LANE_W + LANE_GAP : 0;
  const avail = width - lane;
  const blockW = Math.max(MIN_BLOCK_W, Math.min(MAX_BLOCK_W, Math.floor((avail - 2 * MIN_BAND_W) / 3)));
  const bandW = (avail - 3 * blockW) / 2;
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

function bandPath(x0: number, y0: number, x1: number, y1: number, h: number): string {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h} Z`;
}

/** Labels at one x never closer than a line: push later ones down. */
function spread(labels: { y: number }[]) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].y - sorted[index - 1].y < PCT_LINE) sorted[index].y = sorted[index - 1].y + PCT_LINE;
  }
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

const LIT_NODE_FILL = "color-mix(in srgb, var(--acc-dist) 18%, var(--paper))";
const QUIET_BAND_FILL = "var(--clr-dark-purple-10)";
const QUIET_BAND_STROKE = "var(--clr-dark-purple-20)";
const LIT_BAND_OPACITY = 0.5;

function ownerPercent(record: SourceRecord, node: Placed, graph: Graph): number {
  if (!node.owner) return 0;
  if (node.kind === "notYet") return percentFor(record, NOT_YET_OWNER, graph.batches);
  return percentFor(record, node.owner, node.kind === "removal" ? graph.removals : graph.batches);
}

function FlowChart({ graph, stream, focusKey, activeKey, onHover, onToggle }: {
  graph: Graph;
  stream: Stream;
  focusKey: string;
  activeKey: string | null;
  onHover: (key: string | null) => void;
  onToggle: (key: string) => void;
}) {
  const hatchId = `alloc-hatch-${useId().replace(/:/g, "")}`;
  const [width, measure] = useMeasuredWidth();
  const { placed, scale, height, blockW, lane } = place(graph, width);
  const byKey = new Map(placed.map((node) => [node.key, node]));
  const lit = litSet(graph, activeKey);
  const active = activeKey ? byKey.get(activeKey) : undefined;

  // Stack bands: out of a node in target order, into a node in source order.
  const outAt = new Map<string, number>();
  const inAt = new Map<string, number>();
  const drawn = graph.bands.map((band, index) => {
    const from = byKey.get(band.from);
    const to = byKey.get(band.to);
    if (!from || !to) return null;
    const h = band.value * scale;
    const y0 = from.y + (outAt.get(from.key) ?? 0);
    const y1 = to.y + (inAt.get(to.key) ?? 0);
    outAt.set(from.key, (outAt.get(from.key) ?? 0) + h);
    inAt.set(to.key, (inAt.get(to.key) ?? 0) + h);
    return { band, index, from, to, h, y0, y1 };
  });

  // Share labels: one per record, never two at one spot.
  const pct: { key: string; x: number; y: number; text: string; anchor: "start" | "end" }[] = [];
  if (active && active.kind !== "record") {
    for (const record of placed.filter((node) => node.kind === "record")) {
      const own = drawn.filter((d) => d && lit.bands.has(d.index) && d.from.key === record.key);
      if (!own.length || !record.record) continue;
      const top = Math.min(...own.map((d) => d!.y0));
      const bottom = Math.max(...own.map((d) => d!.y0 + d!.h));
      const percent = ownerPercent(record.record, active, graph);
      if (percent > 0 && percent < 100) pct.push({ key: record.key, x: record.x + blockW + PCT_GAP, y: (top + bottom) / 2, text: `${percent}%`, anchor: "start" });
    }
  } else if (active?.record) {
    for (const d of drawn) {
      if (!d || d.from.key !== active.key) continue;
      const percent = ownerPercent(active.record, d.to, graph);
      pct.push({ key: d.to.key, x: d.to.x - PCT_GAP, y: d.y1 + d.h / 2, text: `${percent}%`, anchor: "end" });
    }
  }
  spread(pct);

  return (
    <div ref={measure} className="w-full min-w-0">
      <div className="relative" style={{ width, height }} data-testid="allocation-flow">
        <svg width={width} height={height} aria-hidden className="absolute inset-0 overflow-visible">
          <defs>
            <pattern id={hatchId} width={HATCH_CELL} height={HATCH_CELL} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={HATCH_CELL} height={HATCH_CELL} fill="var(--paper)" />
              <line x1="0" y1="0" x2="0" y2={HATCH_CELL} stroke={HATCH_STROKE} strokeWidth={STROKE} />
            </pattern>
          </defs>
          {drawn.map((d) =>
            d && !lit.bands.has(d.index) ? (
              <path key={d.index} d={bandPath(d.from.x + blockW, d.y0, d.to.x, d.y1, d.h)} fill={QUIET_BAND_FILL} stroke={QUIET_BAND_STROKE} strokeWidth={0.75} />
            ) : null,
          )}
          {drawn.map((d) =>
            d && lit.bands.has(d.index) ? (
              <path key={d.index} d={bandPath(d.from.x + blockW, d.y0, d.to.x, d.y1, d.h)} fill={LIT_FILL} fillOpacity={LIT_BAND_OPACITY} stroke={LIT_FILL} strokeWidth={0.75} />
            ) : null,
          )}
          {placed.map((node) => {
            const isLit = lit.nodes.has(node.key) && node.kind !== "record" && node.kind !== "notYet";
            return (
              <rect
                key={node.key}
                x={node.x}
                y={node.y}
                width={blockW}
                height={node.h}
                fill={node.kind === "notYet" ? `url(#${hatchId})` : isLit ? LIT_NODE_FILL : START_FILL}
                stroke={node.key === focusKey ? "var(--ink)" : isLit ? LIT_FILL : START_STROKE}
                strokeWidth={node.key === focusKey || isLit ? LIT_STROKE : STROKE}
              />
            );
          })}
          {pct.map((label) => (
            <text key={label.key} x={label.x} y={label.y} textAnchor={label.anchor} dominantBaseline="middle" className="font-medium tabular-nums text-[12px]" fill={LIT_INK}>
              {label.text}
            </text>
          ))}
        </svg>

        {/* Record context in a lane to the left (wide screens). */}
        {lane > 0 &&
          placed
            .filter((node) => node.kind === "record" && node.record)
            .map((node) => (
              <div
                key={`lane-${node.key}`}
                className="pointer-events-none absolute flex flex-col justify-center text-right"
                style={{ left: 0, width: LANE_W, top: node.y + node.h / 2 - HIT_MIN_H / 2, height: HIT_MIN_H }}
              >
                <span className={cn("truncate body-caption", MUTED)}>{formatDay(node.record!.date)}, {node.record!.detail.split(", ").slice(0, 1).join("")}</span>
                <span className={cn("truncate body-caption", MUTED)}>{node.record!.detail.split(", ").slice(1).join(", ")}</span>
              </div>
            ))}

        {/* Labels inside the blocks. */}
        {placed.map((node) => {
          const isLit = lit.nodes.has(node.key) && node.kind !== "record" && node.kind !== "notYet";
          return (
            <div
              key={`label-${node.key}`}
              className="pointer-events-none absolute flex flex-col justify-center overflow-hidden px-6 leading-[16px]"
              style={{ left: node.x, top: node.y, width: blockW, height: node.h }}
            >
              <span className={cn("text-[12px] font-medium", node.kind === "notYet" ? "bg-[var(--paper)] self-start px-2" : "truncate")} style={{ color: isLit ? LIT_INK : "var(--color-text-primary)" }}>
                {node.label}
              </span>
              <span className={cn("truncate text-[12px] tabular-nums", node.kind === "notYet" && "bg-[var(--paper)] self-start px-2")} style={{ color: isLit ? LIT_INK : "var(--color-text-secondary)" }}>
                {formatValue(node.value, stream.unit)}
              </span>
            </div>
          );
        })}

        {/* One button per node, at least 44px tall. */}
        {placed.map((node) => {
          const h = Math.max(HIT_MIN_H, node.h);
          return (
            <button
              key={`hit-${node.key}`}
              type="button"
              data-node={node.key}
              aria-label={`${node.label}: ${formatValue(node.value, stream.unit)}`}
              aria-pressed={activeKey === node.key}
              className="absolute cursor-pointer bg-transparent outline-none focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-[var(--color-interaction)]"
              style={{ left: node.x, top: node.y + node.h / 2 - h / 2, width: blockW, height: h }}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") onHover(node.key);
              }}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(node.key)}
              onBlur={() => onHover(null)}
              onClick={() => onToggle(node.key)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The numbers of the lit node, as an aligned list
// ---------------------------------------------------------------------------

interface DetailRow {
  key: string;
  name: string;
  sub?: string;
  percent?: number;
  value: number;
}

function detailRows(graph: Graph, node: GraphNode, stream: Stream): DetailRow[] {
  if (node.kind === "record" && node.record) {
    const record = node.record;
    return [...graph.batches, NOT_YET_OWNER]
      .map((owner) => ({ owner, fraction: fractionFor(record, owner) }))
      .filter((row) => row.fraction > 0)
      .map(({ owner, fraction }) => ({
        key: owner.key,
        name: owner.notYet ? NOT_YET_LABEL : owner.label,
        sub: basisFor(record, owner).map((basis) => (basis.kg == null ? basis.label : `${basis.label} ${formatKg(basis.kg)}`)).join(", "),
        percent: percentFor(record, owner, graph.batches),
        value: node.value * fraction,
      }));
  }
  const owner = node.kind === "notYet" ? NOT_YET_OWNER : node.owner;
  if (!owner) return [];
  const owners = node.kind === "removal" ? graph.removals : graph.batches;
  return graph.nodes
    .filter((candidate) => candidate.kind === "record" && candidate.record && fractionFor(candidate.record, owner) > 0)
    .map((candidate) => ({
      key: candidate.key,
      name: candidate.label,
      sub: `${formatDay(candidate.record!.date)}, ${candidate.record!.detail}`,
      percent: percentFor(candidate.record!, owner, owners),
      value: (stream.pick(candidate.record!) ?? 0) * fractionFor(candidate.record!, owner),
    }));
}

function DetailList({ graph, node, stream, onOpenTable }: { graph: Graph; node: GraphNode; stream: Stream; onOpenTable: () => void }) {
  const rows = detailRows(graph, node, stream);
  const removal = node.kind === "batch" ? graph.removals.find((candidate) => candidate.batches.includes(node.key as never)) : undefined;
  const sub =
    node.kind === "record" && node.record ? `${formatDay(node.record.date)}, ${node.record.detail}` :
    node.kind === "removal" ? `From ${node.owner?.batches.join(", ")}` :
    node.kind === "batch" ? (removal ? `In ${removal.label}` : "Not in a Removal yet") :
    "Still in the bin";
  const shareHeader = "Share";
  return (
    <div className="flex min-w-0 flex-col gap-8" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-x-16 gap-y-4">
        <span className="flex min-w-0 flex-col">
          <span className="body-medium font-medium">{node.label}</span>
          <span className={cn("body-caption", MUTED)}>{sub}</span>
        </span>
        <button type="button" onClick={onOpenTable} className="min-h-44 body-small underline underline-offset-2">
          Open table
        </button>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th scope="col" className={cn("py-6 pr-12 body-caption font-medium", MUTED)}>{node.kind === "record" ? "Goes to" : "Record"}</th>
            <th scope="col" className={cn("w-[56px] py-6 pr-12 text-right body-caption font-medium sm:w-[72px]", MUTED)}>{shareHeader}</th>
            <th scope="col" className={cn("w-[64px] py-6 text-right body-caption font-medium sm:w-[112px]", MUTED)}>{stream.unit}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="[border-top:var(--row-divider)] align-top">
              <th scope="row" className="py-6 pr-12 text-left font-normal">
                <span className="block body-small">{row.name}</span>
                {row.sub && <span className={cn("block body-caption", MUTED)}>{row.sub}</span>}
              </th>
              <td className="py-6 pr-12 text-right body-small tabular-nums">{row.percent != null ? `${row.percent}%` : ""}</td>
              <td className="py-6 text-right body-small tabular-nums">{formatValue(row.value, stream.unit).replace(` ${stream.unit}`, "")}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="[border-top:var(--hair-2)]">
            <th scope="row" className="py-6 pr-12 text-left body-small font-medium">Total</th>
            <td />
            <td className="py-6 text-right body-small font-medium tabular-nums">{formatValue(node.value, stream.unit).replace(` ${stream.unit}`, "")}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function FlowView({ focus, fixture, onOpenTable }: { focus: Focus; fixture: RemovalFixture; onOpenTable: () => void }) {
  const [streamKey, setStreamKey] = useState<StreamKey>("feedstock");
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const stream = STREAMS.find((candidate) => candidate.key === streamKey) ?? STREAMS[0];
  const graph = buildGraph(stream, fixture);
  const exists = (key: string | null) => !!key && graph.nodes.some((node) => node.key === key);
  const focusKey = focus.owner.key;
  const activeKey = exists(hovered) ? hovered : exists(pinned) ? pinned : exists(focusKey) ? focusKey : null;
  const activeNode = graph.nodes.find((node) => node.key === activeKey);
  return (
    <div className="flex min-w-0 flex-col gap-20 border border-[var(--color-border-secondary)] bg-[var(--paper)] p-16 sm:p-24">
      <SegmentGroup
        label="Quantity"
        options={STREAMS.map((candidate) => ({ value: candidate.key, label: candidate.label }))}
        value={streamKey}
        onChange={(value) => {
          setStreamKey(value);
          setPinned(null);
        }}
        stretch
        className="w-full sm:w-max"
      />
      <FlowChart
        graph={graph}
        stream={stream}
        focusKey={focusKey}
        activeKey={activeKey}
        onHover={setHovered}
        onToggle={(key) => setPinned((current) => (current === key || key === focusKey ? null : key))}
      />
      {activeNode && (
        <div className="border-t border-[var(--clr-dark-purple-10)] pt-16 lg:max-w-[640px]">
          <DetailList graph={graph} node={activeNode} stream={stream} onOpenTable={onOpenTable} />
        </div>
      )}
    </div>
  );
}
