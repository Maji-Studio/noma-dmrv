/**
 * MoistureSplit — the one way this app shows a wet mass broken into dry matter
 * and water.
 *
 * The bar is the load itself, seen in section: a solid plum block for the dry
 * matter that carbon accounting is paid on, and a hatched void for the water
 * that it is not. Reading it takes no arithmetic — a wet feedstock batch is
 * visibly half void, a 2%-moisture biochar is visibly solid — which is the
 * point, because the numbers alone ("1,500 kg", "35%") never made the
 * relationship obvious.
 *
 * Deliberately area-neutral: moisture means the same thing on a feedstock
 * delivery as on a finished product, so it never takes the production /
 * infrastructure / distribution accent. That neutrality is what lets the same
 * component appear in five different feature areas and still read as one idea.
 *
 * Three surfaces, one component:
 * - `variant="detail"` (default) — figures, bar, and the wet/water footnote.
 *   Forms (live under the wet-mass and moisture inputs) and read side sheets.
 * - `variant="compact"` — bar plus a single line. Nested panels, cards.
 * - `variant="inline"` — text only, no bar. Table cells and option labels.
 *
 * Missing moisture renders as an explicit unresolved state rather than nothing:
 * a fully hatched bar and "Moisture not recorded". Dry mass drives certification
 * readiness, so its absence has to be visible, not silent.
 */
"use client";

import {
  describeMassSplit,
  formatMoisturePercent,
  formatSplitMass,
  splitWetMass,
  type MassSplit,
} from "@/lib/mass-moisture";

const PERCENT_SCALE = 100;
/** Keep a sliver of each segment visible so a 99%/1% split still reads as two parts. */
const MIN_VISIBLE_SEGMENT_PERCENT = 1.5;

export type MoistureSplitVariant = "detail" | "compact" | "inline";

interface MoistureSplitProps {
  /** As-received mass in kg. */
  wetMassKg: number | null | undefined;
  /** Moisture on a wet basis, 0–100. */
  moisturePercent: number | null | undefined;
  variant?: MoistureSplitVariant;
  /**
   * What the mass is, when the surrounding context does not already say it
   * ("Biochar", "Feedstock"). Prefixes the dry-mass label.
   */
  materialLabel?: string;
  /**
   * Replaces the default footnote. Pass the provenance when the moisture came
   * from somewhere the operator did not just type (e.g. "Moisture from delivery
   * record").
   */
  note?: string;
  /** Hide the unresolved state entirely — for surfaces where a blank is fine. */
  hideWhenIncomplete?: boolean;
  className?: string;
}

function segmentWidths(split: MassSplit): { dry: number; water: number } {
  const dryPercent = split.dryFraction * PERCENT_SCALE;
  if (dryPercent >= PERCENT_SCALE - MIN_VISIBLE_SEGMENT_PERCENT && split.waterKg > 0) {
    return { dry: PERCENT_SCALE - MIN_VISIBLE_SEGMENT_PERCENT, water: MIN_VISIBLE_SEGMENT_PERCENT };
  }
  if (dryPercent <= MIN_VISIBLE_SEGMENT_PERCENT && split.dryKg > 0) {
    return { dry: MIN_VISIBLE_SEGMENT_PERCENT, water: PERCENT_SCALE - MIN_VISIBLE_SEGMENT_PERCENT };
  }
  return { dry: dryPercent, water: PERCENT_SCALE - dryPercent };
}

function SplitBar({ split, height }: { split: MassSplit; height: string }) {
  const widths = segmentWidths(split);

  return (
    <div
      role="img"
      aria-label={describeMassSplit(split)}
      className={`flex w-full overflow-hidden border border-[var(--color-border-secondary)] ${height}`}
    >
      <div
        aria-hidden="true"
        className="bg-[var(--clr-dark-purple-80)]"
        style={{ width: `${widths.dry}%` }}
      />
      <div
        aria-hidden="true"
        className="moisture-water-hatch border-l border-[var(--color-border-secondary)]"
        style={{ width: `${widths.water}%` }}
      />
    </div>
  );
}

function UnresolvedBar({ height }: { height: string }) {
  return (
    <div
      aria-hidden="true"
      className={`moisture-water-hatch w-full border border-dashed border-[var(--color-border-secondary)] ${height}`}
    />
  );
}

export function MoistureSplit({
  wetMassKg,
  moisturePercent,
  variant = "detail",
  materialLabel,
  note,
  hideWhenIncomplete = false,
  className = "",
}: MoistureSplitProps) {
  const split = splitWetMass(wetMassKg, moisturePercent);
  const dryLabel = materialLabel ? `${materialLabel} dry mass` : "Dry mass";

  if (!split) {
    if (hideWhenIncomplete) return null;

    if (variant === "inline") {
      return (
        <span className={`body-caption text-[var(--color-text-tertiary)] ${className}`}>
          Moisture not recorded
        </span>
      );
    }

    return (
      <div className={`flex flex-col gap-6 ${className}`}>
        <UnresolvedBar height={variant === "compact" ? "h-8" : "h-12"} />
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Moisture not recorded — {dryLabel.toLowerCase()} cannot be derived.
        </p>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <span className={`body-caption text-[var(--color-text-secondary)] ${className}`}>
        <span className="font-mono text-[var(--color-text-primary)]">
          {formatSplitMass(split.dryKg)}
        </span>{" "}
        dry ·{" "}
        <span className="font-mono">{formatMoisturePercent(split.moisturePercent)}</span> moisture
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <div className={`flex flex-col gap-6 ${className}`}>
        <SplitBar split={split} height="h-8" />
        <p className="body-caption text-[var(--color-text-tertiary)]">
          <span className="font-mono text-[var(--color-text-primary)]">
            {formatSplitMass(split.dryKg)}
          </span>{" "}
          dry of {formatSplitMass(split.wetKg)} wet ·{" "}
          {formatMoisturePercent(split.moisturePercent)} moisture
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-8 ${className}`}>
      <div className="flex items-baseline justify-between gap-16">
        <div className="flex items-baseline gap-8">
          <span className="body-caption text-[var(--color-text-tertiary)]">{dryLabel}</span>
          <span
            className="font-mono body-medium font-medium text-[var(--color-text-primary)]"
            aria-live="polite"
            aria-atomic="true"
          >
            {formatSplitMass(split.dryKg)}
          </span>
        </div>
        <div className="flex items-baseline gap-8">
          <span className="body-caption text-[var(--color-text-tertiary)]">Moisture</span>
          <span className="font-mono body-small text-[var(--color-text-secondary)]">
            {formatMoisturePercent(split.moisturePercent)}
          </span>
        </div>
      </div>

      <SplitBar split={split} height="h-12" />

      <p className="body-caption text-[var(--color-text-tertiary)]">
        {note ?? (
          <>
            {formatSplitMass(split.wetKg)} wet · {formatSplitMass(split.waterKg)} water
          </>
        )}
      </p>
    </div>
  );
}
