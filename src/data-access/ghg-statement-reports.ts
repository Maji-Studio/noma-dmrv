import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierGhgStatementReports,
  certifierGhgStatements,
  documents,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type {
  GhgStatementReportModel,
} from "@/lib/certification/ghg-statement-report/model";
import {
  generateVerifierToken,
  hashVerifierToken,
} from "@/lib/certification/ghg-statement-report/verifier-url";
import { requireOrgScope } from "./utils";

export type GhgStatementReportRow =
  typeof certifierGhgStatementReports.$inferSelect;

export interface PreparedReportArtifact {
  report: GhgStatementReportRow;
  document: typeof documents.$inferSelect;
}

export async function listGhgStatementReports(
  ctx: OrgContext,
  ghgStatementId: string,
): Promise<GhgStatementReportRow[]> {
  requireOrgScope(ctx);
  return db
    .select()
    .from(certifierGhgStatementReports)
    .where(
      and(
        eq(certifierGhgStatementReports.ghgStatementId, ghgStatementId),
        eq(
          certifierGhgStatementReports.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .orderBy(desc(certifierGhgStatementReports.version));
}

export async function getGhgStatementReportById(
  ctx: OrgContext,
  reportId: string,
): Promise<GhgStatementReportRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certifierGhgStatementReports)
    .where(
      and(
        eq(certifierGhgStatementReports.id, reportId),
        eq(
          certifierGhgStatementReports.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getApprovedGhgStatementReport(
  ctx: OrgContext,
  args: { ghgStatementId: string; reportId?: string },
): Promise<GhgStatementReportRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certifierGhgStatementReports)
    .where(
      and(
        eq(
          certifierGhgStatementReports.ghgStatementId,
          args.ghgStatementId,
        ),
        args.reportId
          ? eq(certifierGhgStatementReports.id, args.reportId)
          : undefined,
        inArray(certifierGhgStatementReports.lifecycle, [
          "approved",
          "submitted",
        ]),
        // A newly generated report supersedes every older approval: an
        // approved row is only submittable while it is still the statement's
        // latest version.
        sql`${certifierGhgStatementReports.version} = (
          select max(current_report.version)
          from certifier_ghg_statement_reports current_report
          where current_report.ghg_statement_id = ${args.ghgStatementId}
            and current_report.organization_id = ${ctx.organizationId}
        )`,
        eq(
          certifierGhgStatementReports.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .orderBy(desc(certifierGhgStatementReports.version))
    .limit(1);
  return row ?? null;
}

export async function getNextGhgStatementReportVersion(
  ctx: OrgContext,
  ghgStatementId: string,
): Promise<number> {
  requireOrgScope(ctx);
  const [statement] = await db
    .select({ id: certifierGhgStatements.id })
    .from(certifierGhgStatements)
    .where(
      and(
        eq(certifierGhgStatements.id, ghgStatementId),
        eq(certifierGhgStatements.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!statement) throw new SafeError("GHG Statement not found.");
  const [latest] = await db
    .select({ version: certifierGhgStatementReports.version })
    .from(certifierGhgStatementReports)
    .where(
      and(
        eq(certifierGhgStatementReports.ghgStatementId, ghgStatementId),
        eq(
          certifierGhgStatementReports.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .orderBy(desc(certifierGhgStatementReports.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

export async function getReportByPreparationKey(
  ctx: OrgContext,
  args: { ghgStatementId: string; preparationKey: string },
): Promise<GhgStatementReportRow | null> {
  requireOrgScope(ctx);
  const [row] = await db
    .select()
    .from(certifierGhgStatementReports)
    .where(
      and(
        eq(
          certifierGhgStatementReports.ghgStatementId,
          args.ghgStatementId,
        ),
        eq(
          certifierGhgStatementReports.preparationIdempotencyKey,
          args.preparationKey,
        ),
        eq(
          certifierGhgStatementReports.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertPreparedGhgStatementReport(
  ctx: OrgContext,
  args: {
    reportId: string;
    ghgStatementId: string;
    documentId: string;
    version: number;
    sourceFingerprint: string;
    contentChecksumSha256: string;
    frozenInput: Record<string, unknown>;
    reportModel: GhgStatementReportModel;
    preparationKey: string;
    verifierTokenHash: string;
    preparedAt: Date;
    storage: {
      provider: string;
      bucket: string;
      key: string;
      fileName: string;
      fileSizeBytes: number;
    };
  },
): Promise<PreparedReportArtifact> {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    const [statement] = await tx
      .select({ id: certifierGhgStatements.id })
      .from(certifierGhgStatements)
      .where(
        and(
          eq(certifierGhgStatements.id, args.ghgStatementId),
          eq(certifierGhgStatements.organizationId, ctx.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!statement) throw new SafeError("GHG Statement not found.");

    const [existing] = await tx
      .select()
      .from(certifierGhgStatementReports)
      .where(
        and(
          eq(
            certifierGhgStatementReports.ghgStatementId,
            args.ghgStatementId,
          ),
          eq(
            certifierGhgStatementReports.preparationIdempotencyKey,
            args.preparationKey,
          ),
          eq(
            certifierGhgStatementReports.organizationId,
            ctx.organizationId,
          ),
        ),
      )
      .limit(1);
    if (existing) {
      const [document] = await tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, existing.documentId),
            eq(documents.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (!document) throw new Error("Prepared report document is missing.");
      return { report: existing, document };
    }

    const [document] = await tx
      .insert(documents)
      .values({
        id: args.documentId,
        organizationId: ctx.organizationId,
        entityType: "ghgStatementReport",
        entityId: args.reportId,
        documentType: "pdf",
        storageProvider: args.storage.provider,
        storageBucket: args.storage.bucket,
        storageKey: args.storage.key,
        fileName: args.storage.fileName,
        fileSizeBytes: args.storage.fileSizeBytes,
        mimeType: "application/pdf",
        checksumSha256: args.contentChecksumSha256,
        visibility: "private",
        uploadStatus: "uploaded",
        capturedAt: args.preparedAt,
        metadata: {
          kind: "ghg_statement_report",
          reportVersion: args.version,
          sourceFingerprint: args.sourceFingerprint,
        },
        createdBy: ctx.userId,
      })
      .returning();
    const [report] = await tx
      .insert(certifierGhgStatementReports)
      .values({
        id: args.reportId,
        organizationId: ctx.organizationId,
        ghgStatementId: args.ghgStatementId,
        documentId: args.documentId,
        version: args.version,
        lifecycle: "prepared",
        sourceFingerprint: args.sourceFingerprint,
        contentChecksumSha256: args.contentChecksumSha256,
        frozenInput: args.frozenInput,
        reportModel: args.reportModel,
        reviewedNarratives: {},
        preparationIdempotencyKey: args.preparationKey,
        verifierTokenHash: args.verifierTokenHash,
        preparedBy: ctx.userId,
        preparedAt: args.preparedAt,
      })
      .returning();
    return { report, document };
  });
}

export async function approveGhgStatementReport(
  ctx: OrgContext,
  args: {
    reportId: string;
    ghgStatementId: string;
    version: number;
    sourceFingerprint: string;
  },
): Promise<GhgStatementReportRow> {
  requireOrgScope(ctx);
  const [row] = await db
    .update(certifierGhgStatementReports)
    .set({
      lifecycle: "approved",
      approvedBy: ctx.userId,
      approvedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierGhgStatementReports.id, args.reportId),
        eq(
          certifierGhgStatementReports.ghgStatementId,
          args.ghgStatementId,
        ),
        eq(certifierGhgStatementReports.version, args.version),
        sql`${certifierGhgStatementReports.version} = (
          select max(current_report.version)
          from certifier_ghg_statement_reports current_report
          where current_report.ghg_statement_id = ${args.ghgStatementId}
            and current_report.organization_id = ${ctx.organizationId}
        )`,
        eq(certifierGhgStatementReports.lifecycle, "prepared"),
        eq(
          certifierGhgStatementReports.sourceFingerprint,
          args.sourceFingerprint,
        ),
        eq(
          certifierGhgStatementReports.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .returning();
  if (!row) {
    throw new SafeError(
      "This report version is not current or is no longer ready for approval. Generate a new report.",
    );
  }
  return row;
}

/**
 * Stage a fresh verifier capability while leaving the accepted capability
 * untouched. The committed pending digest lets the public route serve the URL
 * during the provider call; only the plaintext returned here leaves this seam.
 */
export async function stageVerifierReportToken(
  ctx: OrgContext,
  reportId: string,
): Promise<string> {
  requireOrgScope(ctx);
  const token = generateVerifierToken();
  const updated = await db
    .update(certifierGhgStatementReports)
    .set({
      pendingVerifierTokenHash: hashVerifierToken(token),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierGhgStatementReports.id, reportId),
        inArray(certifierGhgStatementReports.lifecycle, [
          "approved",
          "submitted",
        ]),
        isNull(certifierGhgStatementReports.pendingVerifierTokenHash),
        eq(certifierGhgStatementReports.organizationId, ctx.organizationId),
      ),
    )
    .returning({ id: certifierGhgStatementReports.id });
  if (updated.length === 0) {
    throw new SafeError("Approved report not found.");
  }
  return token;
}

export async function promotePendingVerifierReportToken(
  ctx: OrgContext,
  args: { reportId: string; token: string },
): Promise<boolean> {
  requireOrgScope(ctx);
  const pendingTokenHash = hashVerifierToken(args.token);
  const updated = await db
    .update(certifierGhgStatementReports)
    .set({
      verifierTokenHash: pendingTokenHash,
      pendingVerifierTokenHash: null,
      lifecycle: "submitted",
      submittedBy: sql`coalesce(${certifierGhgStatementReports.submittedBy}, ${ctx.userId})`,
      submittedAt: sql`coalesce(${certifierGhgStatementReports.submittedAt}, now())`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierGhgStatementReports.id, args.reportId),
        or(
          eq(
            certifierGhgStatementReports.pendingVerifierTokenHash,
            pendingTokenHash,
          ),
          and(
            isNull(certifierGhgStatementReports.pendingVerifierTokenHash),
            eq(
              certifierGhgStatementReports.verifierTokenHash,
              pendingTokenHash,
            ),
          ),
        ),
        inArray(certifierGhgStatementReports.lifecycle, [
          "approved",
          "submitted",
        ]),
        eq(
          certifierGhgStatementReports.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .returning({ id: certifierGhgStatementReports.id });
  return updated.length > 0;
}

export async function clearPendingVerifierReportToken(
  ctx: OrgContext,
  args: { reportId: string; expectedTokenHash: string },
): Promise<boolean> {
  requireOrgScope(ctx);
  const updated = await db
    .update(certifierGhgStatementReports)
    .set({
      pendingVerifierTokenHash: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(certifierGhgStatementReports.id, args.reportId),
        eq(
          certifierGhgStatementReports.pendingVerifierTokenHash,
          args.expectedTokenHash,
        ),
        eq(certifierGhgStatementReports.organizationId, ctx.organizationId),
      ),
    )
    .returning({ id: certifierGhgStatementReports.id });
  return updated.length > 0;
}

export async function getVerifierReportDocument(
  reportId: string,
): Promise<{
  documentId: string;
  storageKey: string | null;
  uploadStatus: string;
  verifierTokenHash: string;
  pendingVerifierTokenHash: string | null;
} | null> {
  // org-scope-ok: verifier capability-token lookup intentionally crosses organizations.
  const [row] = await db
    .select({
      documentId: documents.id,
      storageKey: documents.storageKey,
      uploadStatus: documents.uploadStatus,
      verifierTokenHash: certifierGhgStatementReports.verifierTokenHash,
      pendingVerifierTokenHash:
        certifierGhgStatementReports.pendingVerifierTokenHash,
    })
    .from(certifierGhgStatementReports)
    .innerJoin(
      documents,
      and(
        eq(certifierGhgStatementReports.documentId, documents.id),
        eq(
          certifierGhgStatementReports.organizationId,
          documents.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(certifierGhgStatementReports.id, reportId),
        eq(documents.visibility, "private"),
      ),
    )
    .limit(1);
  return row ?? null;
}
