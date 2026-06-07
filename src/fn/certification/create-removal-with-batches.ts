"use server";

import { createRemovalWithCreditBatches } from "@/data-access/certifier-removals";
import { deriveBatchHealth } from "@/lib/certification/batch-health";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import {
  createRemovalWithBatchesSchema,
  type CreateRemovalWithBatchesInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  buildCreditBatchContextWithFacts,
  loadFacilityCertifierFacts,
} from "./certify-context-core";

// Deferred-create: the New-Removal wizard holds off creating the removal until
// the operator confirms a batch selection. This action IS that confirm — and it
// is SERVER-AUTHORITATIVE: the client's selection gate is UX only, so before any
// write it re-derives every selected batch's health from the batch's own certify
// context and rejects the whole request unless each batch is ungrouped, in
// `facilityId`, and `state === "ready"`. Only then does the data-access layer
// atomically create the removal and assign the batches (re-checking
// ungrouped/same-facility under row locks). Returns the new removal id so the
// wizard can advance into its requirements step.
export async function createRemovalWithBatchesAction(
  input: CreateRemovalWithBatchesInput,
): Promise<ActionResult<{ removalId: string }>> {
  return withAction(async (userId) => {
    const { facilityId, creditBatchIds } =
      createRemovalWithBatchesSchema.parse(input);
    const uniqueIds = Array.from(new Set(creditBatchIds));
    const log = logger.child({
      op: "certifier-removal:create-with-batches",
      facilityId,
      batchCount: uniqueIds.length,
    });
    log.info("certifier removal create requested");

    // Every selected batch shares one facility, so resolve the facility's
    // certifier facts (incl. its Isometric registry calls) ONCE and reuse them
    // across the per-batch re-validation instead of re-fetching per batch.
    const facilityFacts = await loadFacilityCertifierFacts(userId, facilityId);

    // Re-validate per batch against the live context — never trust the client's
    // gate. Each ungrouped batch resolves a 1:1 scope, so `ctx.facilityId` /
    // `ctx.removalId` describe the batch alone: the same load that feeds the
    // classifier also confirms same-facility + ungrouped.
    for (const batchId of uniqueIds) {
      const ctx = await buildCreditBatchContextWithFacts(
        userId,
        batchId,
        facilityFacts,
      );
      const code =
        ctx.memberBatches.find((b) => b.id === batchId)?.code ??
        "A selected credit batch";

      if (ctx.removalId !== null) {
        throw new SafeError(`${code} is already grouped into a removal.`);
      }
      if (ctx.facilityId !== facilityId) {
        throw new SafeError(`${code} belongs to a different facility.`);
      }

      const health = deriveBatchHealth(toBatchHealthFacts(ctx, batchId));
      if (health.state !== "ready") {
        const noun = health.issueCount === 1 ? "issue" : "issues";
        throw new SafeError(
          `${code} isn't ready to certify (${health.issueCount} unresolved ${noun}).`,
        );
      }
    }

    const removalId = await createRemovalWithCreditBatches(
      userId,
      facilityId,
      uniqueIds,
    );
    log.info({ removalId }, "certifier removal created");
    return { removalId };
  });
}
