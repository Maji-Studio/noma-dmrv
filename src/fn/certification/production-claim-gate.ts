/**
 * §8.6.2 production-emissions claim gate (issue #349, ADR 0020).
 *
 * A credit batch's production-bucket emissions submit exactly once: unclaimed
 * batches and batches claimed by THIS removal (resubmit/supersede) proceed; a
 * batch claimed by a DIFFERENT removal fails closed — the delivery-only
 * follow-up entry is gated behind issue #353.
 *
 * The gate runs TWICE per submit, both times before any registry POST:
 *
 *   1. Pre-flight, against the loaded context (`ctx.memberBatchClaims`) —
 *      cheap, fails before the evidence-ledger HTTP work.
 *   2. Fresh-read re-assert, immediately after `claimSubmissionDraft` — the
 *      blocking draft row now exists, so membership is frozen
 *      (`assertRemovalAllowsCreditBatchMutation` blocks regroups on
 *      BLOCKING_SUBMISSION_STATUSES, which includes `draft`) and no NEW
 *      foreign claim can appear; a foreign claim stamped in the window
 *      between context load and draft claim is caught here. This closes the
 *      TOCTOU where the guarded UPDATE in `markSubmissionSubmitted` would
 *      otherwise silently no-op AFTER the registry POSTs already happened.
 *      A throw here leaves the draft locked until the lock TTL — safe
 *      (fail-closed, and the pre-flight gate re-fires loudly on retry).
 */
import { getCreditBatchesByRemovalId } from "@/data-access/certifier-removals";
import { SafeError } from "@/lib/errors";

export interface MemberBatchClaim {
  creditBatchId: string;
  code: string;
  claimedByRemovalId: string | null;
}

export function assertNoForeignProductionClaims(
  claims: readonly MemberBatchClaim[],
  removalId: string,
): void {
  const foreignClaims = claims.filter(
    (b) => b.claimedByRemovalId != null && b.claimedByRemovalId !== removalId,
  );
  if (foreignClaims.length > 0) {
    throw new SafeError(
      `Production emissions for ${foreignClaims.map((b) => b.code).join(", ")} ` +
        "were already claimed by another removal (§8.6.2 front-loading). " +
        "A delivery-only follow-up entry is not yet supported (issue #353).",
    );
  }
}

// Fresh-read variant (gate step 2 above): re-reads the member batches' claim
// columns from the database rather than trusting the context loaded before
// the draft claim.
export async function assertNoForeignProductionClaimsFresh(
  userId: string,
  removalId: string,
): Promise<void> {
  const batches = await getCreditBatchesByRemovalId(userId, removalId);
  assertNoForeignProductionClaims(
    batches.map((b) => ({
      creditBatchId: b.id,
      code: b.code,
      claimedByRemovalId: b.productionEmissionsClaimedByRemovalId,
    })),
    removalId,
  );
}
