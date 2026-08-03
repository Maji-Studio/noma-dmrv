/**
 * The one vocabulary and the one arithmetic for wet mass, moisture and dry mass.
 *
 * Every biochar entity that carries a mass carries the same three quantities in
 * the same relationship:
 *
 *     wet mass  =  dry mass  +  water
 *     moisture  =  water / wet mass        (wet basis, 0–100 %)
 *
 * Dry mass is the figure carbon accounting is built on; wet mass is what the
 * scale reads. Before this module each surface said it differently ("Moisture
 * Content (%)", "Moisture (%)", "Moisture %"), formatted it differently, and
 * derived the split inline. Labels, precision and the split now come from here
 * so a feedstock batch, a delivery and a production run all read the same.
 *
 * Presentation lives in `@/components/ui/moisture-split`; the form inputs live
 * in `@/components/forms/mass-moisture-fields`. Server-side the
 * authoritative dry mass is still recomputed from `@/lib/calculations/mass-dry`
 * — anything derived here is operator feedback, never a submitted value.
 */

import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { formatMassKg, formatPercent } from "@/lib/format-utils";

/** Moisture is reported to one decimal everywhere; more reads as false precision. */
const MOISTURE_FRACTION_DIGITS = 1;

const PERCENT_MAX = 100;

/**
 * Canonical user-facing names. Use these instead of retyping a label — the
 * `*_FIELD_LABEL` variants carry the unit and are what `FormField` expects.
 */
export const MASS_MOISTURE_LABELS = {
  wet: "Wet mass",
  finalWet: "Final wet",
  dry: "Dry mass",
  water: "Water",
  waterBeforeAddition: "Water before addition",
  waterAdded: "Water added",
  moisture: "Moisture",
  finalMoisture: "Final moisture",
} as const;

export const WET_MASS_FIELD_LABEL = "Wet mass (kg)";
export const DRY_MASS_FIELD_LABEL = "Dry mass (kg)";
export const MOISTURE_FIELD_LABEL = "Moisture (%)";

/**
 * The one sentence that resolves the wet-basis/dry-basis ambiguity. Shown as
 * the moisture field's hint everywhere, so an operator never has to guess which
 * convention this app uses.
 */
/**
 * Qualify a mass/moisture label with what the mass IS ("Biochar" + "Wet mass
 * (kg)" -> "Biochar wet mass (kg)").
 *
 * Exported because read surfaces need the identical string the form produced —
 * a detail row and its form field are one label. While this lived privately in
 * the form component, read surfaces hand-typed the qualified label and drifted.
 */
