import {
  markSubmissionSubmitted,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import { recordConfirmedSubmissionIdentity } from "@/data-access/certification-submissions";
import { updateRemovalDates } from "@/data-access/certifier-removals";
import { withFacilityDurabilityLock } from "@/data-access/facility-durability-lock";
import { withFacilityCertificationBoundarySessionLock } from "@/data-access/facility-certification-boundary-lock";
import type { OrgContext } from "@/lib/auth/server";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { formatUtcDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import type { IsometricClient } from "@/lib/isometric";
import type { Logger } from "@/lib/log";
import { ensureRemovalBiocharApplications } from "./biochar-applications";
import { readRemovalReportingWindow } from "./removal-reporting-window";
import { verifyAndPersistRemovalSourceBindings } from "./removal-source-binding-verification";
import type { BiocharApplicationIntent } from "./biochar-application-intents";
import type { RegistryExternalMutationReporter } from "./registry-create";
import { assertResumedSnapshotRevisionCurrent } from "./production-claim-gate";
import { assertRemovalSnapshotConfigurationCurrent } from "./removal-snapshot-readers";
import { ISOMETRIC_PROVIDER, REMOVAL_ENTITY_TYPE } from "./shared";

export function assertDefaultRemovalTemplateConfigured(
  templateId: string | null,
): asserts templateId is string {
  if (!templateId) {
    throw new SafeError(
      "Set a default Removal template in facility settings before retrying this Removal.",
    );
  }
}

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

export function removalReportingWindowNeedsRecovery(
  row: CertificationSubmissionRow,
  persisted: { startedOn: string | null; completedOn: string | null },
): boolean {
  const snapshot = readRemovalReportingWindow(row);
  return (
    persisted.startedOn !== formatUtcDate(snapshot.startedOn) ||
    persisted.completedOn !== formatUtcDate(snapshot.completedOn)
  );
}

export async function reconcileRemovalRegistryArtifacts(args: {
  client: IsometricClient;
  orgCtx: OrgContext;
  removalId: string;
  row: CertificationSubmissionRow;
  externalRemovalId: string;
  reportingWindow: { startedOn: Date; completedOn: Date } | null;
  biocharApplicationIntents: BiocharApplicationIntent[];
  expectedLockedAt?: Date;
  onExternalMutation?: RegistryExternalMutationReporter;
  log: Logger;
}): Promise<void> {
  await ensureRemovalBiocharApplications({
    orgCtx: args.orgCtx,
    removalId: args.removalId,
    externalRemovalId: args.externalRemovalId,
    submissionRow: args.row,
    expectedLockedAt: args.expectedLockedAt,
    intents: args.biocharApplicationIntents,
    onExternalMutation: args.onExternalMutation,
    log: args.log,
  });
  await verifyAndPersistRemovalSourceBindings({
    client: args.client,
    orgCtx: args.orgCtx,
    removalId: args.removalId,
    submissionRow: args.row,
    externalRemovalId: args.externalRemovalId,
    log: args.log,
  });
  if (args.reportingWindow) {
    await persistRemovalReportingWindow(
      args.orgCtx,
      args.removalId,
      args.reportingWindow,
    );
  }
}

export async function recoverSubmittedRemoval(args: {
  client: IsometricClient;
  orgCtx: OrgContext;
  facilityId: string;
  removalId: string;
  row: CertificationSubmissionRow;
  externalRemovalId: string;
  externalProjectId: string;
  templateId: string;
  reportingWindow: { startedOn: Date; completedOn: Date };
  biocharApplicationIntents: BiocharApplicationIntent[];
  onExternalMutation: RegistryExternalMutationReporter;
  log: Logger;
}): Promise<void> {
  await withFacilityCertificationBoundarySessionLock(
    args.orgCtx,
    args.facilityId,
    () =>
      withFacilityDurabilityLock(
        args.orgCtx,
        args.facilityId,
        async (tx) => {
          await acquireCertificationArtifactLocksSorted(tx, [{
            provider: ISOMETRIC_PROVIDER,
            localEntityType: REMOVAL_ENTITY_TYPE,
            localEntityId: args.removalId,
          }]);
          await assertResumedSnapshotRevisionCurrent(args.orgCtx, args.row, true);
          assertRemovalSnapshotConfigurationCurrent(args.row, {
            externalProjectId: args.externalProjectId,
            templateId: args.templateId,
          });
          await reconcileRemovalRegistryArtifacts({ ...args });
        },
      ),
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
