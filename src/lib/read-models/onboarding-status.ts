import { z } from "zod";
import { getOnboardingStatus } from "@/data-access/onboarding";
import type { OrgContext } from "@/lib/auth/server";

const onboardingStatusInputSchema = z.object({
  facilityId: z.uuid().nullable(),
});

export type OnboardingStatusInput = z.input<typeof onboardingStatusInputSchema>;

/**
 * Setup progress counts for the organization, plus one facility's counts when
 * a facility is selected. Every aggregate is filtered on the organization, so
 * a foreign facility id yields zero counts rather than foreign data.
 */
export async function readOnboardingStatus(ctx: OrgContext, input: unknown) {
  const { facilityId } = onboardingStatusInputSchema.parse(input);
  return getOnboardingStatus(ctx, facilityId);
}
