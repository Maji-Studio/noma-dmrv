"use server";

import { randomUUID } from "node:crypto";
import versions from "../../../docs/isometric/versions.json";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import {
  approveGhgStatementReport as approveReportRow,
  getGhgStatementReportById,
  getNextGhgStatementReportVersion,
  getReportByPreparationKey,
  insertPreparedGhgStatementReport,
  issueVerifierReportToken,
  listGhgStatementReports,
  type GhgStatementReportRow,
} from "@/data-access/ghg-statement-reports";
import {
  getCertifierProjectByFacility,
  getLatestSubmissionsForEntities,
} from "@/data-access/certification";
import { getCertifierGhgStatementById } from "@/data-access/certifier-ghg-statements";
import { getFacilityById } from "@/data-access/facilities";
import { getActiveOrganization } from "@/data-access/organizations";
import { withDedicatedLockConnection } from "@/db";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import {
  buildGhgStatementReportModel,
  GHG_STATEMENT_REPORT_MODEL_VERSION,
  GhgStatementReportReconciliationError,
  type BuildGhgStatementReportModelInput,
  type GhgStatementReportModel,
  sha256Hex,
} from "@/lib/certification/ghg-statement-report/model";
import { renderGhgStatementReportPdf } from "@/lib/certification/ghg-statement-report/pdf";
import {
  buildVerifierReportUrl,
  generateVerifierToken,
  hashVerifierToken,
} from "@/lib/certification/ghg-statement-report/verifier-url";
import { redactReportUrlSecrets } from "@/lib/certification/report-url";
import { SafeError } from "@/lib/errors";
import {
  getGhgEntry,
  getGhgStatement,
  getIsometricClientForOrg,
} from "@/lib/isometric";
import { buildStorageKey, getStorageProvider } from "@/lib/storage";
import {
  approveGhgStatementReportSchema,
  prepareGhgStatementReportSchema,
  type ApproveGhgStatementReportInput,
  type PrepareGhgStatementReportInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
} from "./shared";

const PDF_MIME_TYPE = "application/pdf";
// Repo interpretation pins (docs/isometric/versions.json), not operator input:
// the report must always state which methodology its totals were computed under.
const PINNED_STANDARD_VERSION =
  versions.certify_project_observation.current_standard_version;
const PINNED_PROTOCOL_VERSION = versions.protocol.patch_version;

export interface GhgStatementReportView {
  id: string;
  ghgStatementId: string;
  documentId: string;
  version: number;
  lifecycle: string;
  sourceFingerprint: string;
  contentChecksumSha256: string;
  preparedAt: Date;
  approvedAt: Date | null;
  submittedAt: Date | null;
  reviewUrl: string;
}

interface LiveReportFacts {
  input: BuildGhgStatementReportModelInput;
  frozenInput: Record<string, unknown>;
}

