import { readDashboardBatchScope } from "@/lib/read-models";
import { readInput, readResponse } from "../../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load dashboard batch scope",
    invalidInputContext: "Invalid dashboard batch scope",
    logContext: "read:dashboard:batch-scope",
    read: async (ctx) => readDashboardBatchScope(ctx, await readInput(request)),
  });
}
