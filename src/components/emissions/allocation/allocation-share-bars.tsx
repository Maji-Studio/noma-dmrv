/**
 * The Allocation Flow view, "Share bars": one row per quantity, all at once.
 * Each row is a 100% bar split by who carries it (this page lit, other
 * batches or Removals quiet, Not yet allocated hatched) with this page's
 * figure and share at the right. A row opens its records in place.
 */
"use client";

import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { HATCH_BACKGROUND, LIT_FILL, LIT_INK, START_FILL, START_STROKE } from "@/components/ui/chart-tokens";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import type { AllocationRecord, EmissionAllocation } from "@/types/emission-allocation";
import { formatValue } from "./allocation-format";
import { HintSummary } from "./allocation-hint";
import { NOT_YET_LABEL, batchCodesOf, type Focus } from "./allocation-model";
import { FAINT, MUTED } from "./allocation-parts";
import { RecordList } from "./allocation-record-list";
import { hintPhrases, streamSummary, type Slice, type StreamSummary } from "./allocation-share-summary";
import { visibleStreams, type Stream, type StreamKey } from "./allocation-streams";

const LIT_BG = "color-mix(in srgb, var(--acc-dist) 18%, var(--paper))";
const WIDE_FROM_PX = 720;
const LABEL_COL_PX = 176;
const FIGURE_COL_PX = 176;
const COL_GAP_PX = 16;
const BAR_H = "h-28";
const SEGMENT_GAP_PX = 2;
/** Rough width of one caption character, to decide whether a segment label fits inside it. */
const CHAR_PX = 7;
const LABEL_PAD_PX = 16;
const CARET_PX = 14;
const LIT_BORDER_PX = 1.5;
const QUIET_BORDER_PX = 1;

function sliceName(slice: Slice): string {
  return slice.owner.notYet ? NOT_YET_LABEL : slice.owner.label;
}

function sliceText(slice: Slice): string {
  return `${sliceName(slice)} ${slice.percent}%`;
}

/** Whether a segment is wide enough to carry its own label; otherwise the label moves under the bar. */
function labelFits(slice: Slice, summary: StreamSummary, barPx: number): boolean {
  const usable = barPx - SEGMENT_GAP_PX * Math.max(0, summary.slices.length - 1);
  return (usable * slice.value) / summary.total >= sliceText(slice).length * CHAR_PX + LABEL_PAD_PX;
}

