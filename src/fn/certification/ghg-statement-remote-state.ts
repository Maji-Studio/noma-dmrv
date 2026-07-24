import type { OrgContext } from "@/lib/auth/server";
import {
  clearTerminalStatusForResubmit,
  setSubmissionTerminalStatus,
  updateSubmissionMetadata,
  type CertificationSubmissionRow,
  type Tx,
} from "@/data-access/certification";
import {
  getGhgStatementPeriod,
  type GhgStatement,
} from "@/lib/isometric";
import { SUBMISSION_METADATA_KEYS } from "@/lib/isometric/utils/submission-metadata";

export async function applyGhgRemoteState(
  orgCtx: OrgContext,
  submission: CertificationSubmissionRow,
  remote: GhgStatement,
  extraMetadata: Record<string, unknown> = {},
  tx?: Tx,
): Promise<void> {
  const metadataPatch = { ...remoteMetadata(remote), ...extraMetadata };
  if (remote.status === "VERIFIED" || remote.status === "CREDITS_ISSUED") {
    await setSubmissionTerminalStatus(
      orgCtx,
      submission.id,
      { status: "accepted", metadataPatch },
      tx,
    );
    return;
  }
  if (remote.status === "FAILED_VERIFICATION") {
    await setSubmissionTerminalStatus(
      orgCtx,
      submission.id,
      { status: "rejected", metadataPatch },
      tx,
    );
    return;
  }
  if (
    submission.status === "rejected" ||
    submission.status === "accepted" ||
    submission.status === "superseded"
  ) {
    await clearTerminalStatusForResubmit(
      orgCtx,
      submission.id,
      { metadataPatch },
      tx,
    );
    return;
  }
  await updateSubmissionMetadata(orgCtx, submission.id, metadataPatch, tx);
}

function remoteMetadata(remote: GhgStatement): Record<string, unknown> {
  const period = getGhgStatementPeriod(remote);
  return {
    [SUBMISSION_METADATA_KEYS.remoteStatus]: remote.status,
    [SUBMISSION_METADATA_KEYS.pendingTotalCo2eRemovedKg]:
      remote.pending_total_co2e_removed_kg,
    reportUrl: remote.ghg_statement_report_url,
    reportingPeriodStartAt: period.startOn,
    reportingPeriodEndAt: period.endOn,
    submittedToVerifierAt: remote.submitted_at,
    creditsIssuedAt: remote.credits_issued_at,
    verifier: remote.verifier,
    [SUBMISSION_METADATA_KEYS.removalIds]: remote.ghg_entry_ids,
  };
}
