"use server";

import { z } from "zod";
import {
  getDashboardStats,
  type DashboardStats,
} from "@/data-access/dashboard-stats";
import { getUser } from "@/lib/auth/server";
import type { ActionResult } from "@/types/actions";

/**
 * Schema for dashboard stats request
 */
const getDashboardStatsSchema = z.object({
  facilityId: z.string().uuid().optional(),
  periodDays: z.number().min(1).max(365).optional().default(30),
});

export type GetDashboardStatsInput = z.input<typeof getDashboardStatsSchema>;

/**
 * Get dashboard statistics
 * Returns counts and trends for key metrics
 */
export async function getDashboardStatsFn(
  input?: GetDashboardStatsInput
): Promise<ActionResult<DashboardStats>> {
  try {
    const user = await getUser();
    if (!user?.id) {
      return { success: false, error: "Unauthorized" };
    }

    const validated = getDashboardStatsSchema.parse(input ?? {});

    const stats = await getDashboardStats(
      validated.facilityId,
      validated.periodDays
    );

    return { success: true, data: stats };
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
        error instanceof Error ? error.message : "Failed to load dashboard stats",
    };
  }
}
