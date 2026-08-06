import { cn } from "@/lib/utils";
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
    { label: wetLabel, value: formatRecordedMass(wetKg) },
    { label: dryLabel, value: formatRecordedMass(dryKg) },
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
          <dt className="label-micro text-[var(--color-text-secondary)]">
            {figure.label}
          </dt>
          <dd
            className={cn(
              "m-0 whitespace-nowrap font-mono tabular-nums text-[var(--color-text-primary)]",
              isCompact
                ? "text-[length:var(--text-body-small)] leading-[var(--text-body-small--line-height)]"
                : "text-[length:var(--text-body-large)] leading-[var(--text-body-large--line-height)] font-semibold",
            )}
          >
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
