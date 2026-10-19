/**
 * H/C_org and O/C_org for one lab Sample (round 7 Q50). The form and the
 * server share this module so the saved ratios can never disagree.
 *
 * - H/C_org is always calculated from hydrogen and organic carbon, or null
 *   when inputs are unusable or organic carbon is not positive. A lab H/C_org is never
 *   taken, and a cleared input clears the ratio.
 * - O/C_org is calculated whenever oxygen is present. A lab O/C_org is kept
 *   only when the sample has no oxygen figure.
 * - Calculated ratios are rounded to four decimals. A ratio that rounds above
 *   what `numeric(7,6)` stores is refused, never clamped.
 *
 * Pure and client-safe: no server-only imports.
 */

import { isUsableRatio } from "./biochar-eligibility";
import { SafeError } from "@/lib/errors";
import { RATIO_INPUT_MAX } from "@/schemas/helpers";

/** Molar masses (g/mol) the atomic ratios divide by. */
export const SAMPLE_RATIO_MOLAR_MASS = { hydrogen: 1.008, oxygen: 15.999, carbon: 12.011 } as const;
/** Decimals a calculated ratio is saved and shown at. */
export const SAMPLE_RATIO_DECIMALS = 4;

export type SampleRatioField = "hToCOrgRatio" | "oToCOrgRatio";
/** The input a calculated ratio is refused on: the element that drives it. */
export type SampleRatioSourceField = "totalHydrogenPercent" | "totalOxygenPercent";

export interface SampleRatioInputs {
  totalHydrogenPercent: number | null | undefined;
  totalOxygenPercent: number | null | undefined;
  organicCarbonPercent: number | null | undefined;
  /** A lab O/C_org, kept only when there is no oxygen figure. */
  oToCOrgRatio: number | null | undefined;
}

export interface SampleRatioNotice {
  field: SampleRatioField;
  message: string;
}

export interface SampleRatioPreview {
  hToCOrgRatio: number | null;
  oToCOrgRatio: number | null;
  /** `calculated` from oxygen, `lab` when the lab ratio is kept, null when there is none. */
  oToCOrgSource: "calculated" | "lab" | null;
}

export interface DerivedSampleRatios {
  hToCOrgRatio: number | null;
  oToCOrgRatio: number | null;
  /** One line per calculated ratio, for the write response's notices. */
  notices: SampleRatioNotice[];
}

const RATIO_LABELS: Record<SampleRatioField, { name: string; element: string; source: SampleRatioSourceField }> = {
  hToCOrgRatio: { name: "H/C_org", element: "hydrogen", source: "totalHydrogenPercent" },
  oToCOrgRatio: { name: "O/C_org", element: "oxygen", source: "totalOxygenPercent" },
};

/** A calculated ratio above the stored maximum, refused on the input that drives it. */
export class SampleRatioCapError extends SafeError {
  readonly ratio: SampleRatioField;
  readonly field: SampleRatioSourceField;
  readonly value: number;

  constructor(ratio: SampleRatioField, value: number) {
    const label = RATIO_LABELS[ratio];
    super(Number.isFinite(value)
      ? `${label.name} calculated from ${label.element} and organic carbon is ${formatSampleRatio(value)}, above the maximum of ${RATIO_INPUT_MAX}. Check the ${label.element} and organic carbon values.`
      // An organic carbon figure too small to divide by (a subnormal) gives no number at all.
      : `${label.name} cannot be calculated from these ${label.element} and organic carbon values. Check the ${label.element} and organic carbon values.`);
    this.name = "SampleRatioCapError";
    this.ratio = ratio;
    this.field = label.source;
    this.value = value;
  }
}

function atomicRatio(elementPercent: number | null | undefined, molarMass: number, organicCarbonPercent: number | null | undefined): number | null {
  if (!isUsableRatio(elementPercent) || !isUsableRatio(organicCarbonPercent) || organicCarbonPercent === 0) return null;
  return (elementPercent / molarMass) / (organicCarbonPercent / SAMPLE_RATIO_MOLAR_MASS.carbon);
}