export function qualifyMassLabel(
  base: string,
  materialLabel: string | undefined
): string {
  if (!materialLabel) return base;
  return `${materialLabel} ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}

export const MOISTURE_BASIS_HINT =
  "Share of the as-received wet mass that is water (wet basis).";

/**
 * The always-visible cue under a moisture input. Carries the basis as well as
 * the range: `MOISTURE_BASIS_HINT` sits behind an ⓘ, so this is the only place
 * the wet basis is on screen without an interaction.
 */
export const MOISTURE_RANGE_HELPER = "0 to 100% of wet mass";

export interface MassSplit {
  /** As-received mass. */
  wetKg: number;
  /** Water content in kg. */
  waterKg: number;
  /** Water-free mass — the carbon-accounting figure. */
  dryKg: number;
  /** Moisture on a wet basis, 0–100. */
  moisturePercent: number;
  /** Dry share of wet mass, 0–1 — the bar geometry. */
  dryFraction: number;
}

/**
 * Split a wet mass into its dry and water parts. Returns `null` when either
 * input is missing or out of range, which is the signal for callers to render
 * the "moisture not recorded" state rather than silently hiding the readout.
 */
export function splitWetMass(
  wetMassKg: number | null | undefined,
  moisturePercent: number | null | undefined
): MassSplit | null {
  if (wetMassKg == null || moisturePercent == null) return null;
  if (!Number.isFinite(wetMassKg) || !Number.isFinite(moisturePercent)) return null;
  if (wetMassKg < 0 || moisturePercent < 0 || moisturePercent > PERCENT_MAX) return null;

  const dryKg = Math.min(deriveMassDryKg(wetMassKg, moisturePercent), wetMassKg);
  const waterKg = Math.max(wetMassKg - dryKg, 0);

  return {
    wetKg: wetMassKg,
    waterKg,
    dryKg,
    moisturePercent,
    dryFraction: wetMassKg > 0 ? dryKg / wetMassKg : 1,
  };
}

/**
 * Apply added water to an existing wet-basis split. Dry matter is unchanged;
 * wet mass, water mass, and final moisture increase together.
 */
export function splitWetMassAfterAddedWater(
  wetMassKg: number | null | undefined,
  moisturePercent: number | null | undefined,
  addedWaterKg: number | null | undefined,
): MassSplit | null {
  const base = splitWetMass(wetMassKg, moisturePercent);
  const addedWater = addedWaterKg ?? 0;
  if (!base || !Number.isFinite(addedWater) || addedWater < 0) return null;
  if (addedWater === 0) return base;

  const finalWetKg = base.wetKg + addedWater;
  if (!Number.isFinite(finalWetKg)) return null;

  const finalWaterKg = base.waterKg + addedWater;
  return {
    wetKg: finalWetKg,
    waterKg: finalWaterKg,
    dryKg: base.dryKg,
    moisturePercent:
      finalWetKg > 0 ? (finalWaterKg / finalWetKg) * PERCENT_MAX : 0,
    dryFraction: finalWetKg > 0 ? base.dryKg / finalWetKg : 1,
  };
}

export function deriveEffectiveMoisturePercent(
  wetMassKg: number | null | undefined,
  moisturePercent: number | null | undefined,
  addedWaterKg: number | null | undefined,
): number | null {
  const split = splitWetMassAfterAddedWater(
    wetMassKg,
    moisturePercent,
    addedWaterKg,
  );
  if (!split || !Number.isFinite(split.wetKg) || split.wetKg <= 0) {
    return null;
  }
  return Math.min(
    Math.max(split.moisturePercent, 0),
    PERCENT_MAX,
  );
}

/**
 * Accept the loosely-typed values React Hook Form hands back from a watched
 * numeric field (which may still be a string mid-edit) and split them.
 */
export function splitWatchedWetMass(
  wetMassKg: unknown,
  moisturePercent: unknown
): MassSplit | null {
  return splitWetMass(parseWatchedNumber(wetMassKg), parseWatchedNumber(moisturePercent));
}

/**
 * Narrow a watched React Hook Form value to a finite number, or `null`.
 * `Number()` is not a substitute: it turns `null` and `""` into `0`, which
 * would render a cleared field as a real zero-mass split.
 */
export function parseWatchedNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Format a moisture percentage — one decimal, trailing ".0" trimmed, "—" for null. */
export function formatMoisturePercent(value: number | null | undefined): string {
  return formatPercent(value, { digits: MOISTURE_FRACTION_DIGITS });
}

/**
 * Split figures are always kg, never the auto-tonne `formatMass`.
 *
 * A 1,500 kg load at 2% moisture is 1,470 kg dry — in tonnes both round to
 * "1.5 t" and the readout claims no water was removed. Whole kg keeps a small
 * water fraction visible, and keeps the three figures directly subtractable,
 * which is the entire point of showing them together.
 */
export function formatSplitMass(kg: number | null | undefined): string {
  return formatMassKg(kg);
}

export interface WetDryMassFormatInput {
  wetKg: number | null | undefined;
  dryKg: number | null | undefined;
  moisturePercent?: number | null;
  /**
   * Derive dry mass only when moisture is the entity's source of truth.
   * A stored dry mass always takes precedence.
   */
  deriveDryWhenMissing?: boolean;
  /** Label before the wet value. */
  wetLabel?: string;
  /** Label before the dry value. */
  dryLabel?: string;
  /** Divider between wet and dry figures. */
  separator?: string;
  /** Whether kg is separated from the number by a space. */
  unitSpacing?: "spaced" | "compact";
}

/** Format one member of a wet/dry pair, preserving an explicit missing state. */
export function formatRecordedMass(
  kg: number | null | undefined,
  unitSpacing: "spaced" | "compact" = "spaced",
): string {
  if (kg == null || !Number.isFinite(kg) || kg < 0) {
    return "Not recorded";
  }

  const formatted = formatSplitMass(kg);
  return unitSpacing === "compact"
    ? formatted.replace(/ kg$/, "kg")
    : formatted;
}

/**
 * Compact mass pair for tables, pickers and cards. Both labels stay visible so
 * a lone kilogram value can never be mistaken for the other mass basis.
 */
export function formatWetDryMass({
  wetKg,
  dryKg,
  moisturePercent,
  deriveDryWhenMissing = false,
  wetLabel = "Wet",
  dryLabel = "Dry",
  separator = " · ",
  unitSpacing = "spaced",
}: WetDryMassFormatInput): string {
  const resolvedDryKg =
    dryKg == null && deriveDryWhenMissing
      ? splitWetMass(wetKg, moisturePercent)?.dryKg
      : dryKg;

  return `${wetLabel}: ${formatRecordedMass(
    wetKg,
    unitSpacing,
  )}${separator}${dryLabel}: ${formatRecordedMass(
    resolvedDryKg,
    unitSpacing,
  )}`;
}

/**
 * Screen-reader sentence for a split, spelled out in full because the bar's
 * geometry carries the meaning visually and conveys nothing to a screen reader.
 */
export function describeMassSplit(split: MassSplit): string {
  return `${formatSplitMass(split.wetKg)} wet: ${formatSplitMass(split.dryKg)} dry mass and ${formatSplitMass(split.waterKg)} water at ${formatMoisturePercent(split.moisturePercent)} moisture.`;
}

/** Screen-reader sentence for a split that distinguishes newly added water. */
export function describeMassSplitAfterAddedWater(
  split: MassSplit,
  addedWaterKg: number,
  finalSplit: MassSplit,
): string {
  return `${formatSplitMass(finalSplit.wetKg)} final wet mass: ${formatSplitMass(split.dryKg)} dry mass, ${formatSplitMass(split.waterKg)} water before addition, and ${formatSplitMass(addedWaterKg)} added water at ${formatMoisturePercent(finalSplit.moisturePercent)} moisture.`;
}

/** Compact one-line summary — "Wet: 1,000 kg · Dry: 800 kg". */
export function formatMassSplitInline(split: MassSplit): string {
  return formatWetDryMass({ wetKg: split.wetKg, dryKg: split.dryKg });
}
