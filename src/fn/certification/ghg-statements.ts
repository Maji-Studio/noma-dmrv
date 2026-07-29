"use server";

import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import {
  appendSyncEvent,
  attachReportDocument,
  getCertifierProjectByFacility,
  getLatestSubmissionsForEntities,
  getSubmissionById,
  listRecentSyncEvents,
  markSubmissionSubmitted,
  updateSubmissionMetadata,
  type CertificationSubmissionRow,
  type CertifierSyncEventRow,
} from "@/data-access/certification";
import {
  claimSubmissionDraft,
  getLatestSubmission,
  type ClaimBlockedReason,
} from "@/data-access/certification-submissions";
import {
  countRemovalsByGhgStatementIds,
  getCertifierGhgStatementById,
  getEffectiveReportingPeriodEndOn,
  getGhgStatementSubmissionForFacility,
  getOrCreateGhgStatementDraft,
  getRemovalsByGhgStatementId,
  hasMissingRemotePeriod,
  listFacilityIdsForExternalProject,
  listGhgStatementsForFacility,
  listOpenRemovalsForFacility,
  type CertifierGhgStatementRow,
} from "@/data-access/certifier-ghg-statements";
import {
  getApprovedGhgStatementReport,
  markGhgStatementReportSubmitted,
} from "@/data-access/ghg-statement-reports";
import {
  getCreditBatchSummariesByRemovalIds,
  type CertifierRemovalRow,
  type RemovalCreditBatchSummary,
} from "@/data-access/certifier-removals";
import { getFacilityById } from "@/data-access/facilities";
import { requireOrgFacility } from "@/data-access/utils";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import {
  createGhgStatement,
  describeIsometricApiError,
  ghgStatementCreateRefusalMessage,
  getIsometricClientForOrg,
  getGhgStatement,
  IsometricApiError,
  listGhgStatementsForProject,
  matchGhgStatementForCreate,
  payloadHash,
  reconcileGhgStatement,
  resubmitGhgStatement,
  sanitizeIsometricErrorBody,
  submitGhgStatement,
  type GhgStatement,
  type GhgStatementStatus,
  type IsometricClient,
} from "@/lib/isometric";
import {
  expectedButExcludedWarnings,
  type ExpectedRemoval,
} from "@/lib/isometric/utils/ghg-entry-membership";
import {
  derivePeriodStart,
  isRemovalInWindow,
  overlappingEnd,
} from "@/lib/isometric/utils/ghg-reporting-window";
import {
  buildGhgSubmitRequestPayload,
  chooseGhgSubmitModeFromKnownState,
  ghgSubmitAppearsApplied,
  ghgSubmitFingerprintChanged,
} from "@/lib/isometric/utils/ghg-statement-state";
import { isLockedInFlight as computeIsLockedInFlight } from "@/lib/isometric/utils/lock";
import { SUBMISSION_METADATA_KEYS } from "@/lib/isometric/utils/submission-metadata";
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
  applyGhgRemoteState,
  reconcileGhgStatementRemoteState,
} from "@/data-access/certifier-ghg-remote-state";
import {
  assertDedicatedGhgStatementProject,
  reconcileGhgStatementsForFacility,
  reconcileRegistryGhgStatement,
} from "./ghg-statement-reconciliation";
import {
  assertGhgStatementReportFresh,
  issueVerifierReportUrl,
} from "./ghg-statement-reports";
import {
  redactReportSecrets,
  redactReportUrlSecrets,
} from "@/lib/certification/report-url";
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

// Whether this call actually minted the registry statement, or resolved to one
// that already existed for the period. ADR 0004 makes the create *idempotent*
// per (provider, facility, period) on purpose, so "existing" is a normal,
// successful outcome — but the UI must not report it as a creation.
export type GhgStatementCreateOutcome = "created" | "existing";

