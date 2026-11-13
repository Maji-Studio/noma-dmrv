/**
 * PROTOTYPE ONLY. Variant C, "Timeline": days run left to right across the
 * records' span, credit batch periods sit behind as quiet bands with their
 * codes, and each quantity has a lane. Every record is a thin bar at its day,
 * as tall as its figure (per lane), split by who carries it. A bar lists its
 * record under the chart; a lane label lists the lane's records.
 */
"use client";

import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr";
import { useId, useRef, useState } from "react";
import { HATCH_BACKGROUND, HATCH_STROKE, LIT_FILL, START_STROKE } from "@/components/ui/chart-tokens";
import { EmptyState } from "@/components/ui/empty-state";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import { cn } from "@/lib/utils";
import type { AllocationRecord, EmissionAllocation } from "@/types/emission-allocation";
import { visibleStreams, type Stream, type StreamKey } from "./allocation-flow-graph";
import { formatDay, formatValue, recordName } from "./allocation-format";
import { allOwners, batchCodesOf, fractionFor, type Focus } from "./allocation-model";
import { MUTED } from "./allocation-parts";
import { HintSummary, QUIET_BORDER, ROW_LABEL, RecordList, countLabel, streamSummary, type StreamSummary } from "./allocation-variant-shared";

const WIDE_FROM_PX = 720;
const EMPTY_ICON_PX = 32;
const LABEL_COL_PX = 208;
const HEADER_H = 24;
const LANE_H = 64;
const LANE_PAD = 8;
const AXIS_H = 24;
const MIN_PX_PER_DAY = 9;
const PAD_DAYS = 2;
const BAR_W = 6;
const BAR_GAP = 2;
const MIN_BAR_H = 3;
const HIT_MIN_W = 16;
const HIT_MAX_W = 44;
const HATCH_CELL = 4;
const MS_PER_DAY = 86_400_000;
const TICK_MIN_GAP_PX = 56;
const SCROLL_LEAD_PX = 16;
const SWATCH = "inline-block size-10 shrink-0 border";
const QUIET_FILL = "var(--clr-dark-purple-20)";

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY);
const dayString = (n: number) => new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
/** "Sep 1" from "Sep 1, 2026". */
const shortDay = (day: string) => formatDay(day).replace(/, \d{4}$/, "");

type Selection = { kind: "mark"; lane: StreamKey; recordId: string } | { kind: "lane"; lane: StreamKey } | null;

interface Scale {
  start: number;
  end: number;
  px: number;
  x: (day: string) => number;
}

function scaleFor(allocation: EmissionAllocation, streams: Stream[], plotPx: number): Scale | null {
  const days = streams.flatMap((stream) => allocation.records.filter((record) => (stream.pick(record) ?? 0) > 0).map((record) => dayNumber(record.date)));
  if (!days.length) return null;
  const start = Math.min(...days) - PAD_DAYS;
  const end = Math.max(...days) + PAD_DAYS + 1;
  const px = Math.max(plotPx, (end - start) * MIN_PX_PER_DAY);
  return { start, end, px, x: (day: string) => ((dayNumber(day) - start) / (end - start)) * px };
}

function BatchBands({ allocation, focus, scale }: { allocation: EmissionAllocation; focus: Focus; scale: Scale }) {
  const mine = new Set(focus.surface === "batch" ? [focus.owner.key] : focus.owner.batchIds ?? []);
  const clip = (n: number) => Math.min(Math.max(n, scale.start), scale.end);
  const bands = allocation.batches
    .map((batch) => {
      const from = clip(dayNumber(batch.startDate));
      const to = clip(dayNumber(batch.endDate) + 1);
      return { batch, x0: ((from - scale.start) / (scale.end - scale.start)) * scale.px, x1: ((to - scale.start) / (scale.end - scale.start)) * scale.px };
    })
    .filter((band) => band.x1 - band.x0 > 0);
  return (
    <>
      <svg aria-hidden width={scale.px} className="pointer-events-none absolute inset-y-0 left-0 h-full">
        {bands.map((band) => (
          <g key={band.batch.id}>
            <rect x={band.x0} y={0} width={band.x1 - band.x0} height="100%" fill={mine.has(band.batch.id) ? "var(--clr-dark-purple-5)" : "var(--clr-dark-purple-1)"} />
            <line x1={band.x0} x2={band.x0} y1={0} y2="100%" stroke={QUIET_BORDER} strokeDasharray="2 3" />
          </g>
        ))}
      </svg>
      <div className="relative" style={{ height: HEADER_H }}>
        {bands.map((band) => (
          <span
            key={band.batch.id}
            className={cn("absolute top-4 truncate pl-6 font-mono body-caption", mine.has(band.batch.id) ? "font-medium text-[var(--color-text-primary)]" : MUTED)}
            style={{ left: band.x0, width: band.x1 - band.x0 }}
          >
            {band.batch.code}
          </span>
        ))}
      </div>
    </>
  );
}

