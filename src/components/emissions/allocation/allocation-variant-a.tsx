/**
 * PROTOTYPE ONLY. Variant A, "Grouped flow": the Flow view's quantity tabs and
 * two-column Sankey, but the left column holds groups of records that go to
 * the same place ("32 deliveries" all to CB-26-001), so the chart stays a
 * bounded height whatever the record count. A group or an owner lists its
 * records under the chart, the first three, then "Show all N".
 */
"use client";

import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr";
import { useId, useState } from "react";
import { HATCH_STROKE, LIT_FILL, LIT_INK, START_FILL, START_STROKE } from "@/components/ui/chart-tokens";
import { EmptyState } from "@/components/ui/empty-state";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import { formatDateRange } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import type { AllocationRecord, EmissionAllocation } from "@/types/emission-allocation";
import { STREAMS, bandPath, firstStreamWithData, visibleStreams, type StreamKey } from "./allocation-flow-graph";
import { formatDay, formatValue } from "./allocation-format";
import { allOwners, batchCodesOf, feedstockHint, fractionFor, sharesOf, type Focus, type Owner } from "./allocation-model";
import { ModeSwitch, MUTED } from "./allocation-parts";
import { HintSummary, LIT_BG, QUIET_BORDER, RecordList, groupLabel, streamSummary } from "./allocation-variant-shared";

const EMPTY_ICON_PX = 32;
/** Groups beyond this fold into one "N other records" group, so the column stays short. */
const MAX_GROUPS = 6;
const LANE_FROM_PX = 640;
/** Below this panel width the quantity tabs wrap into two columns, as on a phone. */
const TABS_ROW_FROM_PX = 720;
const LANE_W = 168;
const LANE_GAP = 12;
const TARGET_H_WIDE = 260;
const TARGET_H_NARROW = 220;
const MIN_NODE_H = 44;
const GAP = 12;
const MAX_BLOCK_W = 168;
const MIN_BLOCK_W = 112;
const MIN_BAND_W = 40;
const PAD_Y = 4;
const STROKE = 1.25;
const LIT_STROKE = 1.5;
const HATCH_CELL = 6;
const QUIET_BAND_STROKE_W = 0.75;
const LIT_BAND_OPACITY = 0.5;

interface Group {
  key: string;
  records: AllocationRecord[];
  value: number;
  /** Owner key to the part of this group's figure it carries. */
  parts: Map<string, number>;
}

interface Node {
  key: string;
  col: 0 | 1;
  value: number;
  group?: Group;
  owner?: Owner;
  percent?: number;
  x: number;
  y: number;
  h: number;
}

/** Records grouped by the set of owners they go to, in column order; splits after whole ones. */
function groupItems(items: { record: AllocationRecord; value: number }[], focus: Focus): Group[] {
  const owners = allOwners(focus);
  const order = new Map(owners.map((owner, index) => [owner.key, index]));
  const bySignature = new Map<string, Group>();
  for (const { record, value } of items) {
    const keys = sharesOf(record, owners).map((share) => share.owner.key);
    const signature = keys.join("|");
    const group = bySignature.get(signature) ?? { key: `group:${signature}`, records: [], value: 0, parts: new Map<string, number>() };
    group.records.push(record);
    group.value += value;
    for (const owner of owners) {
      const part = value * fractionFor(record, owner);
      if (part > 0) group.parts.set(owner.key, (group.parts.get(owner.key) ?? 0) + part);
    }
    bySignature.set(signature, group);
  }
  const rank = (group: Group) => Math.min(...[...group.parts.keys()].map((key) => order.get(key) ?? owners.length));
  const sorted = [...bySignature.values()].sort((a, b) => rank(a) - rank(b) || a.parts.size - b.parts.size);
  if (sorted.length <= MAX_GROUPS) return sorted;
  const kept = sorted.slice(0, MAX_GROUPS - 1);
  const rest = sorted.slice(MAX_GROUPS - 1);
  const merged: Group = { key: "group:rest", records: rest.flatMap((group) => group.records), value: 0, parts: new Map() };
  for (const group of rest) {
    merged.value += group.value;
    for (const [key, part] of group.parts) merged.parts.set(key, (merged.parts.get(key) ?? 0) + part);
  }
  return [...kept, merged];
}

