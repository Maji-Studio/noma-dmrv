import type { z } from "zod";
import { getCreditBatchActivitySummary, listCreditBatchActivity } from "@/data-access/credit-batch-activity";
import { uuidSchema } from "@/schemas/helpers";
import type { OrgContext } from "@/lib/auth/server";
import { activityPageOptionsSchema } from "@/lib/activity-pagination";

const inputSchema = activityPageOptionsSchema.extend({
  creditBatchId: uuidSchema("Choose a valid credit batch."),
});
const summaryInputSchema = inputSchema.pick({ creditBatchId: true });
export type CreditBatchActivityInput = z.input<typeof inputSchema>;
export type CreditBatchActivitySummaryInput = z.input<typeof summaryInputSchema>;

export async function readCreditBatchActivity(ctx: OrgContext, input: unknown) {
  const { creditBatchId, ...options } = inputSchema.parse(input);
  return listCreditBatchActivity(ctx, creditBatchId, options);
}

export async function readCreditBatchActivitySummary(ctx: OrgContext, input: unknown) {
  const { creditBatchId } = summaryInputSchema.parse(input);
  return getCreditBatchActivitySummary(ctx, creditBatchId);
}
