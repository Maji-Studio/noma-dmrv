"use server";

import { z } from "zod";
import {
  getOnboardingStatus,
  type OnboardingStatus,
} from "@/data-access/onboarding";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const onboardingStatusInputSchema = z.object({
  facilityId: z.uuid().nullable(),
});

export type FetchOnboardingStatusInput = z.infer<
  typeof onboardingStatusInputSchema
>;

export async function fetchOnboardingStatus(
  input: FetchOnboardingStatusInput,
): Promise<ActionResult<OnboardingStatus>> {
  return withAction((ctx) => {
    const validated = onboardingStatusInputSchema.parse(input);
    return getOnboardingStatus(ctx, validated.facilityId);
  });
}
