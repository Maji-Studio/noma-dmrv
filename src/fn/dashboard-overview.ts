"use server";

import { z } from "zod";
import {
  getDashboardOverview,
  type DashboardOverview,
} from "@/data-access/dashboard-overview";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgContext } from "@/lib/auth/server";
import type { ActionResult } from "@/types/actions";
import { toLoggedActionError } from "./action-errors";

const getDashboardOverviewSchema = z.object({
  facilityId: z.uuid(),
  range: z.enum(["30d", "ytd", "all"]).default("30d"),
});

export type GetDashboardOverviewInput = z.input<typeof getDashboardOverviewSchema>;

/**
 * Facility dashboard overview: KPI strip, needs-attention queue, feedstock
 * mix, and the custody-flow ribbon — one aggregate read per range selection.
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
        error: `Validation error: ${error.issues.map((e) => e.message).join(", ")}`,
      };
    }
    return {
      success: false,
      error: toLoggedActionError(
        error,
        "Failed to load the dashboard overview",
        {
          message: "dashboard overview action failed",
          context: { op: "dashboard-overview:get" },
        },
      ),
    };
  }
}
