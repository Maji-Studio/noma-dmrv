"use server";

import { env } from "@/config/env";
import {
  appendSyncEvent,
  attachReportDocument,
  clearTerminalStatusForResubmit,
  getCertifierProjectByFacility,
  getGhgPeriodById,
  getLatestGhgSubmissionForPeriod,
  getOrCreateGhgPeriod,
  getSubmissionById,
  insertDraftSubmissionWithMappingLock,
  listGhgSubmissionsForProject,
  listSubmissionsForFacility,
  LOCK_TTL_MS,
  markSubmissionRejected,
  markSubmissionSubmitted,
  resetSubmissionToDraftWithMappingLock,
  setSubmissionTerminalStatus,
  updateSubmissionMetadata,
  type CertificationSubmissionRow,
  type CertifierGhgPeriodRow,
  type CertifierProjectRow,
  type GhgSubmissionWithPeriod,
  type MappingClaimGuard,
} from "@/data-access/certification";
import { getFacilityById } from "@/data-access/facilities";
import { SafeError } from "@/lib/errors";
import {
  createGhgStatement,
  decideSubmissionClaim,
  getGhgStatement,
  listProjects,
  payloadHash,
  reconcileGhgStatement,
  resubmitGhgStatement,
  submitGhgStatement,
  type GhgStatement,
  type GhgStatementStatus,
  type IsometricProject,
} from "@/lib/isometric";
import {
  chooseGhgSubmitMode,
  ghgSubmitFingerprintChanged,
} from "@/lib/isometric/utils/ghg-statement-state";
import {
  createGhgStatementSchema,
  submitGhgStatementSchema,
  type CreateGhgStatementInput,
  type SubmitGhgStatementInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  assertProductionConfirmed,
  GHG_PERIOD_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
  safeListIfConfigured,
} from "./shared";

export interface FacilityCertificationOverview {
  facility: { id: string; code: string; name: string };
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  statementsForProject: Array<
    GhgSubmissionWithPeriod & { remote: GhgStatement | null }
  >;
  recentRemovals: CertificationSubmissionRow[];
  isProduction: boolean;
}

export interface CreateGhgStatementResult {
  externalId: string;
  periodId: string;
  version: number;
}

export interface SubmitGhgStatementResult {
  externalId: string;
  remoteStatus: GhgStatementStatus;
}

