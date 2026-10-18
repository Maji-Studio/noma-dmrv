// Imported by path: the read-models barrel would load every other read core.
import { readRecordLocks } from "@/lib/read-models/record-locks";
import { readInput, readResponse } from "../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Record locks could not be loaded.",
    invalidInputContext: "Invalid record lock request",
    logContext: "read:record-locks",
    read: async (ctx) => readRecordLocks(ctx, await readInput(request)),
  });
}
