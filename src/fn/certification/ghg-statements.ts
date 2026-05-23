"use server";

import {
  appendSyncEvent,
  attachReportDocument,
  clearTerminalStatusForResubmit,
  getLatestSubmission,
  getSubmissionById,
  insertDraftSubmissionWithMappingLock,
  listRecentSyncEvents,
  markSubmissionRejected,
  markSubmissionSubmitted,
  resetSubmissionToDraftWithMappingLock,
  setSubmissionTerminalStatus,
  updateSubmissionMetadata,
  type CertificationSubmissionRow,
  type CertifierSyncEventRow,
  type MappingClaimGuard,
} from "@/data-access/certification";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getFacilityById } from "@/data-access/facilities";
import { SafeError } from "@/lib/errors";
import {
  createGhgStatement,
  decideSubmissionClaim,
  getGhgStatement,
  IsometricApiError,
  payloadHash,
  reconcileGhgStatement,
  resubmitGhgStatement,
  submitGhgStatement,
  type GhgStatement,
  type GhgStatementStatus,
} from "@/lib/isometric";
import {
  chooseGhgSubmitMode,
  ghgSubmitFingerprintChanged,
  type GhgSubmitMode,
} from "@/lib/isometric/utils/ghg-statement-state";
import {
  isLockedInFlight as computeIsLockedInFlight,
  LOCK_TTL_MS,
} from "@/lib/isometric/utils/lock";
import {
  SUBMISSION_METADATA_KEYS,
  getMetadataValue,
} from "@/lib/isometric/utils/submission-metadata";
import {
  submitGhgStatementSchema,
  type SubmitGhgStatementInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadCreditBatchRunRefs } from "./certify-context";
