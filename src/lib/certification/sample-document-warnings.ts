import type { CreditBatchSampling } from "@/schemas/credit-batches";

export interface SampleDocumentFacts {
  sampling: CreditBatchSampling;
  creditBatchCode: string;
  /** Undefined means document evidence has not been loaded. */
  hasLabReport?: boolean;
}

export function missingSampleLabReport(facts: SampleDocumentFacts): boolean {
  return facts.sampling === "sampled" && facts.hasLabReport === false;
}

export function sampleDocumentWarnings(facts: SampleDocumentFacts): string[] {
  return missingSampleLabReport(facts)
    ? [`Credit batch ${facts.creditBatchCode} has no lab report document. Upload a lab report to one of its Samples. You can still submit the Removal.`]
    : [];
}
