/**
 * Non-blocking warnings a lab Sample write returns (round 7 Q52, Q53). The
 * write is saved either way; each line says what the registry submission will
 * need. The 1,000-year measurement rule is the submission gate's own
 * (`missingSampled1000YearMeasurements`), so entry and submission cannot
 * disagree on it. Pure and client-safe.
 *
 * Protocol basis (biochar-storage-agricultural-soils module v1.1): Table 2
 * marks moisture and H/C_organic "Required" for every production batch, and
 * Option 2 says proponents "should report a set of at least 500 measurements
 * of R0, calculated at the maceral-level, for each sample of their biochar".
 * "Should" is guidance, so the R₀ count never blocks submission.
 */

import type { CreditBatchSampling } from "@/schemas/credit-batches";
import { MINIMUM_REPLICATES_PER_BATCH } from "@/lib/calculations/biochar-eligibility";
import { missingSampled1000YearMeasurements } from "./durability-1000-replicates";

/** Module v1.1 Option 2: R₀ readings per Sample for 1,000-year crediting. */
export const R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE = 500;

export interface SampleEntryFacts {
  sampleCode: string;
  creditBatchCode: string;
  /** The batch facility's declared tier; null when the batch has no facility tier. */
  durabilityOption: "200_year" | "1000_year" | null;
  sampling: CreditBatchSampling;
  totalCarbonPercent: number | null;
  inorganicCarbonPercent: number | null;
  sReflectanceFraction: number | null;
  totalHydrogenPercent: number | null;
  moistureContentPercent: number | null;
  r0MeasurementCount: number | null;
  organicCarbonPercent: number | null;
  totalOxygenPercent: number | null;
  /** The ratios as saved: derived from the effective row, or the kept lab O/C_org. */
  hToCOrgRatio: number | null;
  oToCOrgRatio: number | null;
}

/**
 * Gate (c) counts only replicates with both H/C_org and O/C_org
 * (`durability-submission-gates.ts`), so a Sample missing either does not
 * help its batch reach the minimum. Worded after that gate's blocker.
 */
function missingRatioWarning(facts: SampleEntryFacts): string | null {
  const missing = [
    facts.hToCOrgRatio == null ? "H/C_org" : null,
    facts.oToCOrgRatio == null ? "O/C_org" : null,
  ].filter((ratio): ratio is string => ratio != null);
  if (missing.length === 0) return null;
  const line = `Sample ${facts.sampleCode} has no ${joinWithAnd(missing)}, so it is not one of the ${MINIMUM_REPLICATES_PER_BATCH} Samples with complete H/C_org and O/C_org results credit batch ${facts.creditBatchCode} needs before submitting.`;
  if (facts.organicCarbonPercent === 0) {
    const cause = missing.length > 1 ? "neither ratio can be calculated" : `${missing[0]} cannot be calculated`;
    return `${line} With organic carbon at 0, ${cause}. Check the organic carbon value.`;
  }
  if (facts.oToCOrgRatio == null && facts.totalOxygenPercent == null) {
    return `${line} Enter total oxygen, or the lab's O/C_org when the lab reported no oxygen.`;
  }
  // A missing hydrogen figure has its own line below.
  return line;
}

function joinWithAnd(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function sampleEntryWarnings(facts: SampleEntryFacts): string[] {
  const warnings: string[] = [];
  const is1000Year = facts.durabilityOption === "1000_year";

  // Same scope as the gate: sampled 1,000-year batches submit this tuple per Sample.
  if (is1000Year && facts.sampling === "sampled") {
    const missing = missingSampled1000YearMeasurements(facts);
    if (missing.length > 0) {
      warnings.push(`Sample ${facts.sampleCode} is missing ${joinWithAnd(missing)}. A 1,000-year Removal with credit batch ${facts.creditBatchCode} cannot be submitted until every Sample has ${missing.length === 1 ? "it" : "them"}.`);
    }
  }
  // Unsampled batches submit through the unsampled blueprint; the gate does not judge their chemistry.
  const ratioWarning = facts.sampling === "sampled" ? missingRatioWarning(facts) : null;
  if (facts.sampling === "sampled" && facts.totalHydrogenPercent == null) {
    warnings.push(`Sample ${facts.sampleCode} has no total hydrogen, so H/C_org cannot be calculated. The biochar module requires H/C_org for every production batch (Table 2).`);
  }
  if (facts.moistureContentPercent == null) {
    warnings.push(`Sample ${facts.sampleCode} has no moisture content. The biochar module requires moisture for every production batch (Table 2).`);
  }
  if (ratioWarning) warnings.push(ratioWarning);
  if (is1000Year && (facts.r0MeasurementCount == null || facts.r0MeasurementCount < R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE)) {
    const counted = facts.r0MeasurementCount == null
      ? `Sample ${facts.sampleCode} has no R₀ measurement count.`
      : `Sample ${facts.sampleCode} has ${facts.r0MeasurementCount} R₀ measurements.`;
    warnings.push(`${counted} For 1,000-year crediting the biochar module asks for at least ${R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE} per Sample. You can still submit the Removal.`);
  }
  return warnings;
}
