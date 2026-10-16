"use client";

/**
 * PROTOTYPE (throwaway): Variant B, "Timeline". One row per feedstock, one bar per
 * credit batch from its start to its end date, a year at a time. Windows of one
 * feedstock never overlap, so one row per feedstock always fits; a batch that
 * crosses a month spans the month line, and one that crosses New Year is cut at
 * the edge with an arrow.
 */
import { useState } from "react";
import { CaretLeftIcon, CaretRightIcon, FlaskIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CountBadge } from "../prototype-batch-page/prototype-parts";
import { BATCHES, FEEDSTOCKS, METHOD_B_EVERY, STATE_META, STATE_ORDER, YEARS, type StubBatch } from "./list-model";
import { BatchLink, MUTED, PANEL, periodLabel, tons, useVisible } from "./list-parts";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
/** Below this share of the year (about 18 days) a bar has no room for text. */
const NARROW_PCT = 5;
/** PROTOTYPE: the session's today, so the marker sits where the stub data expects it. */
const TODAY = "2026-10-16";

function dayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function yearSpan(year: number): { first: number; days: number } {
  const first = Date.UTC(year, 0, 1) / DAY_MS;
  return { first, days: Date.UTC(year + 1, 0, 1) / DAY_MS - first };
}

/** Position as percentages of the year track; null when the batch is outside the year. */
function place(batch: StubBatch, year: number) {
  const { first, days } = yearSpan(year);
  const start = dayOf(batch.start) - first;
  const end = dayOf(batch.end) - first + 1;
  if (end <= 0 || start >= days) return null;
  const from = Math.max(start, 0);
  const to = Math.min(end, days);
  return { left: (from / days) * 100, width: ((to - from) / days) * 100, cutStart: start < 0, cutEnd: end > days };
}

function Bar({ batch, year }: { batch: StubBatch; year: number }) {
  const visible = useVisible(batch);
  const spot = place(batch, year);
  if (!spot) return null;
  const meta = STATE_META[batch.state];
  return (
    <BatchLink
      batch={batch}
      title={`${batch.code}, ${periodLabel(batch)}`}
      className={cn(
        "absolute inset-x-0 inset-y-6 flex min-w-0 flex-col overflow-hidden border border-[var(--color-border-secondary)] bg-[var(--paper)] hover:z-10 hover:border-[var(--ink)]",
        !visible && "opacity-40",
      )}
    >
      <span className="sr-only">
        {batch.code}, {batch.feedstock}, {periodLabel(batch)}, {meta.title}, {tons(batch.applied)} applied
      </span>
      <span className={cn("h-4 shrink-0", meta.bar)} aria-hidden />
      {spot.width < NARROW_PCT ? (
        // A sliver (the part of a batch that crosses New Year): only the arrow to the rest.
        <span className="flex flex-1 items-center justify-center" aria-hidden>
          {spot.cutStart ? <CaretLeftIcon size={12} /> : <CaretRightIcon size={12} />}
        </span>
      ) : (
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-2 px-4" aria-hidden>
        <span className="flex min-w-0 items-center gap-4">
          {spot.cutStart && <CaretLeftIcon size={12} className="shrink-0" />}
          <span className="truncate body-caption font-medium tabular-nums">{batch.code}</span>
          {spot.cutEnd && <CaretRightIcon size={12} className="ml-auto shrink-0" />}
        </span>
        <span className="flex min-w-0 items-center gap-4">
          {batch.state === "blocking" ? (
            <CountBadge count={batch.blocking} blocking label="" />
          ) : (
            <span className={cn("truncate body-caption tabular-nums", MUTED)}>{tons(batch.applied)}</span>
          )}
          {batch.sampled && <FlaskIcon size={12} className={cn("ml-auto shrink-0", MUTED)} />}
        </span>
      </span>
      )}
    </BatchLink>
  );
}

/** Wraps a bar in its positioned slot. Kept apart so Bar stays about content. */
function Slot({ batch, year }: { batch: StubBatch; year: number }) {
  const spot = place(batch, year);
  if (!spot) return null;
  return (
    <div className="absolute inset-y-0 px-1" style={{ left: `${spot.left}%`, width: `${spot.width}%` }}>
      <div className="relative h-full">
        <Bar batch={batch} year={year} />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-20 gap-y-8 body-caption", MUTED)}>
      {STATE_ORDER.map((state) => (
        <li key={state} className="inline-flex items-center gap-6">
          <span className={cn("h-4 w-16", STATE_META[state].bar)} aria-hidden />
          {STATE_META[state].title}
        </li>
      ))}
      <li className="inline-flex items-center gap-6">
        <FlaskIcon size={14} aria-hidden />
        Sampled
      </li>
    </ul>
  );
}

