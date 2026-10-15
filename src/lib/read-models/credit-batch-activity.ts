import { z } from "zod";
import { getCreditBatchActivitySummary, listCreditBatchActivity } from "@/data-access/credit-batch-activity";
import type { OrgContext } from "@/lib/auth/server";
import { activityPageOptionsSchema } from "@/lib/activity-pagination";

const inputSchema = activityPageOptionsSchema.extend({
  creditBatchId: z.uuid({ error: "Choose a valid credit batch." }),
});
export async function readCreditBatchActivity(ctx: OrgContext, input: unknown) {
  const { creditBatchId, ...options } = inputSchema.parse(input);
  return listCreditBatchActivity(ctx, creditBatchId, options);
}

export async function readCreditBatchActivitySummary(ctx: OrgContext, input: unknown) {
  const { creditBatchId } = inputSchema.pick({ creditBatchId: true }).parse(input);
  return getCreditBatchActivitySummary(ctx, creditBatchId);
}
