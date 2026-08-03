import {
  appendSyncEvent,
  attachReportDocument,
} from "@/data-access/certification";
import {
  getLatestSubmission,
} from "@/data-access/certification-submissions";
import { applyGhgRemoteState } from "@/data-access/certifier-ghg-remote-state";
import {
  countRemovalsByGhgStatementIds,
  getCertifierGhgStatementById,
} from "@/data-access/certifier-ghg-statements";
import {
  clearPendingVerifierReportToken,
  getApprovedGhgStatementReport,
  promotePendingVerifierReportToken,
} from "@/data-access/ghg-statement-reports";
import { getFacilityById } from "@/data-access/facilities";
import { withFacilityDurabilitySessionLock } from "@/data-access/facility-durability-lock";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import {
  getVerifierTokenFromReportUrl,
  hashVerifierToken,
} from "@/lib/certification/ghg-statement-report/verifier-url";
import {
  redactReportSecrets,
  redactReportUrlSecrets,
} from "@/lib/certification/report-url";
import type { SubmissionProgressReporter } from "@/lib/certification/submission-progress";
import { SafeError } from "@/lib/errors";
import {
  describeIsometricApiError,
  getGhgStatement,
  getIsometricClientForOrg,
  IsometricApiError,
  resubmitGhgStatement,
  sanitizeIsometricErrorBody,
  submitGhgStatement,
  type GhgStatement,
  type GhgStatementStatus,
} from "@/lib/isometric";
import {
  buildGhgSubmitRequestPayload,
  chooseGhgSubmitModeFromKnownState,
  ghgSubmitAppearsApplied,
  ghgSubmitFingerprintChanged,
} from "@/lib/isometric/utils/ghg-statement-state";
import { logger } from "@/lib/log";
import {
  submitGhgStatementDialogSchema,
  type SubmitGhgStatementDialogInput,
} from "@/schemas/certification";
import {
  assertGhgStatementReportFresh,
  issueVerifierReportUrl,
} from "./ghg-statement-reports";
import {
  assertProductionConfirmed,
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
} from "./shared";

export interface SubmitGhgStatementResult {
  externalId: string;
  remoteStatus: GhgStatementStatus;
}

const AMBIGUOUS_PROVIDER_FAILURE_STATUSES = new Set([408, 409, 425, 429]);

function isDefinitiveProviderRejection(error: unknown): boolean {
  return (
    error instanceof IsometricApiError &&
    error.code === "http" &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    !AMBIGUOUS_PROVIDER_FAILURE_STATUSES.has(error.status)
  );
}

