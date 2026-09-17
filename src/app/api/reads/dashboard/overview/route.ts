import { readDashboardOverview } from "@/lib/read-models";
import { readInput, readResponse } from "../../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load the dashboard overview",
    logContext: "read:dashboard:overview",
    read: async (ctx) => readDashboardOverview(ctx, await readInput(request)),
  });
}
