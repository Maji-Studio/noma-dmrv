import { z } from "zod";

import {
  getCreditBatches,
  type CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import { requireOrgFacility } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";

const facilityIdSchema = z.string().uuid("Choose a valid facility.");

export async function readCreditBatches(
  ctx: OrgContext,
  input: unknown,
): Promise<CreditBatchWithRelations[]> {
  const facilityId = facilityIdSchema.parse(input);
  await requireOrgFacility(ctx, facilityId);
  return getCreditBatches(ctx, facilityId);
}
