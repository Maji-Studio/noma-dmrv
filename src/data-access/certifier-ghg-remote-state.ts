import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import {
  getGhgStatementPeriod,
  type GhgStatement,
} from "@/lib/isometric";
import { SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import {
  clearTerminalStatusForResubmit,
  setSubmissionTerminalStatus,
  updateSubmissionMetadata,
  type CertificationSubmissionRow,
  type Tx,
} from "./certification";
import {
  reconcileRemovalMembership,
  updateGhgStatementReportingWindow,
} from "./certifier-ghg-statements";
import { requireOrgScope } from "./utils";
import { redactReportUrlSecrets } from "@/lib/certification/report-url";

export async function applyGhgRemoteState(
  ctx: OrgContext,
  submission: CertificationSubmissionRow,
  remote: GhgStatement,
  extraMetadata: Record<string, unknown> = {},
  tx?: Tx,
): Promise<void> {
  requireOrgScope(ctx);
  const metadataPatch = { ...remoteMetadata(remote), ...extraMetadata };
  if (remote.status === "VERIFIED" || remote.status === "CREDITS_ISSUED") {
    await setSubmissionTerminalStatus(
      ctx,
      submission.id,
      { status: "accepted", metadataPatch },
      tx,
    );
    return;
  }
  if (remote.status === "FAILED_VERIFICATION") {
    await setSubmissionTerminalStatus(
      ctx,
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
      ctx,
      submission.id,
      { metadataPatch },
      tx,
    );
    return;
  }
  await updateSubmissionMetadata(ctx, submission.id, metadataPatch, tx);
}

export async function reconcileGhgStatementRemoteState(
  ctx: OrgContext,
  args: {
    statementId: string;
    submission: CertificationSubmissionRow;
    remote: GhgStatement;
  },
  callerTx?: Tx,
): Promise<{ linkedRemovalIds: string[]; warnings: string[] }> {
  requireOrgScope(ctx);
  const period = getGhgStatementPeriod(args.remote);
  const run = async (
    tx: Tx,
  ): Promise<{ linkedRemovalIds: string[]; warnings: string[] }> => {
    const membership = await reconcileRemovalMembership(
      ctx,
      args.statementId,
      args.remote.ghg_entry_ids,
      tx,
    );
    await updateGhgStatementReportingWindow(
      ctx,
      args.statementId,
      {
        reportingPeriodStartOn: period.startOn,
        reportingPeriodEndOn: period.endOn,
        remotePeriodMissing: period.endOn === null,
      },
      tx,
    );
    await applyGhgRemoteState(ctx, args.submission, args.remote, {}, tx);
    return membership;
  };
  return callerTx ? run(callerTx) : db.transaction(run);
}

function remoteMetadata(remote: GhgStatement): Record<string, unknown> {
  const period = getGhgStatementPeriod(remote);
  return {
    [SUBMISSION_METADATA_KEYS.remoteStatus]: remote.status,
    [SUBMISSION_METADATA_KEYS.pendingTotalCo2eRemovedKg]:
      remote.pending_total_co2e_removed_kg,
    reportUrl: redactReportUrlSecrets(remote.ghg_statement_report_url),
    reportingPeriodStartAt: period.startOn,
    reportingPeriodEndAt: period.endOn,
    submittedToVerifierAt: remote.submitted_at,
    creditsIssuedAt: remote.credits_issued_at,
    verifier: remote.verifier,
    [SUBMISSION_METADATA_KEYS.removalIds]: remote.ghg_entry_ids,
  };
}
