"use server";

import {
  appendSyncEvent,
  attachReportDocument,
  clearTerminalStatusForResubmit,
  getCertifierProjectByFacility,
  getLatestSubmissionsForEntities,
  getSubmissionById,
  listRecentSyncEvents,
  markSubmissionSubmitted,
  setSubmissionTerminalStatus,
  updateSubmissionMetadata,
  type CertificationSubmissionRow,
  type CertifierSyncEventRow,
  type Tx,
} from "@/data-access/certification";
import {
  claimSubmissionDraft,
  getLatestSubmission,
  type ClaimBlockedReason,
} from "@/data-access/certification-submissions";
import {
  countRemovalsByGhgStatementIds,
  getCertifierGhgStatementById,
  getOrCreateGhgStatementDraft,
  getRemovalsByGhgStatementId,
  listGhgStatementsForFacility,
  listOpenRemovalsForFacility,
  reconcileRemovalMembership,
  updateGhgStatementReportingWindow,
  type CertifierGhgStatementRow,
} from "@/data-access/certifier-ghg-statements";
import {
  getCreditBatchSummariesByRemovalIds,
  type CertifierRemovalRow,
  type RemovalCreditBatchSummary,
} from "@/data-access/certifier-removals";
import { getFacilityById } from "@/data-access/facilities";
import { db } from "@/db";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import {
  createGhgStatement,
  getGhgStatement,
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
import { isLockedInFlight as computeIsLockedInFlight } from "@/lib/isometric/utils/lock";
import {
  SUBMISSION_METADATA_KEYS,
  getMetadataValue,
} from "@/lib/isometric/utils/submission-metadata";
import {
  createGhgStatementSchema,
  submitGhgStatementDialogSchema,
  type CreateGhgStatementInput,
  type SubmitGhgStatementDialogInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { ghgStatementLookup, performRegistryCreate } from "./registry-create";
import {
  assertProductionConfirmed,
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
  submitRateLimit,
} from "./shared";

// =====================================================================
// Result + state shapes
// =====================================================================

export interface CreateGhgStatementResult {
  ghgStatementId: string;
  externalId: string;
  // Local removal ids Isometric linked into the statement, reconciled from
  // its server-side `ghg_entry_ids`.
  linkedRemovalIds: string[];
  // Drift notes surfaced to the operator (predicted-but-unlinked removals,
  // Isometric removals with no local record, removals owned elsewhere).
  warnings: string[];
}

export interface SubmitGhgStatementResult {
  externalId: string;
  remoteStatus: GhgStatementStatus;
}

// Re-exported so client components can type the cross-link accordion without
// importing from the data-access layer. Must re-export directly from source —
// `export type { LocalBinding }` of an imported type is miscompiled by SWC
// inside a "use server" module and emits a runtime reference (ReferenceError).
export type { RemovalCreditBatchSummary } from "@/data-access/certifier-removals";

// One removal absorbed by a statement, with its latest removal-ledger row
// for a status badge, and the credit batches grouped into it (the
// cross-link the operator opens to understand what the removal contains).
export interface LinkedRemoval {
  removal: CertifierRemovalRow;
  submission: CertificationSubmissionRow | null;
  creditBatches: RemovalCreditBatchSummary[];
}

export interface GhgStatementState {
  statement: CertifierGhgStatementRow;
  statementSubmission: CertificationSubmissionRow | null;
  linkedRemovals: LinkedRemoval[];
  remote: GhgStatement | null;
  recentSyncEvents: CertifierSyncEventRow[];
  isLockedInFlight: boolean;
}

export interface GhgStatementListItem {
  statement: CertifierGhgStatementRow;
  latestSubmission: CertificationSubmissionRow | null;
  linkedRemovalCount: number;
}

// A submitted removal not yet absorbed by any GHG statement — the stepper
// preview partitions these by `completedOn` against the chosen period end.
export interface OpenRemovalView {
  removalId: string;
  externalId: string;
  completedOn: string | null;
  startedOn: string | null;
  // Credit batches grouped into this removal — surfaced inline in the preview
  // accordion so the operator can see what each predicted removal contains.
  creditBatches: RemovalCreditBatchSummary[];
}

// =====================================================================
// Create — period-first
// =====================================================================

const MULTIPLE_DRAFTS_MESSAGE =
  "Multiple draft GHG statements exist for this project and period in Isometric.";

// Domain wording for the claim module's blocked outcomes (the module owns
// only the mapping-guard wording; claim decisions are translated here).
const GHG_CLAIM_BLOCKED_MESSAGES: Record<
  ClaimBlockedReason,
  string
> = {
  "in-flight": "GHG statement creation already in progress.",
  "rejected-with-external":
    "This GHG statement was rejected by the verifier. Resolve it in the Isometric registry before retrying.",
  "invalid-changed-hash":
    "The reporting period changed for an already-created GHG statement.",
  "state-changed":
    "Submission state changed while creating the GHG statement. Reload and retry.",
};

// How many recent sync events to surface in a statement's detail panel.
const RECENT_SYNC_EVENTS_LIMIT = 10;

// Creates a GHG Statement for a supplier-chosen reporting-period end.
// Isometric's create API accepts only `{ project_id, end_on }` and links
// Removals to the statement server-side by date range — so this is
// period-first: after the POST the actual `ghg_entry_ids` are reconciled back
// onto local `certifier_removals.ghg_statement_id`.
export async function createGhgStatementDraft(
  input: CreateGhgStatementInput,
): Promise<ActionResult<CreateGhgStatementResult>> {
  return withAction(async (userId) => {
    const parsed = createGhgStatementSchema.parse(input);
    assertProductionConfirmed(parsed.confirmProduction);

    const submissionAttemptId = crypto.randomUUID();
    logger.info(
      {
        op: "ghg-statement:create",
        facilityId: parsed.facilityId,
        submissionAttemptId,
      },
      "ghg statement draft requested",
    );

    const project = await getCertifierProjectByFacility(
      userId,
      parsed.facilityId,
    );
    if (!project) {
      throw new SafeError(
        "Link this facility to an Isometric project before creating a GHG statement.",
      );
    }

    // expectedDefaultRemovalTemplateId is intentionally undefined: a GHG
    // Statement has no template, so we only need the externalProjectId arm of
    // the guard. The mapping row is locked FOR UPDATE before the draft row is
    // written, so a concurrent repoint/unlink either runs first (and we fail
    // with "Facility was repointed…") or waits behind us.
    const mappingGuard = {
      facilityId: parsed.facilityId,
      provider: ISOMETRIC_PROVIDER,
      expectedExternalProjectId: project.externalProjectId,
    };

    // Reporting periods are consecutive and non-overlapping — Isometric
    // derives each period's start as the day after the previous period's end.
    // Enforce that here so a new period can't be carved inside an existing
    // one: reject an end date that lands on or before the latest *other*
    // statement's end. The own-end is excluded so an idempotent re-create
    // (same end, double-click / two tabs) still resolves to the existing row
    // via the submission-claim machinery below rather than being blocked.
    const existing = await listGhgStatementsForFacility(
      userId,
      parsed.facilityId,
    );
    const latestOtherEnd = existing
      .map((s) => s.reportingPeriodEndOn)
      .filter((end) => end !== parsed.reportingPeriodEndOn)
      .reduce<string | null>((max, end) => (!max || end > max ? end : max), null);
    if (latestOtherEnd && parsed.reportingPeriodEndOn <= latestOtherEnd) {
      throw new SafeError(
        `This reporting period overlaps an existing GHG statement ending ${latestOtherEnd}. Pick an end date after ${latestOtherEnd}.`,
      );
    }

    // Get-or-create the local statement row. Its id is stable per
    // (facility, period) and anchors the ledger localEntityId, so a repeat
    // create (double-click, two tabs) resolves through the submission-claim
    // machinery below instead of minting a duplicate (ADR 0004).
    const { statement } = await getOrCreateGhgStatementDraft(userId, {
      facilityId: parsed.facilityId,
      reportingPeriodEndOn: parsed.reportingPeriodEndOn,
    });

    const semanticPayload = {
      projectId: project.externalProjectId,
      ghgStatementId: statement.id,
      endOn: parsed.reportingPeriodEndOn,
    };

    // `statement.id` is stable per (facility, period), so on a repeat create
    // the ledger's latest row is the prior attempt and the claim genuinely
    // resolves the race: an in-flight create blocks, an already-created one
    // returns its external id, a stale or failed draft resumes. The module
    // re-decides inside the mapping lock, so a concurrent duplicate create
    // resolves to `existing`/`blocked` instead of dying on the
    // entity-version unique constraint. The guard's template arm is omitted
    // — a GHG Statement has no template.
    const claimed = await claimSubmissionDraft(userId, {
      key: {
        provider: ISOMETRIC_PROVIDER,
        submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
        localEntityType: GHG_STATEMENT_ENTITY_TYPE,
        localEntityId: statement.id,
      },
      guard: mappingGuard,
      policy: { onSubmittedHashChanged: "invalid-changed-hash" },
      tentativeInputs: semanticPayload,
      hashOf: payloadHash,
      buildSnapshot: ({ inputs }) => ({ payloadSnapshot: { semantic: inputs } }),
    });

    switch (claimed.kind) {
      case "blocked":
        throw new SafeError(GHG_CLAIM_BLOCKED_MESSAGES[claimed.reason]);
      case "existing":
        return {
          ghgStatementId: statement.id,
          externalId: claimed.externalId,
          linkedRemovalIds: [],
          warnings: [],
        };
      case "claimed":
        return createGhgStatementRemote({
          userId,
          statement,
          row: claimed.row,
          resumed: claimed.resumed,
          externalProjectId: project.externalProjectId,
          endOn: parsed.reportingPeriodEndOn,
          submissionAttemptId,
        });
    }
  }, { rateLimit: submitRateLimit("cert:create-ghg-statement") });
}

// POSTs the statement to Isometric through the shared create-or-reconcile
// choreography: a network failure may surface after the registry already
// created the draft, so on error (or on a resumed draft, before POSTing) it
// is looked up by (project, end_on). A period holding multiple drafts is
// ambiguous — the row is rejected with MULTIPLE_DRAFTS_MESSAGE.
async function createGhgStatementRemote(args: {
  userId: string;
  statement: CertifierGhgStatementRow;
  row: CertificationSubmissionRow;
  resumed: boolean;
  externalProjectId: string;
  endOn: string;
  submissionAttemptId: string;
}): Promise<CreateGhgStatementResult> {
  const {
    userId,
    statement,
    row,
    resumed,
    externalProjectId,
    endOn,
    submissionAttemptId,
  } = args;

  const requestPayload = { end_on: endOn, project_id: externalProjectId };
  const { externalId } = await performRegistryCreate({
    userId,
    entityType: GHG_STATEMENT_ENTITY_TYPE,
    entityId: statement.id,
    submissionRowId: row.id,
    operation: "ghg_statement:create",
    requestPayload,
    resumed,
    create: () => createGhgStatement(requestPayload).then((r) => r.id),
    reconcile: () =>
      reconcileGhgStatement({ projectId: externalProjectId, endOn }).then(
        ghgStatementLookup,
      ),
    ambiguousMessage: MULTIPLE_DRAFTS_MESSAGE,
    failureMessagePrefix: "GHG statement create failed",
    log: logger.child({
      op: "ghg-statement:create",
      ghgStatementId: statement.id,
      submissionAttemptId,
    }),
  });

  return finalizeGhgStatement({ userId, statement, row, externalId });
}

// Shared tail for the fresh-create and reconciled-create paths (the audit
// event for either is recorded by performRegistryCreate). The remote create
// has already succeeded, so the external id is persisted standalone first —
// losing it would let a retry POST a duplicate statement. The post-create
// reconciliation (removal membership, server-derived reporting window,
// ledger state) then commits in one transaction so a partial failure cannot
// leave the statement half-reconciled.
async function finalizeGhgStatement(args: {
  userId: string;
  statement: CertifierGhgStatementRow;
  row: CertificationSubmissionRow;
  externalId: string;
}): Promise<CreateGhgStatementResult> {
  const { userId, statement, row, externalId } = args;

  await markSubmissionSubmitted(userId, row.id, {
    externalId,
    supersedePreviousId: null,
  });

  // Re-fetch outside any transaction — the create response carries neither
  // the linked removal set nor the server-derived reporting-period start,
  // and a DB transaction must never be held open across network I/O.
  const remote = await getGhgStatement(externalId).catch(() => null);
  if (!remote) {
    await updateSubmissionMetadata(userId, row.id, {
      [SUBMISSION_METADATA_KEYS.remoteStatus]: "DRAFT",
    });
    return {
      ghgStatementId: statement.id,
      externalId,
      linkedRemovalIds: [],
      warnings: [],
    };
  }

  // Membership, reporting window and ledger state move together.
  return db.transaction(async (tx) => {
    const reconciled = await reconcileRemovalMembership(
      userId,
      statement.id,
      remote.ghg_entry_ids,
      tx,
    );
    await updateGhgStatementReportingWindow(
      userId,
      statement.id,
      { reportingPeriodStartOn: remote.reporting_period_start_at ?? null },
      tx,
    );
    await applyGhgRemoteState(userId, row, remote, {}, tx);
    return {
      ghgStatementId: statement.id,
      externalId,
      linkedRemovalIds: reconciled.linkedRemovalIds,
      warnings: reconciled.warnings,
    };
  });
}

// =====================================================================
// Submit to verifier
// =====================================================================

// Submits (or resubmits) a GHG statement to the verifier. The statement is
// resolved from its ledger row keyed by `ghgStatementId`.
export async function submitGhgStatementToVerifier(
  ghgStatementId: string,
  input: SubmitGhgStatementDialogInput,
): Promise<ActionResult<SubmitGhgStatementResult>> {
  return withAction(async (userId) => {
    const parsed = submitGhgStatementDialogSchema.parse(input);
    assertProductionConfirmed(parsed.confirmProduction);

    const submissionAttemptId = crypto.randomUUID();
    logger.info(
      { op: "ghg-statement:submit", ghgStatementId, submissionAttemptId },
      "ghg statement submit started",
    );

    // getLatestSubmission's key constrains type + entity, so the returned
    // row provably belongs to this GHG statement.
    const submission = await getLatestSubmission(userId, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
      localEntityType: GHG_STATEMENT_ENTITY_TYPE,
      localEntityId: ghgStatementId,
    });
    if (!submission?.externalId) {
      throw new SafeError("Create the GHG statement before submitting it.");
    }

    const statement = await getCertifierGhgStatementById(
      userId,
      ghgStatementId,
    );
    if (!statement) throw new SafeError("GHG statement not found.");

    const [facility, remoteBefore] = await Promise.all([
      getFacilityById(userId, statement.facilityId),
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
      description: `GHG statement report - ${facility.code} - period ending ${statement.reportingPeriodEndOn}`,
      metadata: { ghgStatementExternalId: submission.externalId },
    });

    // Same payload shape for every audit event in this action — three call
    // sites (reconciled-success, failure, success) all log the same request.
    const summaryProvided = Boolean(parsed.summaryOfChanges?.trim());
    const submitRequestPayload = buildSubmitRequestPayload(
      submitMode,
      parsed.reportUrl,
      summaryProvided,
    );

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
      logger.warn(
        {
          op: `ghg-statement:${submitMode}`,
          ghgStatementId,
          submissionId: submission.id,
          submissionAttemptId,
          errorName: err instanceof Error ? err.name : typeof err,
        },
        "ghg statement submit failed; attempting reconciliation",
      );
      const after = await getGhgStatement(submission.externalId).catch(
        () => null,
      );
      const submitApplied = remoteBefore
        ? after && ghgSubmitFingerprintChanged(remoteBefore, after)
        : after && ghgSubmitAppearsApplied(after, parsed.reportUrl);
      if (after && submitApplied) {
        await appendSyncEvent(userId, {
          provider: ISOMETRIC_PROVIDER,
          entityType: GHG_STATEMENT_ENTITY_TYPE,
          entityId: ghgStatementId,
          operation: `ghg_statement:${submitMode}:reconciled`,
          status: "succeeded",
          requestPayload: submitRequestPayload,
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
        entityType: GHG_STATEMENT_ENTITY_TYPE,
        entityId: ghgStatementId,
        operation: `ghg_statement:${submitMode}`,
        status: "failed",
        requestPayload: submitRequestPayload,
        errorMessage: message,
      });
      throw new SafeError(`Submit failed: ${message}`);
    }

    await appendSyncEvent(userId, {
      provider: ISOMETRIC_PROVIDER,
      entityType: GHG_STATEMENT_ENTITY_TYPE,
      entityId: ghgStatementId,
      operation: `ghg_statement:${submitMode}`,
      status: "succeeded",
      requestPayload: submitRequestPayload,
      responsePayload: { id: remoteAfter.id, status: remoteAfter.status },
    });
    await applyGhgRemoteState(userId, submission, remoteAfter, {
      reportUrl: parsed.reportUrl,
      summaryOfChanges: parsed.summaryOfChanges?.trim() || null,
      lastReportDocumentId: document.id,
      submittedToVerifierAt: new Date().toISOString(),
    });

    return { externalId: submission.externalId, remoteStatus: remoteAfter.status };
  }, { rateLimit: submitRateLimit("cert:submit-ghg-statement") });
}

// =====================================================================
// Status refresh + state loaders
// =====================================================================

// Re-fetches the live statement, mirrors its status into the ledger, and
// re-reconciles removal membership — a refresh picks up removals Isometric
// linked after the statement was created.
export async function refreshGhgStatementStatus(
  submissionId: string,
): Promise<ActionResult<GhgStatement>> {
  return withAction(async (userId) => {
    const submission = await getSubmissionById(userId, submissionId);
    if (
      !submission ||
      submission.submissionType !== GHG_STATEMENT_SUBMISSION_TYPE ||
      submission.localEntityType !== GHG_STATEMENT_ENTITY_TYPE
    ) {
      throw new SafeError("GHG statement submission not found.");
    }
    if (!submission.externalId) {
      throw new SafeError("GHG statement submission has no remote ID.");
    }
    // Only mirror remote state onto the latest version of the (provider,
    // submissionType, localEntityType, localEntityId) row. Superseded rows
    // stay frozen so the audit trail keeps showing the snapshot from when
    // they were submitted; refreshing a stale row would silently rewrite
    // history with whatever the new version's remote state happens to be.
    const latest = await getLatestSubmission(userId, {
      provider: submission.provider,
      submissionType: submission.submissionType,
      localEntityType: submission.localEntityType,
      localEntityId: submission.localEntityId,
    });
    if (!latest || latest.id !== submission.id) {
      throw new SafeError(
        "This GHG statement version has been superseded. Refresh the page to see the latest one.",
      );
    }
    const remote = await getGhgStatement(submission.externalId);
    await applyGhgRemoteState(userId, submission, remote);
    await reconcileRemovalMembership(
      userId,
      submission.localEntityId,
      remote.ghg_entry_ids,
    );
    return remote;
  });
}

// Full state for one GHG statement's detail panel: the statement, its ledger
// row, the reconciled removals (each with its latest removal-ledger row),
// the live remote statement, and recent sync events.
export async function loadGhgStatementState(
  ghgStatementId: string,
): Promise<ActionResult<GhgStatementState>> {
  return withAction(async (userId) => {
    const statement = await getCertifierGhgStatementById(
      userId,
      ghgStatementId,
    );
    if (!statement) throw new SafeError("GHG statement not found.");

    const [statementSubmission, removalRows, recentSyncEvents] =
      await Promise.all([
        getLatestSubmission(userId, {
          provider: ISOMETRIC_PROVIDER,
          submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
          localEntityType: GHG_STATEMENT_ENTITY_TYPE,
          localEntityId: ghgStatementId,
        }),
        getRemovalsByGhgStatementId(userId, ghgStatementId),
        listRecentSyncEvents(userId, {
          entityType: GHG_STATEMENT_ENTITY_TYPE,
          entityId: ghgStatementId,
          limit: RECENT_SYNC_EVENTS_LIMIT,
        }),
      ]);

    // Two batched lookups for every linked removal — its latest ledger row
    // (status badge) and its grouped credit batches (cross-link accordion).
    const removalIds = removalRows.map((removal) => removal.id);
    const [removalSubmissions, creditBatchesByRemoval] = await Promise.all([
      getLatestSubmissionsForEntities(userId, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: REMOVAL_SUBMISSION_TYPE,
        localEntityType: REMOVAL_ENTITY_TYPE,
        localEntityIds: removalIds,
      }),
      getCreditBatchSummariesByRemovalIds(userId, removalIds),
    ]);
    const linkedRemovals: LinkedRemoval[] = removalRows.map((removal) => ({
      removal,
      submission: removalSubmissions.get(removal.id) ?? null,
      creditBatches: creditBatchesByRemoval.get(removal.id) ?? [],
    }));

    const remote = statementSubmission?.externalId
      ? await getGhgStatement(statementSubmission.externalId).catch(() => null)
      : null;

    return {
      statement,
      statementSubmission,
      linkedRemovals,
      remote,
      recentSyncEvents,
      isLockedInFlight: statementSubmission
        ? computeIsLockedInFlight(statementSubmission)
        : false,
    };
  });
}