function ShareBar({ summary, focus, barPx }: { summary: StreamSummary; focus: Focus; barPx: number }) {
  return (
    <span className={cn("flex w-full min-w-0", BAR_H)} style={{ gap: SEGMENT_GAP_PX }} aria-hidden>
      {summary.slices.map((slice) => {
        const mine = slice.owner.key === focus.owner.key;
        const fits = labelFits(slice, summary, barPx);
        return (
          <span
            key={slice.owner.key}
            className={cn("flex min-w-[2px] items-center overflow-hidden border", fits && "px-6")}
            style={{
              // Shares, not raw quantities: flex-grow factors summing below 1 leave the bar part empty.
              flexGrow: slice.value / summary.total,
              flexBasis: 0,
              borderColor: mine ? LIT_FILL : START_STROKE,
              borderWidth: mine ? LIT_BORDER_PX : QUIET_BORDER_PX,
              background: mine ? LIT_BG : slice.owner.notYet ? undefined : START_FILL,
              ...(slice.owner.notYet ? HATCH_BACKGROUND : {}),
            }}
          >
            {fits && (
              <span className={cn("truncate body-caption", mine && "font-medium", slice.owner.notYet && "bg-[var(--paper)] px-2")} style={{ color: mine ? LIT_INK : "var(--color-text-primary)" }}>
                {/* The page's own share is the figure at the right; the bar names it only. */}
                <span className={cn(!slice.owner.notYet && "font-mono")}>{sliceName(slice)}</span>
                {!mine && ` ${slice.percent}%`}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Labels that do not fit their segment. The page's own share is the figure at the right, so it is left out. */
function hiddenLabels(summary: StreamSummary, focus: Focus, barPx: number): string[] {
  return summary.slices.filter((slice) => slice.owner.key !== focus.owner.key && !labelFits(slice, summary, barPx)).map(sliceText);
}

function ShareRow({ stream, streamRecords, summary, focus, codes, wide, width, open, onToggle }: {
  stream: Stream;
  /** Every record in the stream, figure or not: a partly used delivery may have no t·km yet, and its hint still counts. */
  streamRecords: AllocationRecord[];
  summary: StreamSummary;
  focus: Focus;
  codes: ReadonlyMap<string, string>;
  wide: boolean;
  width: number;
  open: boolean;
  onToggle: () => void;
}) {
  const barPx = wide ? width - LABEL_COL_PX - FIGURE_COL_PX - 2 * COL_GAP_PX : width;
  const records = summary.items.map((item) => item.record);
  const empty = summary.items.length === 0;
  const hidden = empty ? [] : hiddenLabels(summary, focus, barPx);
  const figure = empty ? null : summary.mineMissing ? MISSING_VALUE.notRecorded : `${formatValue(summary.mine, stream.unit)} · ${summary.minePercent}%`;
  const notes = [
    ...(hidden.length ? [hidden.join(", ")] : []),
    ...(summary.undrawn ? [`${summary.undrawn} with no recorded ${stream.noun}`] : []),
  ];
  const label = (
    <span className="inline-flex min-w-0 items-center gap-6">
      {!empty && <CaretRightIcon size={CARET_PX} aria-hidden className={cn("shrink-0 transition-transform", FAINT, open && "rotate-90")} />}
      <span className="body-small font-medium">{stream.label}</span>
    </span>
  );
  const bar = empty ? <span className={cn("body-small", MUTED)}>{stream.emptyHint}</span> : <ShareBar summary={summary} focus={focus} barPx={barPx} />;
  const figureNode = figure && <span className="whitespace-nowrap text-right body-small font-medium tabular-nums">{figure}</span>;
  const extra = (
    <>
      {notes.length > 0 && <span className={cn("block body-caption", MUTED)}>{notes.join(". ")}</span>}
      <HintSummary records={streamRecords} focus={focus} codes={codes} />
    </>
  );
  const content = wide ? (
    <span className="grid w-full items-center" style={{ gridTemplateColumns: `${LABEL_COL_PX}px 1fr ${FIGURE_COL_PX}px`, columnGap: COL_GAP_PX }}>
      {label}
      <span className="flex min-w-0 flex-col gap-4">
        {bar}
        {extra}
      </span>
      <span className="justify-self-end">{figureNode}</span>
    </span>
  ) : (
    <span className="flex w-full min-w-0 flex-col gap-6">
      <span className="flex items-center justify-between gap-12">
        {label}
        {figureNode}
      </span>
      {bar}
      {extra}
    </span>
  );
  return (
    <div className="flex min-w-0 flex-col [&+&]:[border-top:var(--row-divider)]" data-share-row={stream.key}>
      {empty ? (
        <div className="flex min-h-44 items-center py-12">{content}</div>
      ) : (
        <button type="button" aria-expanded={open} onClick={onToggle} aria-label={[`${stream.label}: ${figure}`, summary.slices.map(sliceText).join(", "), ...notes.slice(hidden.length ? 1 : 0), ...hintPhrases(streamRecords, focus, codes)].join(". ")} className="flex min-h-44 w-full cursor-pointer items-center py-12 text-left outline-none hover:bg-[var(--row-hover-bg-solid)] focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-[var(--color-interaction)]">
          {content}
        </button>
      )}
      {open && !empty && (
        <div className="pb-16" style={wide ? { paddingLeft: LABEL_COL_PX + COL_GAP_PX } : undefined}>
          <RecordList records={records} stream={stream} focus={focus} codes={codes} />
        </div>
      )}
    </div>
  );
}

export function ShareBars({ allocation, focus }: { allocation: EmissionAllocation; focus: Focus }) {
  const [open, setOpen] = useState<ReadonlySet<StreamKey>>(new Set());
  const [width, measure] = useMeasuredWidth();
  const codes = batchCodesOf(allocation);
  const wide = width >= WIDE_FROM_PX;
  const toggle = (key: StreamKey) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div data-testid="allocation-share-bars" className="flex min-w-0 flex-col border border-[var(--color-border-secondary)] bg-[var(--paper)] px-16 py-4 sm:px-24">
      <div ref={measure} className="flex w-full min-w-0 flex-col">
        {visibleStreams(allocation.records).map((stream) => (
          <ShareRow
            key={stream.key}
            stream={stream}
            streamRecords={allocation.records.filter(stream.has)}
            summary={streamSummary(stream, allocation.records, focus)}
            focus={focus}
            codes={codes}
            wide={wide}
            width={width}
            open={open.has(stream.key)}
            onToggle={() => toggle(stream.key)}
          />
        ))}
      </div>
    </div>
  );
}
