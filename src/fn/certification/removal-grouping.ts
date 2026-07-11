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

// Hub-facing action — submit an existing removal directly by id.
export async function submitRemovalAction(
  input: SubmitRemovalInput | string,
): Promise<ActionResult<RemovalSubmissionResult>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = submitRemovalSchema.parse(
      typeof input === "string" ? { removalId: input } : input,
    );
    return submitRemoval({
      orgCtx,
      removalId: parsed.removalId,
      confirmProduction: parsed.confirmProduction,
    });
  }, { rateLimit: submitRateLimit("cert:submit-removal") });
}
