import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierGhgPeriods,
  certifierProjects,
  certificationSubmissions,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { creditBatches } from "@/db/schema/credits";
import { documents } from "@/db/schema/documentation";
import { facilities } from "@/db/schema/facilities";
import { SafeError } from "@/lib/errors";
import { requireAuth } from "./utils";

export const LOCK_TTL_MS = 10 * 60 * 1000;

type CertifierProvider = (typeof certifierProjects.$inferSelect)["provider"];
export type CertifierProjectRow = typeof certifierProjects.$inferSelect;
export type CertifierGhgPeriodRow = typeof certifierGhgPeriods.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;

export interface UpsertCertifierProjectInput {
  facilityId: string;
  provider: CertifierProvider;
  externalProjectId: string;
  protocolSlug?: string;
  protocolVersion?: string | null;
  defaultRemovalTemplateId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface LinkedFacilitySummary {
  facilityId: string;
  code: string;
  name: string;
}

export async function getCertifierProjectByFacility(
  userId: string,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<CertifierProjectRow | null> {
  requireAuth(userId);
  const [row] = await db
    .select()
    .from(certifierProjects)
    .where(
      and(
        eq(certifierProjects.facilityId, facilityId),
        eq(certifierProjects.provider, provider),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listFacilitiesLinkedToExternal(
  userId: string,
  provider: CertifierProvider,
  externalProjectId: string,
): Promise<LinkedFacilitySummary[]> {
  requireAuth(userId);
  const rows = await db
    .select({
      facilityId: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(certifierProjects)
    .innerJoin(facilities, eq(certifierProjects.facilityId, facilities.id))
    .where(
      and(
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.externalProjectId, externalProjectId),
      ),
    );
  return rows;
}

export interface LinkedFacilityByProject extends LinkedFacilitySummary {
  externalProjectId: string;
}

export async function listAllFacilitiesLinkedByProvider(
  userId: string,
  provider: CertifierProvider,
): Promise<LinkedFacilityByProject[]> {
  requireAuth(userId);
  return db
    .select({
      externalProjectId: certifierProjects.externalProjectId,
      facilityId: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(certifierProjects)
    .innerJoin(facilities, eq(certifierProjects.facilityId, facilities.id))
    .where(eq(certifierProjects.provider, provider));
}

export async function upsertCertifierProject(
  userId: string,
  input: UpsertCertifierProjectInput,
): Promise<CertifierProjectRow> {
  requireAuth(userId);
  const values = {
    facilityId: input.facilityId,
    provider: input.provider,
    externalProjectId: input.externalProjectId,
    protocolSlug: input.protocolSlug ?? "biochar",
    protocolVersion: input.protocolVersion ?? null,
    defaultRemovalTemplateId: input.defaultRemovalTemplateId ?? null,
    metadata: input.metadata ?? null,
  };

  const [row] = await db
    .insert(certifierProjects)
    .values(values)
    .onConflictDoUpdate({
      target: [certifierProjects.facilityId, certifierProjects.provider],
      set: {
        externalProjectId: values.externalProjectId,
        protocolSlug: values.protocolSlug,
        protocolVersion: values.protocolVersion,
        defaultRemovalTemplateId: values.defaultRemovalTemplateId,
        metadata: values.metadata,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row;
}

export async function deleteCertifierProject(
  userId: string,
  facilityId: string,
  provider: CertifierProvider = "isometric",
): Promise<void> {
  requireAuth(userId);

  // Unlink guard: refuse if any credit batch from this facility has been
  // submitted to the certifier. Phase 3 will be the first writer; this guard
  // expands as additional submission types come online.
  const [blocking] = await db
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .innerJoin(
      creditBatches,
      eq(certificationSubmissions.localEntityId, creditBatches.id),
    )
    .where(
      and(
        eq(certificationSubmissions.provider, provider),
        eq(certificationSubmissions.localEntityType, "creditBatch"),
        eq(creditBatches.facilityId, facilityId),
      ),
    )
    .limit(1);

  if (blocking) {
    throw new SafeError(
      "Cannot unlink: this facility has credit batch submissions on the certifier. Supersede or reject them first.",
    );
  }

  await db
    .delete(certifierProjects)
    .where(
      and(
        eq(certifierProjects.facilityId, facilityId),
        eq(certifierProjects.provider, provider),
      ),
    );
}

export async function getOrCreateGhgPeriod(
  userId: string,
  args: {
    provider: CertifierProvider;
    externalProjectId: string;
    reportingPeriodEndAt: string;
  },
): Promise<CertifierGhgPeriodRow> {
  requireAuth(userId);
  const [inserted] = await db
    .insert(certifierGhgPeriods)
    .values({
      provider: args.provider,
      externalProjectId: args.externalProjectId,
      reportingPeriodEndAt: args.reportingPeriodEndAt,
    })
    .onConflictDoNothing({
      target: [
        certifierGhgPeriods.provider,
        certifierGhgPeriods.externalProjectId,
        certifierGhgPeriods.reportingPeriodEndAt,
      ],
    })
    .returning();
  if (inserted) return inserted;

  const [row] = await db
    .select()
    .from(certifierGhgPeriods)
    .where(
      and(
        eq(certifierGhgPeriods.provider, args.provider),
        eq(certifierGhgPeriods.externalProjectId, args.externalProjectId),
        eq(certifierGhgPeriods.reportingPeriodEndAt, args.reportingPeriodEndAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new SafeError("Could not create or load GHG statement period.");
  }
  return row;
}

// =====================================================================
// Submission ledger
// =====================================================================

export type CertificationSubmissionRow =
  typeof certificationSubmissions.$inferSelect;
export type CertifierSyncEventRow = typeof certifierSyncEvents.$inferSelect;

export interface GhgSubmissionWithPeriod {
  submission: CertificationSubmissionRow;
  period: CertifierGhgPeriodRow;
}

export interface SubmissionKey {
  provider: CertifierProvider;
  submissionType: string;
  localEntityType: string;
  localEntityId: string;
}

export async function getLatestSubmission(
  userId: string,
  key: SubmissionKey,
): Promise<CertificationSubmissionRow | null> {
  requireAuth(userId);
  const [row] = await db
    .select()
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, key.provider),
        eq(certificationSubmissions.submissionType, key.submissionType),
        eq(certificationSubmissions.localEntityType, key.localEntityType),
        eq(certificationSubmissions.localEntityId, key.localEntityId),
      ),
    )
    .orderBy(desc(certificationSubmissions.version))
    .limit(1);
  return row ?? null;
}

export async function getSubmissionById(
  userId: string,
  id: string,
): Promise<CertificationSubmissionRow | null> {
  requireAuth(userId);
  const [row] = await db
    .select()
    .from(certificationSubmissions)
    .where(eq(certificationSubmissions.id, id))
    .limit(1);
  return row ?? null;
}

export async function getGhgPeriodById(
  userId: string,
  id: string,
): Promise<CertifierGhgPeriodRow | null> {
  requireAuth(userId);
  const [row] = await db
    .select()
    .from(certifierGhgPeriods)
    .where(eq(certifierGhgPeriods.id, id))
    .limit(1);
  return row ?? null;
}

export async function getLatestGhgSubmissionForPeriod(
  userId: string,
  ghgPeriodId: string,
): Promise<CertificationSubmissionRow | null> {
  return getLatestSubmission(userId, {
    provider: "isometric",
    submissionType: "ghg_statement",
    localEntityType: "ghgPeriod",
    localEntityId: ghgPeriodId,
  });
}

export async function listSubmissionsForFacility(
  userId: string,
  args: { facilityId: string; submissionType?: string; limit?: number },
): Promise<CertificationSubmissionRow[]> {
  requireAuth(userId);
  const limit = args.limit ?? 50;
  const rows: CertificationSubmissionRow[] = [];

  if (!args.submissionType || args.submissionType === "removal") {
    rows.push(
      ...(await db
        .select({ submission: certificationSubmissions })
        .from(certificationSubmissions)
        .innerJoin(
          creditBatches,
          eq(certificationSubmissions.localEntityId, creditBatches.id),
        )
        .where(
          and(
            eq(certificationSubmissions.localEntityType, "creditBatch"),
            eq(certificationSubmissions.submissionType, "removal"),
            eq(creditBatches.facilityId, args.facilityId),
          ),
        )
        .orderBy(desc(certificationSubmissions.createdAt))
        .limit(limit))
        .map((row) => row.submission),
    );
  }

  if (!args.submissionType || args.submissionType === "ghg_statement") {
    const mapping = await getCertifierProjectByFacility(
      userId,
      args.facilityId,
      "isometric",
    );
    if (mapping) {
      rows.push(
        ...(await listSubmissionsForProject(userId, {
          provider: mapping.provider,
          externalProjectId: mapping.externalProjectId,
          submissionType: "ghg_statement",
          limit,
        })),
      );
    }
  }

  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export async function listSubmissionsForProject(
  userId: string,
  args: {
    provider: CertifierProvider;
    externalProjectId: string;
    submissionType: string;
    limit?: number;
  },
): Promise<CertificationSubmissionRow[]> {
  const rows = await listGhgSubmissionsForProject(userId, args);
  return rows.map((row) => row.submission);
}

export async function listGhgSubmissionsForProject(
  userId: string,
  args: {
    provider: CertifierProvider;
    externalProjectId: string;
    submissionType?: string;
    limit?: number;
  },
): Promise<GhgSubmissionWithPeriod[]> {
  requireAuth(userId);
  const [authorized] = await db
    .select({ id: certifierProjects.id })
    .from(certifierProjects)
    .where(
      and(
        eq(certifierProjects.provider, args.provider),
        eq(certifierProjects.externalProjectId, args.externalProjectId),
      ),
    )
    .limit(1);
  if (!authorized) {
    throw new SafeError("No linked facility has access to this certifier project.");
  }

  return db
    .select({
      submission: certificationSubmissions,
      period: certifierGhgPeriods,
    })
    .from(certifierGhgPeriods)
    .innerJoin(
      certificationSubmissions,
      and(
        eq(certificationSubmissions.provider, certifierGhgPeriods.provider),
        eq(certificationSubmissions.localEntityType, "ghgPeriod"),
        eq(certificationSubmissions.localEntityId, certifierGhgPeriods.id),
        eq(
          certificationSubmissions.submissionType,
          args.submissionType ?? "ghg_statement",
        ),
      ),
    )
    .where(
      and(
        eq(certifierGhgPeriods.provider, args.provider),
        eq(certifierGhgPeriods.externalProjectId, args.externalProjectId),
      ),
    )
    .orderBy(desc(certifierGhgPeriods.reportingPeriodEndAt), desc(certificationSubmissions.version))
    .limit(args.limit ?? 50);
}

export interface InsertDraftSubmissionInput extends SubmissionKey {
  version: number;
  payloadSnapshot: unknown;
  payloadHash: string;
  metadata?: Record<string, unknown> | null;
}

export async function insertDraftSubmission(
  userId: string,
  input: InsertDraftSubmissionInput,
): Promise<CertificationSubmissionRow> {
  requireAuth(userId);
  try {
    const [row] = await db
      .insert(certificationSubmissions)
      .values({
        provider: input.provider,
        submissionType: input.submissionType,
        localEntityType: input.localEntityType,
        localEntityId: input.localEntityId,
        version: input.version,
        status: "draft",
        payloadSnapshot: input.payloadSnapshot as Record<string, unknown>,
        payloadHash: input.payloadHash,
        lockedAt: sql`now()`,
        metadata: (input.metadata ?? null) as Record<string, unknown> | null,
      })
      .returning();
    return row;
  } catch (err) {
    // Postgres unique-violation (23505): another draft is already in flight
    // for this (provider, submissionType, localEntityType, localEntityId,
    // version) tuple. Surface as a SafeError so the orchestrator's branch-b
    // path is consistent with concurrent inserts losing the race.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      throw new SafeError("Submission already in progress");
    }
    throw err;
  }
}

export async function markSubmissionSubmitted(
  userId: string,
  id: string,
  args: { externalId: string; supersedePreviousId?: string | null },
): Promise<void> {
  requireAuth(userId);
  await db.transaction(async (tx) => {
    await tx
      .update(certificationSubmissions)
      .set({
        status: "submitted",
        externalId: args.externalId,
        submittedAt: sql`now()`,
        lockedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(certificationSubmissions.id, id));
    if (args.supersedePreviousId) {
      await tx
        .update(certificationSubmissions)
        .set({
          status: "superseded",
          supersededAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(certificationSubmissions.id, args.supersedePreviousId));
    }
  });
}

export async function markSubmissionRejected(
  userId: string,
  id: string,
  args: { errorMessage: string },
): Promise<void> {
  requireAuth(userId);
  await db
    .update(certificationSubmissions)
    .set({
      status: "rejected",
      lockedAt: null,
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || jsonb_build_object('lastError', ${args.errorMessage}::text)`,
    })
    .where(eq(certificationSubmissions.id, id));
}

export async function resetSubmissionToDraft(
  userId: string,
  id: string,
): Promise<CertificationSubmissionRow> {
  requireAuth(userId);
  const [row] = await db
    .update(certificationSubmissions)
    .set({
      status: "draft",
      lockedAt: sql`now()`,
      updatedAt: sql`now()`,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) - 'lastError'`,
    })
    .where(eq(certificationSubmissions.id, id))
    .returning();
  if (!row) throw new SafeError("Submission not found");
  return row;
}

export async function updateSubmissionMetadata(
  userId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  requireAuth(userId);
  await db
    .update(certificationSubmissions)
    .set({
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(certificationSubmissions.id, id));
}

export async function setSubmissionTerminalStatus(
  userId: string,
  id: string,
  args: {
    status: "accepted" | "rejected";
    metadataPatch?: Record<string, unknown>;
  },
): Promise<void> {
  requireAuth(userId);
  await db
    .update(certificationSubmissions)
    .set({
      status: args.status,
      lockedAt: null,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(args.metadataPatch ?? {})}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(certificationSubmissions.id, id));
}

export async function clearTerminalStatusForResubmit(
  userId: string,
  id: string,
  args: { metadataPatch?: Record<string, unknown> } = {},
): Promise<void> {
  requireAuth(userId);
  await db
    .update(certificationSubmissions)
    .set({
      status: "submitted",
      lockedAt: null,
      metadata: sql`coalesce(${certificationSubmissions.metadata}, '{}'::jsonb) || ${JSON.stringify(args.metadataPatch ?? {})}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(certificationSubmissions.id, id));
}

export async function getSubmissionWithLatestSyncEvent(
  userId: string,
  id: string,
): Promise<{
  submission: CertificationSubmissionRow;
  latestSyncEvent: CertifierSyncEventRow | null;
} | null> {
  requireAuth(userId);
  const submission = await getSubmissionById(userId, id);
  if (!submission) return null;
  const [latestSyncEvent] = await db
    .select()
    .from(certifierSyncEvents)
    .where(
      and(
        eq(certifierSyncEvents.entityType, submission.localEntityType),
        eq(certifierSyncEvents.entityId, submission.localEntityId),
      ),
    )
    .orderBy(desc(certifierSyncEvents.attemptedAt))
    .limit(1);
  return { submission, latestSyncEvent: latestSyncEvent ?? null };
}

export async function attachReportDocument(
  userId: string,
  args: {
    submissionId: string;
    reportUrl: string;
    description: string;
    metadata?: Record<string, unknown>;
  },
): Promise<DocumentRow> {
  requireAuth(userId);
  const [row] = await db
    .insert(documents)
    .values({
      entityType: "ghgStatement",
      entityId: args.submissionId,
      documentType: "pdf",
      fileUrl: args.reportUrl,
      fileName: deriveFileName(args.reportUrl),
      description: args.description,
      metadata: (args.metadata ?? {}) as Record<string, unknown>,
      createdBy: userId,
    })
    .returning();
  return row;
}

export interface AppendSyncEventInput {
  provider: CertifierProvider;
  entityType: string;
  entityId: string;
  operation: string;
  status: "succeeded" | "failed";
  requestPayload?: unknown;
  responsePayload?: unknown;
  errorMessage?: string | null;
}

export async function appendSyncEvent(
  userId: string,
  input: AppendSyncEventInput,
): Promise<void> {
  requireAuth(userId);
  await db.insert(certifierSyncEvents).values({
    provider: input.provider,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    status: input.status,
    requestPayload: (input.requestPayload ?? null) as Record<string, unknown>,
    responsePayload: (input.responsePayload ?? null) as Record<string, unknown>,
    errorMessage: input.errorMessage ?? null,
  });
}

export async function listRecentSyncEvents(
  userId: string,
  args: { entityType: string; entityId: string; limit: number },
): Promise<CertifierSyncEventRow[]> {
  requireAuth(userId);
  return db
    .select()
    .from(certifierSyncEvents)
    .where(
      and(
        eq(certifierSyncEvents.entityType, args.entityType),
        eq(certifierSyncEvents.entityId, args.entityId),
      ),
    )
    .orderBy(desc(certifierSyncEvents.attemptedAt))
    .limit(args.limit);
}

function deriveFileName(reportUrl: string): string {
  try {
    const url = new URL(reportUrl);
    const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
    return lastSegment || "ghg-statement-report.pdf";
  } catch {
    return "ghg-statement-report.pdf";
  }
}