// Hub listing — every GHG statement for a facility with its latest ledger
// row and linked-removal count.
export async function loadGhgStatementsForFacility(
  facilityId: string,
): Promise<ActionResult<GhgStatementListItem[]>> {
  return withAction(async (userId) => {
    const statements = await listGhgStatementsForFacility(userId, facilityId);
    if (statements.length === 0) return [];

    // Two batched lookups for the whole list — the latest ledger row per
    // statement and the linked-removal count per statement — instead of a
    // pair of queries per row.
    const statementIds = statements.map((statement) => statement.id);
    const [submissions, removalCounts] = await Promise.all([
      getLatestSubmissionsForEntities(userId, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
        localEntityType: GHG_STATEMENT_ENTITY_TYPE,
        localEntityIds: statementIds,
      }),
      countRemovalsByGhgStatementIds(userId, statementIds),
    ]);

    return statements.map((statement) => ({
      statement,
      latestSubmission: submissions.get(statement.id) ?? null,
      linkedRemovalCount: removalCounts.get(statement.id) ?? 0,
    }));
  });
}

// Stepper preview — submitted removals not yet absorbed by any GHG statement.
export async function loadOpenRemovalsForFacility(
  facilityId: string,
): Promise<ActionResult<OpenRemovalView[]>> {
  return withAction(async (userId) => {
    const open = await listOpenRemovalsForFacility(userId, facilityId);
    const creditBatchesByRemoval = await getCreditBatchSummariesByRemovalIds(
      userId,
      open.map(({ removal }) => removal.id),
    );
    return open.map(({ removal, externalId }) => ({
      removalId: removal.id,
      externalId,
      completedOn: removal.completedOn,
      startedOn: removal.startedOn,
      creditBatches: creditBatchesByRemoval.get(removal.id) ?? [],
    }));
  });
}

// =====================================================================
// Remote-state helpers
// =====================================================================

async function applyGhgRemoteState(
  userId: string,
  submission: CertificationSubmissionRow,
  remote: GhgStatement,
  extraMetadata: Record<string, unknown> = {},
  tx?: Tx,
): Promise<void> {
  const metadataPatch = { ...remoteMetadata(remote), ...extraMetadata };
  if (remote.status === "VERIFIED" || remote.status === "CREDITS_ISSUED") {
    await setSubmissionTerminalStatus(
      userId,
      submission.id,
      { status: "accepted", metadataPatch },
      tx,
    );
    return;
  }
  if (remote.status === "FAILED_VERIFICATION") {
    await setSubmissionTerminalStatus(
      userId,
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
      userId,
      submission.id,
      { metadataPatch },
      tx,
    );
    return;
  }
  await updateSubmissionMetadata(userId, submission.id, metadataPatch, tx);
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
    [SUBMISSION_METADATA_KEYS.removalIds]: remote.ghg_entry_ids,
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