export interface CreateGhgStatementResult {
  outcome: GhgStatementCreateOutcome;
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
  effectiveReportingPeriodEndOn: string;
  remotePeriodMissing: boolean;
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
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = createGhgStatementSchema.parse(input);
    await requireOrgFacility(orgCtx, parsed.facilityId);
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
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
      orgCtx,
      parsed.facilityId,
    );
    if (!project) {
      throw new SafeError(
        "Link this facility to an Isometric project before creating a GHG statement.",
      );
    }
    assertDedicatedGhgStatementProject(
      await listFacilityIdsForExternalProject(orgCtx, project.externalProjectId),
    );

    const remoteStatements = await listGhgStatementsForProject(
      client,
      project.externalProjectId,
    );
    const remoteMatches = remoteStatements
      .map((remote) =>
        matchGhgStatementForCreate(remote, parsed.reportingPeriodEndOn),
      )
      .filter((match) => match.behavior !== "unrelated");
    const blocking = remoteMatches.find(
      (match) => match.behavior === "refuse",
    );
    const adoptable = remoteMatches.filter(
      (match) => match.behavior === "adopt",
    );
    const singleMatch =
      blocking?.statement ??
      (adoptable.length === 1 ? adoptable[0].statement : null);
    if (singleMatch) {
      const existingRemoteSubmission =
        await getGhgStatementSubmissionForFacility(orgCtx, {
          facilityId: parsed.facilityId,
          externalId: singleMatch.id,
        });
      if (existingRemoteSubmission) {
        if (blocking) {
          throw new SafeError(
            ghgStatementCreateRefusalMessage(blocking.statement),
          );
        }
        // Nothing is minted here — the registry statement already exists and
        // is already on the ledger; this only re-reconciles it.
        const reconciled = await reconcileRegistryGhgStatement(orgCtx, {
          facilityId: parsed.facilityId,
          externalProjectId: project.externalProjectId,
          remote: singleMatch,
        });
        return { outcome: "existing" as const, ...reconciled };
      }
    }
    const knownRemoteMatch = remoteMatches.length > 0;

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
    // `overlappingEnd` is the same rule the create dialog applies client-side.
    const existing = await listGhgStatementsForFacility(
      orgCtx,
      parsed.facilityId,
    );
    const existingEnds = existing
      .filter((statement) => !hasMissingRemotePeriod(statement))
      .map(getEffectiveReportingPeriodEndOn);
    const overlap = overlappingEnd(parsed.reportingPeriodEndOn, existingEnds);
    if (overlap) {
      throw new SafeError(
        `This reporting period overlaps an existing GHG statement ending ${overlap}. Pick an end date after ${overlap}.`,
      );
    }

    // Empty-statement guard (#245). A GHG statement rolls up the removals
    // already submitted in its period ("POST /ghg_statements — submits a series
    // of removals for verification"), so creating one for a period with none
    // mints a junk registry record that can't be withdrawn. Predict the
    // in-window membership exactly as the drawer preview does — the day after
    // the prior period's end through `end_on` — and refuse a create that would
    // be empty. Skipped when a statement already exists for this exact period:
    // an idempotent re-create must resolve to it below (its membership is
    // authoritative and may be non-empty; its own removals are no longer
    // "open"). The authoritative backstop is the 0-linked block in
    // submitGhgStatementToVerifier — this predictive gate just spares the
    // operator a dead-end record and captures the "expected" set so the
    // create result can flag any removal the registry then places elsewhere.
    const periodAlreadyExists = existingEnds.includes(
      parsed.reportingPeriodEndOn,
    );
    const expected: ExpectedRemoval[] = [];
    if (!periodAlreadyExists) {
      const derivedStart = derivePeriodStart(
        parsed.reportingPeriodEndOn,
        existingEnds,
      );
      const openRemovals = await listOpenRemovalsForFacility(
        orgCtx,
        parsed.facilityId,
      );
      for (const { removal, externalId } of openRemovals) {
        if (
          isRemovalInWindow(
            removal.completedOn,
            derivedStart,
            parsed.reportingPeriodEndOn,
          )
        ) {
          expected.push({ localId: removal.id, externalId });
        }
      }
      if (expected.length === 0 && !knownRemoteMatch) {
        throw new SafeError(
          "This reporting period has no submitted removals yet — a statement now would be empty. Submit a removal first, or pick a period end that includes one.",
        );
      }
    }

    // Get-or-create the local statement row. Its id is stable per
    // (facility, period) and anchors the ledger localEntityId, so a repeat
    // create (double-click, two tabs) resolves through the submission-claim
    // machinery below instead of minting a duplicate (ADR 0004).
    const { statement } = await getOrCreateGhgStatementDraft(orgCtx, {
      facilityId: parsed.facilityId,
      reportingPeriodEndOn: parsed.reportingPeriodEndOn,
    });
    // getOrCreate self-consistency invariant (issue #277). parsed.facilityId is
    // client-supplied and every read above (project gate, get-or-create) is
    // keyed on it, so this compares the resolved statement against that same
    // value — it is NOT caller-scope authorization (there is no independent
    // caller facility until #372). What it guarantees is that a future
    // getOrCreate change can't silently anchor the ledger (and its registry
    // writes) to another facility's statement.
    if (statement.facilityId !== parsed.facilityId) {
      throw new SafeError("GHG statement does not belong to this facility.");
    }

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
    const claimed = await claimSubmissionDraft(orgCtx, {
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
      case "existing": {
        // ADR 0004 idempotency: the statement for this period was already
        // created in the registry, so this attempt mints nothing. Report it
        // as such — and read the real membership rather than claiming zero
        // linked removals, which the ledger row simply doesn't carry.
        const linked = await getRemovalsByGhgStatementId(orgCtx, statement.id);
        return {
          outcome: "existing" as const,
          ghgStatementId: statement.id,
          externalId: claimed.externalId,
          linkedRemovalIds: linked.map((removal) => removal.id),
          warnings: [],
        };
      }
      case "claimed":
        return createGhgStatementRemote({
          client,
          orgCtx,
          statement,
          row: claimed.row,
          resumed: claimed.resumed || knownRemoteMatch,
          externalProjectId: project.externalProjectId,
          endOn: parsed.reportingPeriodEndOn,
          submissionAttemptId,
          expected,
        });
    }
  }, { rateLimit: submitRateLimit("cert:create-ghg-statement") });
}

