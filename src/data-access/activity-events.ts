import { and, desc, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { ACTORLESS_ACTIVITY_SOURCES, DEFAULT_ACTORLESS_ACTIVITY_SOURCES, isActivityEntityType, type ACTIVITY_ACTIONS, type ActivityEntityType } from "@/db/schema/common";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgFacility, requireOrgScope } from "./utils";

const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 200;

export type ActivityEventInput = Omit<typeof activityEvents.$inferInsert, "id" | "organizationId" | "sequence">;

// Append-only by convention: no update or delete exports.
export async function recordActivity(ctx: OrgContext, tx: DbTransaction, event: ActivityEventInput): Promise<void> {
  requireOrgScope(ctx);
  if (!isActivityEntityType(event.entityType)) {
    throw new Error(`Unknown activity entity type: ${event.entityType}`);
  }
  const defaultActorUserId = DEFAULT_ACTORLESS_ACTIVITY_SOURCES.some((source) => source === event.source) ? null : ctx.userId;
  const actorUserId = event.actorUserId === undefined ? defaultActorUserId : event.actorUserId;
  if (actorUserId === null && !ACTORLESS_ACTIVITY_SOURCES.some((source) => source === event.source)) {
    throw new Error(`Activity events require an actor unless the source is ${ACTORLESS_ACTIVITY_SOURCES.join(", ")}`);
  }
  if (event.facilityId != null) {
    // This read must never lock the facility row: archive/restore lock it before children.
    await requireOrgFacility(ctx, event.facilityId, tx);
  }
  await tx.insert(activityEvents).values({
    ...event,
    organizationId: ctx.organizationId,
    actorUserId,
  });
}

export async function listEntityActivity(
  ctx: OrgContext,
  entityType: ActivityEntityType,
  entityId: string,
  opts?: {
    limit?: number;
    action?: (typeof ACTIVITY_ACTIONS)[number];
    /** Read inside the caller's transaction, e.g. to share its snapshot. */
    executor?: DbTransaction;
  },
) {
  requireOrgScope(ctx);
  const limit = opts?.limit ?? DEFAULT_ACTIVITY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Activity limit must be a positive integer");
  }
  return (opts?.executor ?? db).select().from(activityEvents).where(and(
    eq(activityEvents.organizationId, ctx.organizationId),
    eq(activityEvents.entityType, entityType),
    eq(activityEvents.entityId, entityId),
    opts?.action ? eq(activityEvents.action, opts.action) : undefined,
  )).orderBy(desc(activityEvents.occurredAt), desc(activityEvents.sequence))
    .limit(Math.min(limit, MAX_ACTIVITY_LIMIT));
}
