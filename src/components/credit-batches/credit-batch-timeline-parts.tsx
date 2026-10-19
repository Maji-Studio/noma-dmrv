"use client";

/**
 * Pieces the credit batch timeline shares: the year switcher, month axis and
 * grid, the Today line and the state legend.
 */
import { CaretLeftIcon, CaretRightIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { dayPercentOfYear, daysInMonths, monthIndexIn, type TimelineState } from "@/lib/credit-batches/timeline";
import { STATUS_STATE_BADGE_CLASSES, type StatusStateClass } from "@/lib/status-state";
import { cn } from "@/lib/utils";

export const MUTED = "text-[var(--color-text-secondary)]";

const LEGEND_MARK_PX = 10;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Tone = { solid: string; tint: string; edge: string; text: string; badge: string };

const TONE_BY_STATE_CLASS: Record<StatusStateClass, Tone> = {
  neutral: { solid: "bg-[var(--st-off)]", tint: "bg-[var(--st-off-bg)]", edge: "border-[var(--st-off)]", text: "text-[var(--st-off)]", badge: STATUS_STATE_BADGE_CLASSES.neutral },
  "in-progress": { solid: "bg-[var(--st-run)]", tint: "bg-[var(--st-run-bg)]", edge: "border-[var(--st-run)]", text: "text-[var(--st-run)]", badge: STATUS_STATE_BADGE_CLASSES["in-progress"] },
  success: { solid: "bg-[var(--st-ok)]", tint: "bg-[var(--st-ok-bg)]", edge: "border-[var(--st-ok)]", text: "text-[var(--st-ok)]", badge: STATUS_STATE_BADGE_CLASSES.success },
  warning: { solid: "bg-[var(--st-wait)]", tint: "bg-[var(--st-wait-bg)]", edge: "border-[var(--st-wait)]", text: "text-[var(--st-wait)]", badge: STATUS_STATE_BADGE_CLASSES.warning },
  error: { solid: "bg-[var(--st-bad)]", tint: "bg-[var(--st-bad-bg)]", edge: "border-[var(--st-bad)]", text: "text-[var(--st-bad)]", badge: STATUS_STATE_BADGE_CLASSES.error },
};

/** Issued is the finished state, so it reads in ink rather than a status color. */
const INK_TONE: Tone = {
  solid: "bg-[var(--ink)]",
  tint: "bg-[var(--clr-dark-purple-10)]",
  edge: "border-[var(--ink)]",
  text: "text-[var(--ink)]",
  badge: "bg-[var(--clr-dark-purple-10)] text-[var(--ink)] border-[var(--clr-dark-purple-60)]",
};

const STATE_TITLE: Record<TimelineState, string> = {
  blocking: "Open",
  ready: "Ready",
  submitted: "Submitted",
  issued: "Issued",
};

/** The tone of a bar whose state has not loaded. */
export const UNKNOWN_TONE = TONE_BY_STATE_CLASS.neutral;

/**
 * Solid, tint, edge and badge per state, for bars, hover cards and the legend.
 * The timeline keeps its own scale (Kenji, 2026-10-19) so each step of the
 * lifecycle has one color: Open orange, Ready purple, Submitted green, Issued
 * ink. Other screens keep the shared mapping in status-state.ts.
 */
export const STATE_TONE: Record<TimelineState, Tone & { title: string }> = {
  blocking: { ...TONE_BY_STATE_CLASS.warning, title: STATE_TITLE.blocking },
  ready: { ...TONE_BY_STATE_CLASS["in-progress"], title: STATE_TITLE.ready },
  submitted: { ...TONE_BY_STATE_CLASS.success, title: STATE_TITLE.submitted },
  issued: { ...INK_TONE, title: STATE_TITLE.issued },
};

/** Issued also carries a check mark, so the finished state reads without color. */
export function StateMark({ state, size }: { state: TimelineState; size: number }) {
  return state === "issued" ? (
    <CheckCircleIcon size={size} weight="fill" className={cn("shrink-0", STATE_TONE.issued.text)} aria-hidden />
  ) : (
    <span className={cn("shrink-0 rounded-full", STATE_TONE[state].solid)} style={{ width: size, height: size }} aria-hidden />
  );
}

export const STATE_ORDER: TimelineState[] = ["blocking", "ready", "submitted", "issued"];

export function YearSwitcher({
  year,
  years,
  today,
  onChange,
}: {
  year: number;
  years: number[];
  today: string;
  onChange: (year: number) => void;
}) {
  const index = years.indexOf(year);
  const currentYear = Number(today.slice(0, 4));
  return (
    <div className="flex items-center gap-12">
      <div className="flex items-center">
        <Button variant="noOutline" size="icon" aria-label="Previous year" disabled={index <= 0} onClick={() => onChange(years[index - 1])}>
          <CaretLeftIcon size={20} weight="bold" aria-hidden />
        </Button>
        <h2 className="min-w-[64px] text-center title-heading-3 tabular-nums" aria-live="polite">
          {year}
        </h2>
        <Button variant="noOutline" size="icon" aria-label="Next year" disabled={index >= years.length - 1} onClick={() => onChange(years[index + 1])}>
          <CaretRightIcon size={20} weight="bold" aria-hidden />
        </Button>
      </div>
      {year !== currentYear && (
        <Button variant="weak" size="small" onClick={() => onChange(currentYear)}>
          {`Back to ${currentYear}`}
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
          <StateMark state={state} size={LEGEND_MARK_PX} />
          {STATE_TONE[state].title}
        </li>
      ))}
    </ul>
  );
}

/** Month columns weighted by their days, the same day mapping bars, slots and the Today line use. */
function monthColumns(year: number): string {
  return daysInMonths(year).map((days) => `${days}fr`).join(" ");
}

/** The month labels over a track; the current month is set in medium weight. */
export function MonthAxis({ year, today, className }: { year: number; today: string; className?: string }) {
  const currentMonth = monthIndexIn(year, today);
  return (
    <div className={cn("grid", className)} style={{ gridTemplateColumns: monthColumns(year) }} aria-hidden>
      {MONTH_LABELS.map((label, index) => (
        <span key={label} className={cn("pl-6 body-caption", index === currentMonth ? "font-medium text-[var(--color-text-primary)]" : MUTED)}>
          {label}
        </span>
      ))}
    </div>
  );
}

/** Faint month separators behind a track, with the current month shaded. */
export function MonthGrid({ year, today }: { year: number; today: string }) {
  const currentMonth = monthIndexIn(year, today);
  return (
    <div className="absolute inset-0 grid" style={{ gridTemplateColumns: monthColumns(year) }} aria-hidden>
      {MONTH_LABELS.map((label, index) => (
        <span key={label} className={cn("border-l border-[var(--color-border-tertiary)]", index === currentMonth && "bg-[var(--color-surface-light)]")} />
      ))}
    </div>
  );
}

/** The Today line over a whole track area; nothing in another year. */
export function TodayLine({ year, today }: { year: number; today: string }) {
  if (monthIndexIn(year, today) < 0) return null;
  return (
    <span
      className="pointer-events-none absolute inset-y-0 z-20 w-px -translate-x-1/2 bg-[var(--ink)]"
      style={{ left: `${dayPercentOfYear(today)}%` }}
      aria-hidden
    />
  );
}
