"use server";

import { randomUUID } from "node:crypto";
import { requireOrgRole } from "@/lib/auth/server";
import {
  approveGhgStatementReport as approveReportRow,
  getGhgStatementReportById,
  getNextGhgStatementReportVersion,
  getReportByPreparationKey,
  insertPreparedGhgStatementReport,
  listGhgStatementReports,
  type GhgStatementReportRow,
} from "@/data-access/ghg-statement-reports";
import { withFacilityDurabilitySessionLock } from "@/data-access/facility-durability-lock";
import { getCertifierGhgStatementById } from "@/data-access/certifier-ghg-statements";
import { withDedicatedLockConnection } from "@/db";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import {
  sha256Hex,
  type GhgStatementReportModel,
} from "@/lib/certification/ghg-statement-report/model";
import { NonCanonicalPdfError } from "@/lib/certification/ghg-statement-report/canonical-pdf";
import { renderGhgStatementReportPdf } from "@/lib/certification/ghg-statement-report/pdf";
import {
  generateVerifierToken,
  hashVerifierToken,
} from "@/lib/certification/ghg-statement-report/verifier-url";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
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
  buildCheckedReportModel,
  loadLiveReportFacts,
  rebuildGhgStatementReportModel,
} from "./ghg-statement-report-core";
import { ISOMETRIC_PROVIDER } from "./shared";

const PDF_MIME_TYPE = "application/pdf";
/** Shown when the renderer emits a PDF this build cannot make byte stable. */
const reportPdfNotCanonicalMessage = (ghgStatementId: string): string =>
  `The GHG Statement report PDF for ${ghgStatementId} was not prepared. Preparing it again will not help. Contact support with this ID.`;

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


/**
 * Canonicalization failures are deterministic: the same model rendered by the
 * same build fails the same way, so the generic "Try again" that `withAction`
 * produces for an unknown error would send the operator down a path that can
 * never work. Surface a specific message and keep the parser's technical
 * reason in the server log, which a `SafeError` would otherwise skip.
 */
async function renderCheckedReportPdf(
  model: GhgStatementReportModel,
  ghgStatementId: string,
): Promise<Buffer> {
  try {
    return await renderGhgStatementReportPdf(model);
  } catch (error) {
    if (!(error instanceof NonCanonicalPdfError)) throw error;
    logger.error(
      { ghgStatementId, errorName: error.name, errorMessage: error.message },
      "GHG statement report PDF could not be canonicalized",
    );
    throw new SafeError(reportPdfNotCanonicalMessage(ghgStatementId));
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


export async function prepareGhgStatementReport(
  input: PrepareGhgStatementReportInput,
): Promise<ActionResult<GhgStatementReportView>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = prepareGhgStatementReportSchema.parse(input);
    const statement = await getCertifierGhgStatementById(
      orgCtx,
      parsed.ghgStatementId,
    );
    if (!statement) throw new SafeError("GHG Statement not found.");
    return withFacilityDurabilitySessionLock(
      orgCtx,
      statement.facilityId,
      () =>
        withDedicatedLockConnection(async (tx) => {
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
          if (parsed.ensureFirst) {
            const [firstReport] = await listGhgStatementReports(
              orgCtx,
              parsed.ghgStatementId,
            );
            if (firstReport) return reportView(firstReport);
          }

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
          const pdf = await renderCheckedReportPdf(
            model,
            parsed.ghgStatementId,
          );
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
              // submission stages a real one via `stageVerifierReportToken`.
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
        }),
    );
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
