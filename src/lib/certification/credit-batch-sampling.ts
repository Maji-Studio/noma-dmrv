import { SafeError } from "@/lib/errors";

/** Fail closed before persisting an unsampled credit-batch boundary choice. */
export function assertUnsampledBatchEligibility(
  eligibility: {
    eligibleSampleCount: number;
    agreedBaselineSize: number;
    unsampledAllowed: boolean;
  },
): void {
  if (eligibility.unsampledAllowed) return;
  throw new SafeError(
    `Unsampled credit batches are not available: ${eligibility.eligibleSampleCount} of ${eligibility.agreedBaselineSize} eligible samples and recorded Method-B prerequisites are required.`,
  );
}