// Creates or reconciles a remote draft by (project, end_on). Multiple remote
// drafts are ambiguous and reject the local row with MULTIPLE_DRAFTS_MESSAGE.
async function createGhgStatementRemote(args: {
  client: IsometricClient;
  orgCtx: OrgContext;
  statement: CertifierGhgStatementRow;
  row: CertificationSubmissionRow;
  resumed: boolean;
  externalProjectId: string;
  endOn: string;
  submissionAttemptId: string;
  // Removals predicted in-window at create time (empty on the resumed/existing
  // paths, where the guard is skipped). Used to flag any the registry excludes.
  expected: ExpectedRemoval[];
}): Promise<CreateGhgStatementResult> {
  const {
    client,
    orgCtx,
    statement,
    row,
    resumed,
    externalProjectId,
    endOn,
    submissionAttemptId,
    expected,
  } = args;

  const requestPayload = { end_on: endOn, project_id: externalProjectId };
  const { externalId, source } = await performRegistryCreate({
    orgCtx,
    entityType: GHG_STATEMENT_ENTITY_TYPE,
    entityId: statement.id,
    submissionRowId: row.id,
    operation: "ghg_statement:create",
    requestPayload,
    resumed,
    create: () => createGhgStatement(client, requestPayload).then((r) => r.id),
    reconcile: () =>
      reconcileGhgStatement(client, { projectId: externalProjectId, endOn }).then(
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

  return finalizeGhgStatement({
    client,
    orgCtx,
    statement,
    row,
    externalId,
    expected,
    outcome: source === "create" ? "created" : "existing",
  });
}

// Shared tail for fresh and reconciled creates. Persist the external id before
// reconciling membership, reporting window, and ledger state transactionally;
// losing it would let a retry POST a duplicate statement.
async function finalizeGhgStatement(args: {
  client: IsometricClient;
  orgCtx: OrgContext;
  statement: CertifierGhgStatementRow;
  row: CertificationSubmissionRow;
  externalId: string;
  expected: ExpectedRemoval[];
  outcome: GhgStatementCreateOutcome;
}): Promise<CreateGhgStatementResult> {
  const { client, orgCtx, statement, row, externalId, expected, outcome } =
    args;

  await markSubmissionSubmitted(orgCtx, row.id, {
    externalId,
    supersedePreviousId: null,
  });

  // Re-fetch outside any transaction — the create response carries neither
  // the linked removal set nor the server-derived reporting-period start,
  // and a DB transaction must never be held open across network I/O.
  const remote = await getGhgStatement(client, externalId).catch(() => null);
  if (!remote) {
    await updateSubmissionMetadata(orgCtx, row.id, {
      [SUBMISSION_METADATA_KEYS.remoteStatus]: "DRAFT",
    });
    return {
      outcome,
      ghgStatementId: statement.id,
      externalId,
      linkedRemovalIds: [],
      warnings: [],
    };
  }

  // Membership, reporting window and ledger state move together behind the
  // organization-scoped data-access boundary.
  const reconciled = await reconcileGhgStatementRemoteState(orgCtx, {
    statementId: statement.id,
    submission: row,
    remote,
  });
  return {
    outcome,
    ghgStatementId: statement.id,
    externalId,
    linkedRemovalIds: reconciled.linkedRemovalIds,
    // Reconcile warns about ids the registry *returned* but we couldn't
    // match; the honesty delta is the inverse — removals we predicted
    // in-window that the registry silently placed in a different period.
    warnings: [
      ...reconciled.warnings,
      ...expectedButExcludedWarnings(expected, reconciled.linkedRemovalIds),
    ],
  };
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
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    const parsed = submitGhgStatementDialogSchema.parse(input);
    assertProductionConfirmed(parsed.confirmProduction);

    const submissionAttemptId = crypto.randomUUID();
    logger.info(
      { op: "ghg-statement:submit", ghgStatementId, submissionAttemptId },
      "ghg statement submit started",
    );

    // Resolve the statement first, then scope its ledger read to the same
    // organization and facility lineage (issue #277).
    const statement = await getCertifierGhgStatementById(
      orgCtx,
      ghgStatementId,
    );
    if (!statement) throw new SafeError("GHG statement not found.");

    const submission = await getLatestSubmission(
      orgCtx,
      {
        provider: ISOMETRIC_PROVIDER,
        submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
        localEntityType: GHG_STATEMENT_ENTITY_TYPE,
        localEntityId: ghgStatementId,
      },
      statement.facilityId,
    );
    if (!submission?.externalId) {
      throw new SafeError("Create the GHG statement before submitting it.");
    }

    const [facility, remoteBefore] = await Promise.all([
      getFacilityById(orgCtx, statement.facilityId),
      getGhgStatement(client, submission.externalId).catch(() => null),
    ]);

    // Empty-statement backstop (#245). Never send a statement with nothing to
    // verify. The registry's own membership (`ghg_entry_ids`) is authoritative;
    // fall back to the reconciled local count only when the live fetch failed.
    // This is the hard gate the predictive create-guard defers to — and it
    // fail-closes any 0-removal statement that already exists in the registry.
    const linkedCount = remoteBefore
      ? remoteBefore.ghg_entry_ids.length
      : (await countRemovalsByGhgStatementIds(orgCtx, [ghgStatementId])).get(
          ghgStatementId,
        ) ?? 0;
    if (linkedCount === 0) {
      throw new SafeError(
        "This GHG statement has no linked removals, so there's nothing to submit. Submit a removal in this reporting period first.",
      );
    }

    const submitMode = chooseGhgSubmitModeFromKnownState(
      remoteBefore,
      submission.metadata,
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

    const externalReportUrl = parsed.externalReportUrl ?? parsed.reportUrl;
    const generatedReport = parsed.reportId
      ? await getApprovedGhgStatementReport(orgCtx, {
          ghgStatementId,
          reportId: parsed.reportId,
        })
      : null;
    if (parsed.reportId && !generatedReport) {
      throw new SafeError(
        "Approve the selected generated report before submitting.",
      );
    }
    if (generatedReport) {
      await assertGhgStatementReportFresh(orgCtx, generatedReport);
    }
    const reportUrl = generatedReport
      ? await issueVerifierReportUrl(orgCtx, generatedReport.id)
      : externalReportUrl;
    if (!reportUrl) {
      throw new SafeError(
        "Approve a generated report or enter an external report URL.",
      );
    }
    const document = generatedReport
      ? { id: generatedReport.documentId }
      : await attachReportDocument(orgCtx, {
          submissionId: submission.id,
          reportUrl,
          description: `External GHG statement report - ${facility.code} - period ending ${statement.reportingPeriodEndOn}`,
          metadata: { ghgStatementExternalId: submission.externalId },
        });

    // Same payload shape for every audit event in this action — three call
    // sites (reconciled-success, failure, success) all log the same request.
    const summaryProvided = Boolean(parsed.summaryOfChanges?.trim());
    const submitRequestPayload = buildGhgSubmitRequestPayload(
      submitMode,
      redactReportUrlSecrets(reportUrl) ?? reportUrl,
      summaryProvided,
    );

    // Both success paths (reconciled-after-failure, and the direct one) have
    // to finalize identically, so they share one closure.
    const finalizeSubmitSuccess = async (remote: GhgStatement) => {
      await applyGhgRemoteState(orgCtx, submission, remote, {
        reportUrl: redactReportUrlSecrets(reportUrl),
        summaryOfChanges: parsed.summaryOfChanges?.trim() || null,
        lastReportDocumentId: document.id,
        submittedToVerifierAt: new Date().toISOString(),
      });
      if (generatedReport) {
        await markGhgStatementReportSubmitted(orgCtx, generatedReport.id);
      }
    };

    let remoteAfter: GhgStatement;
    try {
      remoteAfter =
        submitMode === "resubmit"
          ? await resubmitGhgStatement(client, submission.externalId, {
              ghg_statement_report_url: reportUrl,
              summary_of_changes: parsed.summaryOfChanges?.trim() ?? "",
            })
          : await submitGhgStatement(client, submission.externalId, {
              ghg_statement_report_url: reportUrl,
            });
    } catch (err) {
      const providerFailure =
        err instanceof IsometricApiError
          ? {
              status: err.status ?? null,
              body: redactReportSecrets(
                sanitizeIsometricErrorBody(err.body),
              ),
            }
          : null;
      logger.warn(
        {
          op: `ghg-statement:${submitMode}`,
          ghgStatementId,
          submissionId: submission.id,
          submissionAttemptId,
          errorName: err instanceof Error ? err.name : typeof err,
          ...(providerFailure
            ? { providerStatus: providerFailure.status }
            : {}),
        },
        "ghg statement submit failed; attempting reconciliation",
      );
      const after = await getGhgStatement(client, submission.externalId).catch(
        () => null,
      );
      const submitApplied =
        after &&
        ghgSubmitAppearsApplied(after, reportUrl) &&
        (!remoteBefore ||
          ghgSubmitFingerprintChanged(remoteBefore, after));
      if (after && submitApplied) {
        await appendSyncEvent(orgCtx, {
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
        await finalizeSubmitSuccess(after);
        return { externalId: submission.externalId, remoteStatus: after.status };
      }

      const message =
        err instanceof IsometricApiError
          ? describeIsometricApiError(
              err,
              "The verifier rejected the GHG statement submit.",
            )
          : "Submit failed. Try again.";
      await appendSyncEvent(orgCtx, {
        provider: ISOMETRIC_PROVIDER,
        entityType: GHG_STATEMENT_ENTITY_TYPE,
        entityId: ghgStatementId,
        operation: `ghg_statement:${submitMode}`,
        status: "failed",
        requestPayload: submitRequestPayload,
        responsePayload: providerFailure ?? undefined,
        errorMessage: message,
      });
      throw new SafeError(message);
    }

    await appendSyncEvent(orgCtx, {
      provider: ISOMETRIC_PROVIDER,
      entityType: GHG_STATEMENT_ENTITY_TYPE,
      entityId: ghgStatementId,
      operation: `ghg_statement:${submitMode}`,
      status: "succeeded",
      requestPayload: submitRequestPayload,
      responsePayload: { id: remoteAfter.id, status: remoteAfter.status },
    });
    await finalizeSubmitSuccess(remoteAfter);

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
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    const submission = await getSubmissionById(orgCtx, submissionId);
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
    // Resolve the statement this submission anchors to, so the follow-up ledger
    // read is scoped to its facility (issue #277). The higher-consequence read
    // above (getSubmissionById by raw submissionId) is necessarily unscoped —
    // submissionId is the only handle and the facility is discovered *from* it —
    // and statement.facilityId is likewise derived from that same row, so this
    // scope is lineage-consistency / fail-closed-on-dangling-anchor, not a
    // cross-facility authorization check (that needs an independent caller
    // facility, deferred to #372).
    const statement = await getCertifierGhgStatementById(
      orgCtx,
      submission.localEntityId,
    );
    if (!statement) throw new SafeError("GHG statement not found.");
    // Only mirror remote state onto the latest version of the (provider,
    // submissionType, localEntityType, localEntityId) row. Superseded rows
    // stay frozen so the audit trail keeps showing the snapshot from when
    // they were submitted; refreshing a stale row would silently rewrite
    // history with whatever the new version's remote state happens to be.
    const latest = await getLatestSubmission(
      orgCtx,
      {
        provider: submission.provider,
        submissionType: submission.submissionType,
        localEntityType: submission.localEntityType,
        localEntityId: submission.localEntityId,
      },
      statement.facilityId,
    );
    if (!latest || latest.id !== submission.id) {
      throw new SafeError(
        "This GHG statement version has been superseded. Refresh the page to see the latest one.",
      );
    }
    const remote = await getGhgStatement(client, submission.externalId);
    await reconcileGhgStatementRemoteState(orgCtx, {
      statementId: submission.localEntityId,
      submission,
      remote,
    });
    return remote;
  });
}

// Full state for one GHG statement's detail panel: the statement, its ledger
// row, the reconciled removals (each with its latest removal-ledger row),
// the live remote statement, and recent sync events.
export async function loadGhgStatementState(
  ghgStatementId: string,
): Promise<ActionResult<GhgStatementState>> {
  return withAction(async (orgCtx) => {
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    const statement = await getCertifierGhgStatementById(
      orgCtx,
      ghgStatementId,
    );
    if (!statement) throw new SafeError("GHG statement not found.");

    const [statementSubmission, removalRows, recentSyncEvents] =
      await Promise.all([
        getLatestSubmission(orgCtx, {
          provider: ISOMETRIC_PROVIDER,
          submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
          localEntityType: GHG_STATEMENT_ENTITY_TYPE,
          localEntityId: ghgStatementId,
        }),
        getRemovalsByGhgStatementId(orgCtx, ghgStatementId),
        listRecentSyncEvents(orgCtx, {
          entityType: GHG_STATEMENT_ENTITY_TYPE,
          entityId: ghgStatementId,
          limit: RECENT_SYNC_EVENTS_LIMIT,
        }),
      ]);

    // Two batched lookups for every linked removal — its latest ledger row
    // (status badge) and its grouped credit batches (cross-link accordion).
    const removalIds = removalRows.map((removal) => removal.id);
    const [removalSubmissions, creditBatchesByRemoval] = await Promise.all([
      getLatestSubmissionsForEntities(orgCtx, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: REMOVAL_SUBMISSION_TYPE,
        localEntityType: REMOVAL_ENTITY_TYPE,
        localEntityIds: removalIds,
      }),
      getCreditBatchSummariesByRemovalIds(orgCtx, removalIds),
    ]);
    const linkedRemovals: LinkedRemoval[] = removalRows.map((removal) => ({
      removal,
      submission: removalSubmissions.get(removal.id) ?? null,
      creditBatches: creditBatchesByRemoval.get(removal.id) ?? [],
    }));

    const remote = statementSubmission?.externalId
      ? await getGhgStatement(client, statementSubmission.externalId).catch(() => null)
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
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    try {
      await reconcileGhgStatementsForFacility(orgCtx, facilityId);
    } catch (error) {
      logger.warn(
        {
          op: "ghg-statement:list-reconcile",
          facilityId,
          errorName: error instanceof Error ? error.name : typeof error,
        },
        "registry statement refresh failed; serving stale local list",
      );
    }
    const statements = await listGhgStatementsForFacility(orgCtx, facilityId);
    if (statements.length === 0) return [];

    // Two batched lookups for the whole list — the latest ledger row per
    // statement and the linked-removal count per statement — instead of a
    // pair of queries per row.
    const statementIds = statements.map((statement) => statement.id);
    const [submissions, removalCounts] = await Promise.all([
      getLatestSubmissionsForEntities(orgCtx, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
        localEntityType: GHG_STATEMENT_ENTITY_TYPE,
        localEntityIds: statementIds,
      }),
      countRemovalsByGhgStatementIds(orgCtx, statementIds),
    ]);

    return statements.map((statement) => ({
      statement,
      latestSubmission: submissions.get(statement.id) ?? null,
      linkedRemovalCount: removalCounts.get(statement.id) ?? 0,
      effectiveReportingPeriodEndOn:
        getEffectiveReportingPeriodEndOn(statement),
      remotePeriodMissing: hasMissingRemotePeriod(statement),
    }));
  });
}

// Stepper preview — submitted removals not yet absorbed by any GHG statement.
export async function loadOpenRemovalsForFacility(
  facilityId: string,
): Promise<ActionResult<OpenRemovalView[]>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const open = await listOpenRemovalsForFacility(orgCtx, facilityId);
    const creditBatchesByRemoval = await getCreditBatchSummariesByRemovalIds(
      orgCtx,
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
