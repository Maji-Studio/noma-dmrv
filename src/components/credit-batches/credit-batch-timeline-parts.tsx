"use client";

/**
 * Pieces the credit batch timeline shares: the year switcher, month axis and
 * grid, the Today line and the state legend.
 */
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { dayPercentOfYear, monthIndexIn, type TimelineState } from "@/lib/credit-batches/timeline";
import { cn } from "@/lib/utils";

export const MUTED = "text-[var(--color-text-secondary)]";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Solid, tint and edge per state, for bars, hover cards and the legend. */
export const STATE_TONE: Record<TimelineState, { solid: string; tint: string; edge: string; title: string }> = {
  blocking: { solid: "bg-[var(--st-bad)]", tint: "bg-[var(--st-bad-bg)]", edge: "border-[var(--st-bad)]", title: "Needs work" },
  ready: { solid: "bg-[var(--st-wait)]", tint: "bg-[var(--st-wait-bg)]", edge: "border-[var(--st-wait)]", title: "Ready" },
  submitted: { solid: "bg-[var(--st-run)]", tint: "bg-[var(--st-run-bg)]", edge: "border-[var(--st-run)]", title: "Submitted" },
  issued: { solid: "bg-[var(--st-ok)]", tint: "bg-[var(--st-ok-bg)]", edge: "border-[var(--st-ok)]", title: "Issued" },
};

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
          <span className={cn("size-8 rounded-full", STATE_TONE[state].solid)} aria-hidden />
          {STATE_TONE[state].title}
        </li>
      ))}
    </ul>
  );
}

/** The month labels over a track; the current month is set in medium weight. */
export function MonthAxis({ year, today, className }: { year: number; today: string; className?: string }) {
  const currentMonth = monthIndexIn(year, today);
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
export function MonthGrid({ year, today }: { year: number; today: string }) {
  const currentMonth = monthIndexIn(year, today);
  return (
    <div className="absolute inset-0 grid grid-cols-12" aria-hidden>
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
