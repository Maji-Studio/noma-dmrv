"use server";

import { listSubmissionStatusHistory } from "@/data-access/submission-status-history";
import type { SubmissionStatusHistory } from "@/lib/certification/status-history";
import {
  loadSubmissionStatusHistorySchema,
  type LoadSubmissionStatusHistoryInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";

/** Status history behind a Removal or GHG Statement badge, read on open. */
export async function loadSubmissionStatusHistory(
  input: LoadSubmissionStatusHistoryInput,
): Promise<ActionResult<SubmissionStatusHistory>> {
  return withAction(
    async (orgCtx) => {
      const parsed = loadSubmissionStatusHistorySchema.parse(input);
      return listSubmissionStatusHistory(orgCtx, parsed.entityType, parsed.entityId);
    },
    {
      fallbackMessage: "The status history could not be loaded. Try again.",
      log: {
        message: "Failed to load submission status history",
        context: { op: "loadSubmissionStatusHistory", entityType: input?.entityType },
      },
    },
  );
}
