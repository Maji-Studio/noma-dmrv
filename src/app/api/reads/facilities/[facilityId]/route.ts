import { readFacility } from "@/lib/read-models";
import { readResponse } from "../../read-response";

export const runtime = "nodejs";

export function POST(
  _request: Request,
  context: { params: Promise<{ facilityId: string }> },
): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load facility",
    invalidInputContext: "Invalid facility identifier",
    logContext: "read:facilities:detail",
    read: async (ctx) => readFacility(ctx, (await context.params).facilityId),
  });
}