function buildCheckedReportModel(
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

function reportView(row: GhgStatementReportRow): GhgStatementReportView {
  return {
    id: row.id,
    ghgStatementId: row.ghgStatementId,
    documentId: row.documentId,
    version: row.version,
    lifecycle: row.lifecycle,
    sourceFingerprint: row.sourceFingerprint,
    contentChecksumSha256: row.contentChecksumSha256,
    preparedAt: row.preparedAt,
    approvedAt: row.approvedAt,
    submittedAt: row.submittedAt,
    reviewUrl: `/api/documents/${row.documentId}`,
  };
}

async function loadLiveReportFacts(
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

  const client = await getIsometricClientForOrg(orgCtx.organizationId);
  const remoteStatement = await getGhgStatement(
    client,
    statementSubmission.externalId,
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

  const remoteEntries = await Promise.all(
    remoteStatement.ghg_entry_ids.map((entryId) =>
      getGhgEntry(client, entryId),
    ),
  );
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
    supplierCreditKg:
      entry.credit_allocation?.supplier_allocation_kg ?? null,
    bufferPoolKg:
      entry.credit_allocation?.buffer_pool_contribution_kg ?? null,
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
    await issueVerifierReportToken(orgCtx, reportId),
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

export async function prepareGhgStatementReport(
  input: PrepareGhgStatementReportInput,
): Promise<ActionResult<GhgStatementReportView>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = prepareGhgStatementReportSchema.parse(input);
    return withDedicatedLockConnection(async (tx) => {
      await acquireCertificationArtifactLocksSorted(tx, [
        {
          provider: ISOMETRIC_PROVIDER,
          localEntityType: "ghgStatementReport",
          localEntityId: parsed.ghgStatementId,
        },
      ]);
      const existing = await getReportByPreparationKey(orgCtx, {
        ghgStatementId: parsed.ghgStatementId,
        preparationKey: parsed.preparationKey,
      });
      if (existing) return reportView(existing);

      const version = await getNextGhgStatementReportVersion(
        orgCtx,
        parsed.ghgStatementId,
      );
      const preparedAt = new Date();
      const facts = await loadLiveReportFacts(orgCtx, {
        ghgStatementId: parsed.ghgStatementId,
        reportVersion: version,
        preparedAt: preparedAt.toISOString(),
      });
      const model = buildCheckedReportModel(facts.input);
      const pdf = await renderGhgStatementReportPdf(model);
      const reportId = randomUUID();
      const documentId = randomUUID();
      const checksum = sha256Hex(pdf);
      const storage = getStorageProvider();
      const fileName = `ghg-statement-report-v${version}.pdf`;
      const storageKey = `org/${orgCtx.organizationId}/${buildStorageKey({
        entityType: "ghgStatementReport",
        entityId: reportId,
        documentType: "pdf",
        fileName,
      })}`;
      await storage.putObject(storageKey, pdf, PDF_MIME_TYPE);
      try {
        const artifact = await insertPreparedGhgStatementReport(orgCtx, {
          reportId,
          ghgStatementId: parsed.ghgStatementId,
          documentId,
          version,
          sourceFingerprint: model.sourceFingerprint,
          contentChecksumSha256: checksum,
          frozenInput: facts.frozenInput,
          reportModel: model,
          preparationKey: parsed.preparationKey,
          // Seeded with a token nobody holds: the link stays inert until
          // submission issues a real one via `issueVerifierReportToken`.
          verifierTokenHash: hashVerifierToken(generateVerifierToken()),
          preparedAt,
          storage: {
            provider: storage.name,
            bucket: storage.bucket,
            key: storageKey,
            fileName,
            fileSizeBytes: pdf.byteLength,
          },
        });
        return reportView(artifact.report);
      } catch (error) {
        await storage.deleteObject(storageKey).catch(() => undefined);
        throw error;
      }
    });
  });
}

export async function approveGhgStatementReport(
  input: ApproveGhgStatementReportInput,
): Promise<ActionResult<GhgStatementReportView>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = approveGhgStatementReportSchema.parse(input);
    const report = await getGhgStatementReportById(orgCtx, parsed.reportId);
    if (
      !report ||
      report.ghgStatementId !== parsed.ghgStatementId ||
      report.version !== parsed.version
    ) {
      throw new SafeError("GHG Statement report version not found.");
    }
    const rebuilt = await rebuildGhgStatementReportModel(orgCtx, report);
    if (rebuilt.sourceFingerprint !== report.sourceFingerprint) {
      throw new SafeError(
        "This report is stale because live inputs changed. Generate and review a new report.",
      );
    }
    const approved = await approveReportRow(orgCtx, {
      reportId: report.id,
      ghgStatementId: report.ghgStatementId,
      version: report.version,
      sourceFingerprint: report.sourceFingerprint,
    });
    return reportView(approved);
  });
}

export async function loadGhgStatementReports(
  ghgStatementId: string,
): Promise<ActionResult<GhgStatementReportView[]>> {
  return withAction(async (orgCtx) => {
    const statement = await getCertifierGhgStatementById(
      orgCtx,
      ghgStatementId,
    );
    if (!statement) throw new SafeError("GHG Statement not found.");
    const reports = await listGhgStatementReports(orgCtx, statement.id);
    return reports.map(reportView);
  });
}
