"use client";

/**
 * PROTOTYPE (throwaway): three refinements of the credit batch timeline.
 * A "Quiet bars": flat tinted bars with a state edge, no boxes.
 * B "Thin track": one slim line per feedstock, batches as segments.
 * C "Bars and volume": quiet bars plus applied tonnes per month, stacked by state.
 */
import { useState, type ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { CountBadge } from "../prototype-batch-page/prototype-parts";
import { BATCHES, FEEDSTOCKS, STATE_ORDER, YEARS, type BatchState, type StubBatch } from "./list-model";
import { MUTED, PANEL, tons } from "./list-parts";
import {
  BarLink,
  batchesIn,
  dayOf,
  MONTH_LABELS,
  MonthAxis,
  MonthGrid,
  place,
  STATE_TONE,
  StateLegend,
  TodayLine,
  type Spot,
  YearSummary,
  YearSwitcher,
} from "./timeline-core";

/** Below this share of the year (about 18 days) a bar has no room for text. */
const NARROW_PCT = 5;
const LABEL_COL = "grid-cols-[128px_minmax(0,1fr)]";
const LABEL_OFFSET = "left-[128px]";

const EDGE: Record<BatchState, string> = {
  blocking: "border-[var(--st-bad)]",
  ready: "border-[var(--ink)]",
  submitted: "border-[var(--st-run)]",
  issued: "border-[var(--st-ok)]",
};

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
      <div className="relative -mx-20 overflow-x-auto px-20 sm:mx-0 sm:px-0">{children}</div>
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

/* ---------- A: Quiet bars ---------- */

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

function QuietRows({ year }: { year: number }) {
  return (
    <div className="relative min-w-[880px]">
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
          </ul>
        </div>
      ))}
      <div className={cn("pointer-events-none absolute top-24 right-0 bottom-0", LABEL_OFFSET)}>
        <TodayLine year={year} label={false} />
      </div>
    </div>
  );
}

export function QuietTimeline() {
  const [year, setYear] = useState(YEARS[YEARS.length - 1]);
  return (
    <Frame year={year} onYear={setYear}>
      <QuietRows year={year} />
    </Frame>
  );
}

/* ---------- B: Thin track ---------- */

function TrackSegment({ batch, spot }: { batch: StubBatch; spot: Spot }) {
  const narrow = spot.width < NARROW_PCT;
  return (
    <>
      {!narrow && (
        <span className="absolute top-8 left-[2px] right-[2px] flex items-center gap-4 overflow-hidden">
          <span className={cn("truncate body-caption tabular-nums group-hover:text-[var(--color-text-primary)]", batch.state === "blocking" || batch.state === "ready" ? "font-medium" : MUTED)}>
            {batch.code}
          </span>
          {batch.state === "blocking" && (
            <span className="shrink-0">
              <CountBadge count={batch.blocking} blocking label="" />
            </span>
          )}
        </span>
      )}
      <span className={cn("absolute top-[38px] left-[2px] right-[2px] h-6 transition-[height,top] group-hover:top-[36px] group-hover:h-10", STATE_TONE[batch.state].solid)} />
      {(spot.cutStart || spot.cutEnd) && (
        <span className={cn("absolute top-[50px]", spot.cutStart ? "left-0" : "right-0")}>
          <CutMark spot={spot} />
        </span>
      )}
    </>
  );
}

function TrackRows({ year }: { year: number }) {
  return (
    <div className="relative min-w-[880px]">
      <div className={cn("grid", LABEL_COL)}>
        <span />
        <MonthAxis year={year} className="h-24" />
      </div>
      {FEEDSTOCKS.map((feedstock) => (
        <div key={feedstock} className={cn("grid", LABEL_COL)}>
          <FeedstockLabel feedstock={feedstock} year={year} />
          <ul className="relative h-[72px]" aria-label={`${feedstock} credit batches in ${year}`}>
            <span className="absolute top-[40px] right-0 left-0 h-[2px] bg-[var(--color-border-tertiary)]" aria-hidden />
            {batchesIn(year, feedstock).map((batch) => {
              const spot = place(batch, year)!;
              return (
                <li key={batch.code}>
                  <BarLink batch={batch} spot={spot} className="group">
                    <TrackSegment batch={batch} spot={spot} />
                  </BarLink>
                </li>
              );
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

export function TrackTimeline() {
  const [year, setYear] = useState(YEARS[YEARS.length - 1]);
  return (
    <Frame year={year} onYear={setYear}>
      <TrackRows year={year} />
    </Frame>
  );
}

/* ---------- C: Bars and volume ---------- */

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const VOLUME_HEIGHT_PX = 96;

/** Applied tonnes per month and state; a batch that crosses months splits by days. */
function monthlyVolume(year: number): Record<BatchState, number>[] {
  const months = MONTH_LABELS.map(() => ({ blocking: 0, ready: 0, submitted: 0, issued: 0 }) as Record<BatchState, number>);
  for (const batch of BATCHES) {
    const start = dayOf(batch.start);
    const end = dayOf(batch.end) + 1;
    const length = end - start;
    for (let month = 0; month < 12; month += 1) {
      const from = Date.UTC(year, month, 1) / 86_400_000;
      const to = Date.UTC(year, month + 1, 1) / 86_400_000;
      const overlap = Math.min(end, to) - Math.max(start, from);
      if (overlap > 0) months[month][batch.state] += (batch.applied * overlap) / length;
    }
  }
  return months;
}

function VolumeChart({ year }: { year: number }) {
  const months = monthlyVolume(year);
  const totals = months.map((month) => STATE_ORDER.reduce((sum, state) => sum + month[state], 0));
  const max = Math.max(...totals, 1);
  return (
    <div className={cn("grid border-t border-[var(--color-border-secondary)] pt-12", LABEL_COL)}>
      <div className="flex flex-col justify-end gap-2 pb-4 pr-12">
        <span className="body-small font-medium">Applied per month</span>
        <span className={cn("body-caption", MUTED)}>All feedstocks</span>
      </div>
      <div className="grid grid-cols-12 items-end gap-x-8 px-4" style={{ height: VOLUME_HEIGHT_PX + 20 }}>
        {months.map((month, index) => (
          <div key={MONTH_LABELS[index]} className="flex h-full flex-col justify-end gap-4">
            {totals[index] > 0 && <span className={cn("text-center body-caption tabular-nums", MUTED)}>{Math.round(totals[index])} t</span>}
            <span className="flex flex-col-reverse" style={{ height: (totals[index] / max) * VOLUME_HEIGHT_PX }} aria-hidden>
              {STATE_ORDER.map((state) =>
                month[state] > 0 ? <span key={state} className={STATE_TONE[state].solid} style={{ height: `${(month[state] / totals[index]) * 100}%` }} /> : null,
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VolumeRows({ year }: { year: number }) {
  return (
    <div className="relative flex min-w-[880px] flex-col">
      <div className={cn("grid", LABEL_COL)}>
        <span />
        <div className="grid grid-cols-4" aria-hidden>
          {QUARTERS.map((quarter) => (
            <span key={quarter} className={cn("border-l border-[var(--color-border-secondary)] pl-6 body-caption font-medium", MUTED)}>
              {quarter}
            </span>
          ))}
        </div>
      </div>
      <QuietRows year={year} />
      <VolumeChart year={year} />
    </div>
  );
}

export function VolumeTimeline() {
  const [year, setYear] = useState(YEARS[YEARS.length - 1]);
  return (
    <Frame year={year} onYear={setYear}>
      <VolumeRows year={year} />
    </Frame>
  );
}
