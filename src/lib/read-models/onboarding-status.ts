import { z } from "zod";
import { getOnboardingStatus } from "@/data-access/onboarding";
import type { OrgContext } from "@/lib/auth/server";

const onboardingStatusInputSchema = z.object({
  facilityId: z.uuid().nullable(),
});

export type OnboardingStatusInput = z.input<typeof onboardingStatusInputSchema>;

/**
 * Setup progress counts for the organization, plus one facility's counts when
 * a facility is selected. The facility guard runs inside the data-access read
 * (alongside its aggregate query), so a foreign facility id is rejected there.
 */
export async function readOnboardingStatus(ctx: OrgContext, input: unknown) {
  const { facilityId } = onboardingStatusInputSchema.parse(input);
  return getOnboardingStatus(ctx, facilityId);
}
