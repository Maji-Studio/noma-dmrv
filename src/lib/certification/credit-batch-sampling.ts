import { SafeError } from "@/lib/errors";
import { formatCount } from "@/lib/copy-utils";

export function getUnsampledBatchEligibilityIssue(
  eligibility: {
    eligibleSampleCount: number;
    agreedBaselineSize: number;
    unsampledAllowed: boolean;
  },
): string | null {
  if (eligibility.unsampledAllowed) return null;
  return `This process has ${formatCount(eligibility.eligibleSampleCount, "qualifying Method-A Sample")}. Record at least ${eligibility.agreedBaselineSize} and complete the Method-B prerequisites before creating an unsampled credit batch.`;
}

/** Fail closed before persisting an unsampled credit-batch boundary choice. */
export function assertUnsampledBatchEligibility(
  eligibility: Parameters<typeof getUnsampledBatchEligibilityIssue>[0],
): void {
  const issue = getUnsampledBatchEligibilityIssue(eligibility);
  if (issue) throw new SafeError(issue);
}
