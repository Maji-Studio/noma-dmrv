import type { CreditBatchSampling } from "@/schemas/credit-batches";

export interface SampleDocumentFacts {
  sampling: CreditBatchSampling;
  creditBatchCode: string;
  /** Undefined means document evidence has not been loaded. */
  hasLabReport?: boolean;
  hasReflectanceHistogram?: boolean;
  durabilityOption?: "200_year" | "1000_year" | null;
}

export function missingSampleLabReport(facts: SampleDocumentFacts): boolean {
  return facts.sampling === "sampled" && facts.hasLabReport === false;
}

export function missingSampleReflectanceHistogram(facts: SampleDocumentFacts): boolean {
  return facts.sampling === "sampled" && facts.durabilityOption === "1000_year" && facts.hasReflectanceHistogram === false;
}

/** The phrase each warning carries, so readers can tell the two apart. */
export const NO_LAB_REPORT_PHRASE = "has no lab report document";
export const NO_REFLECTANCE_HISTOGRAM_PHRASE = "has no reflectance histogram document";

export function sampleDocumentWarnings(facts: SampleDocumentFacts): string[] {
  const warnings: string[] = [];
  if (missingSampleLabReport(facts)) {
    warnings.push(`Credit batch ${facts.creditBatchCode} ${NO_LAB_REPORT_PHRASE}. Upload a lab report to one of its Samples. You can still submit the Removal.`);
  }
  if (missingSampleReflectanceHistogram(facts)) {
    warnings.push(`Credit batch ${facts.creditBatchCode} ${NO_REFLECTANCE_HISTOGRAM_PHRASE}. Upload a reflectance histogram to one of its Samples. You can still submit the Removal.`);
  }
  return warnings;
}
