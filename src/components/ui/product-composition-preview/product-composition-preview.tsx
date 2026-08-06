import { formatMassKg } from "@/lib/format-utils";
import {
  formatMoisturePercent,
  MIN_VISIBLE_SEGMENT_PERCENT,
  PERCENT_SCALE,
} from "@/lib/mass-moisture";

interface ProductCompositionPreviewProps {
  wetMassKg: number | null | undefined;
  dryBiocharKg: number | null | undefined;
  moisturePercent?: number | null;
  wetLabel?: string;
  dryLabel?: string;
  remainderLabel?: string;
  estimate?: boolean;
  note?: string;
  className?: string;
  framed?: boolean;
  testId?: string;
}

/** Two-part mass preview for blended biochar products. */
export function ProductCompositionPreview({
  wetMassKg,
  dryBiocharKg,
  moisturePercent,
  wetLabel = "Wet biochar product",
  dryLabel = "Dry biochar",
  remainderLabel = "Ingredients + water",
  estimate = false,
  note,
  className = "",
  framed = true,
  testId = "product-composition-preview",
}: ProductCompositionPreviewProps) {
  const remainderKg =
    wetMassKg != null && dryBiocharKg != null
      ? Math.max(0, wetMassKg - dryBiocharKg)
      : null;
  const hasComposition =
    wetMassKg != null &&
    dryBiocharKg != null &&
    Number.isFinite(wetMassKg) &&
    Number.isFinite(dryBiocharKg) &&
    wetMassKg > 0 &&
    dryBiocharKg >= 0 &&
    dryBiocharKg <= wetMassKg;
  const dryFraction = hasComposition ? dryBiocharKg / wetMassKg : 0;
  const rawDryPercent = dryFraction * PERCENT_SCALE;
  const rawRemainderPercent = PERCENT_SCALE - rawDryPercent;
  const dryPercent =
    rawDryPercent > 0 && rawDryPercent < MIN_VISIBLE_SEGMENT_PERCENT
      ? MIN_VISIBLE_SEGMENT_PERCENT
      : rawDryPercent;
  const remainderPercent =
    rawRemainderPercent > 0 &&
    rawRemainderPercent < MIN_VISIBLE_SEGMENT_PERCENT
      ? MIN_VISIBLE_SEGMENT_PERCENT
      : rawRemainderPercent;
  const visibleTotal = dryPercent + remainderPercent;

  return (
    <div
      data-testid={testId}
      className={`${framed ? "border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-medium)] px-16 py-12" : ""} ${className}`.trim()}
    >
      <p className="body-small text-[var(--color-text-secondary)]">
        {wetLabel}: <span className="font-mono">{formatMassKg(wetMassKg)}</span>
        {estimate ? " (planning estimate)" : ""}
      </p>
      {hasComposition ? (
        <div
          role="img"
          aria-label={`${formatMassKg(dryBiocharKg)} dry biochar and ${formatMassKg(remainderKg)} ingredients plus water`}
          className="mt-8 flex h-12 w-full overflow-hidden border border-[var(--color-border-secondary)]"
        >
          <div
            aria-hidden="true"
            data-product-composition-segment="dry-biochar"
            className="bg-[var(--clr-dark-purple-80)]"
            style={{ width: `${(dryPercent / visibleTotal) * PERCENT_SCALE}%` }}
          />
          <div
            aria-hidden="true"
            data-product-composition-segment="ingredients-water"
            className="moisture-water-hatch border-l border-[var(--color-border-secondary)]"
            style={{
              width: `${(remainderPercent / visibleTotal) * PERCENT_SCALE}%`,
            }}
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="moisture-water-hatch mt-8 h-12 w-full border border-dashed border-[var(--color-border-secondary)]"
        />
      )}
      <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div>
          <p className="body-caption text-[var(--color-text-tertiary)]">{dryLabel}</p>
          <p className="font-mono body-medium text-[var(--color-text-primary)]">
            {formatMassKg(dryBiocharKg)}
          </p>
        </div>
        <div>
          <p className="body-caption text-[var(--color-text-tertiary)]">{remainderLabel}</p>
          <p className="font-mono body-medium text-[var(--color-text-primary)]">
            {formatMassKg(remainderKg)}
          </p>
        </div>
      </div>
      {moisturePercent !== undefined && (
        <p className="body-caption mt-8 text-[var(--color-text-tertiary)]">
          Measured product moisture: {formatMoisturePercent(moisturePercent)}. This measurement does not change dry biochar.
        </p>
      )}
      {note && (
        <p className="body-caption mt-4 text-[var(--color-text-tertiary)]">{note}</p>
      )}
    </div>
  );
}
