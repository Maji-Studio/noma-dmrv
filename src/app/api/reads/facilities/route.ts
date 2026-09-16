import { readFacilities } from "@/lib/read-models";
import { readInput, readResponse } from "../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load facilities",
    invalidInputContext: "Invalid facility filters",
    logContext: "read:facilities:list",
    read: async (ctx) => readFacilities(ctx, await readInput(request)),
  });
}
