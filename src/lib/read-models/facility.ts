import { getFacilityById } from "@/data-access/facilities";
import type { OrgContext } from "@/lib/auth/server";
import { facilityIdSchema } from "./facility-id";

/**
 * One facility of the organization. The data-access lookup is already
 * org-scoped and raises the missing-record message the detail hook keys its
 * retry rule on, so no separate facility guard runs first.
 */
export async function readFacility(ctx: OrgContext, input: unknown) {
  return getFacilityById(ctx, facilityIdSchema.parse(input));
}
