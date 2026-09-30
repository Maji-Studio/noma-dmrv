"use server";

import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { getCo2eStoredPreviews } from "@/data-access/credit-batch-accounting";
import { requireOrgFacility } from "@/data-access/utils";
import { SafeError } from "@/lib/errors";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import {
  compileRemovalSubmission,
  type CompiledRemovalSubmission,
  type RemovalSubmissionReview,
} from "./removal-submission-build";
import { prepareRemovalSubmission } from "./removal-submission-prepare";
import { reviewPayloadHash } from "@/lib/certification/removal-review-hash";

export interface RemovalCompilationView {
  /** Null when preparation is blocked before anything could be compiled. */
  review: RemovalSubmissionReview | null;
  blockers: string[];
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

    const ctx = await loadRemovalSubmissionContext(orgCtx, removalId);
    const preparation = prepareRemovalSubmission(ctx);
    const preparationBlockers = preparation.blockers.map(
      (blocker) => blocker.message,
    );
    if (!preparation.prepared) {
      return {
        review: null,
        blockers: preparationBlockers,
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
    const blockers = [...preparationBlockers, ...compiled.blockers];

    return {
      review: compiled.review,
      blockers,
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
