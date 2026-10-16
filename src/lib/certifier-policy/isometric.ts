import { getUnsampledBatchEligibilityIssue } from "@/lib/certification/credit-batch-sampling";

type BatchEligibilityInput = { sampling: "sampled" } | {
  sampling: "unsampled";
  certifier: string | null;
  hasIsometricCredentials: boolean;
  methodBEligibility: Parameters<typeof getUnsampledBatchEligibilityIssue>[0];
};

type BatchEligibility = { eligible: true } | { eligible: false; message: string };

/** Write-time Isometric sampling rules; the caller supplies transaction-scoped facts. */
export function isBatchEligible(batch: BatchEligibilityInput): BatchEligibility {
  if (batch.sampling === "sampled") return { eligible: true };
  if (batch.certifier !== "isometric" || !batch.hasIsometricCredentials) {
    return {
      eligible: false,
      message: "Unsampled credit batches require an Isometric connection for the organization and facility.",
    };
  }
  const issue = getUnsampledBatchEligibilityIssue(batch.methodBEligibility);
  return issue ? { eligible: false, message: issue } : { eligible: true };
}
