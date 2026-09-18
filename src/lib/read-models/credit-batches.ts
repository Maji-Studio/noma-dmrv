import {
  getCreditBatches,
  type CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import { requireOrgFacility } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { facilityIdSchema } from "./facility-id";

/** Credit batches for one facility, for both read transports. */
export async function readCreditBatches(
  ctx: OrgContext,
  input: unknown,
): Promise<CreditBatchWithRelations[]> {
  const facilityId = facilityIdSchema.parse(input);
  await requireOrgFacility(ctx, facilityId);
  return getCreditBatches(ctx, facilityId);
}
