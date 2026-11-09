import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";
import { InterruptedRemovalChangedError } from "@/lib/certification/interrupted-removal-copy";
import { readRemovalSubmissionExternalMutation } from "./removal-submission-failure";
import { SafeError } from "@/lib/errors";
import { payloadHash } from "@/lib/isometric";
import { loadRemovalSubmissionContext } from "@/lib/certification/certify-context-core";
import { retireClaimedRemovalDraftForDrift } from "./production-claim-gate";
import { buildRemovalSubmissionBuild } from "@/lib/certification/removal-submission-build";
import { prepareRemovalSubmission } from "@/lib/certification/removal-submission-prepare";

// Blockers that mean the recheck could not read what it needs, not that the
// Removal's data or settings changed. With any of them present the other
// blockers (lines to decide, missing fixed datapoints) may only reflect the
// unread template, so a possibly sent draft stays retryable (#1114).
const RECHECK_FAILURE_BLOCKERS: ReadonlySet<string> = new Set([
  "templateNotFullyRead",
  "noCredentials",
  "noProject",
]);

/** A failed read cannot prove drift, even when other blockers accompany it. */
export function hasRemovalRecheckFailure(blockers: readonly { code: string }[]): boolean {
  return blockers.some((blocker) => RECHECK_FAILURE_BLOCKERS.has(blocker.code));
}

/** Refuse before claiming anything; a possibly sent draft must stay intact for deletion. */
export function assertRemovalPreflightBlockers(
  latest: Pick<CertificationSubmissionRow, "status" | "externalId" | "metadata"> | null | undefined,
  blockers: readonly { code: string; message: string }[],
): void {
  if (!blockers.length) return;
  const possiblySentDraft = latest?.status === "draft" &&
    (latest.externalId || readRemovalSubmissionExternalMutation(latest.metadata) !== "none");
  if (possiblySentDraft && !hasRemovalRecheckFailure(blockers)) {
    throw new InterruptedRemovalChangedError();
  }
  throw new SafeError(blockers[0].message);
}

export async function assertClaimedRemovalPayloadFresh(args: {
  orgCtx: OrgContext;
  removalId: string;
  row: CertificationSubmissionRow;
  preserveForReconciliation: boolean;
}): Promise<void> {
  const { orgCtx, removalId, row } = args;
  const retireForDrift = (reason: string, changed: boolean) =>
    retireClaimedRemovalDraftForDrift({
      orgCtx,
      submissionId: row.id,
      reason,
      preserveForReconciliation: args.preserveForReconciliation,
      changed,
    });
  const freshCtx = await loadRemovalSubmissionContext(orgCtx, removalId, { refreshEnrichment: true, claimedSubmissionId: row.id });
  const { prepared, blockers } = prepareRemovalSubmission(freshCtx);
  if (blockers.length > 0 || !prepared) {
    const durabilityOnly = blockers.length > 0 && blockers.every(
      (blocker) => blocker.code === "durabilityUnavailable",
    );
    if (durabilityOnly) {
      await retireForDrift(
        "durability measurement-sample gate changed after draft claim",
        true,
      );
      throw new SafeError(
        "Removal template configuration changed while preparing this submission. The draft was retired; reload and submit again.",
      );
    }
    const recheckIncomplete = blockers.length === 0 || hasRemovalRecheckFailure(blockers);
    await retireForDrift("semantic payload rebuild failed after draft claim", !recheckIncomplete);
    throw new SafeError(
      "Removal source data or template configuration changed while preparing this submission. The draft was retired; reload and submit again.",
    );
  }

  let freshBuild: Awaited<ReturnType<typeof buildRemovalSubmissionBuild>>;
  try {
    freshBuild = await buildRemovalSubmissionBuild({
      orgCtx,
      removalId,
      ctx: freshCtx,
      prepared,
    });
  } catch (error) {
    await retireForDrift("semantic payload rebuild failed after draft claim", false);
    throw error;
  }
  const freshHash = payloadHash(freshBuild.semanticPayload);
  if (freshHash === row.payloadHash) return;

  await retireForDrift(
    `semantic payload drift: snapshot ${String(row.payloadHash)} != current ${freshHash}`,
    true,
  );
  throw new SafeError(
    "Removal source data changed while preparing this submission. The stale draft was retired; reload and submit again.",
  );
}
