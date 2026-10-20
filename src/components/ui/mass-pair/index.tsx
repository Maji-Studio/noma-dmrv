import { cn } from "@/lib/utils";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  formatRecordedMass,
  MASS_MOISTURE_LABELS,
} from "@/lib/mass-moisture";

export interface MassPairProps {
  wetKg: number | null | undefined;
  dryKg: number | null | undefined;
  wetLabel?: string;
  dryLabel?: string;
  layout?: "columns" | "stacked";
  variant?: "summary" | "compact";
  className?: string;
}

function isRecorded(kg: number | null | undefined): boolean {
  return formatRecordedMass(kg) !== MISSING_VALUE.notRecorded;
}

/** A structured wet/dry comparison for KPI cards and dense table cells. */
export function MassPair({
  wetKg,
  dryKg,
  wetLabel = MASS_MOISTURE_LABELS.wet,
  dryLabel = MASS_MOISTURE_LABELS.dry,
  layout = "columns",
  variant = "summary",
  className,
}: MassPairProps) {
  const figures = [
    { label: wetLabel, value: formatRecordedMass(wetKg), recorded: isRecorded(wetKg) },
    { label: dryLabel, value: formatRecordedMass(dryKg), recorded: isRecorded(dryKg) },
  ];
  const isCompact = variant === "compact";

  return (
    <dl
      aria-label={`${wetLabel} and ${dryLabel}`}
      className={cn(
        "grid min-w-0",
        layout === "columns"
          ? "grid-cols-2 gap-12"
          : isCompact
            ? "grid-cols-1 gap-4"
            : "grid-cols-1 gap-8",
        className,
      )}
    >
      {figures.map((figure) => (
        <div
          key={figure.label}
          className={cn(
            "min-w-0",
            isCompact
              ? "flex items-baseline justify-between gap-12"
              : "flex flex-col gap-2",
          )}
        >
          <dt className="body-caption text-[var(--color-text-secondary)]">
            {figure.label}
          </dt>
          <dd
            {...(figure.recorded ? {} : { "data-empty": true })}
            className={cn(
              "m-0 whitespace-nowrap",
              figure.recorded
                ? "font-mono tabular-nums text-[var(--color-text-primary)]"
                : "text-[var(--color-text-tertiary)]",
              isCompact
                ? "text-[length:var(--text-body-small)] leading-[var(--text-body-small--line-height)]"
                : "text-[length:var(--text-body-large)] leading-[var(--text-body-large--line-height)]",
              figure.recorded && !isCompact && "font-semibold",
            )}
          >
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
