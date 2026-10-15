import { and, desc, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { ACTORLESS_ACTIVITY_SOURCES, activityEvents, isActivityEntityType, type ActivityEntityType } from "@/db/schema/activity";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 200;

export type ActivityEventInput = Omit<typeof activityEvents.$inferInsert, "id" | "organizationId" | "sequence">;

// Append-only by convention: no update or delete exports.
export async function recordActivity(ctx: OrgContext, tx: DbTransaction, event: ActivityEventInput): Promise<void> {
  requireOrgScope(ctx);
  if (!isActivityEntityType(event.entityType)) {
    throw new Error(`Unknown activity entity type: ${event.entityType}`);
  }
  const actorUserId = event.actorUserId === undefined ? ctx.userId : event.actorUserId;
  if (actorUserId === null && !ACTORLESS_ACTIVITY_SOURCES.some((source) => source === event.source)) {
    throw new Error(`Activity events require an actor unless the source is ${ACTORLESS_ACTIVITY_SOURCES.join(", ")}`);
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
  opts?: { limit?: number },
) {
  requireOrgScope(ctx);
  const limit = opts?.limit ?? DEFAULT_ACTIVITY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Activity limit must be a positive integer");
  }
  return db.select().from(activityEvents).where(and(
    eq(activityEvents.organizationId, ctx.organizationId),
    eq(activityEvents.entityType, entityType),
    eq(activityEvents.entityId, entityId),
  )).orderBy(desc(activityEvents.occurredAt), desc(activityEvents.sequence))
    .limit(Math.min(limit, MAX_ACTIVITY_LIMIT));
}
