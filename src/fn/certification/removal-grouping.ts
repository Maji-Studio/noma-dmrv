"use server";

import {
  submitRemovalSchema,
  type SubmitRemovalInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { submitRemoval, type RemovalSubmissionResult } from "./submit-removal";
import { submitRateLimit } from "./shared";
import { requireOrgRole } from "@/lib/auth/server";

// Compatibility/fallback action for direct server consumers. The current UI
// uses the streaming API route; keep this admin guard and rate-limit key in
// sync with src/app/api/certification/submissions/route.ts.
export async function submitRemovalAction(
  input: SubmitRemovalInput,
): Promise<ActionResult<RemovalSubmissionResult>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = submitRemovalSchema.parse(input);
    return submitRemoval({
      orgCtx,
      removalId: parsed.removalId,
      confirmProduction: parsed.confirmProduction,
      expectedCompilationHash: parsed.compilationHash,
    });
  }, { rateLimit: submitRateLimit("cert:submit-removal") });
}