function Axis({ scale }: { scale: Scale }) {
  const ticks: string[] = [];
  for (let n = scale.start; n < scale.end; n += 1) {
    const day = dayString(n);
    if (day.endsWith("-01")) ticks.push(day);
  }
  // The first day too, unless a month start sits right next to it.
  const first = dayString(scale.start);
  if (!ticks.length || scale.x(ticks[0]) > TICK_MIN_GAP_PX) ticks.unshift(first);
  return (
    <div className="relative [border-top:var(--row-divider)]" style={{ height: AXIS_H }} aria-hidden>
      {ticks.map((day) => (
        <span key={day} className={cn("absolute top-4 pl-4 whitespace-nowrap body-caption tabular-nums", MUTED)} style={{ left: scale.x(day) }}>
          {shortDay(day)}
        </span>
      ))}
    </div>
  );
}

function LaneMarks({ stream, summary, focus, scale, selected, onHover, onSelect, hatchId }: {
  stream: Stream;
  summary: StreamSummary;
  focus: Focus;
  scale: Scale;
  selected: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  hatchId: string;
}) {
  const owners = allOwners(focus);
  // The page first (bottom), other owners, Not yet allocated on top.
  const stackOrder = [focus.owner, ...owners.filter((owner) => owner.key !== focus.owner.key)];
  const max = Math.max(...summary.items.map((item) => item.value));
  const inner = LANE_H - LANE_PAD * 2;
  const sameDay = new Map<string, number>();
  const slotPx = scale.px / (scale.end - scale.start);
  const marks = [...summary.items]
    .sort((a, b) => a.record.date.localeCompare(b.record.date))
    .map(({ record, value }) => {
      const index = sameDay.get(record.date) ?? 0;
      sameDay.set(record.date, index + 1);
      const x = scale.x(record.date) + slotPx / 2 - BAR_W / 2 + index * (BAR_W + BAR_GAP);
      const h = Math.max(MIN_BAR_H, (value / max) * inner);
      let top = LANE_H - LANE_PAD;
      const segments = stackOrder.flatMap((owner) => {
        const fraction = fractionFor(record, owner);
        if (fraction <= 0) return [];
        const sh = h * fraction;
        top -= sh;
        return [{ owner, y: top, h: sh }];
      });
      return { record, value, x, h, segments };
    });
  const hitW = Math.min(HIT_MAX_W, Math.max(HIT_MIN_W, slotPx));
  return (
    <div className="relative" style={{ height: LANE_H, width: scale.px }}>
      <svg aria-hidden width={scale.px} height={LANE_H} className="absolute inset-0">
        <line x1={0} x2={scale.px} y1={LANE_H - LANE_PAD} y2={LANE_H - LANE_PAD} stroke={QUIET_BORDER} />
        {marks.map((mark) => (
          <g key={mark.record.id}>
            {mark.segments.map((segment) => {
              const mine = segment.owner.key === focus.owner.key;
              return (
                <rect
                  key={segment.owner.key}
                  x={mark.x}
                  y={segment.y}
                  width={BAR_W}
                  height={segment.h}
                  fill={mine ? LIT_FILL : segment.owner.notYet ? `url(#${hatchId})` : QUIET_FILL}
                  stroke={segment.owner.notYet ? HATCH_STROKE : "none"}
                  strokeWidth={segment.owner.notYet ? 0.75 : 0}
                />
              );
            })}
            {selected === mark.record.id && <rect x={mark.x - 2} y={LANE_H - LANE_PAD - mark.h - 2} width={BAR_W + 4} height={mark.h + 4} fill="none" stroke="var(--ink)" strokeWidth={1.5} />}
          </g>
        ))}
      </svg>
      {marks.map((mark) => (
        <button
          key={`hit-${mark.record.id}`}
          type="button"
          aria-label={`${recordName(mark.record)}, ${formatDay(mark.record.date)}: ${formatValue(mark.value, stream.unit)}`}
          aria-pressed={selected === mark.record.id}
          className="absolute top-0 cursor-pointer bg-transparent outline-none focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-interaction)]"
          style={{ left: mark.x + BAR_W / 2 - hitW / 2, width: hitW, height: LANE_H }}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") onHover(mark.record.id);
          }}
          onPointerLeave={() => onHover(null)}
          onFocus={() => onHover(mark.record.id)}
          onBlur={() => onHover(null)}
          onClick={() => onSelect(mark.record.id)}
        />
      ))}
    </div>
  );
}

