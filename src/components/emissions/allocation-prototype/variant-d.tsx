/**
 * PROTOTYPE variant D, "Flow": one quantity at a time (feedstock t·km,
 * delivery t·km, diesel L, electricity kWh) flowing from source records into
 * credit batches and on into Removals, band widths in the quantity itself.
 * The bands into this page's batch or Removal are lit; the rest stay quiet.
 * Phones drop to two columns: records into the page's own kind.
 */
"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/forms/segmented-control";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { cn } from "@/lib/utils";
import {
  NOT_YET_OWNER,
  RECORDS,
  batchOwners,
  formatValue,
  fractionFor,
  removalOwners,
  sharesOf,
  type Focus,
  type Owner,
  type RemovalFixture,
  type SourceRecord,
  type Unit,
} from "./fixture";
import { MUTED, PANEL, ownerFill } from "./parts";

type StreamKey = "feedstock" | "delivery" | "diesel" | "electricity";

const STREAMS: { key: StreamKey; label: string; title: string; unit: Unit; pick: (record: SourceRecord) => number | null }[] = [
  { key: "feedstock", label: "Feedstock", title: "Feedstock transport", unit: "t·km", pick: (r) => (r.group === "feedstockTransport" ? r.quantities[0].value : null) },
  { key: "delivery", label: "Delivery", title: "Biochar delivery transport", unit: "t·km", pick: (r) => (r.group === "deliveryTransport" ? r.quantities[0].value : null) },
  { key: "diesel", label: "Diesel", title: "Diesel", unit: "L", pick: (r) => r.quantities.find((q) => q.unit === "L")?.value ?? null },
  { key: "electricity", label: "Electricity", title: "Electricity", unit: "kWh", pick: (r) => r.quantities.find((q) => q.unit === "kWh")?.value ?? null },
];

interface FlowNode {
  key: string;
  label: string;
  value: number;
  col: number;
  fill?: string;
  hatched?: boolean;
  lit: boolean;
  y: number;
  h: number;
}

interface FlowLink {
  from: string;
  to: string;
  value: number;
  lit: boolean;
  percent?: number;
}

interface Geometry {
  width: number;
  colX: number[];
  nodeW: number;
  gap: number;
  top: number;
  height: number;
  labelSize: number;
  showValues: boolean;
}

const DESKTOP: Omit<Geometry, "colX" | "height"> & { colX3: number[]; colX2: number[] } = {
  width: 920,
  colX3: [196, 520, 780],
  colX2: [196, 640],
  nodeW: 10,
  gap: 10,
  top: 8,
  labelSize: 12,
  showValues: true,
};
const PHONE = { width: 316, colX: [70, 190], nodeW: 8, gap: 8, top: 8, labelSize: 11, showValues: false };
const PX_PER_NODE = 34;
const MIN_HEIGHT = 240;
const LABEL_GAP = 6;
const LABEL_PAD = 3;
/** Rough glyph width in em for the label chip; the chip only needs to cover the text. */
const CHAR_EM = 0.56;
const HALO = { paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3, strokeLinejoin: "round" } as const;

function build(stream: (typeof STREAMS)[number], focus: Focus, fixture: RemovalFixture, threeColumns: boolean) {
  const items = RECORDS.map((record) => ({ record, value: stream.pick(record) })).filter((item): item is { record: SourceRecord; value: number } => item.value != null && item.value > 0);
  const batches = batchOwners();
  const removals = removalOwners(fixture);
  // Middle column: batches when there are three columns or the page is a batch; Removals otherwise.
  const mid: Owner[] = threeColumns || focus.surface === "batch" ? batches : removals;
  const litMid = (owner: Owner) => (focus.surface === "batch" ? owner.key === focus.owner.key : owner.batches.every((code) => focus.owner.batches.includes(code)) && !owner.notYet);
  const nodes: Omit<FlowNode, "y" | "h">[] = [];
  const links: FlowLink[] = [];
  for (const { record, value } of items) {
    nodes.push({ key: record.id, label: record.code, value, col: 0, lit: false });
    const shares = sharesOf(record, mid);
    for (const share of shares) {
      links.push({ from: record.id, to: share.owner.key, value: value * share.fraction, lit: !share.owner.notYet && litMid(share.owner), percent: shares.length > 1 ? share.percent : undefined });
    }
  }
  const midOwners = [...mid, NOT_YET_OWNER];
  for (const owner of midOwners) {
    const value = items.reduce((sum, item) => sum + item.value * fractionFor(item.record, owner), 0);
    if (value <= 0) continue;
    const fill = ownerFill(owner, mid);
    nodes.push({ key: owner.key, label: owner.notYet ? "Not yet allocated" : owner.label, value, col: 1, fill, hatched: owner.notYet, lit: !owner.notYet && litMid(owner) });
  }
  if (threeColumns) {
    for (const removal of removals) {
      const value = items.reduce((sum, item) => sum + item.value * fractionFor(item.record, removal), 0);
      if (value <= 0) continue;
      const lit = focus.surface === "removal" ? removal.key === focus.owner.key : removal.batches.includes(focus.owner.key as never);
      nodes.push({ key: removal.key, label: removal.label, value, col: 2, fill: ownerFill(removal, removals), lit });
      for (const code of removal.batches) {
        const batch = batches.find((owner) => owner.key === code);
        if (!batch) continue;
        const batchValue = items.reduce((sum, item) => sum + item.value * fractionFor(item.record, batch), 0);
        if (batchValue > 0) links.push({ from: code, to: removal.key, value: batchValue, lit: lit && (focus.surface === "removal" || code === focus.owner.key) });
      }
    }
  }
  return { nodes, links };
}