function dateSpan(records: AllocationRecord[]): string {
  const days = records.map((record) => record.date).sort();
  return days[0] === days[days.length - 1] ? formatDay(days[0]) : formatDateRange(days[0], days[days.length - 1]);
}

function layout(groups: Group[], slices: { owner: Owner; value: number; percent: number }[], width: number) {
  const lane = width >= LANE_FROM_PX ? LANE_W + LANE_GAP : 0;
  const avail = width - lane;
  const blockW = Math.max(MIN_BLOCK_W, Math.min(MAX_BLOCK_W, Math.floor((avail - MIN_BAND_W) / 2)));
  const colX = [lane, width - blockW];
  const cols: Omit<Node, "x" | "y" | "h">[][] = [
    groups.map((group) => ({ key: group.key, col: 0, value: group.value, group })),
    slices.map((slice) => ({ key: slice.owner.key, col: 1, value: slice.value, owner: slice.owner, percent: slice.percent })),
  ];
  const target = lane ? TARGET_H_WIDE : TARGET_H_NARROW;
  const totals = cols.map((nodes) => nodes.reduce((sum, node) => sum + node.value, 0));
  const scale = Math.min(...cols.map((nodes, index) => (nodes.length && totals[index] > 0 ? (target - (nodes.length - 1) * GAP) / totals[index] : Infinity)));
  const heightOf = (value: number) => Math.max(value * scale, MIN_NODE_H);
  const colHeight = (nodes: { value: number }[]) => nodes.reduce((sum, node) => sum + heightOf(node.value), 0) + Math.max(0, nodes.length - 1) * GAP;
  const height = Math.max(...cols.map(colHeight)) + PAD_Y * 2;
  const placed: Node[] = [];
  cols.forEach((nodes, col) => {
    let y = PAD_Y + (height - PAD_Y * 2 - colHeight(nodes)) / 2;
    for (const node of nodes) {
      const h = heightOf(node.value);
      placed.push({ ...node, x: colX[col], y, h });
      y += h + GAP;
    }
  });
  return { placed, height, blockW, lane };
}

