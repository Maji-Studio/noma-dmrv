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

/** Which Sample document a batch lacks, for readers that word it themselves. */
export type SampleDocumentWarningKey = "labReport" | "reflectanceHistogram";

export function sampleDocumentWarningKeys(facts: SampleDocumentFacts): SampleDocumentWarningKey[] {
  const keys: SampleDocumentWarningKey[] = [];
  if (missingSampleLabReport(facts)) keys.push("labReport");
  if (missingSampleReflectanceHistogram(facts)) keys.push("reflectanceHistogram");
  return keys;
}

export function sampleDocumentWarnings(facts: SampleDocumentFacts): string[] {
  const warnings: string[] = [];
  if (missingSampleLabReport(facts)) {
    warnings.push(`Credit batch ${facts.creditBatchCode} has no lab report document. Upload a lab report to one of its Samples. You can still submit the Removal.`);
  }
  if (missingSampleReflectanceHistogram(facts)) {
    warnings.push(`Credit batch ${facts.creditBatchCode} has no reflectance histogram document. Upload a reflectance histogram to one of its Samples. You can still submit the Removal.`);
  }
  return warnings;
}