function layout(nodes: Omit<FlowNode, "y" | "h">[], geometry: Geometry): { placed: FlowNode[]; scale: number } {
  const cols = [...new Set(nodes.map((node) => node.col))];
  const maxTotal = Math.max(...cols.map((col) => nodes.filter((node) => node.col === col).reduce((sum, node) => sum + node.value, 0)));
  const maxCount = Math.max(...cols.map((col) => nodes.filter((node) => node.col === col).length));
  const scale = (geometry.height - geometry.top * 2 - (maxCount - 1) * geometry.gap) / maxTotal;
  const placed: FlowNode[] = [];
  for (const col of cols) {
    let y = geometry.top;
    for (const node of nodes.filter((candidate) => candidate.col === col)) {
      const h = Math.max(2, node.value * scale);
      placed.push({ ...node, y, h });
      y += h + geometry.gap;
    }
  }
  return { placed, scale };
}

function bandPath(x0: number, y0: number, x1: number, y1: number, h: number): string {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h} Z`;
}

function FlowSvg({ stream, focus, fixture, geometry, threeColumns, className }: { stream: (typeof STREAMS)[number]; focus: Focus; fixture: RemovalFixture; geometry: Omit<Geometry, "height">; threeColumns: boolean; className?: string }) {
  const { nodes: raw, links } = build(stream, focus, fixture, threeColumns);
  const count = raw.filter((node) => node.col === 0).length;
  const height = Math.max(MIN_HEIGHT, count * PX_PER_NODE);
  const g: Geometry = { ...geometry, height };
  const { placed: nodes, scale } = layout(raw, g);
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const focusFill = ownerFill(focus.owner, focus.owners) ?? "var(--ink)";
  const drawn = links.map((link) => {
    const from = byKey.get(link.from);
    const to = byKey.get(link.to);
    if (!from || !to) return null;
    const h = Math.max(1, link.value * scale);
    const y0 = from.y + (outOffset.get(from.key) ?? 0);
    const y1 = to.y + (inOffset.get(to.key) ?? 0);
    outOffset.set(from.key, (outOffset.get(from.key) ?? 0) + h);
    inOffset.set(to.key, (inOffset.get(to.key) ?? 0) + h);
    return { link, from, to, h, y0, y1 };
  });
  const x = (col: number) => g.colX[col];
  const lastCol = threeColumns ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${g.width} ${height}`} className={cn("block h-auto w-full", className)} role="img" aria-label={`${stream.title} from records into ${threeColumns ? "credit batches and Removals" : focus.surface === "batch" ? "credit batches" : "Removals"}`}>
      <defs>
        <pattern id={`hatch-${stream.key}-${g.width}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--paper)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--clr-dark-purple-40)" strokeWidth="1.5" />
        </pattern>
      </defs>
      {drawn.map((band, index) =>
        band ? (
          <path
            key={index}
            d={bandPath(x(band.from.col) + g.nodeW, band.y0, x(band.to.col), band.y1, band.h)}
            fill={band.link.lit ? focusFill : "var(--clr-dark-purple-10)"}
            fillOpacity={band.link.lit ? 0.55 : 1}
          />
        ) : null,
      )}
      {nodes.map((node) => (
        <rect
          key={node.key}
          x={x(node.col)}
          y={node.y}
          width={g.nodeW}
          height={node.h}
          fill={node.hatched ? `url(#hatch-${stream.key}-${g.width})` : node.col === 0 ? "var(--clr-dark-purple-40)" : node.fill}
          stroke={node.lit ? "var(--ink)" : "var(--clr-dark-purple-20)"}
          strokeWidth={node.lit ? 2 : 1}
        />
      ))}
      {nodes.map((node) => {
        const left = node.col === 0;
        const tx = left ? x(0) - LABEL_GAP : x(node.col) + g.nodeW + LABEL_GAP;
        const ty = node.y + node.h / 2;
        const strong = node.lit || node.col === lastCol;
        const value = g.showValues ? `  ${formatValue(node.value, stream.unit)}` : "";
        // Labels over bands sit on a paper chip so the band never strikes through the text.
        const chipW = (node.label.length + value.length) * g.labelSize * CHAR_EM + LABEL_PAD * 2;
        return (
          <g key={`label-${node.key}`}>
            {!left && <rect x={tx - LABEL_PAD} y={ty - g.labelSize * 0.8} width={chipW} height={g.labelSize * 1.6} fill="var(--paper)" fillOpacity={0.92} />}
            <text x={tx} y={ty} textAnchor={left ? "end" : "start"} dominantBaseline="middle" fontSize={g.labelSize} fill="var(--ink)">
              <tspan fontWeight={node.lit ? 600 : 400}>{node.label}</tspan>
              {value && <tspan fill="var(--color-text-secondary)" fontWeight={strong ? 500 : 400}>{value}</tspan>}
            </text>
          </g>
        );
      })}
      {drawn.map((band, index) =>
        band && band.link.lit && band.link.percent != null && band.from.col === 0 ? (
          <text key={`pct-${index}`} x={x(0) + g.nodeW + 4} y={band.y0 + band.h / 2} dominantBaseline="middle" fontSize={g.labelSize - 1} fontWeight={600} fill="var(--ink)" {...HALO}>
            {band.link.percent}%
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Under the chart: the lit bands as text, so the numbers read without the picture. */
function CarriedList({ stream, focus }: { stream: (typeof STREAMS)[number]; focus: Focus }) {
  const rows = RECORDS.map((record) => ({ record, value: stream.pick(record), fraction: fractionFor(record, focus.owner) })).filter(
    (row): row is { record: SourceRecord; value: number; fraction: number } => row.value != null && row.value > 0 && row.fraction > 0,
  );
  const total = rows.reduce((sum, row) => sum + row.value * row.fraction, 0);
  return (
    <div className="flex flex-col gap-6 px-16 pb-16">
      <span className="body-small">
        {focus.owner.label} carries <span className="font-medium tabular-nums">{formatValue(total, stream.unit)}</span> {rows.length === 1 ? "from 1 record" : `from ${rows.length} records`}
      </span>
      <ul className={cn("flex flex-wrap gap-x-16 gap-y-2 body-caption tabular-nums", MUTED)}>
        {rows.map((row) => {
          const percent = sharesOf(row.record, focus.owners).find((share) => share.owner.key === focus.owner.key)?.percent ?? 0;
          return (
            <li key={row.record.id} className="whitespace-nowrap">
              {row.record.code} {percent}%, {formatValue(row.value * row.fraction, stream.unit)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function VariantD({ focus, fixture }: { focus: Focus; fixture: RemovalFixture }) {
  const [streamKey, setStreamKey] = useState<StreamKey>("feedstock");
  const stream = STREAMS.find((candidate) => candidate.key === streamKey) ?? STREAMS[0];
  // The sheet is narrower than the page: two columns there too.
  const wide = focus.surface === "batch";
  return (
    <section aria-labelledby="allocation-d" className="flex min-w-0 flex-col gap-16">
      <span className="inline-flex items-center gap-6">
        <h2 id="allocation-d" className="title-heading-3">Allocation</h2>
        <ExplanationInfo
          title="Allocation"
          hint="Each band is the part of a record that flows into a credit batch, then into the Removal that holds it. Hatched is still in the bin. Band widths are the quantity itself, so every record is drawn whole and only once."
        />
      </span>
      <div className={cn(PANEL, "flex min-w-0 flex-col gap-12")}>
        <div className="px-16 pt-16">
          <SegmentedControl
            legend="Quantity"
            options={STREAMS.map((candidate) => ({ value: candidate.key, label: candidate.label }))}
            value={streamKey}
            onValueChange={(value) => setStreamKey(value as StreamKey)}
            className="max-sm:grid-flow-row max-sm:grid-cols-2"
          />
        </div>
        <div className="px-16">
          {wide ? (
            <>
              <FlowSvg className="hidden md:block" stream={stream} focus={focus} fixture={fixture} threeColumns geometry={{ ...DESKTOP, colX: DESKTOP.colX3 }} />
              <FlowSvg className="md:hidden" stream={stream} focus={focus} fixture={fixture} threeColumns={false} geometry={PHONE} />
            </>
          ) : (
            <>
              <FlowSvg className="hidden sm:block" stream={stream} focus={focus} fixture={fixture} threeColumns geometry={{ ...DESKTOP, width: 560, colX: [80, 290, 450], showValues: false }} />
              <FlowSvg className="sm:hidden" stream={stream} focus={focus} fixture={fixture} threeColumns={false} geometry={PHONE} />
            </>
          )}
        </div>
        <CarriedList stream={stream} focus={focus} />
      </div>
    </section>
  );
}