function GroupedChart({ groups, slices, unit, focusKey, activeKey, onHover, onToggle, focus, codes }: {
  groups: Group[];
  slices: { owner: Owner; value: number; percent: number }[];
  unit: (typeof STREAMS)[number]["unit"];
  focusKey: string;
  activeKey: string | null;
  onHover: (key: string | null) => void;
  onToggle: (key: string) => void;
  focus: Focus;
  codes: ReadonlyMap<string, string>;
}) {
  const hatchId = `alloc-a-hatch-${useId().replace(/:/g, "")}`;
  const [width, measure] = useMeasuredWidth();
  const { placed, height, blockW, lane } = layout(groups, slices, width);
  const byKey = new Map(placed.map((node) => [node.key, node]));
  const outAt = new Map<string, number>();
  const inAt = new Map<string, number>();
  const bands = placed
    .filter((node) => node.col === 0 && node.group)
    .flatMap((from) =>
      [...from.group!.parts.entries()].flatMap(([ownerKey, part]) => {
        const to = byKey.get(ownerKey);
        if (!to) return [];
        const h0 = (part / from.value) * from.h;
        const h1 = (part / to.value) * to.h;
        const y0 = from.y + (outAt.get(from.key) ?? 0);
        const y1 = to.y + (inAt.get(to.key) ?? 0);
        outAt.set(from.key, (outAt.get(from.key) ?? 0) + h0);
        inAt.set(to.key, (inAt.get(to.key) ?? 0) + h1);
        return [{ key: `${from.key}>${to.key}`, from, to, h0, h1, y0, y1, lit: activeKey === from.key || activeKey === to.key }];
      }),
    );
  const litNodes = new Set(bands.filter((band) => band.lit).flatMap((band) => [band.from.key, band.to.key]));
  const isNotYet = (node: Node) => !!node.owner?.notYet;
  const nodeLabel = (node: Node) => (node.group ? groupLabel(node.group.records) : node.owner?.notYet ? "Not yet allocated" : node.owner?.label ?? "");

  return (
    <div ref={measure} className="w-full min-w-0">
      <div className="relative" style={{ width, height }} data-testid="allocation-variant-a-chart">
        <svg width={width} height={height} aria-hidden className="absolute inset-0 overflow-visible">
          <defs>
            <pattern id={hatchId} width={HATCH_CELL} height={HATCH_CELL} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={HATCH_CELL} height={HATCH_CELL} fill="var(--paper)" />
              <line x1="0" y1="0" x2="0" y2={HATCH_CELL} stroke={HATCH_STROKE} strokeWidth={STROKE} />
            </pattern>
          </defs>
          {[false, true].map((litPass) =>
            bands
              .filter((band) => band.lit === litPass)
              .map((band) => (
                <path
                  key={band.key}
                  d={bandPath(band.from.x + blockW, band.y0, band.h0, band.to.x, band.y1, band.h1)}
                  fill={litPass ? LIT_FILL : "var(--clr-dark-purple-10)"}
                  fillOpacity={litPass ? LIT_BAND_OPACITY : 1}
                  stroke={litPass ? LIT_FILL : QUIET_BORDER}
                  strokeWidth={QUIET_BAND_STROKE_W}
                />
              )),
          )}
          {placed.map((node) => {
            const lit = litNodes.has(node.key) && node.col === 1 && !isNotYet(node);
            return (
              <rect
                key={node.key}
                x={node.x}
                y={node.y}
                width={blockW}
                height={node.h}
                fill={isNotYet(node) ? `url(#${hatchId})` : lit ? LIT_BG : START_FILL}
                stroke={node.key === focusKey ? "var(--ink)" : lit || activeKey === node.key ? LIT_FILL : START_STROKE}
                strokeWidth={node.key === focusKey || lit || activeKey === node.key ? LIT_STROKE : STROKE}
              />
            );
          })}
        </svg>

        {/* Wide: the group's dates and hint in a lane to its left. */}
        {lane > 0 &&
          placed
            .filter((node) => node.group)
            .map((node) => (
              <div
                key={`lane-${node.key}`}
                className="pointer-events-none absolute flex flex-col items-end justify-center text-right"
                style={{ left: 0, width: LANE_W, top: node.y, height: node.h }}
              >
                <span className={cn("truncate body-caption", MUTED)}>{dateSpan(node.group!.records)}</span>
                <HintSummary records={node.group!.records} focus={focus} codes={codes} />
              </div>
            ))}

        {placed.map((node) => {
          const lit = litNodes.has(node.key) && node.col === 1 && !isNotYet(node);
          return (
            <div key={`label-${node.key}`} className="pointer-events-none absolute flex flex-col justify-center overflow-hidden px-8" style={{ left: node.x, top: node.y, width: blockW, height: node.h }}>
              <span className={cn("body-caption font-medium", isNotYet(node) ? "self-start bg-[var(--paper)] px-2" : "truncate", node.owner && !node.owner.notYet && "font-mono")} style={{ color: lit ? LIT_INK : "var(--color-text-primary)" }}>
                {nodeLabel(node)}
              </span>
              <span className={cn("truncate body-caption tabular-nums", isNotYet(node) && "self-start bg-[var(--paper)] px-2")} style={{ color: lit ? LIT_INK : "var(--color-text-secondary)" }}>
                {formatValue(node.value, unit)}
                {node.percent !== undefined && `, ${node.percent}%`}
              </span>
            </div>
          );
        })}

        {placed.map((node) => {
          const h = Math.max(MIN_NODE_H, node.h);
          return (
            <button
              key={`hit-${node.key}`}
              type="button"
              aria-label={`${nodeLabel(node)}: ${formatValue(node.value, unit)}`}
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

export function VariantA({ allocation, focus }: { allocation: EmissionAllocation; focus: Focus }) {
  const [chosen, setChosen] = useState<StreamKey | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [panelWidth, measurePanel] = useMeasuredWidth();
  const codes = batchCodesOf(allocation);
  const streams = visibleStreams(allocation.records);
  const hasStake = (record: AllocationRecord) => fractionFor(record, focus.owner) > 0 || feedstockHint(record, focus.owner, focus.owners, codes) !== null;
  const streamKey = chosen ?? firstStreamWithData(allocation.records, hasStake);
  const stream = STREAMS.find((candidate) => candidate.key === streamKey) ?? STREAMS[0];
  const summary = streamSummary(stream, allocation.records, focus);
  const groups = groupItems(summary.items, focus);
  const keys = new Set([...groups.map((group) => group.key), ...summary.slices.map((slice) => slice.owner.key)]);
  const pick = (key: string | null) => (key && keys.has(key) ? key : null);
  const activeKey = pick(hovered) ?? pick(pinned) ?? focus.owner.key;
  const activeGroup = groups.find((group) => group.key === activeKey);
  const activeOwner = activeGroup ? undefined : allOwners(focus).find((owner) => owner.key === activeKey) ?? focus.owner;
  const streamRecords = summary.items.map((item) => item.record);
  const ownerRecords = activeOwner
    ? streamRecords.filter((record) => fractionFor(record, activeOwner) > 0 || feedstockHint(record, activeOwner, focus.owners, codes)?.kind === "countedOn")
    : [];
  return (
    <div ref={measurePanel} data-allocation-variant="a" className="flex min-w-0 flex-col gap-20 border border-[var(--color-border-secondary)] bg-[var(--paper)] p-16 sm:p-24">
      <ModeSwitch
        legend="Quantity"
        options={streams.map((candidate) => ({ value: candidate.key, label: candidate.label }))}
        value={streamKey}
        onChange={(next) => {
          setChosen(next);
          setPinned(null);
        }}
        className={panelWidth < TABS_ROW_FROM_PX ? "w-full grid-flow-row grid-cols-2" : "w-max"}
      />
      {summary.items.length === 0 ? (
        <EmptyState padding="sm" icon={<ChartBarIcon size={EMPTY_ICON_PX} aria-hidden />} title={`No ${stream.label.toLowerCase()} figures recorded`} description={stream.emptyHint} />
      ) : (
        <GroupedChart
          groups={groups}
          slices={summary.slices}
          unit={stream.unit}
          focusKey={focus.owner.key}
          activeKey={activeKey}
          onHover={setHovered}
          onToggle={(key) => setPinned(pinned === key || key === focus.owner.key ? null : key)}
          focus={focus}
          codes={codes}
        />
      )}
      {summary.undrawn > 0 && (
        <p className={cn("body-caption", MUTED)}>
          {summary.undrawn} {summary.undrawn === 1 ? "record has" : "records have"} no recorded {stream.noun} and {summary.undrawn === 1 ? "is" : "are"} not drawn. The table lists {summary.undrawn === 1 ? "it" : "them"}.
        </p>
      )}
      {summary.items.length > 0 && (
        <div key={`${stream.key}-${activeKey}`} className="flex min-w-0 flex-col gap-8 border-t border-[var(--clr-dark-purple-10)] pt-16 lg:max-w-[720px]">
          {/* A group of one is its record: the row below names it. */}
          {activeGroup?.records.length !== 1 && <span className="flex min-w-0 flex-col">
            <span className={cn("body-medium font-medium", activeOwner && !activeOwner.notYet && "font-mono")}>
              {activeGroup ? groupLabel(activeGroup.records) : activeOwner?.notYet ? "Not yet allocated" : activeOwner?.label}
            </span>
            {activeGroup && <span className={cn("body-caption", MUTED)}>{dateSpan(activeGroup.records)}</span>}
          </span>}
          {activeGroup ? (
            <RecordList records={activeGroup.records} stream={stream} focus={focus} codes={codes} />
          ) : ownerRecords.length ? (
            <RecordList records={ownerRecords} stream={stream} focus={focus} codes={codes} owner={activeOwner} />
          ) : (
            <EmptyState padding="sm" icon={<ChartBarIcon size={EMPTY_ICON_PX} aria-hidden />} title={`${focus.owner.label} carries no ${stream.phrase}`} description="Pick another quantity above." />
          )}
        </div>
      )}
    </div>
  );
}