export async function loadFacilityCertificationOverview(
  facilityId: string,
): Promise<ActionResult<FacilityCertificationOverview>> {
  return withAction(async (userId) => {
    const [facility, mapping, recentRemovals] = await Promise.all([
      getFacilityById(userId, facilityId),
      getCertifierProjectByFacility(userId, facilityId, ISOMETRIC_PROVIDER),
      listSubmissionsForFacility(userId, {
        facilityId,
        submissionType: "removal",
        limit: 10,
      }),
    ]);

    const projects = mapping ? await safeListIfConfigured(() => listProjects()) : [];
    const project = mapping
      ? (projects.find((p) => p.id === mapping.externalProjectId) ?? null)
      : null;
    const statements = mapping
      ? await listGhgSubmissionsForProject(userId, {
          provider: ISOMETRIC_PROVIDER,
          externalProjectId: mapping.externalProjectId,
          limit: 50,
        })
      : [];

    const statementsForProject = await Promise.all(
      statements.map(async (row) => ({
        ...row,
        remote: row.submission.externalId
          ? await getGhgStatement(row.submission.externalId).catch(() => null)
          : null,
      })),
    );

    return {
      facility: { id: facility.id, code: facility.code, name: facility.name },
      mapping,
      project,
      statementsForProject,
      recentRemovals,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}

export async function createGhgStatementForFacility(
  facilityId: string,
  input: CreateGhgStatementInput,
): Promise<ActionResult<CreateGhgStatementResult>> {
  return withAction(async (userId) => {
    const parsed = createGhgStatementSchema.parse(input);
    const mapping = await getCertifierProjectByFacility(
      userId,
      facilityId,
      ISOMETRIC_PROVIDER,
    );
    if (!mapping) {
      throw new SafeError("Link this facility to an Isometric project first.");
    }

    assertProductionConfirmed(parsed.confirmProduction);

    const mappingGuard: MappingClaimGuard = {
      facilityId,
      provider: ISOMETRIC_PROVIDER,
      expectedExternalProjectId: mapping.externalProjectId,
    };
    const period = await getOrCreateGhgPeriod(userId, {
      provider: ISOMETRIC_PROVIDER,
      externalProjectId: mapping.externalProjectId,
      reportingPeriodEndAt: parsed.endOn,
    });
    const semanticPayload = {
      projectId: mapping.externalProjectId,
      endOn: parsed.endOn,
    };
    const semanticHash = payloadHash(semanticPayload);
    const latest = await getLatestGhgSubmissionForPeriod(userId, period.id);

    const claim = decideSubmissionClaim({
      latest,
      payloadHash: semanticHash,
      now: Date.now(),
      lockTtlMs: LOCK_TTL_MS,
      policy: { onSubmittedHashChanged: "invalid-changed-hash" },
    });

    switch (claim.kind) {
      case "blocked-in-flight":
        throw new SafeError("GHG statement creation already in progress.");
      case "blocked-rejected-with-external":
        throw new SafeError(
          "This statement was rejected by the verifier; use Resubmit instead of creating a new statement.",
        );
      case "invalid-changed-hash":
        throw new SafeError(
          "GHG statement hash changed for an existing period row.",
        );
      case "return-existing":
        return {
          externalId: claim.externalId,
          periodId: period.id,
          version: claim.version,
        };
      case "resume": {
        const row = await resetSubmissionToDraftWithMappingLock(
          userId,
          claim.resumeRowId,
          mappingGuard,
        );
        return createOrClaimGhgStatement({
          userId,
          row,
          period,
          projectId: mapping.externalProjectId,
          endOn: parsed.endOn,
          resumed: true,
        });
      }
      case "create-new-version": {
        if (claim.reason === "rejected-hash-changed") {
          console.warn(
            "GHG retry will create a new version after rejected row with changed hash",
            { submissionId: latest!.id },
          );
        }
        const row = await insertDraftSubmissionWithMappingLock(
          userId,
          {
            provider: ISOMETRIC_PROVIDER,
            submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
            localEntityType: GHG_PERIOD_ENTITY_TYPE,
            localEntityId: period.id,
            version: claim.nextVersion,
            payloadSnapshot: {
              semantic: semanticPayload,
              transport: {},
            },
            payloadHash: semanticHash,
          },
          mappingGuard,
        );
        return createOrClaimGhgStatement({
          userId,
          row,
          period,
          projectId: mapping.externalProjectId,
          endOn: parsed.endOn,
          resumed: false,
        });
      }
    }
  });
}

export async function submitGhgStatementForFacility(
  facilityId: string,
  input: SubmitGhgStatementInput,
): Promise<ActionResult<SubmitGhgStatementResult>> {
  return withAction(async (userId) => {
    const parsed = submitGhgStatementSchema.parse(input);
    assertProductionConfirmed(parsed.confirmProduction);

    const submission = await getSubmissionById(userId, parsed.submissionId);
    if (!submission) throw new SafeError("GHG statement submission not found.");
    if (!submission.externalId) {
      throw new SafeError("Create the GHG statement before submitting it.");
    }

    const period = await getGhgPeriodById(userId, submission.localEntityId);
    if (!period) throw new SafeError("GHG statement period not found.");
    const mapping = await getCertifierProjectByFacility(
      userId,
      facilityId,
      ISOMETRIC_PROVIDER,
    );
    if (!mapping || mapping.externalProjectId !== period.externalProjectId) {
      throw new SafeError("Selected facility is not linked to this GHG statement project.");
    }
    const facility = await getFacilityById(userId, facilityId);
    const remoteBefore = await getGhgStatement(submission.externalId);
    const submitMode = chooseGhgSubmitMode(remoteBefore);
    if (submitMode === "blocked-awaiting") {
      throw new SafeError("This GHG statement is already awaiting verification.");
    }
    if (submitMode === "blocked-verified") {
      throw new SafeError("This GHG statement is already verified.");
    }
    if (submitMode === "resubmit" && !parsed.summaryOfChanges?.trim()) {
      throw new SafeError("Summary of changes is required for resubmission.");
    }

    const document = await attachReportDocument(userId, {
      submissionId: submission.id,
      reportUrl: parsed.reportUrl,
      description: `GHG statement report - ${facility.code} - ${period.reportingPeriodEndAt}`,
      metadata: { ghgStatementExternalId: submission.externalId },
    });

    let remoteAfter: GhgStatement;
    try {
      remoteAfter =
        submitMode === "resubmit"
          ? await resubmitGhgStatement(submission.externalId, {
              ghg_statement_report_url: parsed.reportUrl,
              summary_of_changes: parsed.summaryOfChanges?.trim() ?? "",
            })
          : await submitGhgStatement(submission.externalId, {
              ghg_statement_report_url: parsed.reportUrl,
            });
    } catch (err) {
      const after = await getGhgStatement(submission.externalId).catch(
        () => null,
      );
      if (after && ghgSubmitFingerprintChanged(remoteBefore, after)) {
        await appendSyncEvent(userId, {
          provider: ISOMETRIC_PROVIDER,
          entityType: GHG_PERIOD_ENTITY_TYPE,
          entityId: period.id,
          operation: `ghg_statement:${submitMode}:reconciled`,
          status: "succeeded",
          requestPayload: buildSubmitRequestPayload(
            submitMode,
            parsed.reportUrl,
            parsed.summaryOfChanges,
          ),
          responsePayload: {
            id: submission.externalId,
            source: "reconciliation",
            detected_status: after.status,
          },
        });
        await applyGhgRemoteState(userId, submission, after, {
          reportUrl: parsed.reportUrl,
          summaryOfChanges: parsed.summaryOfChanges?.trim() || null,
          lastReportDocumentId: document.id,
          submittedToVerifierAt: new Date().toISOString(),
        });
        return { externalId: submission.externalId, remoteStatus: after.status };
      }

      const message = err instanceof Error ? err.message : String(err);
      await appendSyncEvent(userId, {
        provider: ISOMETRIC_PROVIDER,
        entityType: GHG_PERIOD_ENTITY_TYPE,
        entityId: period.id,
        operation: `ghg_statement:${submitMode}`,
        status: "failed",
        requestPayload: buildSubmitRequestPayload(
          submitMode,
          parsed.reportUrl,
          parsed.summaryOfChanges,
        ),
        errorMessage: message,
      });
      throw new SafeError(`Submit failed: ${message}`);
    }

    await appendSyncEvent(userId, {
      provider: ISOMETRIC_PROVIDER,
      entityType: GHG_PERIOD_ENTITY_TYPE,
      entityId: period.id,
      operation: `ghg_statement:${submitMode}`,
      status: "succeeded",
      requestPayload: buildSubmitRequestPayload(
        submitMode,
        parsed.reportUrl,
        parsed.summaryOfChanges,
      ),
      responsePayload: { id: remoteAfter.id, status: remoteAfter.status },
    });
    await applyGhgRemoteState(userId, submission, remoteAfter, {
      reportUrl: parsed.reportUrl,
      summaryOfChanges: parsed.summaryOfChanges?.trim() || null,
      lastReportDocumentId: document.id,
      submittedToVerifierAt: new Date().toISOString(),
    });

    return { externalId: submission.externalId, remoteStatus: remoteAfter.status };
  });
}

export async function refreshGhgStatementStatus(
  submissionId: string,
): Promise<ActionResult<GhgStatement>> {
  return withAction(async (userId) => {
    const submission = await getSubmissionById(userId, submissionId);
    if (!submission?.externalId) {
      throw new SafeError("GHG statement submission has no remote ID.");
    }
    const remote = await getGhgStatement(submission.externalId);
    await applyGhgRemoteState(userId, submission, remote);
    return remote;
  });
}

async function createOrClaimGhgStatement(args: {
  userId: string;
  row: CertificationSubmissionRow;
  period: CertifierGhgPeriodRow;
  projectId: string;
  endOn: string;
  resumed: boolean;
}): Promise<CreateGhgStatementResult> {
  const operation = args.resumed
    ? "ghg_statement:create:resumed"
    : "ghg_statement:create";

  if (args.resumed) {
    const reconciled = await reconcileGhgStatement({
      projectId: args.projectId,
      endOn: args.endOn,
    });
    if (reconciled.found === "multiple") {
      const message =
        "Multiple draft GHG statements exist for this project and period in Isometric.";
      await markSubmissionRejected(args.userId, args.row.id, {
        errorMessage: message,
      });
      throw new SafeError(message);
    }
    if (reconciled.found === "single") {
      await markSubmissionSubmitted(args.userId, args.row.id, {
        externalId: reconciled.externalId,
        supersedePreviousId: null,
      });
      await updateGhgCreateMetadata(args.userId, args.row, reconciled.externalId);
      await appendSyncEvent(args.userId, {
        provider: ISOMETRIC_PROVIDER,
        entityType: GHG_PERIOD_ENTITY_TYPE,
        entityId: args.period.id,
        operation,
        status: "succeeded",
        responsePayload: {
          id: reconciled.externalId,
          source: "reconciliation",
        },
      });
      return {
        externalId: reconciled.externalId,
        periodId: args.period.id,
        version: args.row.version,
      };
    }
  }

  let remote: GhgStatement;
  try {
    remote = await createGhgStatement({
      end_on: args.endOn,
      project_id: args.projectId,
    });
  } catch (err) {
    const reconciled = await reconcileGhgStatement({
      projectId: args.projectId,
      endOn: args.endOn,
    });
    if (reconciled.found === "multiple") {
      const message =
        "Multiple draft GHG statements exist for this project and period in Isometric.";
      await markSubmissionRejected(args.userId, args.row.id, {
        errorMessage: message,
      });
      throw new SafeError(message);
    }
    if (reconciled.found === "single") {
      await markSubmissionSubmitted(args.userId, args.row.id, {
        externalId: reconciled.externalId,
        supersedePreviousId: null,
      });
      await updateGhgCreateMetadata(args.userId, args.row, reconciled.externalId);
      await appendSyncEvent(args.userId, {
        provider: ISOMETRIC_PROVIDER,
        entityType: GHG_PERIOD_ENTITY_TYPE,
        entityId: args.period.id,
        operation: `${operation}:reconciled`,
        status: "succeeded",
        responsePayload: {
          id: reconciled.externalId,
          source: "reconciliation",
        },
      });
      return {
        externalId: reconciled.externalId,
        periodId: args.period.id,
        version: args.row.version,
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    await appendSyncEvent(args.userId, {
      provider: ISOMETRIC_PROVIDER,
      entityType: GHG_PERIOD_ENTITY_TYPE,
      entityId: args.period.id,
      operation,
      status: "failed",
      requestPayload: { end_on: args.endOn, project_id: args.projectId },
      errorMessage: message,
    });
    await markSubmissionRejected(args.userId, args.row.id, {
      errorMessage: message,
    });
    throw new SafeError(`GHG statement create failed: ${message}`);
  }

  await markSubmissionSubmitted(args.userId, args.row.id, {
    externalId: remote.id,
    supersedePreviousId: null,
  });
  await appendSyncEvent(args.userId, {
    provider: ISOMETRIC_PROVIDER,
    entityType: GHG_PERIOD_ENTITY_TYPE,
    entityId: args.period.id,
    operation,
    status: "succeeded",
    requestPayload: { end_on: args.endOn, project_id: args.projectId },
    responsePayload: { id: remote.id, status: remote.status },
  });
  await applyGhgRemoteState(args.userId, args.row, remote);

  return {
    externalId: remote.id,
    periodId: args.period.id,
    version: args.row.version,
  };
}

async function updateGhgCreateMetadata(
  userId: string,
  submission: CertificationSubmissionRow,
  externalId: string,
): Promise<void> {
  const remote = await getGhgStatement(externalId).catch(() => null);
  if (!remote) {
    await updateSubmissionMetadata(userId, submission.id, {
      remoteStatus: "DRAFT",
    });
    return;
  }
  await applyGhgRemoteState(userId, submission, remote);
}

async function applyGhgRemoteState(
  userId: string,
  submission: CertificationSubmissionRow,
  remote: GhgStatement,
  extraMetadata: Record<string, unknown> = {},
): Promise<void> {
  const metadataPatch = { ...remoteMetadata(remote), ...extraMetadata };
  if (remote.status === "VERIFIED" || remote.status === "CREDITS_ISSUED") {
    await setSubmissionTerminalStatus(userId, submission.id, {
      status: "accepted",
      metadataPatch,
    });
    return;
  }
  if (remote.status === "FAILED_VERIFICATION") {
    await setSubmissionTerminalStatus(userId, submission.id, {
      status: "rejected",
      metadataPatch,
    });
    return;
  }
  if (
    submission.status === "rejected" ||
    submission.status === "accepted" ||
    submission.status === "superseded"
  ) {
    await clearTerminalStatusForResubmit(userId, submission.id, {
      metadataPatch,
    });
    return;
  }
  await updateSubmissionMetadata(userId, submission.id, metadataPatch);
}

function remoteMetadata(remote: GhgStatement): Record<string, unknown> {
  return {
    remoteStatus: remote.status,
    pendingTotalCo2eRemovedKg: remote.pending_total_co2e_removed_kg,
    reportUrl: remote.ghg_statement_report_url,
    reportingPeriodStartAt: remote.reporting_period_start_at,
    reportingPeriodEndAt: remote.reporting_period_end_at,
    submittedToVerifierAt: remote.submitted_at,
    creditsIssuedAt: remote.credits_issued_at,
    verifier: remote.verifier,
    removalIds: remote.removal_ids,
  };
}

function buildSubmitRequestPayload(
  mode: "submit" | "resubmit",
  reportUrl: string,
  summaryOfChanges?: string | null,
): Record<string, string> {
  if (mode === "resubmit") {
    return {
      ghg_statement_report_url: reportUrl,
      summary_of_changes: summaryOfChanges?.trim() ?? "",
    };
  }
  return { ghg_statement_report_url: reportUrl };
}
