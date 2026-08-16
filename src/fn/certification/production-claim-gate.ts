/**
 * §8.6.2 production-emissions claim gate (issue #349, ADR 0020).
 *
 * A credit batch's production-bucket emissions submit exactly once: unclaimed
 * batches and batches claimed by THIS removal (resubmit/supersede) contribute
 * production inputs. A batch claimed by a DIFFERENT removal remains valid in
 * the scope, but its production bucket is suppressed by the compiler.
 *
 * The fresh-read re-assert (`assertProductionClaimGateFresh`) runs immediately
 * after `claimSubmissionDraft`. It verifies the frozen slice set, run lineage,
 * and claim ownership, then lets only the earliest active draft submit an
 * unclaimed batch's production inputs. New unassigned downstream slices remain
 * valid and do not change the Removal being submitted. The full semantic
 * payload is rebuilt afterward to catch same-ID source-data edits that lineage
 * IDs cannot represent.
 */
import type { OrgContext } from "@/lib/auth/server";
import {
  retireStaleSubmissionDraft,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import { listProductionClaimDraftContenders } from "@/data-access/certifier-removals";
import { SafeError } from "@/lib/errors";
import { MAPPING_REVISION } from "@/lib/isometric/transformers/datapoint";
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
  claimedByRemovalId: string | null;
}

const INTERRUPTED_REMOVAL_DRIFT_MESSAGE =
  "This interrupted Removal may already exist in the registry, but its source data or calculation settings changed. Ask support to reconcile it before retrying.";

export async function retireClaimedRemovalDraftForDrift(args: {
  orgCtx: OrgContext;
  submissionId: string;
  reason: string;
  preserveForReconciliation: boolean;
}): Promise<void> {
  if (args.preserveForReconciliation) {
    throw new SafeError(INTERRUPTED_REMOVAL_DRIFT_MESSAGE);
  }
  await retireStaleSubmissionDraft(args.orgCtx, args.submissionId, {
    reason: args.reason,
  });
}

// See module docblock: one fresh scope read verifies lineage and claim state.
export async function assertProductionClaimGateFresh(
  orgCtx: OrgContext,
  removalId: string,
  expected: readonly MemberBatchLineage[],
  submissionId: string,
): Promise<void> {
  const scope = await resolveScopeForRemoval(orgCtx, removalId);
  assertMemberBatchLineageUnchanged(expected, scope.memberBatches);
  const unclaimedBatchIds = expected
    .filter((batch) => batch.claimedByRemovalId == null)
    .map((batch) => batch.creditBatchId);
  const contenders =
    (await listProductionClaimDraftContenders(orgCtx, unclaimedBatchIds)) ?? [];
  const winnerByBatchId = new Map<
    string,
    (typeof contenders)[number]
  >();
  for (const contender of contenders) {
    if (!winnerByBatchId.has(contender.creditBatchId)) {
      winnerByBatchId.set(contender.creditBatchId, contender);
    }
  }
  const lost = expected.filter((batch) => {
    if (batch.claimedByRemovalId != null) return false;
    const winner = winnerByBatchId.get(batch.creditBatchId);
    return winner != null &&
      (winner.removalId !== removalId || winner.submissionId !== submissionId);
  });
  if (lost.length > 0) {
    throw new SafeError(
      `Another Removal started claiming production inputs for credit batch ${lost
        .map((batch) => batch.code)
        .sort()
        .join(", ")}. Wait for that submission to finish, then reload and retry.`,
    );
  }
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
    productionEmissionsClaimedByRemovalId: string | null;
  }[],
): void {
  const drifted = new Set<string>();
  const freshById = new Map(fresh.map((b) => [b.id, b]));
  for (const exp of expected) {
    const now = freshById.get(exp.creditBatchId);
    if (
      !now ||
      !sortedEqual(exp.productionRunIds, now.productionRunIds) ||
      !sortedEqual(exp.applicationIds, now.applicationIds) ||
      exp.claimedByRemovalId !== now.productionEmissionsClaimedByRemovalId
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
      `Credit batch membership, run lineage, or production claim changed while preparing this ` +
        `submission (${[...drifted].sort().join(", ")}). Reload and retry.`,
    );
  }
}

// Resume gate (ADR 0020): a resumed draft's snapshot is transport truth, but
// a snapshot built under an older INPUT_MAPPING revision encodes obsolete
// accounting (e.g. pre-front-loading prorated production values). Completing
// it would POST those stale datapoint bodies and then stamp the production
// claim off them. Retire the draft (terminal `superseded`, non-blocking — see
// retireStaleSubmissionDraft for why not `rejected`) and fail closed; the next
// attempt mints a fresh version from live data under the current revision. An
// interrupted draft with possible registry state is preserved for support
// reconciliation instead. Missing `__mappingRevision` (pre-ADR-0005 snapshot)
// counts as stale.
export async function assertResumedSnapshotRevisionCurrent(
  orgCtx: OrgContext,
  row: CertificationSubmissionRow,
  preserveForReconciliation = false,
): Promise<void> {
  const revision = (row.payloadSnapshot as { __mappingRevision?: unknown } | null)
    ?.__mappingRevision;
  if (revision === MAPPING_REVISION) return;
  await retireClaimedRemovalDraftForDrift({
    orgCtx,
    submissionId: row.id,
    reason: `mapping revision drift: snapshot ${String(revision)} != current ${MAPPING_REVISION}`,
    preserveForReconciliation,
  });
  throw new SafeError(
    "This Removal draft uses older calculation settings. Submit again to rebuild it with current data.",
  );
}

function sortedEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, i) => value === sortedB[i]);
}
