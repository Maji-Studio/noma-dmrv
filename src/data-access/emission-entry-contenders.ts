import { isRemovalCorrectionWindowOpen } from "@/lib/record-lock";
import { getCertifiedLineageForBatches } from "./certification-lineage-guards";
import { emissionCorrectionBatchIds } from "./emission-entry-corrections";
import type { StatementReads } from "./record-lock-lineage";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { certifierRemovals, certificationSubmissions } from "@/db/schema/certification";
import { creditBatchApplications, creditBatches } from "@/db/schema/credits";
import type { OrgContext } from "@/lib/auth/server";
import { deriveRemovalEntryWindow, type EntryContender } from "@/lib/certification/removal-emission-contributions";
import { requireOrgScope, type Executor } from "./utils";

/** Every unsubmitted Removal is a contender, even before it acquires a ledger row. */
export async function listEmissionEntryDraftContenders(ctx: OrgContext, creditBatchIds: string[], executor: Executor & Pick<typeof db, "selectDistinct"> = db): Promise<EntryContender[]> {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return [];
  const enabled = emissionsEntriesEnabled();
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
    .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), inArray(certifierRemovals.id, ids), enabled ? undefined : sql`not exists (
      select 1 from ${certificationSubmissions} where ${certificationSubmissions.organizationId} = ${ctx.organizationId}
      and ${certificationSubmissions.localEntityId} = ${certifierRemovals.id}
      and ${certificationSubmissions.localEntityType} = 'removal' and ${certificationSubmissions.submissionType} = 'removal'
      and (${certificationSubmissions.submittedAt} is not null or ${certificationSubmissions.status} in ('submitted', 'accepted')))`));
  if (!enabled) return ids.flatMap((removalId) => {
    const group = rows.filter((row) => row.removalId === removalId && !hasFreshRemovalDeletionLease(row.metadata));
    const window = deriveRemovalEntryWindow(group, group.map((row) => row.applicationDate));
    return window ? [{ contenderKind: "draft" as const, removalId, createdAt: group[0].createdAt.toISOString(),
      creditBatchIds: [...new Set(group.map((row) => row.creditBatchId))], window }] : [];
  });
  const statementReads: StatementReads = new Map();
  const lineageReads = new Map<string, ReturnType<typeof getCertifiedLineageForBatches>>();
  const lineageByBatch = new Map(await Promise.all([...new Set(rows.map((row) => row.creditBatchId))].map(async (batchId) => {
    const union = await emissionCorrectionBatchIds(ctx, executor, batchId);
    const key = JSON.stringify([...union].sort());
    if (!lineageReads.has(key)) lineageReads.set(key, getCertifiedLineageForBatches(ctx, executor, union, statementReads));
    const lineage = await lineageReads.get(key)!;
    return [batchId, lineage.map((row) => row.recordLockRemoval)] as const;
  })));
  const facts = [...lineageByBatch.values()].flat();
  return ids.flatMap((removalId) => {
    const group = rows.filter((row) => row.removalId === removalId && !hasFreshRemovalDeletionLease(row.metadata));
    const fact = facts.find((item) => item.id === removalId);
    if (!fact) return [];
    const eligibleBatchIds = group.map((row) => row.creditBatchId).filter((id) => {
      const shared = lineageByBatch.get(id);
      return !!fact && !!shared && isRemovalCorrectionWindowOpen(fact, shared);
    });
    const correction = eligibleBatchIds.length > 0;
    const submitted = fact?.submissions.some((submission) => submission.submittedAt || ["submitted", "accepted"].includes(submission.status));
    if (submitted && !correction) return [];
    const window = deriveRemovalEntryWindow(group, group.map((row) => row.applicationDate));
    return window ? [{ contenderKind: correction ? "correction" as const : "draft" as const, removalId, createdAt: group[0].createdAt.toISOString(),
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
