/**
 * MoistureSplit — the one way this app shows a wet mass broken into dry matter,
 * water already present, and any water added afterward.
 *
 * The bar is the load itself, seen in section: a solid plum block for the dry
 * matter that carbon accounting is paid on, a hatched void for the water that
 * it is not, and an optional purple segment for added water. Reading it takes no
 * arithmetic — a wet feedstock batch is visibly half void, a 2%-moisture
 * biochar is visibly solid, and added water remains visibly attributable.
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
  describeMassSplitAfterAddedWater,
  formatMoisturePercent,
  formatSplitMass,
  formatWetDryMass,
  MASS_MOISTURE_LABELS,
  splitWetMass,
  splitWetMassAfterAddedWater,
  MIN_VISIBLE_SEGMENT_PERCENT,
  PERCENT_SCALE,
  type MassSplit,
} from "@/lib/mass-moisture";

export type MoistureSplitVariant = "detail" | "compact" | "inline";

interface MoistureSplitProps {
  /** As-received mass in kg. */
  wetMassKg: number | null | undefined;
  /** Moisture on a wet basis, 0–100. */
  moisturePercent: number | null | undefined;
  /** Stored authoritative dry mass, when the entity carries one. */
  dryMassKg?: number | null;
  /** Water added after the recorded wet mass and moisture measurement. */
  addedWaterKg?: number | null;
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
  /** Override the final-moisture label when added water changes its scope. */
  finalMoistureLabel?: string;
  /**
   * Replaces the default footnote without added water; with added water, renders
   * before the breakdown. Pass provenance such as "Moisture from delivery record".
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
  label: string,
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

interface AddedWaterState {
  addedWaterKg: number;
  finalSplit: MassSplit;
}

function resolveAddedWaterState(
  split: MassSplit,
  addedWaterKg: number | null | undefined,
): AddedWaterState | null {
  if (
    addedWaterKg == null ||
    !Number.isFinite(addedWaterKg) ||
    addedWaterKg <= 0
  ) {
    return null;
  }

  const finalSplit = splitWetMassAfterAddedWater(
    split.wetKg,
    split.moisturePercent,
    addedWaterKg,
  );
  return finalSplit ? { addedWaterKg, finalSplit } : null;
}

function segmentWidths(
  split: MassSplit,
  addedWaterState: AddedWaterState | null,
): { dry: number; water: number; addedWater: number } {
  const finalWetKg = addedWaterState?.finalSplit.wetKg ?? split.wetKg;
  if (finalWetKg <= 0) {
    return { dry: PERCENT_SCALE, water: 0, addedWater: 0 };
  }

  const rawSegments = {
    dry: (split.dryKg / finalWetKg) * PERCENT_SCALE,
    water: (split.waterKg / finalWetKg) * PERCENT_SCALE,
    addedWater:
      ((addedWaterState?.addedWaterKg ?? 0) / finalWetKg) * PERCENT_SCALE,
  };
  const smallSegmentTotal = Object.values(rawSegments)
    .filter((width) => width > 0 && width < MIN_VISIBLE_SEGMENT_PERCENT)
    .reduce((total) => total + MIN_VISIBLE_SEGMENT_PERCENT, 0);
  const scalableTotal = Object.values(rawSegments)
    .filter((width) => width >= MIN_VISIBLE_SEGMENT_PERCENT)
    .reduce((total, width) => total + width, 0);
  const remainingWidth = PERCENT_SCALE - smallSegmentTotal;

  const visibleWidth = (width: number): number => {
    if (width <= 0) return 0;
    if (width < MIN_VISIBLE_SEGMENT_PERCENT) {
      return MIN_VISIBLE_SEGMENT_PERCENT;
    }
    return scalableTotal > 0
      ? (width / scalableTotal) * remainingWidth
      : width;
  };

  return {
    dry: visibleWidth(rawSegments.dry),
    water: visibleWidth(rawSegments.water),
    addedWater: visibleWidth(rawSegments.addedWater),
  };
}

function SplitBar({
  split,
  height,
  addedWaterState,
}: {
  split: MassSplit;
  height: string;
  addedWaterState: AddedWaterState | null;
}) {
  const widths = segmentWidths(split, addedWaterState);

  return (
    <div
      role="img"
      aria-label={
        addedWaterState
          ? describeMassSplitAfterAddedWater(
              split,
              addedWaterState.addedWaterKg,
              addedWaterState.finalSplit,
            )
          : describeMassSplit(split)
      }
      className={`flex w-full overflow-hidden border border-[var(--color-border-secondary)] ${height}`}
    >
      <div
        aria-hidden="true"
        data-moisture-segment="dry"
        className="bg-[var(--clr-dark-purple-80)]"
        style={{ width: `${widths.dry}%` }}
      />
      <div
        aria-hidden="true"
        data-moisture-segment="water"
        className="moisture-water-hatch border-l border-[var(--color-border-secondary)]"
        style={{ width: `${widths.water}%` }}
      />
      {addedWaterState && (
        <div
          aria-hidden="true"
          data-moisture-segment="added-water"
          className="border-l border-[var(--color-border-secondary)] bg-[var(--color-moisture-added-water)]"
          style={{ width: `${widths.addedWater}%` }}
        />
      )}
    </div>
  );
}

function AddedWaterSummary({
  split,
  addedWaterState,
  finalMoistureLabel,
}: {
  split: MassSplit;
  addedWaterState: AddedWaterState;
  finalMoistureLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-16 gap-y-4">
      <span className="inline-flex items-center gap-6">
        <span
          aria-hidden="true"
          className="inline-block h-8 w-8 moisture-water-hatch border border-[var(--color-border-secondary)]"
        />
        {MASS_MOISTURE_LABELS.waterBeforeAddition}: {formatSplitMass(split.waterKg)}
      </span>
      <span className="inline-flex items-center gap-6">
        <span
          aria-hidden="true"
          className="inline-block h-8 w-8 bg-[var(--color-moisture-added-water)]"
        />
        {MASS_MOISTURE_LABELS.waterAdded}: {formatSplitMass(addedWaterState.addedWaterKg)}
      </span>
      <span className="font-medium text-[var(--color-text-secondary)]">
        {finalMoistureLabel ?? MASS_MOISTURE_LABELS.finalMoisture}:{" "}
        {formatMoisturePercent(addedWaterState.finalSplit.moisturePercent)}
      </span>
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
  addedWaterKg,
  variant = "detail",
  materialLabel,
  wetLabel,
  dryLabel,
  finalMoistureLabel,
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

  const addedWaterState = resolveAddedWaterState(split, addedWaterKg);
  const displayedSplit = addedWaterState?.finalSplit ?? split;
  const displayedWetLabel =
    wetLabel ??
    (addedWaterState
      ? qualifyFigureLabel(MASS_MOISTURE_LABELS.finalWet, materialLabel)
      : undefined);

  if (variant === "inline") {
    return (
      <span className={`body-caption text-[var(--color-text-secondary)] ${className}`}>
        <span className="font-mono text-[var(--color-text-primary)]">
          {formatVisualizationMass({
            split: displayedSplit,
            materialLabel,
            wetLabel: displayedWetLabel,
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
            split: displayedSplit,
            materialLabel,
            wetLabel: displayedWetLabel,
            dryLabel,
          })}
        </p>
        <SplitBar
          split={split}
          height="h-8"
          addedWaterState={addedWaterState}
        />
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {formatMoisturePercent(displayedSplit.moisturePercent)} moisture
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
          split: displayedSplit,
          materialLabel,
          wetLabel: displayedWetLabel,
          dryLabel,
        })}
      </p>

      <SplitBar
        split={split}
        height="h-12"
        addedWaterState={addedWaterState}
      />

      <div className="body-caption text-[var(--color-text-tertiary)]">
        {addedWaterState ? (
          <>
            {note && <p className="body-caption">{note}</p>}
            <AddedWaterSummary
              split={split}
              addedWaterState={addedWaterState}
              finalMoistureLabel={finalMoistureLabel}
            />
          </>
        ) : note ?? (
          <>
            Moisture: {formatMoisturePercent(split.moisturePercent)} · Water:{" "}
            {formatSplitMass(split.waterKg)}
          </>
        )}
      </div>
    </div>
  );
}
