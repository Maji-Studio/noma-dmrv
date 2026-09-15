import { readProductionRuns } from "@/fn/read-models";
import { readInput, readResponse } from "../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load production runs",
    invalidInputContext: "Invalid production run filters",
    logContext: "read:production-runs:list",
    read: async (ctx) => readProductionRuns(ctx, await readInput(request)),
  });
}
