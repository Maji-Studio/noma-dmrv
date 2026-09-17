import { isDatabaseSchemaMismatchError } from "@/db/errors";
import {
  DASHBOARD_SCHEMA_MISMATCH_MESSAGE,
  readDashboardOverview,
} from "@/lib/read-models";
import { readInput, readResponse } from "../../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load the dashboard overview",
    invalidInputContext: "Invalid dashboard filters",
    logContext: "read:dashboard:overview",
    read: async (ctx) => readDashboardOverview(ctx, await readInput(request)),
    knownFaultMessage: (error) =>
      isDatabaseSchemaMismatchError(error)
        ? DASHBOARD_SCHEMA_MISMATCH_MESSAGE
        : undefined,
  });
}
