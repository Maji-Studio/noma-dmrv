import { readActiveOrganization } from "@/lib/read-models";
import { readResponse } from "../../read-response";

export const runtime = "nodejs";

export function POST(): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load organization",
    logContext: "read:organizations:active",
    read: (ctx) => readActiveOrganization(ctx),
  });
}
