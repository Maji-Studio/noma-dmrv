import { readOnboardingStatus } from "@/lib/read-models";
import { readInput, readResponse } from "../../read-response";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return readResponse({
    fallbackMessage: "Failed to load onboarding status",
    logContext: "read:onboarding:status",
    read: async (ctx) => readOnboardingStatus(ctx, await readInput(request)),
  });
}
