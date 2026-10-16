"use client";

/**
 * PROTOTYPE (throwaway): the credit batch timeline. Quiet tinted bars with a
 * state edge, one row per feedstock, and a dashed "+" slot in every gap and
 * after the last batch that proposes the window of a new credit batch.
 */
import { useState, type ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateRange } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { CountBadge } from "../prototype-batch-page/prototype-parts";
import { FEEDSTOCKS, newBatchSlots, YEARS, type BatchState, type NewBatchSlot, type StubBatch } from "./list-model";
import { MUTED, PANEL, tons } from "./list-parts";
import {
  BarLink,
  batchesIn,
  MonthAxis,
  MonthGrid,
  place,
  StateLegend,
  STATE_TONE,
  TodayLine,
  todayPct,
  type Spot,
  YearSummary,
  YearSwitcher,
} from "./timeline-core";

/** Below this share of the year (about 18 days) a bar has no room for text. */
const NARROW_PCT = 5;
const LABEL_PX = 128;
const MIN_TRACK_PX = 880;
const LABEL_COL = "grid-cols-[128px_minmax(0,1fr)]";
const LABEL_OFFSET = "left-[128px]";

const EDGE: Record<BatchState, string> = {
  blocking: "border-[var(--st-bad)]",
  ready: "border-[var(--st-wait)]",
  submitted: "border-[var(--st-run)]",
  issued: "border-[var(--st-ok)]",
};

/** Opens a scroll box with today in the middle, when the box scrolls and the year holds today. */
function centerOnToday(year: number) {
  return (box: HTMLDivElement | null) => {
    const pct = todayPct(year);
    if (!box || pct == null || box.scrollWidth <= box.clientWidth) return;
    const x = LABEL_PX + (pct / 100) * (box.scrollWidth - LABEL_PX);
    box.scrollLeft = x - box.clientWidth / 2;
  };
}

function Frame({ year, onYear, children }: { year: number; onYear: (year: number) => void; children: ReactNode }) {
  return (
    <section className={cn(PANEL, "flex min-w-0 flex-col gap-20 p-20 sm:p-24")} aria-label="Credit batches over time">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div className="flex flex-col gap-2">
          <YearSwitcher year={year} onChange={onYear} />
          <span className="pl-8">
            <YearSummary year={year} />
          </span>
        </div>
        <StateLegend />
      </div>
      {/* Scrolls inside the panel on narrow screens; relative keeps sr-only text inside the scroll box. */}
      <div ref={centerOnToday(year)} className="relative -mx-20 overflow-x-auto px-20 sm:mx-0 sm:px-0">
        {children}
      </div>
    </section>
  );
}

function FeedstockLabel({ feedstock, year }: { feedstock: string; year: number }) {
  const rows = batchesIn(year, feedstock);
  const applied = rows.reduce((sum, batch) => sum + batch.applied, 0);
  return (
    <div className="flex min-w-0 flex-col justify-center gap-2 py-10 pr-12">
      <span className="body-small font-medium">{feedstock}</span>
      <span className={cn("body-caption tabular-nums", MUTED)}>{rows.length > 0 ? tons(applied) : "No batches"}</span>
    </div>
  );
}

function CutMark({ spot }: { spot: Spot }) {
  return spot.cutStart ? <CaretLeftIcon size={12} className="shrink-0" aria-hidden /> : <CaretRightIcon size={12} className="shrink-0" aria-hidden />;
}

function QuietBar({ batch, spot }: { batch: StubBatch; spot: Spot }) {
  const narrow = spot.width < NARROW_PCT;
  return (
    <span className="absolute inset-y-10 left-[1px] right-[1px]">
      <span
        className={cn(
          "absolute inset-0 flex items-center gap-4 overflow-hidden border-l-[3px] pr-4 group-hover:brightness-95",
          narrow ? "justify-center pl-0" : "pl-6",
          STATE_TONE[batch.state].tint,
          EDGE[batch.state],
        )}
      >
        {narrow ? (
          <CutMark spot={spot} />
        ) : (
          <>
            {spot.cutStart && <CutMark spot={{ ...spot, cutEnd: false }} />}
            {/* Every bar here is a credit batch, so the shared "CB-" prefix is dropped; hover and the link label carry the full code. */}
            <span className="truncate body-caption font-medium tabular-nums">{batch.code.replace(/^CB-/, "")}</span>
            {spot.cutEnd && (
              <span className="ml-auto">
                <CutMark spot={{ ...spot, cutStart: false }} />
              </span>
            )}
          </>
        )}
      </span>
      {/* The count sits on the corner so the code keeps the bar's width. */}
      {batch.state === "blocking" && (
        <span className="absolute -top-8 -right-4 z-10">
          <CountBadge count={batch.blocking} blocking label="" />
        </span>
      )}
    </span>
  );
}

/** A dashed slot over the proposed window of a new credit batch. Always visible, so touch can reach it. */
function NewBatchSlotButton({ slot, spot, onPick }: { slot: NewBatchSlot; spot: Spot; onPick: (slot: NewBatchSlot) => void }) {
  const label = `New credit batch, ${formatDateRange(slot.start, slot.end)}`;
  return (
    <li className="absolute inset-y-0" style={{ left: `${spot.left}%`, width: `${spot.width}%` }}>
      <Tooltip content={label}>
        <button
          type="button"
          aria-label={label}
          onClick={() => onPick(slot)}
          className="absolute inset-x-[2px] inset-y-10 flex items-center justify-center border border-dashed border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)] outline-offset-2 hover:border-[var(--ink)] hover:bg-[var(--color-surface-medium)] hover:text-[var(--color-text-primary)] focus-visible:border-[var(--ink)] focus-visible:text-[var(--color-text-primary)]"
        >
          <PlusIcon size={16} aria-hidden />
        </button>
      </Tooltip>
    </li>
  );
}

function Rows({ year, onPick }: { year: number; onPick: (slot: NewBatchSlot) => void }) {
  return (
    <div className="relative" style={{ minWidth: MIN_TRACK_PX }}>
      <div className={cn("grid", LABEL_COL)}>
        <span />
        <MonthAxis year={year} className="h-24" />
      </div>
      {FEEDSTOCKS.map((feedstock) => (
        <div key={feedstock} className={cn("grid border-t border-[var(--color-border-tertiary)]", LABEL_COL)}>
          <FeedstockLabel feedstock={feedstock} year={year} />
          <ul className="relative h-[56px]" aria-label={`${feedstock} credit batches in ${year}`}>
            <MonthGrid year={year} />
            {batchesIn(year, feedstock).map((batch) => {
              const spot = place(batch, year)!;
              return (
                <li key={batch.code}>
                  <BarLink batch={batch} spot={spot} className="group">
                    <QuietBar batch={batch} spot={spot} />
                  </BarLink>
                </li>
              );
            })}
            {newBatchSlots(feedstock).map((slot) => {
              const spot = place(slot, year);
              return spot ? <NewBatchSlotButton key={slot.start} slot={slot} spot={spot} onPick={onPick} /> : null;
            })}
          </ul>
        </div>
      ))}
      <div className={cn("pointer-events-none absolute top-24 right-0 bottom-0", LABEL_OFFSET)}>
        <TodayLine year={year} />
      </div>
    </div>
  );
}

export function QuietTimeline({ onPick }: { onPick: (slot: NewBatchSlot) => void }) {
  const [year, setYear] = useState(YEARS[YEARS.length - 1]);
  return (
    <Frame year={year} onYear={setYear}>
      <Rows year={year} onPick={onPick} />
    </Frame>
  );
}
