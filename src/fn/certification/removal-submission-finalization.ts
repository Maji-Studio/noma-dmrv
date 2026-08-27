import {
  markSubmissionSubmitted,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import { recordConfirmedSubmissionIdentity } from "@/data-access/certification-submissions";
import { updateRemovalDates } from "@/data-access/certifier-removals";
import type { OrgContext } from "@/lib/auth/server";
import { formatUtcDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import type { IsometricClient } from "@/lib/isometric";
import type { Logger } from "@/lib/log";
import { ensureRemovalBiocharApplications } from "./biochar-applications";
import {
  readRemovalBiocharApplicationIntents,
} from "./removal-snapshot-readers";
import { readRemovalReportingWindow } from "./removal-reporting-window";
import { verifyAndPersistRemovalSourceBindings } from "./removal-source-binding-verification";

export async function persistRemovalReportingWindow(
  orgCtx: OrgContext,
  removalId: string,
  reportingWindow: { startedOn: Date; completedOn: Date },
): Promise<void> {
  await updateRemovalDates(orgCtx, removalId, {
    startedOn: formatUtcDate(reportingWindow.startedOn),
    completedOn: formatUtcDate(reportingWindow.completedOn),
  });
}

export async function recordRemovalConfirmedIdentity(args: {
  orgCtx: OrgContext;
  rowId: string;
  externalId: string;
  expectedLockedAt: Date;
}): Promise<void> {
  const recorded = await recordConfirmedSubmissionIdentity(
    args.orgCtx,
    args.rowId,
    {
      externalId: args.externalId,
      expectedLockedAt: args.expectedLockedAt,
    },
  );
  if (!recorded) {
    throw new SafeError(
      "The Removal registry identity could not be saved because the submission changed. Refresh and try again.",
    );
  }
}

export async function recoverSubmittedRemovalReportingWindow(args: {
  client: IsometricClient;
  orgCtx: OrgContext;
  removalId: string;
  row: CertificationSubmissionRow;
  log: Logger;
}): Promise<void> {
  await ensureRemovalBiocharApplications({
    orgCtx: args.orgCtx,
    removalId: args.removalId,
    externalRemovalId: args.row.externalId!,
    submissionRow: args.row,
    intents: readRemovalBiocharApplicationIntents(args.row),
    log: args.log,
  });
  await verifyAndPersistRemovalSourceBindings({
    client: args.client,
    orgCtx: args.orgCtx,
    removalId: args.removalId,
    submissionRow: args.row,
    externalRemovalId: args.row.externalId!,
    log: args.log,
  });
  await persistRemovalReportingWindow(
    args.orgCtx,
    args.removalId,
    readRemovalReportingWindow(args.row),
  );
}

export async function finalizeRemovalSubmission(args: {
  orgCtx: OrgContext;
  row: Pick<CertificationSubmissionRow, "id">;
  externalId: string;
  expectedLockedAt: Date;
  supersedePreviousId: string | null;
  removalId: string;
  claimBatchIds: string[];
}): Promise<void> {
  await markSubmissionSubmitted(args.orgCtx, args.row.id, {
    externalId: args.externalId,
    expectedLockedAt: args.expectedLockedAt,
    supersedePreviousId: args.supersedePreviousId,
    productionEmissionsClaim: {
      removalId: args.removalId,
      creditBatchIds: args.claimBatchIds,
    },
  });
}
