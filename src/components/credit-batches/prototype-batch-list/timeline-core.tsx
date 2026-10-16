"use client";

/**
 * PROTOTYPE (throwaway): what the three timeline versions share. Year maths,
 * the year switcher, the month axis, the Today line, the state legend and the
 * hover details (the app's shared Tooltip).
 *
 * A credit batch window is at most one month but need not follow calendar
 * months, and one feedstock's windows never overlap, so one row per feedstock
 * always fits and a batch is drawn from its start to its end date.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BATCHES, matchesStage, STATE_META, STATE_ORDER, YEARS, type BatchState, type StubBatch } from "./list-model";
import { batchHref, MUTED, periodLabel, tons, useList } from "./list-parts";

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
/** PROTOTYPE: the session's today, so the marker sits where the stub data expects it. */
export const TODAY = "2026-10-16";

/** Solid and tint per state, for bars, edges and the legend. */
export const STATE_TONE: Record<BatchState, { solid: string; tint: string; text: string }> = {
  blocking: { solid: "bg-[var(--st-bad)]", tint: "bg-[var(--st-bad-bg)]", text: "text-[var(--st-bad)]" },
  ready: { solid: "bg-[var(--ink)]", tint: "bg-[var(--color-surface-medium)]", text: "text-[var(--ink)]" },
  submitted: { solid: "bg-[var(--st-run)]", tint: "bg-[var(--st-run-bg)]", text: "text-[var(--st-run)]" },
  issued: { solid: "bg-[var(--st-ok)]", tint: "bg-[var(--st-ok-bg)]", text: "text-[var(--st-ok)]" },
};

export function dayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function yearSpan(year: number): { first: number; days: number } {
  const first = Date.UTC(year, 0, 1) / DAY_MS;
  return { first, days: Date.UTC(year + 1, 0, 1) / DAY_MS - first };
}

export interface Spot {
  left: number;
  width: number;
  cutStart: boolean;
  cutEnd: boolean;
}

/** Position as percentages of the year track; null when the batch is outside the year. */
export function place(batch: StubBatch, year: number): Spot | null {
  const { first, days } = yearSpan(year);
  const start = dayOf(batch.start) - first;
  const end = dayOf(batch.end) - first + 1;
  if (end <= 0 || start >= days) return null;
  const from = Math.max(start, 0);
  const to = Math.min(end, days);
  return { left: (from / days) * 100, width: ((to - from) / days) * 100, cutStart: start < 0, cutEnd: end > days };
}

export function batchesIn(year: number, feedstock?: string): StubBatch[] {
  return BATCHES.filter((batch) => (!feedstock || batch.feedstock === feedstock) && place(batch, year));
}

/** Where today sits on the year track, as a percentage, or null in another year. */
export function todayPct(year: number): number | null {
  const { first, days } = yearSpan(year);
  const day = dayOf(TODAY) - first;
  return day >= 0 && day < days ? (day / days) * 100 : null;
}

export function YearSwitcher({ year, onChange }: { year: number; onChange: (year: number) => void }) {
  const index = YEARS.indexOf(year);
  const current = Number(TODAY.slice(0, 4));
  return (
    <div className="flex items-center gap-12">
      <div className="flex items-center">
        <Button variant="noOutline" size="icon" aria-label="Previous year" disabled={index <= 0} onClick={() => onChange(YEARS[index - 1])}>
          <CaretLeftIcon size={20} weight="bold" aria-hidden />
        </Button>
        <h2 className="min-w-[64px] text-center title-heading-3 tabular-nums" aria-live="polite">
          {year}
        </h2>
        <Button variant="noOutline" size="icon" aria-label="Next year" disabled={index >= YEARS.length - 1} onClick={() => onChange(YEARS[index + 1])}>
          <CaretRightIcon size={20} weight="bold" aria-hidden />
        </Button>
      </div>
      {year !== current && YEARS.includes(current) && (
        <Button variant="weak" size="small" onClick={() => onChange(current)}>
          Back to {current}
        </Button>
      )}
    </div>
  );
}

export function StateLegend() {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-16 gap-y-6 body-caption", MUTED)}>
      {STATE_ORDER.map((state) => (
        <li key={state} className="inline-flex items-center gap-6">
          <span className={cn("size-8 rounded-full", STATE_TONE[state].solid)} aria-hidden />
          {STATE_META[state].title}
        </li>
      ))}
    </ul>
  );
}

