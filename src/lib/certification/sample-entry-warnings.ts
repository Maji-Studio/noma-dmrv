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
      warnings.push(`Sample ${facts.sampleCode} has no ${joinWithAnd(missing)}. A 1,000-year Removal with credit batch ${facts.creditBatchCode} cannot be submitted until every Sample has them.`);
    }
  }
  if (facts.totalHydrogenPercent == null) {
    warnings.push(`Sample ${facts.sampleCode} has no total hydrogen, so H/C_org cannot be calculated. The biochar module requires H/C_org for every production batch (Table 2).`);
  }
  if (facts.moistureContentPercent == null) {
    warnings.push(`Sample ${facts.sampleCode} has no moisture content. The biochar module requires moisture for every production batch (Table 2).`);
  }
  if (is1000Year && (facts.r0MeasurementCount == null || facts.r0MeasurementCount < R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE)) {
    const counted = facts.r0MeasurementCount == null
      ? `Sample ${facts.sampleCode} has no R₀ measurement count.`
      : `Sample ${facts.sampleCode} has ${facts.r0MeasurementCount} R₀ measurements.`;
    warnings.push(`${counted} For 1,000-year crediting the biochar module asks for at least ${R0_MEASUREMENTS_PER_SAMPLE_GUIDANCE} per Sample. You can still submit the Removal.`);
  }
  return warnings;
}
