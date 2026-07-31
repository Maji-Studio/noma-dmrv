"use server";

import { z } from "zod";
import {
  getDashboardOverview,
  type DashboardOverview,
} from "@/data-access/dashboard-overview";
import { requireOrgFacility } from "@/data-access/utils";
import { isDatabaseSchemaMismatchError } from "@/db/errors";
import { requireOrgContext } from "@/lib/auth/server";
import type { ActionResult } from "@/types/actions";
import {
  formatZodActionError,
  toLoggedActionError,
} from "./action-errors";

const getDashboardOverviewSchema = z.object({
  facilityId: z.uuid(),
  range: z.enum(["week", "month", "all"]).default("month"),
});

const DASHBOARD_SCHEMA_MISMATCH_MESSAGE =
  "The dashboard and the database may be out of sync. Ask an administrator to apply the latest database update. Then reload this page.";

export type GetDashboardOverviewInput = z.input<typeof getDashboardOverviewSchema>;

/**
 * Facility dashboard overview: KPI band, traceability stations, mass flow,
 * needs-attention queue, activity feed, and certification summary — one
 * aggregate read per range selection.
 */
export async function getDashboardOverviewFn(
  input: GetDashboardOverviewInput,
): Promise<ActionResult<DashboardOverview>> {
  try {
    const ctx = await requireOrgContext();

    const validated = getDashboardOverviewSchema.parse(input);
    await requireOrgFacility(ctx, validated.facilityId);

    const overview = await getDashboardOverview(
      ctx,
      validated.facilityId,
      validated.range,
    );

    return { success: true, data: overview };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: formatZodActionError(error),
      };
    }
    const schemaMismatch = isDatabaseSchemaMismatchError(error);

    return {
      success: false,
      error: toLoggedActionError(
        error,
        schemaMismatch
          ? DASHBOARD_SCHEMA_MISMATCH_MESSAGE
          : "Failed to load the dashboard overview",
        {
          message: "dashboard overview action failed",
          context: {
            op: "dashboard-overview:get",
            ...(schemaMismatch ? { schemaMismatch: true } : {}),
          },
        },
      ),
    };
  }
}