/** A year summary line: batches and applied tonnes in view. */
export function YearSummary({ year }: { year: number }) {
  const inYear = batchesIn(year);
  const applied = inYear.reduce((sum, batch) => sum + batch.applied, 0);
  const blocking = inYear.filter((batch) => batch.state === "blocking").length;
  return (
    <p className={cn("body-small", MUTED)}>
      {inYear.length} credit {inYear.length === 1 ? "batch" : "batches"}, {tons(applied)} applied
      {blocking > 0 && `, ${blocking} ${blocking === 1 ? "needs" : "need"} work`}
    </p>
  );
}

/** The month labels over a track; `shade` tints the current month. */
export function MonthAxis({ year, className }: { year: number; className?: string }) {
  const currentMonth = Number(TODAY.slice(0, 4)) === year ? Number(TODAY.slice(5, 7)) - 1 : -1;
  return (
    <div className={cn("grid grid-cols-12", className)} aria-hidden>
      {MONTH_LABELS.map((label, index) => (
        <span key={label} className={cn("pl-6 body-caption", index === currentMonth ? "font-medium text-[var(--color-text-primary)]" : MUTED)}>
          {label}
        </span>
      ))}
    </div>
  );
}

/** Faint month separators behind a track, with the current month shaded. */
export function MonthGrid({ year, shadeCurrent = true }: { year: number; shadeCurrent?: boolean }) {
  const currentMonth = Number(TODAY.slice(0, 4)) === year ? Number(TODAY.slice(5, 7)) - 1 : -1;
  return (
    <div className="absolute inset-0 grid grid-cols-12" aria-hidden>
      {MONTH_LABELS.map((label, index) => (
        <span
          key={label}
          className={cn("border-l border-[var(--color-border-tertiary)]", shadeCurrent && index === currentMonth && "bg-[var(--color-surface-light)]")}
        />
      ))}
    </div>
  );
}

/** The Today line over a whole track area. */
export function TodayLine({ year, label = true }: { year: number; label?: boolean }) {
  const pct = todayPct(year);
  if (pct == null) return null;
  return (
    <span className="pointer-events-none absolute inset-y-0 z-20 flex flex-col items-center" style={{ left: `${pct}%` }} aria-hidden>
      <span className="w-px flex-1 -translate-x-1/2 bg-[var(--ink)]" />
      {label && <span className="-translate-x-1/2 bg-[var(--ink)] px-4 body-caption font-medium text-white">Today</span>}
    </span>
  );
}

/** What hover shows: identity, window, state, mass and Removals. */
export function BatchDetails({ batch }: { batch: StubBatch }) {
  const state = STATE_META[batch.state];
  return (
    <span className="flex flex-col gap-4">
      <span className="body-small font-medium">
        {batch.code}, {batch.feedstock}
      </span>
      <span>{periodLabel(batch)}</span>
      <span>
        {state.title}
        {batch.state === "blocking" && `, ${batch.blocking} blocking ${batch.blocking === 1 ? "item" : "items"}`}
      </span>
      <span className="tabular-nums">
        {tons(batch.produced)} produced, {tons(batch.applied)} applied
      </span>
      {batch.removals.length > 0 && <span>In {batch.removals.join(" and ")}</span>}
    </span>
  );
}

/**
 * A positioned bar slot: the link to the batch page, with hover details. The
 * link fills the slot; `children` draws the bar.
 */
export function BarLink({ batch, spot, className, children }: { batch: StubBatch; spot: Spot; className?: string; children: ReactNode }) {
  const { realBatchId, stage } = useList();
  // The mass strip filter dims batches that hold no mass in the chosen gap.
  const dimmed = !matchesStage(batch, stage);
  return (
    <div className={cn("absolute inset-y-0", dimmed && "opacity-30")} style={{ left: `${spot.left}%`, width: `${spot.width}%` }}>
      <Tooltip content={<BatchDetails batch={batch} />} side="top">
        <Link
          href={batchHref(realBatchId, batch)}
          aria-label={`${batch.code}, ${batch.feedstock}, ${periodLabel(batch)}, ${STATE_META[batch.state].title}`}
          className={cn("absolute inset-0 block outline-offset-2", className)}
        >
          {children}
        </Link>
      </Tooltip>
    </div>
  );
}
