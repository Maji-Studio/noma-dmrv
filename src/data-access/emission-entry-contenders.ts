import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { certifierRemovals, certificationSubmissions } from "@/db/schema/certification";
import { creditBatchApplications, creditBatches } from "@/db/schema/credits";
import type { OrgContext } from "@/lib/auth/server";
import { deriveRemovalEntryWindow, type EntryContender } from "@/lib/certification/removal-emission-contributions";
import { requireOrgScope } from "./utils";

/** Every unsubmitted Removal is a contender, even before it acquires a ledger row. */
export async function listEmissionEntryDraftContenders(ctx: OrgContext, creditBatchIds: string[]): Promise<EntryContender[]> {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return [];
  const members = await db.select({ removalId: creditBatchApplications.removalId }).from(creditBatchApplications)
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.creditBatchId, creditBatchIds)));
  const ids = [...new Set(members.flatMap((member) => member.removalId ? [member.removalId] : []))];
  if (!ids.length) return [];
  const rows = await db.select({ removalId: certifierRemovals.id, createdAt: certifierRemovals.createdAt, metadata: certifierRemovals.metadata,
    creditBatchId: creditBatches.id, startDate: creditBatches.startDate, applicationDate: applications.applicationDate })
    .from(certifierRemovals)
    .innerJoin(creditBatchApplications, and(eq(creditBatchApplications.removalId, certifierRemovals.id), eq(creditBatchApplications.organizationId, ctx.organizationId)))
    .innerJoin(creditBatches, and(eq(creditBatches.id, creditBatchApplications.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)))
    .innerJoin(applications, and(eq(applications.id, creditBatchApplications.applicationId), eq(applications.organizationId, ctx.organizationId)))
    .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), inArray(certifierRemovals.id, ids),
      sql`not exists (select 1 from ${certificationSubmissions} where
        ${certificationSubmissions.organizationId} = ${ctx.organizationId}
        and ${certificationSubmissions.localEntityId} = ${certifierRemovals.id}
        and ${certificationSubmissions.localEntityType} = 'removal'
        and ${certificationSubmissions.submissionType} = 'removal'
        and (${certificationSubmissions.submittedAt} is not null or ${certificationSubmissions.status} in ('submitted', 'accepted')))`));
  return ids.flatMap((removalId) => {
    const group = rows.filter((row) => row.removalId === removalId && !hasFreshRemovalDeletionLease(row.metadata));
    const window = deriveRemovalEntryWindow(group, group.map((row) => row.applicationDate));
    return window ? [{ contenderKind: "draft" as const, removalId, createdAt: group[0].createdAt.toISOString(),
      creditBatchIds: [...new Set(group.map((row) => row.creditBatchId))], window }] : [];
  });
}

/** A retained reservation owns the entry until the attempt releases it, including ambiguous failures. */
export async function loadEmissionEntryReservations(ctx: OrgContext, submissionIds: string[]) {
  requireOrgScope(ctx);
  if (!submissionIds.length) return [];
  return db.select({ submissionId: certificationSubmissions.id, removalId: certificationSubmissions.localEntityId,
    status: certificationSubmissions.status, lockedAt: certificationSubmissions.lockedAt, metadata: certificationSubmissions.metadata })
    .from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      inArray(certificationSubmissions.id, submissionIds), eq(certificationSubmissions.localEntityType, "removal"),
      eq(certificationSubmissions.submissionType, "removal")));
}
