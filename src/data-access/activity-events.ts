import { and, desc, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { ACTORLESS_ACTIVITY_SOURCES, DEFAULT_ACTORLESS_ACTIVITY_SOURCES, isActivityEntityType, type ActivityEntityType } from "@/db/schema/common";
import { facilities } from "@/db/schema/facilities";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 200;

export type ActivityEventInput = Omit<typeof activityEvents.$inferInsert, "id" | "organizationId" | "sequence">;

async function assertActivityFacilityOwnership(ctx: OrgContext, tx: DbTransaction, facilityId: string): Promise<void> {
  // Never lock this row: save writers can already hold children that facility
  // archive/restore locks after the facility. Archived facilities remain valid.
  const [facility] = await tx.select({ id: facilities.id }).from(facilities).where(and(
    eq(facilities.id, facilityId),
    eq(facilities.organizationId, ctx.organizationId),
  ));
  if (!facility) {
    throw new Error("Activity facility not found in the current organization");
  }
}

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
    await assertActivityFacilityOwnership(ctx, tx, event.facilityId);
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
