/**
 * The Sample form keeps an emptied number input as `undefined`, which the
 * partial-update contract reads as "keep the stored value". On submit every
 * optional measurement the operator emptied becomes `null`, so clearing
 * hydrogen clears it (and with it H/C_org) instead of silently restoring it.
 * Total and organic carbon are required and never cleared.
 */

import { deriveSampleRatios, type SampleRatioInputs } from "@/lib/calculations/sample-ratios";

export const SAMPLE_CLEARABLE_NUMBER_FIELDS = [
  "weightGrams", "volumeMl", "inorganicCarbonPercent",
  "totalHydrogenPercent", "totalNitrogenPercent", "totalOxygenPercent", "totalSulfurPercent",
  "ashContentPercent", "moistureContentPercent", "bulkDensityKgPerM3", "ph", "saltContentGPerKg",
  "oToCOrgRatio", "randomReflectanceR0Percent", "sReflectanceFraction", "r0MeasurementCount",
  "reactiveCarbonPercent", "residualCarbonPercent",
  "phosphorusPercent", "potassiumPercent", "magnesiumPercent", "calciumPercent", "ironPercent",
] as const;

export function withClearedMeasurements<T extends object>(data: T): T {
  const cleared = { ...data } as Record<string, unknown>;
  for (const field of SAMPLE_CLEARABLE_NUMBER_FIELDS) {
    if (cleared[field] === undefined) cleared[field] = null;
  }
  return cleared as T;
}

export const SAMPLING_CLOCK_NO_BATCH_HINT = "Choose a credit batch to enter the sampling time on its facility clock.";
export const SAMPLING_CLOCK_LOADING_HINT = "Loading the credit batch facility clock.";
export const SAMPLING_CLOCK_FAILED_HINT = "The credit batch facility clock could not be loaded. Close the form and open it again.";

/**
 * The clock the sampling time is entered on (round 7 Q51). Only the selected
 * credit batch's facility zone is trusted: while it loads, after a failed
 * lookup, or with no batch chosen, the time cannot be entered or saved, so a
 * wall time is never read on another facility's clock. `timeZone` is then a
 * display placeholder for the disabled input only.
 */
export type SamplingClock =
  | { ready: true; timeZone: string; hint: string }
  | { ready: false; timeZone: string; hint: string };

export function resolveSamplingClock(args: {
  creditBatchId: string | null | undefined;
  lookup: "pending" | "error" | "success";
  batchTimeZone: string | null | undefined;
  placeholderTimeZone: string;
  cue: (timeZone: string) => string;
}): SamplingClock {
  const blocked = (hint: string): SamplingClock => ({ ready: false, timeZone: args.placeholderTimeZone, hint });
  if (!args.creditBatchId) return blocked(SAMPLING_CLOCK_NO_BATCH_HINT);
  if (args.lookup === "pending") return blocked(SAMPLING_CLOCK_LOADING_HINT);
  if (args.lookup === "error" || !args.batchTimeZone) return blocked(SAMPLING_CLOCK_FAILED_HINT);
  return { ready: true, timeZone: args.batchTimeZone, hint: args.cue(args.batchTimeZone) };
}

/**
 * The editable lab O/C_org a saved sample opens with. A sample with oxygen
 * stored a calculated ratio, which is not a lab figure: the field starts empty
 * and the preview shows the calculation. Otherwise clearing oxygen would
 * submit the old calculated ratio as if the lab had reported it.
 */
export function labOToCOrgRatioDefault(
  sample: { totalOxygenPercent: number | null; oToCOrgRatio: number | null } | null | undefined,
): number | undefined {
  if (!sample || sample.totalOxygenPercent != null) return undefined;
  return sample.oToCOrgRatio ?? undefined;
}

/**
 * The payload the form submits: emptied measurements cleared, and both ratios
 * as the server will store them, from the helper the server shares (round 7
 * Q50). Throws `SampleRatioCapError` for a calculated ratio the column cannot hold.
 */
export function prepareSampleSubmission<T extends SampleRatioInputs>(entered: T): T & { hToCOrgRatio: number | null; oToCOrgRatio: number | null } {
  const data = withClearedMeasurements(entered);
  const ratios = deriveSampleRatios(data);
  // null clears a stored ratio on edit, as the partial-update contract reads it.
  return { ...data, hToCOrgRatio: ratios.hToCOrgRatio, oToCOrgRatio: ratios.oToCOrgRatio };
}
