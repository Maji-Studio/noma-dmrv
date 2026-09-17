import { z } from "zod";
import { getDashboardOverview } from "@/data-access/dashboard-overview";
import { requireOrgFacility } from "@/data-access/utils";
import { isDatabaseSchemaMismatchError } from "@/db/errors";
import { logActionError } from "@/fn/action-errors";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";

const dashboardOverviewInputSchema = z.object({
  facilityId: z.uuid(),
  range: z.enum(["week", "month", "all"]).default("month"),
});

export const DASHBOARD_SCHEMA_MISMATCH_MESSAGE =
  "The dashboard and the database may be out of sync. Ask an administrator to apply the latest database update. Then reload this page.";

export type DashboardOverviewInput = z.input<typeof dashboardOverviewInputSchema>;

export async function readDashboardOverview(ctx: OrgContext, input: unknown) {
  const { facilityId, range } = dashboardOverviewInputSchema.parse(input);
  try {
    await requireOrgFacility(ctx, facilityId);
    return await getDashboardOverview(ctx, facilityId, range);
  } catch (error) {
    if (isDatabaseSchemaMismatchError(error)) {
      logActionError(error, {
        message: "dashboard overview action failed",
        context: { op: "dashboard-overview:get", schemaMismatch: true },
      });
      throw new SafeError(DASHBOARD_SCHEMA_MISMATCH_MESSAGE);
    }
    throw error;
  }
}