/** Atomic H/C_org, `(H% / 1.008) / (Corg% / 12.011)`, unrounded; null for unusable inputs or non-positive organic carbon. */
export function calculateHToCOrgRatio(hydrogenPercent: number | null | undefined, organicCarbonPercent: number | null | undefined): number | null {
  return atomicRatio(hydrogenPercent, SAMPLE_RATIO_MOLAR_MASS.hydrogen, organicCarbonPercent);
}

/** Atomic O/C_org, `(O% / 15.999) / (Corg% / 12.011)`, unrounded; null for unusable inputs or non-positive organic carbon. */
export function calculateOToCOrgRatio(oxygenPercent: number | null | undefined, organicCarbonPercent: number | null | undefined): number | null {
  return atomicRatio(oxygenPercent, SAMPLE_RATIO_MOLAR_MASS.oxygen, organicCarbonPercent);
}

/** A ratio at the saved precision, as the form has always rounded it. */
export function roundSampleRatio(value: number): number {
  return parseFloat(value.toFixed(SAMPLE_RATIO_DECIMALS));
}

/** A ratio as shown and quoted: four decimals. */
export function formatSampleRatio(value: number): string {
  return value.toFixed(SAMPLE_RATIO_DECIMALS);
}

function rounded(value: number | null): number | null {
  return value === null ? null : roundSampleRatio(value);
}

/** Rounded ratios before preview filtering or persistence cap checks. */
function roundedSampleRatios(input: SampleRatioInputs): SampleRatioPreview {
  const hToCOrgRatio = rounded(calculateHToCOrgRatio(input.totalHydrogenPercent, input.organicCarbonPercent));
  if (input.totalOxygenPercent != null) {
    return { hToCOrgRatio, oToCOrgRatio: rounded(calculateOToCOrgRatio(input.totalOxygenPercent, input.organicCarbonPercent)), oToCOrgSource: "calculated" };
  }
  const lab = isUsableRatio(input.oToCOrgRatio) ? input.oToCOrgRatio : null;
  return { hToCOrgRatio, oToCOrgRatio: lab, oToCOrgSource: lab === null ? null : "lab" };
}

/** Live form ratios; negative and non-finite results remain unavailable. */
export function previewSampleRatios(input: SampleRatioInputs): SampleRatioPreview {
  const ratios = roundedSampleRatios(input);
  return {
    ...ratios,
    hToCOrgRatio: isUsableRatio(ratios.hToCOrgRatio) ? ratios.hToCOrgRatio : null,
    oToCOrgRatio: isUsableRatio(ratios.oToCOrgRatio) ? ratios.oToCOrgRatio : null,
  };
}

/**
 * The ratios to save for the effective sample (patch merged over the stored
 * row on an update). Throws `SampleRatioCapError` for a calculated ratio above
 * `RATIO_INPUT_MAX` after rounding, or one that is not a finite number. A lab O/C_org is not checked here: its
 * input schema already caps it.
 */
export function deriveSampleRatios(input: SampleRatioInputs): DerivedSampleRatios {
  const preview = roundedSampleRatios(input);
  const notices: SampleRatioNotice[] = [];
  const calculated: [SampleRatioField, number | null][] = [
    ["hToCOrgRatio", preview.hToCOrgRatio],
    ["oToCOrgRatio", preview.oToCOrgSource === "calculated" ? preview.oToCOrgRatio : null],
  ];
  for (const [field, value] of calculated) {
    if (value === null) continue;
    if (!Number.isFinite(value) || value > RATIO_INPUT_MAX) throw new SampleRatioCapError(field, value);
    const label = RATIO_LABELS[field];
    notices.push({ field, message: `${label.name} calculated from ${label.element} and organic carbon: ${formatSampleRatio(value)}` });
  }
  return { hToCOrgRatio: preview.hToCOrgRatio, oToCOrgRatio: preview.oToCOrgRatio, notices };
}
