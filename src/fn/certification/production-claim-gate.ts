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
 *   2. Fresh-read re-assert (`assertProductionClaimGateFresh`), immediately
 *      after `claimSubmissionDraft` — the blocking draft row now exists, so
 *      membership is frozen (`assertRemovalAllowsCreditBatchMutation` blocks
 *      regroups on BLOCKING_SUBMISSION_STATUSES, which includes `draft`) and
 *      no NEW foreign claim or membership/lineage drift can appear. One fresh
 *      scope read serves two asserts:
 *        a. no foreign claim was stamped in the window between context load
 *           and draft claim (would otherwise trip the rowcount backstop in
 *           `markSubmissionSubmitted` only AFTER the registry POSTs);
 *        b. the member-batch set and each batch's run/application lineage
 *           still match what the payload was built from — `updateCreditBatch`
 *           can regroup runs (or the batch itself) right up until the draft
 *           row exists, and the POST would otherwise ship the stale snapshot
 *           and then stamp a production claim for changed batch contents.
 *      A throw here leaves the draft locked until the lock TTL — safe
 *      (fail-closed, and the pre-flight gate re-fires loudly on retry).
 */
import { SafeError } from "@/lib/errors";
import { resolveScopeForRemoval } from "./certify-context-core";

export interface MemberBatchClaim {
  creditBatchId: string;
  code: string;
  claimedByRemovalId: string | null;
}

// The payload-relevant lineage of one member batch as the submission context
// loaded it (sorted). What the fresh re-assert compares against.
export interface MemberBatchLineage {
  creditBatchId: string;
  code: string;
  productionRunIds: string[];
  applicationIds: string[];
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

// Gate step 2 (see module docblock): one fresh scope read, two asserts.
export async function assertProductionClaimGateFresh(
  userId: string,
  removalId: string,
  expected: readonly MemberBatchLineage[],
): Promise<void> {
  const scope = await resolveScopeForRemoval(userId, removalId, {
    skipPreview: true,
  });
  assertNoForeignProductionClaims(
    scope.memberBatches.map((b) => ({
      creditBatchId: b.id,
      code: b.code,
      claimedByRemovalId: b.productionEmissionsClaimedByRemovalId,
    })),
    removalId,
  );
  assertMemberBatchLineageUnchanged(expected, scope.memberBatches);
}

// Pure fingerprint compare: same member-batch set, and per batch the same
// production-run and application sets. Order-insensitive.
export function assertMemberBatchLineageUnchanged(
  expected: readonly MemberBatchLineage[],
  fresh: readonly {
    id: string;
    code: string;
    productionRunIds: string[];
    applicationIds: string[];
  }[],
): void {
  const drifted = new Set<string>();
  const freshById = new Map(fresh.map((b) => [b.id, b]));
  for (const exp of expected) {
    const now = freshById.get(exp.creditBatchId);
    if (
      !now ||
      !sortedEqual(exp.productionRunIds, now.productionRunIds) ||
      !sortedEqual(exp.applicationIds, now.applicationIds)
    ) {
      drifted.add(exp.code);
    }
    freshById.delete(exp.creditBatchId);
  }
  for (const added of freshById.values()) {
    drifted.add(added.code);
  }
  if (drifted.size > 0) {
    throw new SafeError(
      `Credit batch membership or run lineage changed while preparing this ` +
        `submission (${[...drifted].sort().join(", ")}). Reload and retry.`,
    );
  }
}

function sortedEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, i) => value === sortedB[i]);
}
