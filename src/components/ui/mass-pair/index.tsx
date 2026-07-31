import { cn } from "@/lib/utils";
import {
  formatRecordedMass,
  formatSummaryMass,
  MASS_MOISTURE_LABELS,
} from "@/lib/mass-moisture";

export interface MassPairProps {
  wetKg: number | null | undefined;
  dryKg: number | null | undefined;
  layout?: "columns" | "stacked";
  variant?: "summary" | "compact";
  className?: string;
}

/** A structured wet/dry comparison for KPI cards and dense table cells. */
export function MassPair({
  wetKg,
  dryKg,
  layout = "columns",
  variant = "summary",
  className,
}: MassPairProps) {
  const formatValue =
    variant === "compact" ? formatRecordedMass : formatSummaryMass;
  const figures = [
    { label: MASS_MOISTURE_LABELS.wet, value: formatValue(wetKg) },
    { label: MASS_MOISTURE_LABELS.dry, value: formatValue(dryKg) },
  ];
  const isCompact = variant === "compact";

  return (
    <dl
      aria-label="Wet and dry mass"
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
              isCompact ? "body-small" : "body-large font-semibold",
            )}
          >
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
