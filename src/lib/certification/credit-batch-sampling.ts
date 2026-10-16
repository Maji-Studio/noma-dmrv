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
