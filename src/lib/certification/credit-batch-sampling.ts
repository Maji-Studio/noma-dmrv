import { SafeError } from "@/lib/errors";
import { formatCount } from "@/lib/copy-utils";

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
    `Unsampled credit batches are not available. Record the Method-B prerequisites and at least ${eligibility.agreedBaselineSize} eligible Samples. This process has ${formatCount(eligibility.eligibleSampleCount, "eligible Sample")}.`,
  );
}
