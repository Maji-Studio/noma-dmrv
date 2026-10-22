import { decideSubmissionClaim } from "@/lib/isometric/utils/submission-claim";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { isSubmittedAttempt, isRemovalCorrectionWindowOpen, isReturnedStatement } from "@/lib/record-lock";
import { getCertifiedLineageForBatches } from "./certification-lineage-guards";
import { emissionCorrectionBatchIds } from "./emission-entry-corrections";
import type { StatementReads } from "./record-lock-lineage";
import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { certifierRemovals, certificationSubmissions } from "@/db/schema/certification";
import { creditBatchApplications, creditBatches } from "@/db/schema/credits";
import type { OrgContext } from "@/lib/auth/server";
import { deriveRemovalEntryWindow, type EntryContender } from "@/lib/certification/removal-emission-contributions";
import { requireOrgScope, type Executor } from "./utils";

/** Every unsubmitted Removal is a contender, even before it acquires a ledger row. */
export async function listEmissionEntryDraftContenders(ctx: OrgContext, creditBatchIds: string[], executor: Executor & Pick<typeof db, "selectDistinct"> = db, claimedAttempt?: { removalId: string; submissionId?: string }, advisory = false): Promise<EntryContender[]> {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return [];
  const members = await executor.select({ removalId: creditBatchApplications.removalId }).from(creditBatchApplications)
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.creditBatchId, creditBatchIds)));
  const ids = [...new Set(members.flatMap((member) => member.removalId ? [member.removalId] : []))];
  if (!ids.length) return [];
  const rows = await executor.select({ removalId: certifierRemovals.id, createdAt: certifierRemovals.createdAt, metadata: certifierRemovals.metadata, ghgStatementId: certifierRemovals.ghgStatementId,
    creditBatchId: creditBatches.id, startDate: creditBatches.startDate, applicationDate: applications.applicationDate })
    .from(certifierRemovals)
    .innerJoin(creditBatchApplications, and(eq(creditBatchApplications.removalId, certifierRemovals.id), eq(creditBatchApplications.organizationId, ctx.organizationId)))
    .innerJoin(creditBatches, and(eq(creditBatches.id, creditBatchApplications.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)))
    .innerJoin(applications, and(eq(applications.id, creditBatchApplications.applicationId), eq(applications.organizationId, ctx.organizationId)))
    .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), inArray(certifierRemovals.id, ids)));
  let excludeSubmissionId: string | undefined;
  if (claimedAttempt && ids.includes(claimedAttempt.removalId)) {
    const [latest] = await executor.select().from(certificationSubmissions).where(and(
      eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.provider, "isometric"),
      eq(certificationSubmissions.localEntityType, "removal"), eq(certificationSubmissions.submissionType, "removal"),
      eq(certificationSubmissions.localEntityId, claimedAttempt.removalId),
    )).orderBy(desc(certificationSubmissions.version)).limit(1);
    // Only the submission read for this Removal can recover its exact latest draft.
    // Ordinary reads and mutation authorization retain the full lineage.
    const resumable = latest && !claimedAttempt.submissionId && decideSubmissionClaim({
      latest, payloadHash: latest.payloadHash ?? "", now: Date.now(), lockTtlMs: LOCK_TTL_MS,
      policy: { onSubmittedHashChanged: "supersede", allowEvidenceRefresh: true },
    }).kind === "resume";
    if (latest?.status === "draft" && latest.version > 1 &&
      (latest.id === claimedAttempt.submissionId || resumable)) excludeSubmissionId = latest.id;
  }
  const statementReads: StatementReads = new Map();
  const lineageReads = new Map<string, ReturnType<typeof getCertifiedLineageForBatches>>();
  const lineageByBatch = new Map(await Promise.all([...new Set(rows.map((row) => row.creditBatchId))].map(async (batchId) => {
    const union = await emissionCorrectionBatchIds(ctx, executor, batchId);
    const key = JSON.stringify([...union].sort());
    if (!lineageReads.has(key)) lineageReads.set(key, getCertifiedLineageForBatches(ctx, executor, union, statementReads, excludeSubmissionId, !advisory));
    const lineage = await lineageReads.get(key)!;
    // Advisory display evaluates the last persisted registry observation. It is
    // never mutation authority: writes still acquire the lineage locks and make
    // a fresh registry read. Do not return these projected facts to lock guards.
    return [batchId, lineage.map((row) => advisory ? { ...row.recordLockRemoval,
      statements: row.recordLockRemoval.statements.map(statement => ({ ...statement, fresh: true })),
    } : row.recordLockRemoval)] as const;
  })));
  const facts = [...lineageByBatch.values()].flat();
  return ids.flatMap((removalId) => {
    const group = rows.filter((row) => row.removalId === removalId && !hasFreshRemovalDeletionLease(row.metadata));
    const fact = facts.find((item) => item.id === removalId);
    if (!fact) return [];
    const eligibleBatchIds = group.map((row) => row.creditBatchId).filter((id) => {
      const shared = lineageByBatch.get(id);
      return !!shared && isRemovalCorrectionWindowOpen(fact, shared);
    });
    const correction = eligibleBatchIds.length > 0;
    // The correction window's own rule; inside an open window every statement passes it.
    const returnedStatements = correction ? fact.statements.filter(isReturnedStatement) : [];
    const statement = returnedStatements.find((item) => item.id === group[0]?.ghgStatementId) ?? returnedStatements[0];
    const returnedStatement: EntryContender["returnedStatement"] = statement
      ? { id: statement.id, status: statement.status === "DRAFT" ? "DRAFT" : "FAILED_VERIFICATION" } : undefined;
    const submitted = fact.submissions.some(isSubmittedAttempt);
    if (submitted && !correction) return [];
    const window = deriveRemovalEntryWindow(group, group.map((row) => row.applicationDate));
    return window ? [{ contenderKind: correction ? "correction" as const : "draft" as const, removalId, returnedStatement, createdAt: group[0].createdAt.toISOString(),
      creditBatchIds: [...new Set(correction ? eligibleBatchIds : group.map((row) => row.creditBatchId))], window }] : [];
  });
}

