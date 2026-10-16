import { readCreditBatchActivitySummary } from "@/lib/read-models/credit-batch-activity";
import { readInput, readResponse } from "../../../read-response";

export const runtime = "nodejs";
export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to get credit batch activity",
    invalidInputContext: "Invalid activity filters",
    logContext: "read:credit-batches:activity:summary",
    read: async ctx => readCreditBatchActivitySummary(ctx, await readInput(request)),
  });
}