function LaneLabel({ stream, summary, focus, codes, active, onClick, inline }: {
  stream: Stream;
  summary: StreamSummary;
  focus: Focus;
  codes: ReadonlyMap<string, string>;
  active: boolean;
  onClick: () => void;
  inline: boolean;
}) {
  const empty = summary.items.length === 0;
  const figure = empty ? "No figures recorded" : `${formatValue(summary.mine, stream.unit)} · ${summary.minePercent}%`;
  const Tag = empty ? "div" : "button";
  return (
    <Tag
      {...(empty ? {} : { type: "button" as const, "aria-pressed": active, onClick })}
      className={cn(
        "flex w-full min-w-0 text-left", !empty && "cursor-pointer",
        "outline-none focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-interaction)]",
        inline ? "min-h-44 flex-wrap items-center justify-between gap-x-12 py-6" : "flex-col justify-center pr-12",
      )}
      style={inline ? undefined : { height: LANE_H }}
    >
      <span className={cn("body-small font-medium", active && "underline underline-offset-4")}>{ROW_LABEL[stream.key]}</span>
      <span className={cn("body-caption tabular-nums", empty ? MUTED : "text-[var(--color-text-primary)]")}>{figure}</span>
      <HintSummary records={summary.items.map((item) => item.record)} focus={focus} codes={codes} />
    </Tag>
  );
}

function Key({ focus, present }: { focus: Focus; present: { others: boolean; notYet: boolean } }) {
  return (
    <div className="flex flex-wrap items-center gap-x-16 gap-y-4 body-caption" aria-hidden>
      <span className="inline-flex items-center gap-6">
        <span className={SWATCH} style={{ background: LIT_FILL, borderColor: LIT_FILL }} />
        <span className="font-mono">{focus.owner.label}</span>
      </span>
      {present.others && (
        <span className="inline-flex items-center gap-6">
          <span className={SWATCH} style={{ background: QUIET_FILL, borderColor: QUIET_FILL }} />
          {focus.surface === "batch" ? "Other credit batches" : "Other Removals"}
        </span>
      )}
      {present.notYet && (
        <span className="inline-flex items-center gap-6">
          <span className={SWATCH} style={{ ...HATCH_BACKGROUND, borderColor: START_STROKE }} />
          Not yet allocated
        </span>
      )}
    </div>
  );
}

