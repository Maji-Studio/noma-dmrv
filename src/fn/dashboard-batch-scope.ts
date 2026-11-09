"use server";

import { z } from "zod";
import {
  getDashboardBatchScope,
  type DashboardBatchScope,
} from "@/data-access/dashboard-batch-scope";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const dashboardBatchScopeSchema = z.object({
  facilityId: z.uuid(),
  creditBatchId: z.uuid().nullable(),
});

export async function getDashboardBatchScopeFn(input: {
  facilityId: string;
  creditBatchId: string | null;
}): Promise<ActionResult<DashboardBatchScope>> {
  return withAction(async (ctx) => {
    const { facilityId, creditBatchId } = dashboardBatchScopeSchema.parse(input);
    return getDashboardBatchScope(ctx, facilityId, creditBatchId);
  }, {
    zodErrorPrefix: "Invalid dashboard batch scope",
    fallbackMessage: "Failed to load dashboard batch scope",
  });
}
