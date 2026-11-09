import { z } from "zod";
import { getDashboardBatchScope } from "@/data-access/dashboard-batch-scope";
import { requireOrgFacility } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { uuidSchema } from "@/schemas/helpers";
import { facilityIdSchema } from "./facility-id";

const dashboardBatchScopeInputSchema = z.object({
  facilityId: facilityIdSchema,
  creditBatchId: uuidSchema("Choose a valid credit batch.").nullable(),
});
export type DashboardBatchScopeInput = z.input<typeof dashboardBatchScopeInputSchema>;

export async function readDashboardBatchScope(ctx: OrgContext, input: unknown) {
  const { facilityId, creditBatchId } = dashboardBatchScopeInputSchema.parse(input);
  await requireOrgFacility(ctx, facilityId);
  return getDashboardBatchScope(ctx, facilityId, creditBatchId);
}