function SamplingNote() {
  return (
    <ul className="flex flex-col gap-4 body-small">
      {FEEDSTOCKS.map((feedstock) => {
        const batches = BATCHES.filter((batch) => batch.feedstock === feedstock);
        const sinceSampled = [...batches].reverse().findIndex((batch) => batch.sampled);
        const left = METHOD_B_EVERY - (sinceSampled < 0 ? batches.length : sinceSampled);
        return (
          <li key={feedstock}>
            <span className="font-medium">{feedstock}:</span>{" "}
            <span className={MUTED}>
              {batches.filter((batch) => batch.sampled).length} of {batches.length} credit batches sampled. Method B needs the next sampled batch within {left} {left === 1 ? "batch" : "batches"}.
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function TimelineVariant() {
  const [year, setYear] = useState(YEARS[YEARS.length - 1]);
  const index = YEARS.indexOf(year);
  const { first, days } = yearSpan(year);
  const todayDay = dayOf(TODAY) - first;
  const showToday = todayDay >= 0 && todayDay < days;
  return (
    <section className={cn(PANEL, "flex min-w-0 flex-col gap-20 p-20 sm:p-24")} aria-label="Credit batches over time">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div className="flex items-center gap-8">
          <Button variant="noOutline" size="icon" aria-label="Previous year" disabled={index <= 0} onClick={() => setYear(YEARS[index - 1])}>
            <CaretLeftIcon size={20} weight="bold" aria-hidden />
          </Button>
          <h2 className="title-heading-3 tabular-nums" aria-live="polite">
            {year}
          </h2>
          <Button variant="noOutline" size="icon" aria-label="Next year" disabled={index >= YEARS.length - 1} onClick={() => setYear(YEARS[index + 1])}>
            <CaretRightIcon size={20} weight="bold" aria-hidden />
          </Button>
        </div>
        <Legend />
      </div>
      {/* Bars use the full width; feedstock names sit above their row. Scrolls inside the panel on narrow screens. */}
      <div className="relative -mx-20 overflow-x-auto px-20 sm:mx-0 sm:px-0">
        <div className="relative min-w-[880px] pb-24">
          <div className="grid h-24 grid-cols-12">
            {MONTH_LABELS.map((label) => (
              <span key={label} className={cn("border-l border-[var(--color-border-tertiary)] pl-6 body-caption", MUTED)}>
                {label}
              </span>
            ))}
          </div>
          {FEEDSTOCKS.map((feedstock) => {
            const rows = BATCHES.filter((batch) => batch.feedstock === feedstock);
            const inYear = rows.filter((batch) => place(batch, year));
            const applied = inYear.reduce((sum, batch) => sum + batch.applied, 0);
            return (
              <div key={feedstock} className="flex flex-col">
                <div className="flex items-baseline gap-12 border-t border-[var(--color-border-tertiary)] pt-12 pb-4">
                  <span className="body-small font-medium">{feedstock}</span>
                  <span className={cn("body-caption tabular-nums", MUTED)}>
                    {inYear.length > 0 ? `${inYear.length} ${inYear.length === 1 ? "batch" : "batches"}, ${tons(applied)} applied` : "No batches"}
                  </span>
                </div>
                <div className="relative h-[64px]">
                  <div className="absolute inset-0 grid grid-cols-12" aria-hidden>
                    {MONTH_LABELS.map((label) => (
                      <span key={label} className="border-l border-[var(--color-border-tertiary)]" />
                    ))}
                  </div>
                  <ul aria-label={`${feedstock} credit batches in ${year}`}>
                    {inYear.map((batch) => (
                      <li key={batch.code}>
                        <Slot batch={batch} year={year} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
          {showToday && (
            // From under the month labels to below the rows, where the tag sits clear of the axis.
            <span className="pointer-events-none absolute top-24 bottom-0 z-20 flex flex-col items-center" style={{ left: `${(todayDay / days) * 100}%` }}>
              <span className="w-px flex-1 -translate-x-1/2 bg-[var(--ink)]" aria-hidden />
              <span className="-translate-x-1/2 bg-[var(--ink)] px-4 body-caption font-medium text-white">Today</span>
            </span>
          )}
        </div>
      </div>
      <div className="border-t border-[var(--color-border-tertiary)] pt-16">
        <SamplingNote />
      </div>
    </section>
  );
}
