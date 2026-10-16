"use server";

import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { getCo2eStoredPreviews } from "@/data-access/credit-batch-accounting";
import { requireOrgFacility } from "@/data-access/utils";
import { logger } from "@/lib/log";
import { SafeError } from "@/lib/errors";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import {
  compileRemovalSubmission,
  REMOVAL_COMPILATION_FAILED_MESSAGE,
  type CompiledRemovalSubmission,
  type RemovalSubmissionReview,
} from "./removal-submission-build";
import { evaluateRemovalBlockers } from "./removal-blockers-gate";
import { legacyBlocker, type RemovalBlocker } from "@/lib/certification/removal-blockers";
import { prepareRemovalSubmission } from "./removal-submission-prepare";
import { reviewPayloadHash } from "@/lib/certification/removal-review-hash";

export interface RemovalCompilationView {
  /** Null when preparation is blocked before anything could be compiled. */
  review: RemovalSubmissionReview | null;
  blockers: string[];
  removalBlockers: RemovalBlocker[];
  warnings: string[];
  snapshot: CompiledRemovalSubmission["snapshot"];
  compilationHash: string | null;
  estimatedStoredCo2eTonnes: number | null;
  estimateMissingInputs: string[];
}

export async function loadRemovalCompilation(
  facilityId: string,
  removalId: string,
): Promise<ActionResult<RemovalCompilationView>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const removal = await getCertifierRemovalById(orgCtx, removalId);
    if (!removal || removal.facilityId !== facilityId) {
      throw new SafeError("Removal does not belong to requested facility");
    }

    const ctx = await loadRemovalSubmissionContext(orgCtx, removalId, { refreshEnrichment: true });
    const preparation = prepareRemovalSubmission(ctx);
    let removalBlockers: RemovalBlocker[];
    try {
      removalBlockers = await evaluateRemovalBlockers({ orgCtx, removalId, ctx });
    } catch (error) {
      if (error instanceof SafeError) throw error;
      logger.error(
        { organizationId: orgCtx.organizationId, removalId },
        "removal preflight build failed",
      );
      removalBlockers = [legacyBlocker(REMOVAL_COMPILATION_FAILED_MESSAGE)];
    }
    const blockers = removalBlockers.map((blocker) => blocker.message);
    if (!preparation.prepared) {
      return {
        review: null,
        blockers,
        removalBlockers,
        warnings: [...(ctx.submissionWarnings ?? [])],
        snapshot: null,
        compilationHash: null,
        estimatedStoredCo2eTonnes: null,
        estimateMissingInputs: [],
      };
    }

    const compiled = await compileRemovalSubmission({
      orgCtx,
      removalId,
      ctx,
      prepared: preparation.prepared,
      allowPendingSources: true,
    });
    // Rich review compilation also walks candidate Sources. A blocker it finds
    // after a clear preflight still blocks: list it so no snapshot or hash is
    // handed out, and the operator sees why.
    if (removalBlockers.length === 0) {
      removalBlockers.push(...compiled.blockers.map((message) => legacyBlocker(message)));
      blockers.push(...compiled.blockers);
    }
    const previews = await getCo2eStoredPreviews(
      orgCtx,
      ctx.memberBatches.map((batch) => batch.id),
      { removalId },
    );
    const batchPreviews = ctx.memberBatches.map(
      (batch) => previews[batch.id],
    );
    const estimateComplete = batchPreviews.length > 0 && batchPreviews.every(
      (preview) => preview?.co2eStoredTonnes != null,
    );
    const estimateMissingInputs = [
      ...new Set(
        batchPreviews.flatMap((preview) => preview?.missingInputs ?? []),
      ),
    ];

    return {
      review: compiled.review,
      blockers,
      removalBlockers,
      warnings: compiled.warnings,
      snapshot: blockers.length === 0 ? compiled.snapshot : null,
      compilationHash:
        blockers.length === 0 && compiled.snapshot
          ? reviewPayloadHash(compiled.snapshot.semanticPayload)
          : null,
      estimatedStoredCo2eTonnes: estimateComplete
        ? batchPreviews.reduce(
            (total, preview) => total + (preview?.co2eStoredTonnes ?? 0),
            0,
          )
        : null,
      estimateMissingInputs,
    };
  });
}
