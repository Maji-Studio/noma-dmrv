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
 * - `variant="detail"` (default) — no card and no frame. The bar sits directly
 *   under the wet-mass and moisture inputs it describes, with one key line of
 *   swatches under it ("Dry 3,200 kg", "Water 800 kg"). Below that, the
 *   calculation table: the composition ledger plus the wet-basis arithmetic in
 *   words. Forms and read side sheets.
 * - `variant="compact"` — figures plus bar plus one line. Nested panels, cards.
 * - `variant="inline"` — text only, no bar. Table cells and option labels.
 *
 * `calculation={false}` drops that table where the host surface already owns a
 * disclosure for the arithmetic.
 *
 * Its Simple boundary is the picture: Simple keeps the bar and key line,
 * because those are what the two inputs mean, and Detailed adds the table.
 * Without a form detail scope (unmanaged sheets) the level resolves to
 * Detailed and the table always shows.
 *
 * The key line carries `aria-live`, so a screen reader hears the recalculated
 * split without the table being re-announced on every keystroke.
 *
 * A missing input renders as an explicit unresolved state rather than nothing:
 * a fully hatched bar naming whichever of wet mass or moisture is absent. Dry
 * mass drives certification readiness, so its absence has to be visible, not
 * silent — and has to point at the field that actually needs filling.
 */
"use client";

import type { ReactNode } from "react";
import { useSimplePresence } from "@/components/forms/form-detail-context";
import { CompositionLedger } from "@/components/forms/composition-ledger";
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

/** Bar heights: 10px is the resolved bar, 8px the denser compact variant. */
const BAR_HEIGHT = "h-10";
const COMPACT_BAR_HEIGHT = "h-8";
/** Square key swatch, sized to the caption text beside it. */
const SWATCH = "inline-block h-12 w-12 shrink-0";

interface MoistureSplitProps {
  /**
   * `detail` only. Set false where the surrounding surface already discloses the
   * arithmetic, so the split contributes the bar and its key line and nothing
   * else. The stock movement card is the case: its own "Show calculation" holds
   * the FIFO draw, and a second ledger of the same movement's dry and water
   * masses beside it reads as two competing breakdowns.
   */
  calculation?: boolean;
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
   * Provenance shown with the calculation, such as "Moisture from delivery
   * record". It explains where a number came from, so it sits with the
   * arithmetic rather than beside the bar.
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

interface DisplaySplit {
  split: MassSplit;
  /**
   * Whether dry mass came from the saved record rather than from the moisture
   * reading. The two cases have different arithmetic to explain.
   */
  dryMassIsStored: boolean;
}

function resolveDisplaySplit(
  wetMassKg: number | null | undefined,
  moisturePercent: number | null | undefined,
  dryMassKg: number | null | undefined,
): DisplaySplit | null {
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
      dryMassIsStored: true,
      split: {
        wetKg: wetMassKg,
        dryKg: dryMassKg,
        waterKg,
        moisturePercent:
          wetMassKg > 0 ? (waterKg / wetMassKg) * PERCENT_SCALE : 0,
        dryFraction: wetMassKg > 0 ? dryMassKg / wetMassKg : 1,
      },
    };
  }
  const split = splitWetMass(wetMassKg, moisturePercent);
  return split ? { split, dryMassIsStored: false } : null;
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

function KeyItem({
  swatch,
  children,
}: {
  swatch: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-6">
      <span aria-hidden="true" className={`${SWATCH} ${swatch}`} />
      {children}
    </span>
  );
}

/**
 * The one line under the bar. It names each segment and its mass, in the same
 * order the bar draws them, so the swatch is the only thing tying the two
 * together. Final moisture joins the line only when added water has moved it
 * away from the moisture the operator entered.
 */
