"use server";

import {
  assignCreditBatchToRemoval,
  ensureRemovalForCreditBatch,
} from "@/data-access/certifier-removals";
import {
  assignCreditBatchToRemovalSchema,
  submitRemovalSchema,
  type AssignCreditBatchToRemovalInput,
  type SubmitRemovalInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { submitRemoval, type RemovalSubmissionResult } from "./submit-removal";
import { submitRateLimit } from "./shared";

// Hub-facing action — submit an existing removal directly by id.
export async function submitRemovalAction(
  input: SubmitRemovalInput | string,
): Promise<ActionResult<RemovalSubmissionResult>> {
  return withAction(async (userId) => {
    const parsed = submitRemovalSchema.parse(
      typeof input === "string" ? { removalId: input } : input,
    );
    return submitRemoval({
      userId,
      removalId: parsed.removalId,
      confirmProduction: parsed.confirmProduction,
    });
  }, { rateLimit: submitRateLimit("cert:submit-removal") });
}

// Creates (or returns) the removal for a credit batch without submitting —
// the Removals hub uses this to start a fresh removal that sibling batches
// can then be grouped into.
export async function ensureRemovalForCreditBatchAction(
  creditBatchId: string,
): Promise<ActionResult<{ removalId: string }>> {
  return withAction(async (userId) => {
    const removalId = await ensureRemovalForCreditBatch(userId, creditBatchId);
    return { removalId };
  });
}

// N:1 grouping — move a credit batch onto `removalId`, or detach it with
// `null`. The data-access layer enforces same-facility and blocks regrouping
// when either the source or target removal has a non-terminal submission.
export async function assignCreditBatchToRemovalAction(
  input: AssignCreditBatchToRemovalInput,
): Promise<ActionResult<{ ok: true }>> {
  return withAction(async (userId) => {
    const parsed = assignCreditBatchToRemovalSchema.parse(input);
    await assignCreditBatchToRemoval(
      userId,
      parsed.creditBatchId,
      parsed.removalId,
    );
    return { ok: true as const };
  });
}