/** A retained reservation owns the entry until the attempt releases it, including ambiguous failures. */
export async function loadEmissionEntryReservations(ctx: OrgContext, submissionIds: string[], executor: Executor = db) {
  requireOrgScope(ctx);
  if (!submissionIds.length) return [];
  return executor.select({ submissionId: certificationSubmissions.id, removalId: certificationSubmissions.localEntityId,
    status: certificationSubmissions.status, lockedAt: certificationSubmissions.lockedAt, metadata: certificationSubmissions.metadata })
    .from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      inArray(certificationSubmissions.id, submissionIds), eq(certificationSubmissions.localEntityType, "removal"),
      eq(certificationSubmissions.submissionType, "removal")));
}

/** Applications still available to a current or future draft, compared as calendar dates. */
export async function listEmissionEntryAvailableApplications(ctx: OrgContext, creditBatchIds: string[], executor: Executor = db) {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return [];
  return executor.select({ creditBatchId: creditBatchApplications.creditBatchId, applicationDate: applications.applicationDate })
    .from(creditBatchApplications)
    .innerJoin(applications, and(eq(applications.id, creditBatchApplications.applicationId), eq(applications.organizationId, ctx.organizationId)))
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.creditBatchId, creditBatchIds),
      sql`not exists (select 1 from ${certificationSubmissions} where
        ${certificationSubmissions.organizationId} = ${ctx.organizationId}
        and ${certificationSubmissions.localEntityId} = ${creditBatchApplications.removalId}
        and ${certificationSubmissions.localEntityType} = 'removal'
        and ${certificationSubmissions.submissionType} = 'removal'
        and (${certificationSubmissions.submittedAt} is not null or ${certificationSubmissions.status} in ('submitted', 'accepted')))`));
}
