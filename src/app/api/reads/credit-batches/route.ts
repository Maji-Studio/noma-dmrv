import { readCreditBatches } from "@/lib/read-models";
import { readInput, readResponse } from "../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to get credit batches",
    invalidInputContext: "Invalid facility identifier",
    logContext: "read:credit-batches:list",
    read: async (ctx) => readCreditBatches(ctx, await readInput(request)),
  });
}
