import { z } from "zod";
import { getDashboardOverview } from "@/data-access/dashboard-overview";
import { requireOrgFacility } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { facilityIdSchema } from "./facility-id";

const dashboardOverviewInputSchema = z.object({
  facilityId: facilityIdSchema,
  range: z.enum(["week", "month", "all"]).default("month"),
});

/** Operator copy when the database schema lags the deployed dashboard. */
export const DASHBOARD_SCHEMA_MISMATCH_MESSAGE =
  "The dashboard and the database may be out of sync. Ask an administrator to apply the latest database update. Then reload this page.";

export type DashboardOverviewInput = z.input<typeof dashboardOverviewInputSchema>;

/**
 * One aggregate read per range selection: KPI band, traceability stations,
 * mass flow, attention queue and certification summary for one facility.
 */
export async function readDashboardOverview(ctx: OrgContext, input: unknown) {
  const { facilityId, range } = dashboardOverviewInputSchema.parse(input);
  await requireOrgFacility(ctx, facilityId);
  return getDashboardOverview(ctx, facilityId, range);
}
