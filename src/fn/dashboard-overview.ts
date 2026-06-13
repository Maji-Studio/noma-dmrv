"use server";

import { z } from "zod";
import {
  getDashboardOverview,
  type DashboardOverview,
} from "@/data-access/dashboard-overview";
import { getUser } from "@/lib/auth/server";
import type { ActionResult } from "@/types/actions";

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
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = getDashboardOverviewSchema.parse(input);

    const overview = await getDashboardOverview(
      user.id,
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
      error:
        error instanceof Error
          ? error.message
          : "Failed to load the dashboard overview",
    };
  }
}
