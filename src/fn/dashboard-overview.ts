"use server";

import { z } from "zod";
import {
  getDashboardOverview,
  type DashboardOverview,
} from "@/data-access/dashboard-overview";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const dashboardOverviewInputSchema = z.object({
  facilityId: z.string().uuid().nullable().optional(),
  periodDays: z.number().int().min(1).max(365).optional(),
});

export type DashboardOverviewInput = z.input<typeof dashboardOverviewInputSchema>;

export async function loadDashboardOverview(
  input?: DashboardOverviewInput,
): Promise<ActionResult<DashboardOverview>> {
  return withAction(async (userId) => {
    const validated = dashboardOverviewInputSchema.parse(input ?? {});
    return getDashboardOverview(userId, {
      facilityId: validated.facilityId ?? null,
      periodDays: validated.periodDays,
    });
  });
}
