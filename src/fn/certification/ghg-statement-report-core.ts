/**
 * Trusted-context core for generated GHG Statement reports.
 *
 * Directive-free on purpose: every function here takes an already resolved
 * `OrgContext`, so it must never be exported from a `"use server"` module,
 * where Next.js would make it a public action accepting a forged context.
 * Session-authenticated actions live in `./ghg-statement-reports`; the
 * submission pipeline (`./submit-ghg-statement`) calls this module directly.
 */
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import versions from "../../../docs/isometric/versions.json";
import type { OrgContext } from "@/lib/auth/server";
import {
  stageVerifierReportToken,
  type GhgStatementReportRow,
} from "@/data-access/ghg-statement-reports";
import {
  getCertifierProjectByFacility,
  getLatestSubmissionsForEntities,
} from "@/data-access/certification";
import { getCertifierGhgStatementById } from "@/data-access/certifier-ghg-statements";
import { getFacilityById } from "@/data-access/facilities";
import { getActiveOrganization } from "@/data-access/organizations";
import {
  buildGhgStatementReportModel,
  GHG_STATEMENT_REPORT_MODEL_VERSION,
  GhgStatementReportReconciliationError,
  type BuildGhgStatementReportModelInput,
  type GhgStatementReportModel,
} from "@/lib/certification/ghg-statement-report/model";
import { buildVerifierReportUrl } from "@/lib/certification/ghg-statement-report/verifier-url";
import { redactReportUrlSecrets } from "@/lib/certification/report-url";
import { SafeError } from "@/lib/errors";
import { DomainError } from "@/lib/domain-errors";
import { IsometricApiError, isRetryableIsometricReadError } from "@/lib/isometric/client";
import { logger } from "@/lib/log";
import {
  getGhgEntry,
  getGhgStatement,
} from "@/lib/isometric";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
} from "./shared";

// Repo interpretation pins (docs/isometric/versions.json), not operator input:
// the report must always state which methodology its totals were computed under.
const PINNED_STANDARD_VERSION =
  versions.certify_project_observation.current_standard_version;
const PINNED_PROTOCOL_VERSION = versions.protocol.patch_version;
// Per-call timeout, attempt cap and bounded backoff remain in the shared client.
const REPORT_REGISTRY_READ_BASE_DEADLINE_MS = 60_000;
const REPORT_REGISTRY_READ_PER_ENTRY_MS = 5_000;
const REPORT_REGISTRY_READ_MAX_DEADLINE_MS = 300_000;
const REPORT_REGISTRY_READ_CONCURRENCY = 4;

export interface LiveReportFacts {
  input: BuildGhgStatementReportModelInput;
  frozenInput: Record<string, unknown>;
}

export function buildCheckedReportModel(
  input: BuildGhgStatementReportModelInput,
): GhgStatementReportModel {
  try {
    return buildGhgStatementReportModel(input);
  } catch (error) {
    if (error instanceof GhgStatementReportReconciliationError) {
      throw new SafeError(
        `${error.message} Refresh the GHG Statement and generate a new report.`,
      );
    }
    throw error;
  }
}

