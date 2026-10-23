import { and, eq, inArray, isNull, or, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbTransaction } from "@/db";
import { applications, certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatches, emissionEntries, facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { ISOMETRIC_PROVIDER, REMOVAL_ENTITY_TYPE, REMOVAL_SUBMISSION_TYPE } from "@/lib/isometric/utils/constants";
import { requireOrgScope } from "./utils";

export type CarryExecutor = typeof db | DbTransaction;
export interface CarryReadScope {
  /** Reservation revalidation must never discover unrelated entries. */
  entryIds?: string[];
  ownedBatchIds?: string[];
  ownedRemovalId?: string;
}

/** Organization-scoped ledger identity shared by sent and retained carry queries. */
function carryRemovalSubmission(ctx: OrgContext, removalId: SQLWrapper | string) {
  requireOrgScope(ctx);
  return and(eq(certificationSubmissions.organizationId, ctx.organizationId),
    eq(certificationSubmissions.provider, ISOMETRIC_PROVIDER),
    eq(certificationSubmissions.localEntityType, REMOVAL_ENTITY_TYPE),
    eq(certificationSubmissions.submissionType, REMOVAL_SUBMISSION_TYPE),
    sql`${certificationSubmissions.localEntityId} = ${removalId}`);
}

function carryRemovalWasSent(ctx: OrgContext, removalId: SQLWrapper) {
  requireOrgScope(ctx);
  return sql`exists (select 1 from ${certificationSubmissions}
    where ${carryRemovalSubmission(ctx, removalId)}
      and (${certificationSubmissions.submittedAt} is not null or ${certificationSubmissions.status} in ('submitted', 'accepted')))`;
}

/** SQL prefilter only; exact remaining mass is checked with the shared roll-up calculation. */
export async function listCarryCandidates(ctx: OrgContext, facilityId: string, executor: CarryExecutor, scope: CarryReadScope) {
  requireOrgScope(ctx);
  const original = alias(emissionEntries, "carry_original");
  return executor.select({ entry: emissionEntries, batch: creditBatches, timezone: facilities.timezone }).from(emissionEntries)
    .innerJoin(creditBatches, and(eq(creditBatches.id, emissionEntries.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)))
    .innerJoin(facilities, and(eq(facilities.id, creditBatches.facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId),
      scope.entryIds ? inArray(emissionEntries.id, scope.entryIds) : undefined,
      eq(emissionEntries.kind, "value"), eq(emissionEntries.lineRule, "additive"), isNull(emissionEntries.deletedAt),
      isNull(emissionEntries.sentByRemovalId),
      sql`jsonb_array_length(${emissionEntries.inputShape}) = 1`,
      sql`${creditBatches.endDate} < (current_timestamp at time zone ${facilities.timezone})::date`,
      sql`not exists (select 1 from ${emissionEntries} as ${sql.identifier("carry_original")} where ${original.organizationId} = ${ctx.organizationId}
        and ${original.id} = ${emissionEntries.replacesEntryId} and ${original.sentByRemovalId} is not null)`,
      sql`exists (select 1 from ${creditBatchApplications} where ${creditBatchApplications.organizationId} = ${ctx.organizationId}
        and ${creditBatchApplications.creditBatchId} = ${creditBatches.id})`,
      // A remaining future application means this batch can still take the entry itself.
      sql`not exists (select 1 from ${creditBatchApplications}
        join ${applications} on ${applications.id} = ${creditBatchApplications.applicationId}
          and ${applications.organizationId} = ${ctx.organizationId}
        where ${creditBatchApplications.organizationId} = ${ctx.organizationId}
          and ${creditBatchApplications.creditBatchId} = ${creditBatches.id}
          and ${applications.applicationDate} >= ${emissionEntries.occurredOn}
          and not ${carryRemovalWasSent(ctx, creditBatchApplications.removalId)})`,
    )).orderBy(emissionEntries.id);
}

/** Retained owners are read only for the requested batches/Removal or frozen entry IDs. */
export async function listOwnedCarryEntries(ctx: OrgContext, facilityId: string, executor: CarryExecutor, scope: CarryReadScope) {
  requireOrgScope(ctx);
  if (!scope.entryIds?.length && !scope.ownedBatchIds?.length && !scope.ownedRemovalId) return [];
  return executor.select({ entry: emissionEntries, batch: creditBatches, timezone: facilities.timezone }).from(emissionEntries)
    .innerJoin(creditBatches, and(eq(creditBatches.id, emissionEntries.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)))
    .innerJoin(facilities, and(eq(facilities.id, creditBatches.facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId), isNull(emissionEntries.deletedAt),
      or(sql`${emissionEntries.sentByRemovalId} is not null`, sql`${emissionEntries.sendReservedBySubmissionId} is not null`),
      or(scope.entryIds?.length ? inArray(emissionEntries.id, scope.entryIds) : undefined,
        scope.ownedBatchIds?.length ? inArray(emissionEntries.creditBatchId, scope.ownedBatchIds) : undefined,
        scope.ownedRemovalId ? or(eq(emissionEntries.sentByRemovalId, scope.ownedRemovalId), sql`exists (select 1 from ${certificationSubmissions}
          where ${carryRemovalSubmission(ctx, scope.ownedRemovalId)} and ${certificationSubmissions.id} = ${emissionEntries.sendReservedBySubmissionId})`) : undefined)))
    .orderBy(emissionEntries.id);
}

/** Draft receivers, or all members of origin Removals for their correction windows. No registry reads. */
export async function listCarryRemovalMembers(ctx: OrgContext, facilityId: string, executor: CarryExecutor, originBatchIds?: string[]) {
  requireOrgScope(ctx);
  return executor.select({ removal: certifierRemovals, batch: creditBatches, applicationDate: applications.applicationDate })
    .from(certifierRemovals)
    .innerJoin(creditBatchApplications, and(eq(creditBatchApplications.removalId, certifierRemovals.id), eq(creditBatchApplications.organizationId, ctx.organizationId)))
    .innerJoin(creditBatches, and(eq(creditBatches.id, creditBatchApplications.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)))
    .innerJoin(applications, and(eq(applications.id, creditBatchApplications.applicationId), eq(applications.organizationId, ctx.organizationId)))
    .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.facilityId, facilityId),
      originBatchIds ? inArray(certifierRemovals.id, executor.select({ id: creditBatchApplications.removalId }).from(creditBatchApplications).where(and(
        eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.creditBatchId, originBatchIds),
      ))) : sql`not ${carryRemovalWasSent(ctx, certifierRemovals.id)}`));
}
