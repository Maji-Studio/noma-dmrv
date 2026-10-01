import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { payloadHash } from "@/lib/isometric";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import { retireClaimedRemovalDraftForDrift } from "./production-claim-gate";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";
import { prepareRemovalSubmission } from "./removal-submission-prepare";

export async function assertClaimedRemovalPayloadFresh(args: {
  orgCtx: OrgContext;
  removalId: string;
  row: CertificationSubmissionRow;
  preserveForReconciliation: boolean;
}): Promise<void> {
  const { orgCtx, removalId, row } = args;
  const retireForDrift = (reason: string) =>
    retireClaimedRemovalDraftForDrift({
      orgCtx,
      submissionId: row.id,
      reason,
      preserveForReconciliation: args.preserveForReconciliation,
    });
  const freshCtx = await loadRemovalSubmissionContext(orgCtx, removalId);
  const { prepared, blockers } = prepareRemovalSubmission(freshCtx);
  if (blockers.length > 0 || !prepared) {
    const durabilityOnly = blockers.length > 0 && blockers.every(
      (blocker) => blocker.code === "durabilityUnavailable",
    );
    if (durabilityOnly) {
      await retireForDrift(
        "durability measurement-sample gate changed after draft claim",
      );
      throw new SafeError(
        "Removal template configuration changed while preparing this submission. The draft was retired; reload and submit again.",
      );
    }
    await retireForDrift("semantic payload rebuild failed after draft claim");
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
    await retireForDrift("semantic payload rebuild failed after draft claim");
    throw error;
  }
  const freshHash = payloadHash(freshBuild.semanticPayload);
  if (freshHash === row.payloadHash) return;

  await retireForDrift(
    `semantic payload drift: snapshot ${String(row.payloadHash)} != current ${freshHash}`,
  );
  throw new SafeError(
    "Removal source data changed while preparing this submission. The stale draft was retired; reload and submit again.",
  );
}