export async function loadLiveReportFacts(
  orgCtx: OrgContext,
  args: {
    ghgStatementId: string;
    reportVersion: number;
    preparedAt: string;
  },
): Promise<LiveReportFacts> {
  const statement = await getCertifierGhgStatementById(
    orgCtx,
    args.ghgStatementId,
  );
  if (!statement) throw new SafeError("GHG Statement not found.");
  const [project, facility, organization, statementSubmission] =
    await Promise.all([
      getCertifierProjectByFacility(orgCtx, statement.facilityId),
      getFacilityById(orgCtx, statement.facilityId),
      getActiveOrganization(orgCtx),
      getLatestSubmissionsForEntities(orgCtx, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
        localEntityType: GHG_STATEMENT_ENTITY_TYPE,
        localEntityIds: [statement.id],
      }).then((rows) => rows.get(statement.id) ?? null),
    ]);
  if (!project || !organization) {
    throw new SafeError(
      "The GHG Statement document-control lineage is incomplete.",
    );
  }
  if (!statementSubmission?.externalId) {
    throw new SafeError("Create the GHG Statement before generating its report.");
  }

  const client = await resolveIsometricClient(orgCtx);
  const readFailureMessage =
    `GHG Statement ${statementSubmission.externalId} could not be read from Isometric. Try again shortly.`;
  const readFailure = new DomainError(
    "registry_unavailable",
    readFailureMessage,
    { retryable: true },
  );
  const controller = new AbortController();
  const startedAt = Date.now();
  const abortAtDeadline = () => controller.abort(readFailure);
  let deadline = setTimeout(
    abortAtDeadline,
    REPORT_REGISTRY_READ_BASE_DEADLINE_MS,
  );
  try {
    const remoteStatement = await getGhgStatement(
      client,
      statementSubmission.externalId,
      { signal: controller.signal },
    );
    if (
      remoteStatement.id !== statementSubmission.externalId ||
      remoteStatement.project_id !== project.externalProjectId ||
      remoteStatement.reporting_period_start_at === null ||
      remoteStatement.reporting_period_start_at !==
        statement.reportingPeriodStartOn ||
      remoteStatement.reporting_period_end_at !== statement.reportingPeriodEndOn
    ) {
      throw new SafeError(
        "The live GHG Statement does not match the local project and reporting-period lineage. Refresh it before generating a report.",
      );
    }
    if (
      remoteStatement.pending_total_co2e_removed_kg === null ||
      !Number.isFinite(remoteStatement.pending_total_co2e_removed_kg)
    ) {
      throw new SafeError(
        "The live GHG Statement does not expose a pending net removed total. Refresh it or wait for Isometric to finish recalculating.",
      );
    }
    if (remoteStatement.ghg_entry_ids.length === 0) {
      throw new SafeError(
        "This GHG Statement has no live GHG Entry membership. Submit a Removal first.",
      );
    }

    // Count the statement read against the same budget, then allow larger
    // statements more time without holding the report locks indefinitely.
    const deadlineMs = Math.min(
      REPORT_REGISTRY_READ_BASE_DEADLINE_MS +
        remoteStatement.ghg_entry_ids.length * REPORT_REGISTRY_READ_PER_ENTRY_MS,
      REPORT_REGISTRY_READ_MAX_DEADLINE_MS,
    );
    clearTimeout(deadline);
    controller.signal.throwIfAborted();
    deadline = setTimeout(abortAtDeadline, Math.max(0, deadlineMs - (Date.now() - startedAt)));

    const remoteEntries: Awaited<ReturnType<typeof getGhgEntry>>[] = [];
    let nextIndex = 0;
    const workers = Array.from({
      length: Math.min(REPORT_REGISTRY_READ_CONCURRENCY, remoteStatement.ghg_entry_ids.length),
    }, async () => {
      try {
        while (nextIndex < remoteStatement.ghg_entry_ids.length) {
          controller.signal.throwIfAborted();
          const index = nextIndex++;
          remoteEntries[index] = await getGhgEntry(client, remoteStatement.ghg_entry_ids[index], {
            signal: controller.signal,
          });
        }
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    });
    try {
      await Promise.all(workers);
    } catch (error) {
      // Cancel siblings and drain them before unwinding the lock scopes.
      controller.abort(error);
      await Promise.allSettled(workers);
      throw error;
    }
    for (const [index, entry] of remoteEntries.entries()) {
      const requestedId = remoteStatement.ghg_entry_ids[index];
      // noma supports only biochar removal credits; a REDUCTION entry's figures
      // must never be presented as removals (see lib/isometric/projects.ts).
      if (entry.credit_type !== "REMOVAL") {
        throw new SafeError(
          `Live GHG Entry ${requestedId} is not a removal credit. This report supports only removal entries.`,
        );
      }
      if (
        entry.id !== requestedId ||
        entry.ghg_statement_id !== remoteStatement.id ||
        entry.completed_on < remoteStatement.reporting_period_start_at ||
        entry.completed_on > remoteStatement.reporting_period_end_at ||
        entry.started_on > entry.completed_on
      ) {
        throw new SafeError(
          `Live GHG Entry ${requestedId} does not match this statement and reporting period. Generate a new report after refreshing membership.`,
        );
      }
    }

    const documentControl = {
      organizationName: organization.name,
      facilityCode: facility.code,
      externalProjectId: project.externalProjectId,
      externalGhgStatementId: remoteStatement.id,
      reportingPeriodStartOn: remoteStatement.reporting_period_start_at,
      reportingPeriodEndOn: remoteStatement.reporting_period_end_at,
      standardVersion: PINNED_STANDARD_VERSION,
      protocolVersion: PINNED_PROTOCOL_VERSION,
      configuredProtocolVersion: project.protocolVersion,
    };
    const normalizedEntries = remoteEntries.map((entry) => ({
      id: entry.id,
      startedOn: entry.started_on,
      completedOn: entry.completed_on,
      netRemovedKg: entry.co2e_net_removed_kg,
      netRemovedWithoutDiscountKg:
        entry.co2e_net_removed_without_discount_kg,
      netRemovedStandardDeviationKg:
        entry.co2e_net_removed_standard_deviation_kg,
      ghgStatementId: entry.ghg_statement_id,
    }));
    const input: BuildGhgStatementReportModelInput = {
      reportVersion: args.reportVersion,
      preparedAt: args.preparedAt,
      documentControl,
      authoritativeStatement: {
        externalEntryIds: remoteStatement.ghg_entry_ids,
        pendingTotalCo2eRemovedKg:
          remoteStatement.pending_total_co2e_removed_kg,
        creditAllocation: remoteStatement.credit_allocation
          ? {
              supplierCreditKg:
                remoteStatement.credit_allocation.supplier_allocation_kg,
              bufferPoolKg:
                remoteStatement.credit_allocation.buffer_pool_contribution_kg,
            }
          : null,
      },
      remoteEntries: normalizedEntries,
    };
    return {
      input,
      frozenInput: {
        documentControl,
        authoritativeStatement: {
          id: remoteStatement.id,
          projectId: remoteStatement.project_id,
          ghgEntryIds: [...remoteStatement.ghg_entry_ids],
          pendingTotalCo2eRemovedKg:
            remoteStatement.pending_total_co2e_removed_kg,
          creditAllocation: remoteStatement.credit_allocation,
          reportingPeriodStartOn:
            remoteStatement.reporting_period_start_at,
          reportingPeriodEndOn: remoteStatement.reporting_period_end_at,
          status: remoteStatement.status,
          priorReportUrl: redactReportUrlSecrets(
            remoteStatement.ghg_statement_report_url,
          ),
        },
        liveGhgEntries: normalizedEntries,
      },
    };
  } catch (error) {
    const aborted = error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    if (error === readFailure || aborted ||
      (error instanceof IsometricApiError && isRetryableIsometricReadError(error))) {
      logger.warn(
        {
          ghgStatementId: args.ghgStatementId,
          externalGhgStatementId: statementSubmission.externalId,
          reason: error === readFailure ? "deadline_exceeded" : "retry_budget_exhausted",
        },
        "GHG Statement report registry read stopped",
      );
      if (error === readFailure) throw readFailure;
      throw new DomainError("registry_unavailable", readFailureMessage, { retryable: true });
    }
    if (error instanceof IsometricApiError) {
      if (error.code === "not_configured") {
        throw new DomainError("registry_not_configured", error.message);
      }
      throw new DomainError(
        "registry_read_refused",
        `GHG Statement ${statementSubmission.externalId} could not be read from Isometric. Check the GHG Statement in Isometric or the registry connection.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

export async function rebuildGhgStatementReportModel(
  orgCtx: OrgContext,
  report: GhgStatementReportRow,
): Promise<GhgStatementReportModel> {
  const storedModel = report.reportModel as {
    modelVersion?: unknown;
  } | null;
  if (storedModel?.modelVersion !== GHG_STATEMENT_REPORT_MODEL_VERSION) {
    throw new SafeError(
      "This report uses an earlier format. Generate and approve a new report.",
    );
  }
  const facts = await loadLiveReportFacts(orgCtx, {
    ghgStatementId: report.ghgStatementId,
    reportVersion: report.version,
    preparedAt: report.preparedAt.toISOString(),
  });
  return buildCheckedReportModel(facts.input);
}

/**
 * Mints a fresh verifier capability token for an approved report and returns
 * the link carrying it. Each call revokes the link handed out by the previous
 * call, which is why the URL is built at submission rather than at preparation
 * — only the token digest is ever stored.
 */
export async function issueVerifierReportUrl(
  orgCtx: OrgContext,
  reportId: string,
): Promise<string> {
  return buildVerifierReportUrl(
    reportId,
    await stageVerifierReportToken(orgCtx, reportId),
  );
}

export async function assertGhgStatementReportFresh(
  orgCtx: OrgContext,
  report: GhgStatementReportRow,
): Promise<void> {
  const rebuilt = await rebuildGhgStatementReportModel(orgCtx, report);
  if (rebuilt.sourceFingerprint !== report.sourceFingerprint) {
    throw new SafeError(
      "The approved report is stale because live GHG Statement data changed. Generate and approve a new report.",
    );
  }
}
