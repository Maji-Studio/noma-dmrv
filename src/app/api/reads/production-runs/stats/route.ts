import { readProductionRunStats } from "@/lib/read-models";
import { readInput, readResponse } from "../../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load production run stats",
    invalidInputContext: "Invalid facility identifier",
    logContext: "read:production-runs:stats",
    read: async (ctx) => readProductionRunStats(ctx, await readInput(request)),
  });
}
