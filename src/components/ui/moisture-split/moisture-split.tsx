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
 * A missing input renders as an explicit unresolved state rather than nothing:
 * a fully hatched bar naming whichever of wet mass or moisture is absent. Dry
 * mass drives certification readiness, so its absence has to be visible, not
 * silent — and has to point at the field that actually needs filling.
 */
"use client";

import {
  describeMassSplit,
  formatMoisturePercent,
  formatSplitMass,
  formatWetDryMass,
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
  /** Stored authoritative dry mass, when the entity carries one. */
  dryMassKg?: number | null;
  variant?: MoistureSplitVariant;
  /**
   * What the mass is, when the surrounding context does not already say it
   * ("Biochar", "Feedstock"). Prefixes the dry-mass label.
   */
  materialLabel?: string;
  /** Override the wet figure label for a more specific surface. */
  wetLabel?: string;
  /** Override the dry figure label for a more specific surface. */
  dryLabel?: string;
  /**
   * Replaces the default footnote. Pass the provenance when the moisture came
   * from somewhere the operator did not just type (e.g. "Moisture from delivery
   * record").
   */
  note?: string;
  className?: string;
}

/**
 * Which input the split is waiting on. `splitWetMass` returns null when either
 * is missing or out of range, and the two gaps send the operator to different
 * fields, so the unresolved state has to say which. Both missing reads as wet
 * mass — that is the one entered first.
 */
function missingSplitInput(wetMassKg: number | null | undefined): string {
  const wetOk =
    wetMassKg != null && Number.isFinite(wetMassKg) && wetMassKg >= 0;
  return wetOk ? "Moisture" : "Wet mass";
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

function resolveDisplaySplit(
  wetMassKg: number | null | undefined,
  moisturePercent: number | null | undefined,
  dryMassKg: number | null | undefined,
): MassSplit | null {
  if (
    wetMassKg != null &&
    dryMassKg != null &&
    Number.isFinite(wetMassKg) &&
    Number.isFinite(dryMassKg) &&
    wetMassKg >= 0 &&
    dryMassKg >= 0 &&
    dryMassKg <= wetMassKg
  ) {
    const waterKg = wetMassKg - dryMassKg;
    return {
      wetKg: wetMassKg,
      dryKg: dryMassKg,
      waterKg,
      moisturePercent:
        wetMassKg > 0 ? (waterKg / wetMassKg) * PERCENT_SCALE : 0,
      dryFraction: wetMassKg > 0 ? dryMassKg / wetMassKg : 1,
    };
  }
  return splitWetMass(wetMassKg, moisturePercent);
}

function qualifyFigureLabel(
  label: "Wet" | "Dry",
  materialLabel: string | undefined,
): string {
  if (!materialLabel) return label;
  return `${label} ${materialLabel.charAt(0).toLowerCase()}${materialLabel.slice(1)}`;
}

function formatVisualizationMass({
  split,
  materialLabel,
  wetLabel,
  dryLabel,
}: {
  split: MassSplit;
  materialLabel?: string;
  wetLabel?: string;
  dryLabel?: string;
}): string {
  return formatWetDryMass({
    wetKg: split.wetKg,
    dryKg: split.dryKg,
    wetLabel: wetLabel ?? qualifyFigureLabel("Wet", materialLabel),
    dryLabel: dryLabel ?? qualifyFigureLabel("Dry", materialLabel),
    separator: " | ",
    unitSpacing: "compact",
  });
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
  dryMassKg,
  variant = "detail",
  materialLabel,
  wetLabel,
  dryLabel,
  note,
  className = "",
}: MoistureSplitProps) {
  const split = resolveDisplaySplit(
    wetMassKg,
    moisturePercent,
    dryMassKg,
  );
  const unresolvedDryLabel =
    dryLabel ??
    (materialLabel ? `${materialLabel} dry mass` : "Dry mass");

  if (!split) {
    // The split needs BOTH inputs, so name the one actually missing — telling an
    // operator "moisture not recorded" when moisture is fine and wet mass is not
    // sends them to the wrong field, and the unresolved state exists precisely to
    // make a certification gap visible.
    const missing = missingSplitInput(wetMassKg);

    if (variant === "inline") {
      return (
        <span className={`body-caption text-[var(--color-text-tertiary)] ${className}`}>
          {missing} not recorded
        </span>
      );
    }

    return (
      <div className={`flex flex-col gap-6 ${className}`}>
        <UnresolvedBar height={variant === "compact" ? "h-8" : "h-12"} />
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {missing} not recorded. {unresolvedDryLabel} cannot be calculated.
        </p>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <span className={`body-caption text-[var(--color-text-secondary)] ${className}`}>
        <span className="font-mono text-[var(--color-text-primary)]">
          {formatVisualizationMass({
            split,
            materialLabel,
            wetLabel,
            dryLabel,
          })}
        </span>
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <div className={`flex flex-col gap-6 ${className}`}>
        <p className="body-caption font-mono text-[var(--color-text-primary)]">
          {formatVisualizationMass({
            split,
            materialLabel,
            wetLabel,
            dryLabel,
          })}
        </p>
        <SplitBar split={split} height="h-8" />
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {formatMoisturePercent(split.moisturePercent)} moisture
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-8 ${className}`}>
      <p
        className="font-mono body-small font-medium text-[var(--color-text-primary)]"
        aria-live="polite"
        aria-atomic="true"
      >
        {formatVisualizationMass({
          split,
          materialLabel,
          wetLabel,
          dryLabel,
        })}
      </p>

      <SplitBar split={split} height="h-12" />

      <p className="body-caption text-[var(--color-text-tertiary)]">
        {note ?? (
          <>
            Moisture: {formatMoisturePercent(split.moisturePercent)} · Water:{" "}
            {formatSplitMass(split.waterKg)}
          </>
        )}
      </p>
    </div>
  );
}