export async function submitGhgStatementToVerifierCore(args: {
  orgCtx: OrgContext;
  ghgStatementId: string;
  input: SubmitGhgStatementDialogInput;
  onProgress?: SubmissionProgressReporter;
}): Promise<SubmitGhgStatementResult> {
  const { orgCtx, ghgStatementId, onProgress } = args;
  requireOrgRole(orgCtx, "admin");
  const client = await getIsometricClientForOrg(orgCtx.organizationId);
  const parsed = submitGhgStatementDialogSchema.parse(args.input);
  assertProductionConfirmed(parsed.confirmProduction);
  onProgress?.({ step: "ghg_statement.checking", state: "active" });

  const submissionAttemptId = crypto.randomUUID();
  logger.info(
    { op: "ghg-statement:submit", ghgStatementId, submissionAttemptId },
    "ghg statement submit started",
  );

  const statement = await getCertifierGhgStatementById(orgCtx, ghgStatementId);
  if (!statement) throw new SafeError("GHG Statement not found.");

  const initialSubmission = await getLatestSubmission(
    orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
      localEntityType: GHG_STATEMENT_ENTITY_TYPE,
      localEntityId: ghgStatementId,
    },
    statement.facilityId,
  );
  if (!initialSubmission?.externalId) {
    throw new SafeError("Create the GHG Statement before submitting it.");
  }
  const initialExternalId = initialSubmission.externalId;

  const facility = await getFacilityById(orgCtx, statement.facilityId);
  const externalReportUrl = parsed.externalReportUrl ?? parsed.reportUrl;
  const selectedGeneratedReport = parsed.reportId
    ? await getApprovedGhgStatementReport(orgCtx, {
        ghgStatementId,
        reportId: parsed.reportId,
      })
    : null;
  if (parsed.reportId && !selectedGeneratedReport) {
    throw new SafeError(
      "Approve the selected generated report before submitting.",
    );
  }
  if (!selectedGeneratedReport && !externalReportUrl) {
    throw new SafeError(
      "Approve a generated report or enter an external report URL.",
    );
  }
  const submissionKey = {
    provider: ISOMETRIC_PROVIDER,
    submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
    localEntityType: GHG_STATEMENT_ENTITY_TYPE,
    localEntityId: ghgStatementId,
  };

  const result = await withFacilityDurabilitySessionLock(
    orgCtx,
    statement.facilityId,
    async (): Promise<SubmitGhgStatementResult> => {
      const readCurrentSubmission = async () => {
        const current = await getLatestSubmission(
          orgCtx,
          submissionKey,
          statement.facilityId,
        );
        if (
          !current ||
          current.id !== initialSubmission.id ||
          current.externalId !== initialExternalId
        ) {
          throw new SafeError(
            "This GHG Statement version changed. Refresh the page and try again.",
          );
        }
        return current;
      };

      let submission = await readCurrentSubmission();
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
      const remoteBefore = await getGhgStatement(
        client,
        initialExternalId,
      ).catch(() => null);

      if (generatedReport?.pendingVerifierTokenHash) {
        const previouslyStagedToken = getVerifierTokenFromReportUrl(
          remoteBefore?.ghg_statement_report_url ?? null,
          generatedReport.id,
        );
        if (previouslyStagedToken && remoteBefore?.status !== "DRAFT") {
          const promoted = await promotePendingVerifierReportToken(orgCtx, {
            reportId: generatedReport.id,
            token: previouslyStagedToken,
          });
          if (!promoted) {
            throw new SafeError(
              "A previous verifier submission is still being reconciled. Refresh the GHG Statement and try again.",
            );
          }
        } else {
          throw new SafeError(
            "A previous verifier submission is still being reconciled. Refresh the GHG Statement and try again.",
          );
        }
      }

      const linkedCount = remoteBefore
        ? remoteBefore.ghg_entry_ids.length
        : (await countRemovalsByGhgStatementIds(orgCtx, [ghgStatementId])).get(
            ghgStatementId,
          ) ?? 0;
      if (linkedCount === 0) {
        throw new SafeError(
          "This GHG Statement has no linked Removals. Submit a Removal in this reporting period first.",
        );
      }

      const submitMode = chooseGhgSubmitModeFromKnownState(
        remoteBefore,
        submission.metadata,
      );
      if (submitMode === "blocked-awaiting") {
        throw new SafeError(
          "This GHG Statement is already awaiting verification.",
        );
      }
      if (submitMode === "blocked-verified") {
        throw new SafeError("This GHG Statement is already verified.");
      }
      if (submitMode === "resubmit" && !parsed.summaryOfChanges?.trim()) {
        throw new SafeError("Summary of changes is required for resubmission.");
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
      const pendingVerifierToken = generatedReport
        ? getVerifierTokenFromReportUrl(reportUrl, generatedReport.id)
        : null;
      if (generatedReport && !pendingVerifierToken) {
        throw new Error("Generated verifier report URL is malformed.");
      }

      onProgress?.({ step: "ghg_statement.checking", state: "complete" });
      onProgress?.({
        step: "ghg_statement.preparing_report",
        state: "active",
      });
      const document = generatedReport
        ? { id: generatedReport.documentId }
        : await attachReportDocument(orgCtx, {
            submissionId: submission.id,
            reportUrl,
            description: `External GHG Statement report: ${facility.code}, period ending ${statement.reportingPeriodEndOn}`,
            metadata: { ghgStatementExternalId: initialExternalId },
          });
      const submitRequestPayload = buildGhgSubmitRequestPayload(
        submitMode,
        redactReportUrlSecrets(reportUrl) ?? reportUrl,
        Boolean(parsed.summaryOfChanges?.trim()),
      );
      const finalizeSubmitSuccess = async (remote: GhgStatement) => {
        if (generatedReport && pendingVerifierToken) {
          const promoted = await promotePendingVerifierReportToken(orgCtx, {
            reportId: generatedReport.id,
            token: pendingVerifierToken,
          });
          if (!promoted) {
            throw new Error(
              "Verifier report capability could not be promoted after provider success.",
            );
          }
        }
        submission = await readCurrentSubmission();
        await applyGhgRemoteState(
          orgCtx,
          submission,
          remote,
          {
            reportUrl: redactReportUrlSecrets(reportUrl),
            summaryOfChanges: parsed.summaryOfChanges?.trim() || null,
            lastReportDocumentId: document.id,
            submittedToVerifierAt: new Date().toISOString(),
          },
        );
      };

      onProgress?.({
        step: "ghg_statement.preparing_report",
        state: "complete",
      });
      onProgress?.({ step: "ghg_statement.sending", state: "active" });
      let remoteAfter: GhgStatement;
      try {
        remoteAfter =
          submitMode === "resubmit"
            ? await resubmitGhgStatement(client, initialExternalId, {
                ghg_statement_report_url: reportUrl,
                summary_of_changes: parsed.summaryOfChanges?.trim() ?? "",
              })
            : await submitGhgStatement(client, initialExternalId, {
                ghg_statement_report_url: reportUrl,
              });
      } catch (err) {
        const providerFailure =
          err instanceof IsometricApiError
            ? {
                status: err.status ?? null,
                body: redactReportSecrets(sanitizeIsometricErrorBody(err.body)),
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
        const after = await getGhgStatement(client, initialExternalId).catch(
          () => null,
        );
        const submitApplied =
          after &&
          ghgSubmitAppearsApplied(after, reportUrl) &&
          (!remoteBefore || ghgSubmitFingerprintChanged(remoteBefore, after));
        if (after && submitApplied) {
          onProgress?.({ step: "ghg_statement.sending", state: "complete" });
          onProgress?.({ step: "ghg_statement.confirming", state: "active" });
          await appendSyncEvent(orgCtx, {
            provider: ISOMETRIC_PROVIDER,
            entityType: GHG_STATEMENT_ENTITY_TYPE,
            entityId: ghgStatementId,
            operation: `ghg_statement:${submitMode}:reconciled`,
            status: "succeeded",
            requestPayload: submitRequestPayload,
            responsePayload: {
              id: initialExternalId,
              source: "reconciliation",
              detected_status: after.status,
              submission_attempt_id: submissionAttemptId,
              external_mutation: "confirmed",
            },
          });
          await finalizeSubmitSuccess(after);
          return { externalId: initialExternalId, remoteStatus: after.status };
        }

        const confirmedNonApplied = isDefinitiveProviderRejection(err);
        if (
          generatedReport &&
          pendingVerifierToken &&
          confirmedNonApplied
        ) {
          await clearPendingVerifierReportToken(orgCtx, {
            reportId: generatedReport.id,
            expectedTokenHash: hashVerifierToken(pendingVerifierToken),
          });
        }

        const message =
          err instanceof IsometricApiError
            ? describeIsometricApiError(
                err,
                "The verifier rejected the GHG Statement. Open it in Isometric to resolve the issue.",
              )
            : "Submit failed. Try again.";
        await appendSyncEvent(orgCtx, {
          provider: ISOMETRIC_PROVIDER,
          entityType: GHG_STATEMENT_ENTITY_TYPE,
          entityId: ghgStatementId,
          operation: `ghg_statement:${submitMode}`,
          status: "failed",
          requestPayload: submitRequestPayload,
          responsePayload: {
            ...(providerFailure ?? {}),
            submission_attempt_id: submissionAttemptId,
            external_mutation: confirmedNonApplied ? "none" : "possible",
            reconciliation: after ? "not_confirmed" : "unavailable",
          },
          errorMessage: message,
        });
        throw new SafeError(message);
      }

      onProgress?.({ step: "ghg_statement.sending", state: "complete" });
      onProgress?.({ step: "ghg_statement.confirming", state: "active" });
      await appendSyncEvent(orgCtx, {
        provider: ISOMETRIC_PROVIDER,
        entityType: GHG_STATEMENT_ENTITY_TYPE,
        entityId: ghgStatementId,
        operation: `ghg_statement:${submitMode}`,
        status: "succeeded",
        requestPayload: submitRequestPayload,
        responsePayload: {
          id: remoteAfter.id,
          status: remoteAfter.status,
          submission_attempt_id: submissionAttemptId,
          external_mutation: "confirmed",
        },
      });
      await finalizeSubmitSuccess(remoteAfter);
      return {
        externalId: initialExternalId,
        remoteStatus: remoteAfter.status,
      };
    },
  );
  onProgress?.({ step: "ghg_statement.confirming", state: "complete" });
  onProgress?.({ step: "ghg_statement.complete", state: "complete" });
  return result;
}