import {
  assertProductionConfirmed,
  CREDIT_BATCH_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
  PRODUCTION_RUN_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";

export interface GhgStatementForCreditBatchResult {
  externalId: string;
  version: number;
}

export interface SubmitGhgStatementResult {
  externalId: string;
  remoteStatus: GhgStatementStatus;
}

export interface SubmitGhgStatementForCreditBatchArgs {
  userId: string;
  creditBatchId: string;
  externalProjectId: string;
  mappingGuard: MappingClaimGuard;
  // Reporting-period end — max production-run endTime, YYYY-MM-DD.
  endOn: string;
  // The per-run Removals that this statement must absorb.
  removals: { runId: string; externalId: string }[];
}

// Phase 2 of `submitCreditBatch`: submits one GHG Statement for the credit
// batch, anchored by date range. Isometric links Removals to a statement
// server-side by reporting period (`CreateGhgStatementRequest` is only
// `{ end_on, project_id }`), so the per-run Removals must already exist
// before this runs. After create, the statement is re-fetched and every
// removal external id is asserted present in `removal_ids` — on every
// claim branch, since the semantic hash excludes removal ids and
// `return-existing` would otherwise mask membership drift.
export async function submitGhgStatementForCreditBatch(
  args: SubmitGhgStatementForCreditBatchArgs,
): Promise<GhgStatementForCreditBatchResult> {
  const {
    userId,
    creditBatchId,
    externalProjectId,
    mappingGuard,
    endOn,
    removals,
  } = args;
  const removalExternalIds = removals.map((r) => r.externalId);

  const semanticPayload = {
    projectId: externalProjectId,
    creditBatchId,
    endOn,
  };
  const semanticHash = payloadHash(semanticPayload);

  const latest = await getLatestSubmission(userId, {
    provider: ISOMETRIC_PROVIDER,
    submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
    localEntityType: CREDIT_BATCH_ENTITY_TYPE,
    localEntityId: creditBatchId,
  });

  const claim = decideSubmissionClaim({
    latest,
    payloadHash: semanticHash,
    now: Date.now(),
    lockTtlMs: LOCK_TTL_MS,
    policy: { onSubmittedHashChanged: "invalid-changed-hash" },
  });

  switch (claim.kind) {
    case "blocked-in-flight":
      throw new SafeError("GHG statement submission already in progress.");
    case "blocked-rejected-with-external":
      throw new SafeError(
        "This GHG statement was rejected by the verifier. Resolve the rejection in the Isometric registry before retrying.",
      );
    case "invalid-changed-hash":
      throw new SafeError(
        "The reporting period changed for an already-submitted credit batch. A credit batch maps to a fixed monthly GHG statement.",
      );
    case "return-existing": {
      // The semantic hash excludes removal ids, so a `return-existing`
      // branch must still re-verify membership against the live statement.
      await assertRemovalMembership(
        userId,
        creditBatchId,
        claim.externalId,
        removalExternalIds,
      );
      return { externalId: claim.externalId, version: claim.version };
    }
    case "resume": {
      const row = await resetSubmissionToDraftWithMappingLock(
        userId,
        claim.resumeRowId,
        mappingGuard,
        LOCK_TTL_MS,
      );
      return createGhgStatementForCreditBatchRow({
        userId,
        creditBatchId,
        row,
        externalProjectId,
        endOn,
        removalExternalIds,
        resumed: true,
      });
    }
    case "create-new-version": {
      if (claim.reason === "rejected-hash-changed") {
        console.warn(
          "GHG statement retry will create a new version after a rejected row with changed hash",
          { submissionId: latest!.id },
        );
      }
      const row = await insertDraftSubmissionWithMappingLock(
        userId,
        {
          provider: ISOMETRIC_PROVIDER,
          submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
          localEntityType: CREDIT_BATCH_ENTITY_TYPE,
          localEntityId: creditBatchId,
          version: claim.nextVersion,
          payloadSnapshot: {
            semantic: semanticPayload,
            removals,
          },
          payloadHash: semanticHash,
        },
        mappingGuard,
      );
      return createGhgStatementForCreditBatchRow({
        userId,
        creditBatchId,
        row,
        externalProjectId,
        endOn,
        removalExternalIds,
        resumed: false,
      });
    }
  }
}

interface CreateGhgStatementRowArgs {
  userId: string;
  creditBatchId: string;
  row: CertificationSubmissionRow;
  externalProjectId: string;
  endOn: string;
  removalExternalIds: string[];
  resumed: boolean;
}

const MULTIPLE_DRAFTS_MESSAGE =
  "Multiple draft GHG statements exist for this project and period in Isometric.";

// Resolves a reconciliation lookup on the create path: `multiple` rejects
// the ledger row and throws; `single` finalizes against the existing
// statement; `none` returns null so the caller proceeds to a fresh create.
async function resolveReconciledGhgStatement(
  args: CreateGhgStatementRowArgs,
  reconciled: Awaited<ReturnType<typeof reconcileGhgStatement>>,
  operation: string,
): Promise<GhgStatementForCreditBatchResult | null> {
  if (reconciled.found === "multiple") {
    await markSubmissionRejected(args.userId, args.row.id, {
      errorMessage: MULTIPLE_DRAFTS_MESSAGE,
    });
    throw new SafeError(MULTIPLE_DRAFTS_MESSAGE);
  }
  if (reconciled.found === "single") {
    return finalizeGhgStatementRow({
      ...args,
      externalId: reconciled.externalId,
      operation,
      source: "reconciliation",
    });
  }
  return null;
}

async function createGhgStatementForCreditBatchRow(
  args: CreateGhgStatementRowArgs,
): Promise<GhgStatementForCreditBatchResult> {
  const operation = args.resumed
    ? "ghg_statement:create:resumed"
    : "ghg_statement:create";

  if (args.resumed) {
    const reconciled = await reconcileGhgStatement({
      projectId: args.externalProjectId,
      endOn: args.endOn,
    });
    const resolved = await resolveReconciledGhgStatement(
      args,
      reconciled,
      operation,
    );
    if (resolved) return resolved;
  }

  let remote: GhgStatement;
  try {
    remote = await createGhgStatement({
      end_on: args.endOn,
      project_id: args.externalProjectId,
    });
  } catch (err) {
    const reconciled = await reconcileGhgStatement({
      projectId: args.externalProjectId,
      endOn: args.endOn,
    });
    const resolved = await resolveReconciledGhgStatement(
      args,
      reconciled,
      `${operation}:reconciled`,
    );
    if (resolved) return resolved;

    const message = err instanceof Error ? err.message : String(err);
    // Preserve the verifier's response body — an Isometric 4xx carries the
    // actionable detail (which field, which rule), and a bare status code
    // is undebuggable without it.
    const responsePayload =
      err instanceof IsometricApiError ? err.body : undefined;
    await appendSyncEvent(args.userId, {
      provider: ISOMETRIC_PROVIDER,
      entityType: CREDIT_BATCH_ENTITY_TYPE,
      entityId: args.creditBatchId,
      operation,
      status: "failed",
      requestPayload: {
        end_on: args.endOn,
        project_id: args.externalProjectId,
      },
      responsePayload,
      errorMessage: message,
    });
    await markSubmissionRejected(args.userId, args.row.id, {
      errorMessage: message,
    });
    throw new SafeError(`GHG statement create failed: ${message}`);
  }

  return finalizeGhgStatementRow({
    ...args,
    externalId: remote.id,
    operation,
    source: "create",
  });
}

// Shared tail for both the fresh-create and reconciled-create paths: marks
// the ledger row submitted, records the sync event, runs the removal
// membership assertion, then mirrors the remote status into the row.
async function finalizeGhgStatementRow(args: {
  userId: string;
  creditBatchId: string;
  row: CertificationSubmissionRow;
  externalId: string;
  removalExternalIds: string[];
  operation: string;
  source: "create" | "reconciliation";
}): Promise<GhgStatementForCreditBatchResult> {
  await markSubmissionSubmitted(args.userId, args.row.id, {
    externalId: args.externalId,
    supersedePreviousId: null,
  });
  await appendSyncEvent(args.userId, {
    provider: ISOMETRIC_PROVIDER,
    entityType: CREDIT_BATCH_ENTITY_TYPE,
    entityId: args.creditBatchId,
    operation: args.operation,
    status: "succeeded",
    responsePayload: { id: args.externalId, source: args.source },
  });

  await assertRemovalMembership(
    args.userId,
    args.creditBatchId,
    args.externalId,
    args.removalExternalIds,
  );

  const remote = await getGhgStatement(args.externalId).catch(() => null);
  if (remote) {
    await applyGhgRemoteState(args.userId, args.row, remote);
  } else {
    await updateSubmissionMetadata(args.userId, args.row.id, {
      [SUBMISSION_METADATA_KEYS.remoteStatus]: "DRAFT",
    });
  }

  return { externalId: args.externalId, version: args.row.version };
}

// Asserts the GHG statement absorbed every per-run Removal. Isometric links
// Removals by reporting period server-side; a run whose `completed_on`
// falls outside the (server-controlled) period would be silently dropped.
// On any gap, records a failed sync event and throws.
async function assertRemovalMembership(
  userId: string,
  creditBatchId: string,
  statementExternalId: string,
  removalExternalIds: string[],
): Promise<void> {
  const remote = await getGhgStatement(statementExternalId);
  const present = new Set(remote.removal_ids);
  const missing = removalExternalIds.filter((id) => !present.has(id));
  if (missing.length === 0) return;

  await appendSyncEvent(userId, {
    provider: ISOMETRIC_PROVIDER,
    entityType: CREDIT_BATCH_ENTITY_TYPE,
    entityId: creditBatchId,
    operation: "ghg_statement:removal_membership",
    status: "failed",
    requestPayload: {
      ghgStatementId: statementExternalId,
      expectedRemovalIds: removalExternalIds,
    },
    responsePayload: { removal_ids: remote.removal_ids },
    errorMessage: `GHG statement ${statementExternalId} is missing ${missing.length} removal(s): ${missing.join(", ")}`,
  });
  throw new SafeError(
    `GHG statement did not absorb every Removal (${missing.length} of ${removalExternalIds.length} missing). A Removal's completion date may fall outside the statement's reporting period — verify in the Isometric registry.`,
  );
}

// Submits (or resubmits) the credit batch's GHG statement to the verifier.
// Replaces the facility-anchored entry point: the statement is resolved
// from the credit-batch ledger and the loaded row is asserted to belong to
// this credit batch (the dropped period model used to provide that link
// indirectly through the project check).
export async function submitGhgStatementToVerifier(
  creditBatchId: string,
  input: SubmitGhgStatementInput,
): Promise<ActionResult<SubmitGhgStatementResult>> {
  return withAction(async (userId) => {
    const parsed = submitGhgStatementSchema.parse(input);
    assertProductionConfirmed(parsed.confirmProduction);

    const submission = await getSubmissionById(userId, parsed.submissionId);
    if (!submission) throw new SafeError("GHG statement submission not found.");
    if (
      submission.localEntityType !== CREDIT_BATCH_ENTITY_TYPE ||
      submission.localEntityId !== creditBatchId ||
      submission.submissionType !== GHG_STATEMENT_SUBMISSION_TYPE
    ) {
      throw new SafeError(
        "Submission does not belong to this credit batch's GHG statement.",
      );
    }
    if (!submission.externalId) {
      throw new SafeError("Create the GHG statement before submitting it.");
    }

    const creditBatch = await getCreditBatchById(userId, creditBatchId);
    if (!creditBatch) throw new SafeError("Credit batch not found.");

    const [facility, remoteBefore] = await Promise.all([
      getFacilityById(userId, creditBatch.facilityId),
      getGhgStatement(submission.externalId).catch(() => null),
    ]);

    const submitMode = chooseGhgSubmitModeFromKnownState(
      remoteBefore,
      submission,
    );
    if (submitMode === "blocked-awaiting") {
      throw new SafeError(
        "This GHG statement is already awaiting verification.",
      );
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
      description: `GHG statement report - ${facility.code} - credit batch ${creditBatch.code}`,
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
      const submitApplied = remoteBefore
        ? after && ghgSubmitFingerprintChanged(remoteBefore, after)
        : after && ghgSubmitAppearsApplied(after, parsed.reportUrl);
      if (after && submitApplied) {
        await appendSyncEvent(userId, {
          provider: ISOMETRIC_PROVIDER,
          entityType: CREDIT_BATCH_ENTITY_TYPE,
          entityId: creditBatchId,
          operation: `ghg_statement:${submitMode}:reconciled`,
          status: "succeeded",
          requestPayload: buildSubmitRequestPayload(
            submitMode,
            parsed.reportUrl,
            Boolean(parsed.summaryOfChanges?.trim()),
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
        return {
          externalId: submission.externalId,
          remoteStatus: after.status,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      await appendSyncEvent(userId, {
        provider: ISOMETRIC_PROVIDER,
        entityType: CREDIT_BATCH_ENTITY_TYPE,
        entityId: creditBatchId,
        operation: `ghg_statement:${submitMode}`,
        status: "failed",
        requestPayload: buildSubmitRequestPayload(
          submitMode,
          parsed.reportUrl,
          Boolean(parsed.summaryOfChanges?.trim()),
        ),
        errorMessage: message,
      });
      throw new SafeError(`Submit failed: ${message}`);
    }

    await appendSyncEvent(userId, {
      provider: ISOMETRIC_PROVIDER,
      entityType: CREDIT_BATCH_ENTITY_TYPE,
      entityId: creditBatchId,
      operation: `ghg_statement:${submitMode}`,
      status: "succeeded",
      requestPayload: buildSubmitRequestPayload(
        submitMode,
        parsed.reportUrl,
        Boolean(parsed.summaryOfChanges?.trim()),
      ),
      responsePayload: { id: remoteAfter.id, status: remoteAfter.status },
    });
    await applyGhgRemoteState(userId, submission, remoteAfter, {
      reportUrl: parsed.reportUrl,
      summaryOfChanges: parsed.summaryOfChanges?.trim() || null,
      lastReportDocumentId: document.id,
      submittedToVerifierAt: new Date().toISOString(),
    });

    return {
      externalId: submission.externalId,
      remoteStatus: remoteAfter.status,
    };
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

export interface CreditBatchGhgStatementRemoval {
  runId: string;
  runCode: string;
  submission: CertificationSubmissionRow | null;
}

export interface CreditBatchGhgStatementState {
  // The credit batch's latest GHG-statement ledger row (null if never run).
  statementSubmission: CertificationSubmissionRow | null;
  // One entry per production run rolled up by the credit batch — each the
  // run's latest Removal ledger row (null if that run never submitted).
  removalSubmissions: CreditBatchGhgStatementRemoval[];
  // Live GHG statement, when a remote id exists.
  remote: GhgStatement | null;
  recentSyncEvents: CertifierSyncEventRow[];
  isLockedInFlight: boolean;
}

// Loads the full Certify submission state for a credit batch's side-sheet
// panel: the GHG-statement row, every per-run Removal row, the live remote
// statement, and recent sync events. Replaces `loadCreditBatchSubmissionState`.
export async function loadCreditBatchGhgStatementState(
  creditBatchId: string,
): Promise<ActionResult<CreditBatchGhgStatementState>> {
  return withAction(async (userId) => {
    const [statementSubmission, runRefs, recentSyncEvents] = await Promise.all([
      getLatestSubmission(userId, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
        localEntityType: CREDIT_BATCH_ENTITY_TYPE,
        localEntityId: creditBatchId,
      }),
      loadCreditBatchRunRefs(userId, creditBatchId),
      listRecentSyncEvents(userId, {
        entityType: CREDIT_BATCH_ENTITY_TYPE,
        entityId: creditBatchId,
        limit: 10,
      }),
    ]);

    const removalSubmissions = await Promise.all(
      runRefs.map(async (ref) => ({
        runId: ref.id,
        runCode: ref.code,
        submission: await getLatestSubmission(userId, {
          provider: ISOMETRIC_PROVIDER,
          submissionType: REMOVAL_SUBMISSION_TYPE,
          localEntityType: PRODUCTION_RUN_ENTITY_TYPE,
          localEntityId: ref.id,
        }),
      })),
    );

    const remote = statementSubmission?.externalId
      ? await getGhgStatement(statementSubmission.externalId).catch(() => null)
      : null;

    return {
      statementSubmission,
      removalSubmissions,
      remote,
      recentSyncEvents,
      isLockedInFlight: statementSubmission
        ? computeIsLockedInFlight(statementSubmission)
        : false,
    };
  });
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
    [SUBMISSION_METADATA_KEYS.remoteStatus]: remote.status,
    [SUBMISSION_METADATA_KEYS.pendingTotalCo2eRemovedKg]:
      remote.pending_total_co2e_removed_kg,
    reportUrl: remote.ghg_statement_report_url,
    reportingPeriodStartAt: remote.reporting_period_start_at,
    reportingPeriodEndAt: remote.reporting_period_end_at,
    submittedToVerifierAt: remote.submitted_at,
    creditsIssuedAt: remote.credits_issued_at,
    verifier: remote.verifier,
    [SUBMISSION_METADATA_KEYS.removalIds]: remote.removal_ids,
  };
}

function chooseGhgSubmitModeFromKnownState(
  remote: GhgStatement | null,
  submission: CertificationSubmissionRow,
): GhgSubmitMode {
  if (remote) return chooseGhgSubmitMode(remote);

  const status = getMetadataValue(
    submission.metadata,
    SUBMISSION_METADATA_KEYS.remoteStatus,
  );
  const pendingTotal = getMetadataValue(
    submission.metadata,
    SUBMISSION_METADATA_KEYS.pendingTotalCo2eRemovedKg,
  );
  if (status === "DRAFT") return "submit";
  if (status === "AWAITING_VERIFICATION") return "blocked-awaiting";
  if (
    status === "FAILED_VERIFICATION" ||
    (typeof pendingTotal === "number" && pendingTotal > 0)
  ) {
    return "resubmit";
  }
  if (typeof status === "string") return "blocked-verified";

  throw new SafeError("Unable to determine the GHG statement submit state.");
}

function ghgSubmitAppearsApplied(
  remote: GhgStatement,
  reportUrl: string,
): boolean {
  return (
    remote.ghg_statement_report_url === reportUrl &&
    (remote.status === "AWAITING_VERIFICATION" || remote.status === "VERIFIED")
  );
}

function buildSubmitRequestPayload(
  mode: "submit" | "resubmit",
  reportUrl: string,
  summaryProvided: boolean,
): Record<string, string | boolean> {
  if (mode === "resubmit") {
    return {
      ghg_statement_report_url: reportUrl,
      summary_of_changes_provided: summaryProvided,
    };
  }
  return { ghg_statement_report_url: reportUrl };
}
