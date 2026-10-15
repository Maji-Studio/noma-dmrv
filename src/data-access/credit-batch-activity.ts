import { and, desc, eq, or, lt, isNull, count, sql } from "drizzle-orm";
import { activityPageOptionsSchema, decodeActivityCursor, encodeActivityCursor, type ActivityPageOptions } from "@/lib/activity-pagination";
import { db } from "@/db";
import { activityEvents, users } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { activityIds, loadActivityMembers } from "./credit-batch-activity-members";
import { resolveActivityRecords } from "./activity-record-labels";
import { requireOrgScope } from "./utils";

/** Explicit batch links take precedence over current membership fallbacks. */
function batchActivityPredicate(creditBatchId: string, members: NonNullable<Awaited<ReturnType<typeof loadActivityMembers>>>) {
  return or(
    eq(activityEvents.creditBatchId, creditBatchId),
    and(isNull(activityEvents.creditBatchId), or(
      activityIds(activityEvents.productionRunId, members.ids.production_run),
      and(
        eq(activityEvents.entityType, "document"),
        // Document types may contain colons. Only the final owner type/UUID
        // identify membership; compare as text so malformed reasons cannot throw.
        sql`${activityEvents.reasonCode} like 'document:%'`,
        or(...Object.entries(members.documentOwners).map(([type, ids]) => and(
          sql`split_part(${activityEvents.reasonCode}, ':', -2) = ${type}`,
          sql`split_part(${activityEvents.reasonCode}, ':', -1) = any(${sql.param(ids)}::text[])`,
        ))),
      ),
      ...Object.entries(members.ids).map(([type, ids]) => and(
        eq(activityEvents.entityType, type as typeof activityEvents.$inferSelect.entityType), activityIds(activityEvents.entityId, ids),
      )),
    )),
  );
}

export async function listCreditBatchActivity(ctx: OrgContext, creditBatchId: string, options: ActivityPageOptions = {}) {
  requireOrgScope(ctx);
  const { cursor, limit } = activityPageOptionsSchema.parse(options);
  const after = cursor === undefined ? undefined : decodeActivityCursor(cursor);
  const members = await loadActivityMembers(ctx, creditBatchId);
  if (!members) return { items: [], nextCursor: null };
  const rows = await db.select().from(activityEvents).where(and(
    eq(activityEvents.organizationId, ctx.organizationId),
    after ? or(lt(activityEvents.occurredAt, after.occurredAt), and(eq(activityEvents.occurredAt, after.occurredAt), lt(activityEvents.sequence, after.sequence))) : undefined,
    batchActivityPredicate(creditBatchId, members),
  )).orderBy(desc(activityEvents.occurredAt), desc(activityEvents.sequence)).limit(limit + 1);
  const items = rows.slice(0, limit);
  return { items: await resolveItems(ctx, items), nextCursor: rows.length > limit ? encodeActivityCursor(items[items.length - 1]) : null };
}

async function resolveItems(ctx: OrgContext, items: typeof activityEvents.$inferSelect[]) {
  requireOrgScope(ctx);
  const [records, actors] = await Promise.all([
    resolveActivityRecords(ctx, items),
    db.selectDistinct({ id: users.id, name: users.name }).from(users)
      .innerJoin(activityEvents, eq(activityEvents.actorUserId, users.id))
      .where(and(eq(activityEvents.organizationId, ctx.organizationId), activityIds(activityEvents.id, items.map(row => row.id)))),
  ]);
  const actorsById = new Map(actors.map(actor => [actor.id, actor]));
  return items.map(row => ({
    id: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId,
    changedFields: row.changedFields, fromStatus: row.fromStatus, toStatus: row.toStatus,
    fromRemote: row.fromRemote, toRemote: row.toRemote, source: row.source,
    occurredAt: row.occurredAt, registryAt: row.registryAt, reasonCode: row.reasonCode,
    actor: row.actorUserId ? actorsById.get(row.actorUserId) ?? { id: row.actorUserId, name: null } : null,
    record: records.get(`${row.entityType}:${row.entityId}`)!,
  }));
}

export type CreditBatchActivityPage = Awaited<ReturnType<typeof listCreditBatchActivity>>;

/** Counts cover the entire history, independent of the list cursor or page size. */
export async function getCreditBatchActivitySummary(ctx: OrgContext, creditBatchId: string): Promise<CreditBatchActivitySummary> {
  requireOrgScope(ctx);
  const members = await loadActivityMembers(ctx, creditBatchId);
  if (!members) return { total: 0, counts: [], latest: null };
  const predicate = batchActivityPredicate(creditBatchId, members);
  const [counts, latestRows] = await Promise.all([
    db.select({ entityType: activityEvents.entityType, action: activityEvents.action, count: count() })
      .from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), predicate)).groupBy(activityEvents.entityType, activityEvents.action)
      .orderBy(activityEvents.entityType, activityEvents.action),
    db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), predicate))
      .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.sequence)).limit(1),
  ]);
  return { total: counts.reduce((total, group) => total + group.count, 0), counts,
    latest: (await resolveItems(ctx, latestRows))[0] ?? null };
}

export type CreditBatchActivitySummary = {
  total: number;
  counts: (Pick<typeof activityEvents.$inferSelect, "entityType" | "action"> & { count: number })[];
  latest: CreditBatchActivityPage["items"][number] | null;
};
