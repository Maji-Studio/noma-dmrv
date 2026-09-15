import { readFacilityCertifierSummary } from "@/fn/read-models";
import { readResponse } from "../../../read-response";

export const runtime = "nodejs";

export function POST(
  _request: Request,
  context: { params: Promise<{ facilityId: string }> },
): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load certification settings",
    invalidInputContext: "Invalid facility identifier",
    logContext: "read:facilities:certifier-summary",
    read: async (ctx) =>
      readFacilityCertifierSummary(ctx, (await context.params).facilityId),
  });
}
