// Imported by path: the read-models barrel would load every other read core.
import { readRecordUsedByChain } from "@/lib/read-models/record-used-by-chain";
import { readInput, readResponse } from "../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "These records could not be loaded.",
    invalidInputContext: "Invalid record",
    logContext: "read:record-used-by-chain",
    read: async (ctx) => readRecordUsedByChain(ctx, await readInput(request)),
  });
}
