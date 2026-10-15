import { readCreditBatchActivity } from "@/lib/read-models/credit-batch-activity";
import { readInput, readResponse } from "../../read-response";

export const runtime = "nodejs";
export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to get credit batch activity",
    invalidInputContext: "Invalid activity filters",
    logContext: "read:credit-batches:activity",
    read: async ctx => readCreditBatchActivity(ctx, await readInput(request)),
  });
}