export function VariantC({ allocation, focus }: { allocation: EmissionAllocation; focus: Focus }) {
  const hatchId = `alloc-c-hatch-${useId().replace(/:/g, "")}`;
  const [selection, setSelection] = useState<Selection>(null);
  const [hovered, setHovered] = useState<{ lane: StreamKey; recordId: string } | null>(null);
  const [width, measure] = useMeasuredWidth();
  const codes = batchCodesOf(allocation);
  const wide = width >= WIDE_FROM_PX;
  const streams = visibleStreams(allocation.records);
  const summaries = new Map(streams.map((stream) => [stream.key, streamSummary(stream, allocation.records, focus)]));
  const scale = scaleFor(allocation, streams, wide ? width - LABEL_COL_PX : width);
  const shown: Selection = hovered ? { kind: "mark", ...hovered } : selection;
  const shownStream = shown ? streams.find((stream) => stream.key === shown.lane) : undefined;
  const shownSummary = shownStream ? summaries.get(shownStream.key) : undefined;
  const shownRecords: AllocationRecord[] = !shown || !shownSummary ? [] : shown.kind === "mark" ? shownSummary.items.filter((item) => item.record.id === shown.recordId).map((item) => item.record) : shownSummary.items.map((item) => item.record);
  const allSlices = [...summaries.values()].flatMap((summary) => summary.slices);
  const present = { others: allSlices.some((slice) => !slice.owner.notYet && slice.owner.key !== focus.owner.key), notYet: allSlices.some((slice) => slice.owner.notYet) };
  const selectMark = (lane: StreamKey, recordId: string) =>
    setSelection((current) => (current?.kind === "mark" && current.recordId === recordId && current.lane === lane ? null : { kind: "mark", lane, recordId }));
  const selectLane = (lane: StreamKey) => setSelection((current) => (current?.kind === "lane" && current.lane === lane ? null : { kind: "lane", lane }));

  // Phones scroll the chart, not the page: open it at the page's own batch period.
  const pageStart = allocation.batches.find((batch) => (focus.surface === "batch" ? batch.id === focus.owner.key : focus.owner.batchIds?.includes(batch.id)))?.startDate;
  const scrolled = useRef(false);
  const scrollToPage = (element: HTMLDivElement | null) => {
    if (!element || !scale || !pageStart || scrolled.current) return;
    element.scrollLeft = Math.max(0, scale.x(pageStart) - SCROLL_LEAD_PX);
    scrolled.current = true;
  };

  const lanes = scale
    ? streams.map((stream) => {
        const summary = summaries.get(stream.key)!;
        const label = <LaneLabel stream={stream} summary={summary} focus={focus} codes={codes} active={selection?.kind === "lane" && selection.lane === stream.key} onClick={() => selectLane(stream.key)} inline={!wide} />;
        return { stream, summary, label };
      })
    : [];

  return (
    <div data-allocation-variant="c" className="flex min-w-0 flex-col gap-16 border border-[var(--color-border-secondary)] bg-[var(--paper)] p-16 sm:p-24">
      <svg width={0} height={0} aria-hidden className="absolute">
        <defs>
          <pattern id={hatchId} width={HATCH_CELL} height={HATCH_CELL} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={HATCH_CELL} height={HATCH_CELL} fill="var(--paper)" />
            <line x1="0" y1="0" x2="0" y2={HATCH_CELL} stroke={HATCH_STROKE} strokeWidth={1} />
          </pattern>
        </defs>
      </svg>
      <div ref={measure} className="w-full min-w-0">
        {!scale ? (
          <EmptyState padding="sm" icon={<ChartBarIcon size={EMPTY_ICON_PX} aria-hidden />} title="No figures recorded" description="Feedstock deliveries, production runs, biochar deliveries and manual entries show up here once they have figures." />
        ) : (
          <div className="flex min-w-0 flex-col gap-12">
            <Key focus={focus} present={present} />
            <div className="flex min-w-0">
              {wide && (
                <div className="shrink-0" style={{ width: LABEL_COL_PX, paddingTop: HEADER_H }}>
                  {lanes.map((lane) => <div key={lane.stream.key}>{lane.label}</div>)}
                </div>
              )}
              <div ref={wide ? undefined : scrollToPage} className="min-w-0 flex-1 overflow-x-auto" data-testid="allocation-variant-c-scroll">
                <div className="relative" style={{ width: scale.px }}>
                  <BatchBands allocation={allocation} focus={focus} scale={scale} />
                  {lanes.map((lane) => (
                    <div key={lane.stream.key} className="relative">
                      {!wide && (
                        <div className="sticky left-0" style={{ width }}>
                          {lane.label}
                        </div>
                      )}
                      {lane.summary.items.length ? (
                        <LaneMarks
                          stream={lane.stream}
                          summary={lane.summary}
                          focus={focus}
                          scale={scale}
                          selected={shown?.kind === "mark" && shown.lane === lane.stream.key ? shown.recordId : null}
                          onHover={(id) => setHovered(id ? { lane: lane.stream.key, recordId: id } : null)}
                          onSelect={(id) => selectMark(lane.stream.key, id)}
                          hatchId={hatchId}
                        />
                      ) : (
                        <div style={{ height: wide ? LANE_H : 0 }} />
                      )}
                    </div>
                  ))}
                  <Axis scale={scale} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {shown && shownStream && shownRecords.length > 0 && (
        <div key={`${shown.kind}-${shown.lane}`} className="flex min-w-0 flex-col gap-8 border-t border-[var(--clr-dark-purple-10)] pt-16 lg:max-w-[720px]">
          {shown.kind === "lane" && (
            <span className="flex min-w-0 flex-col">
              <span className="body-medium font-medium">{ROW_LABEL[shownStream.key]}</span>
              <span className={cn("body-caption", MUTED)}>
                {countLabel(shownRecords)}
                {shownSummary?.undrawn ? `. ${shownSummary.undrawn} with no recorded ${shownStream.noun}` : ""}
              </span>
            </span>
          )}
          <RecordList records={shownRecords} stream={shownStream} focus={focus} codes={codes} />
        </div>
      )}
    </div>
  );
}
