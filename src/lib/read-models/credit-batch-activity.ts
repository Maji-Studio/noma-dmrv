import { z } from "zod";
import { getCreditBatchActivitySummary, listCreditBatchActivity } from "@/data-access/credit-batch-activity";
import { uuidSchema } from "@/schemas/helpers";
import type { OrgContext } from "@/lib/auth/server";
import { activityPageOptionsSchema } from "@/lib/activity-pagination";
import { activityFiltersSchema } from "@/lib/activity-filters";

const summaryInputSchema = z.object({
  creditBatchId: uuidSchema("Choose a valid credit batch."),
});
const inputSchema = activityPageOptionsSchema.extend(summaryInputSchema.shape).extend(activityFiltersSchema.shape);
export type CreditBatchActivityInput = z.input<typeof inputSchema>;
export type CreditBatchActivitySummaryInput = z.input<typeof summaryInputSchema>;

export async function readCreditBatchActivity(ctx: OrgContext, input: unknown) {
  const { creditBatchId, action, entityType, ...options } = inputSchema.parse(input);
  return listCreditBatchActivity(ctx, creditBatchId, options, { action, entityType });
}

export async function readCreditBatchActivitySummary(ctx: OrgContext, input: unknown) {
  const { creditBatchId } = summaryInputSchema.parse(input);
  return getCreditBatchActivitySummary(ctx, creditBatchId);
}
