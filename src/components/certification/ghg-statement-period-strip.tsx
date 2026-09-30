/**
 * PeriodStrip: a GHG Statement's reporting period as two blocks with an
 * arrow, start to end. It is the one place the period shows; the create
 * dialog, the submit dialog and the detail sheet all render this strip
 * instead of repeating the dates in each step.
 *
 * The start is read-only: Isometric sets it for the first statement, then
 * derives each later start from the previous statement's end.
 */
import { ArrowRightIcon, CalendarBlankIcon } from "@phosphor-icons/react/dist/ssr";
import { formatDate } from "@/lib/format-utils";

const ICON_PX = 16;

function PeriodBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-[var(--color-background-light)] px-12 py-10">
      <span className="body-caption text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className="flex items-center gap-6 body-medium font-medium tabular-nums text-[var(--color-text-primary)]">
        <CalendarBlankIcon
          size={ICON_PX}
          aria-hidden="true"
          className="shrink-0 text-[var(--color-icon-secondary)]"
        />
        {value}
      </span>
    </div>
  );
}

export function PeriodStrip({
  start,
  end,
}: {
  /** ISO date, or null when Isometric sets the start. */
  start: string | null;
  /** ISO date. */
  end: string;
}) {
  const startText = start ? formatDate(start) : "Set by Isometric";
  const endText = formatDate(end);
  return (
    <div
      role="group"
      aria-label={`Reporting period: ${startText} to ${endText}`}
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-8"
    >
      <PeriodBlock label="Start" value={startText} />
      <ArrowRightIcon
        size={ICON_PX}
        aria-hidden="true"
        className="text-[var(--color-icon-secondary)]"
      />
      <PeriodBlock label="End" value={endText} />
    </div>
  );
}