function SplitKey({
  split,
  addedWaterState,
  materialLabel,
  dryLabel,
  finalMoistureLabel,
}: {
  split: MassSplit;
  addedWaterState: AddedWaterState | null;
  materialLabel?: string;
  dryLabel?: string;
  finalMoistureLabel?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-16 gap-y-4 body-caption text-[var(--color-text-secondary)] tabular-nums"
      aria-live="polite"
      aria-atomic="true"
    >
      <KeyItem swatch="bg-[var(--clr-dark-purple-80)]">
        {dryLabel ?? qualifyFigureLabel("Dry", materialLabel)}{" "}
        {formatSplitMass(split.dryKg)}
      </KeyItem>
      <KeyItem swatch="moisture-water-hatch border border-[var(--color-border-secondary)]">
        {addedWaterState
          ? MASS_MOISTURE_LABELS.waterBeforeAddition
          : MASS_MOISTURE_LABELS.water}{" "}
        {formatSplitMass(split.waterKg)}
      </KeyItem>
      {addedWaterState && (
        <>
          <KeyItem swatch="bg-[var(--color-moisture-added-water)]">
            {MASS_MOISTURE_LABELS.waterAdded}{" "}
            {formatSplitMass(addedWaterState.addedWaterKg)}
          </KeyItem>
          <span className="font-medium">
            {finalMoistureLabel ?? MASS_MOISTURE_LABELS.finalMoisture}{" "}
            {formatMoisturePercent(addedWaterState.finalSplit.moisturePercent)}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The arithmetic behind the ledger, in one sentence per step. It states the
 * rule and then the same rule with this record's numbers, so an operator can
 * check the figure without leaving the form.
 */
function formatSplitArithmetic({
  split,
  dryMassIsStored,
  addedWaterState,
}: {
  split: MassSplit;
  dryMassIsStored: boolean;
  addedWaterState: AddedWaterState | null;
}): string {
  const base = dryMassIsStored
    ? `Dry mass comes from the saved record. Water is the wet mass minus the dry mass: ${formatSplitMass(split.wetKg)} - ${formatSplitMass(split.dryKg)} = ${formatSplitMass(split.waterKg)}.`
    : `Dry = wet × (1 - moisture). ${formatSplitMass(split.wetKg)} × (1 - ${formatMoisturePercent(split.moisturePercent)}) = ${formatSplitMass(split.dryKg)}.`;
  if (!addedWaterState) return base;
  return `${base} Added water raises the wet mass and leaves dry mass unchanged: ${formatSplitMass(split.wetKg)} + ${formatSplitMass(addedWaterState.addedWaterKg)} = ${formatSplitMass(addedWaterState.finalSplit.wetKg)}.`;
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
  calculation = true,
  materialLabel,
  wetLabel,
  dryLabel,
  finalMoistureLabel,
  note,
  className = "",
}: MoistureSplitProps) {
  const parts = useSimplePresence("picture");
  const display = resolveDisplaySplit(wetMassKg, moisturePercent, dryMassKg);
  const unresolvedDryLabel =
    dryLabel ?? (materialLabel ? `${materialLabel} dry mass` : "Dry mass");

  if (!display) {
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
        <UnresolvedBar
          height={variant === "compact" ? COMPACT_BAR_HEIGHT : BAR_HEIGHT}
        />
        <p
          className="body-caption text-[var(--color-text-tertiary)]"
          aria-live="polite"
          aria-atomic="true"
        >
          {missing} not recorded. {unresolvedDryLabel} cannot be calculated.
        </p>
      </div>
    );
  }

  const { split, dryMassIsStored } = display;
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
          height={COMPACT_BAR_HEIGHT}
          addedWaterState={addedWaterState}
        />
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {formatMoisturePercent(displayedSplit.moisturePercent)} moisture
        </p>
      </div>
    );
  }

  // The bar and its key are what the two inputs mean, so they stay in Simple.
  // The table is the arithmetic behind them, which is what Detailed adds.
  const showCalculation = calculation && parts.detailed;

  return (
    <div className={`flex flex-col gap-12 ${className}`}>
      <div className="flex flex-col gap-8">
        <SplitBar
          split={split}
          height={BAR_HEIGHT}
          addedWaterState={addedWaterState}
        />
        <SplitKey
          split={split}
          addedWaterState={addedWaterState}
          materialLabel={materialLabel}
          dryLabel={dryLabel}
          finalMoistureLabel={finalMoistureLabel}
        />
      </div>

      {showCalculation && (
        <div className="flex flex-col gap-8">
          <CompositionLedger
            label={`${materialLabel ?? "Material"} composition`}
            totalLabel={wetLabel ?? "Wet total"}
            total={displayedSplit.wetKg}
            segments={[
              {
                label: unresolvedDryLabel,
                mass: split.dryKg,
                category: "dry-biochar",
              },
              {
                label: MASS_MOISTURE_LABELS.water,
                mass: split.waterKg,
                category: "existing-water",
              },
              ...(addedWaterState
                ? [
                    {
                      label: MASS_MOISTURE_LABELS.waterAdded,
                      mass: addedWaterState.addedWaterKg,
                      category: "added-water" as const,
                    },
                  ]
                : []),
            ]}
          />
          <p className="body-caption text-[var(--color-text-tertiary)]">
            {formatSplitArithmetic({ split, dryMassIsStored, addedWaterState })}
          </p>
          {note && <p className="body-caption">{note}</p>}
        </div>
      )}
    </div>
  );
}
