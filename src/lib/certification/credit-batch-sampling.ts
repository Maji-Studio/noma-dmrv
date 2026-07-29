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
    `This process has ${formatCount(eligibility.eligibleSampleCount, "qualifying Method-A Sample")}. Record at least ${eligibility.agreedBaselineSize} and complete the Method-B prerequisites before creating an unsampled credit batch.`,
  );
}
