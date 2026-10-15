/** Database contracts for transaction-owned, organization-scoped activity history. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000";
});
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { ACTORLESS_ACTIVITY_SOURCES, activityEvents, creditBatches, facilities, feedstockTypes, organizations, productionProcesses } from "@/db/schema";
import { listEntityActivity, recordActivity, type ActivityEventInput } from "@/data-access/activity-events";
import { archiveFacility } from "@/data-access/facilities";
import type { OrgContext } from "@/lib/auth/server";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";
import { TEST_SITE_POSITION } from "./helpers/test-org";

const EVENT_TIME = new Date("2026-10-15T10:00:00Z");
const NEWER_EVENT_TIME = new Date("2026-10-15T11:00:00Z");
const TRANSACTION_START_GAP_MS = 10;
const BARRIER_POOL_SIZE = 2;
const CONCURRENCY_TEST_TIMEOUT_MS = 15_000;
const BATCH_START_DATE = "2026-10-01";
const BATCH_END_DATE = "2026-10-31";
const organizationIds: string[] = [];
let ctx: OrgContext;
let otherCtx: OrgContext;
let entityId: string;

async function createContext(): Promise<OrgContext> {
  const organizationId = `org_activity_${crypto.randomUUID()}`;
  await db.insert(organizations).values({ id: organizationId, name: "Activity fixture", slug: organizationId });
  organizationIds.push(organizationId);
  return { organizationId, userId: `activity_user_${crypto.randomUUID()}`, orgRole: "owner", isPlatformAdmin: false };
}

async function createFacility(context: OrgContext, archivedAt?: Date): Promise<string> {
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION,
    organizationId: context.organizationId,
    code: `activity_${crypto.randomUUID()}`,
    name: "Activity fixture",
    timezone: "UTC",
    archivedAt,
  }).returning({ id: facilities.id });
  return facility.id;
}

async function createCreditBatch(facilityId: string): Promise<string> {
  const organizationId = ctx.organizationId;
  const [feedstockType] = await db.insert(feedstockTypes).values({
    organizationId, code: `activity_${crypto.randomUUID()}`, name: "Activity fixture", category: "forestry",
  }).returning({ id: feedstockTypes.id });
  const [process] = await db.insert(productionProcesses).values({
    organizationId, facilityId, feedstockTypeId: feedstockType.id,
  }).returning({ id: productionProcesses.id });
  const [batch] = await db.insert(creditBatches).values({
    organizationId, facilityId, feedstockTypeId: feedstockType.id, productionProcessId: process.id,
    code: `activity_${crypto.randomUUID()}`, startDate: BATCH_START_DATE, endDate: BATCH_END_DATE,
  }).returning({ id: creditBatches.id });
  return batch.id;
}

beforeEach(async () => {
  entityId = crypto.randomUUID();
  ctx = await createContext();
  otherCtx = await createContext();
});

afterEach(async () => {
  if (organizationIds.length) {
    await db.delete(activityEvents).where(inArray(activityEvents.organizationId, organizationIds));
    await db.delete(creditBatches).where(inArray(creditBatches.organizationId, organizationIds));
    await db.delete(productionProcesses).where(inArray(productionProcesses.organizationId, organizationIds));
    await db.delete(feedstockTypes).where(inArray(feedstockTypes.organizationId, organizationIds));
    await db.delete(facilities).where(inArray(facilities.organizationId, organizationIds));
    await db.delete(organizations).where(inArray(organizations.id, organizationIds));
    organizationIds.length = 0;
  }
});

function event(overrides: Partial<ActivityEventInput> = {}): ActivityEventInput {
  return { entityType: "delivery", entityId, action: "created", source: "form", ...overrides };
}

it.each(["form", "rest", "mcp", "registry"] as const)("stamps the context organization and default actor for %s, with value-free defaults", async (source) => {
  await db.transaction((tx) => recordActivity(ctx, tx, event({ source })));
  const rows = await listEntityActivity(ctx, "delivery", entityId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ organizationId: ctx.organizationId, facilityId: null, actorUserId: ctx.userId, changedFields: [] });
  expect(rows[0].occurredAt).toBeInstanceOf(Date);
  expect(typeof rows[0].sequence).toBe("bigint");
});

it("isolates organizations even for the same entity type and id", async () => {
  await db.transaction((tx) => recordActivity(ctx, tx, event()));
  expect(await listEntityActivity(otherCtx, "delivery", entityId)).toEqual([]);
  await db.transaction((tx) => recordActivity(otherCtx, tx, event({ action: "updated" })));
  const rows = await listEntityActivity(otherCtx, "delivery", entityId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ organizationId: otherCtx.organizationId, action: "updated" });
});

it("rolls back activity when the caller's transaction fails", async () => {
  const failure = new Error("Injected failure after activity insert");
  await expect(db.transaction(async (tx) => {
    await recordActivity(ctx, tx, event());
    const inside = await tx.select().from(activityEvents).where(eq(activityEvents.organizationId, ctx.organizationId));
    expect(inside).toHaveLength(1);
    throw failure;
  })).rejects.toBe(failure);
  expect(await listEntityActivity(ctx, "delivery", entityId)).toEqual([]);
});

it("refuses an unknown entity type before writing", async () => {
  await db.transaction(async (tx) => {
    // @ts-expect-error Exercise input arriving without TypeScript validation.
    await expect(recordActivity(ctx, tx, event({ entityType: "unknown_entity" })))
      .rejects.toThrow("Unknown activity entity type: unknown_entity");
    const rows = await tx.select().from(activityEvents).where(eq(activityEvents.organizationId, ctx.organizationId));
    expect(rows).toEqual([]);
  });
});

it("enforces the actor constraint on direct form inserts", async () => {
  await expect(db.insert(activityEvents).values({ ...event(), organizationId: ctx.organizationId, actorUserId: null }))
    .rejects.toMatchObject({ cause: { code: "23514", constraint: "activity_events_actor" } });
  expect(await listEntityActivity(ctx, "delivery", entityId)).toEqual([]);
});

it("orders newest first, breaking equal timestamps by descending sequence", async () => {
  await db.transaction(async (tx) => {
    await recordActivity(ctx, tx, event({ occurredAt: NEWER_EVENT_TIME, action: "deleted" }));
    await recordActivity(ctx, tx, event({ occurredAt: EVENT_TIME, action: "created" }));
    await recordActivity(ctx, tx, event({ occurredAt: EVENT_TIME, action: "updated", changedFields: ["notes"] }));
  });
  const rows = await listEntityActivity(ctx, "delivery", entityId);
  expect(rows.map((row) => row.action)).toEqual(["deleted", "updated", "created"]);
  expect(rows[0].occurredAt).toEqual(NEWER_EVENT_TIME);
  expect(rows[1].occurredAt).toEqual(EVENT_TIME);
  expect(rows[1].occurredAt).toEqual(rows[2].occurredAt);
  expect(rows[1].sequence).toBeGreaterThan(rows[2].sequence);
  expect(await listEntityActivity(ctx, "delivery", entityId, { limit: 1 })).toEqual([rows[0]]);
});

it("orders overlapping transactions by event insert time rather than transaction start", async () => {
  await db.transaction(async (t1) => {
    await t1.execute(sql`select 1`);
    // Keep transaction start times distinct at the column's millisecond precision.
    await delay(TRANSACTION_START_GAP_MS);
    // T1 stays open while T2 records its event and commits on another connection.
    await db.transaction((t2) => recordActivity(ctx, t2, event({ action: "created" })));
    await recordActivity(ctx, t1, event({ action: "updated" }));
  });

  const rows = await listEntityActivity(ctx, "delivery", entityId);
  expect(rows.map((row) => row.action)).toEqual(["updated", "created"]);
  expect(rows[0].sequence).toBeGreaterThan(rows[1].sequence);
});

it.each(ACTORLESS_ACTIVITY_SOURCES)("allows an explicit null actor for %s", async (source) => {
  await db.transaction((tx) => recordActivity(ctx, tx, event({ source, actorUserId: null })));
  expect((await listEntityActivity(ctx, "delivery", entityId))[0].actorUserId).toBeNull();
});

it.each(["system", "script"] as const)("defaults the actor to null for %s", async (source) => {
  await db.transaction((tx) => recordActivity(ctx, tx, event({ source })));
  expect((await listEntityActivity(ctx, "delivery", entityId))[0].actorUserId).toBeNull();
});

it("preserves an explicit actor and unlinked entity references", async () => {
  const input = event({ actorUserId: "activity_other_user", facilityId: await createFacility(ctx),
    creditBatchId: crypto.randomUUID(), productionRunId: crypto.randomUUID() });
  await db.transaction((tx) => recordActivity(ctx, tx, input));
  expect((await listEntityActivity(ctx, "delivery", entityId))[0]).toMatchObject(input);
});

it("rejects a facility from another organization in recordActivity", async () => {
  const facilityId = await createFacility(otherCtx);
  await db.transaction(async (tx) => {
    await expect(recordActivity(ctx, tx, event({ facilityId })))
      .rejects.toThrow("Activity facility not found in the current organization");
    const rows = await tx.select().from(activityEvents).where(eq(activityEvents.organizationId, ctx.organizationId));
    expect(rows).toEqual([]);
  });
  expect(await listEntityActivity(ctx, "delivery", entityId)).toEqual([]);
});

it("accepts an archived facility from the same organization", async () => {
  const facilityId = await createFacility(ctx, EVENT_TIME);
  await db.transaction((tx) => recordActivity(ctx, tx, event({ facilityId })));
  expect(await listEntityActivity(ctx, "delivery", entityId)).toMatchObject([{ facilityId }]);
});

it("records activity while a facility archive waits on the writer's credit batch lock", { timeout: CONCURRENCY_TEST_TIMEOUT_MS }, async () => {
  const facilityId = await createFacility(ctx);
  const creditBatchId = await createCreditBatch(facilityId);
  const pool = createTestPool(BARRIER_POOL_SIZE);
  try {
    const writer = await openOperationBarrier(pool);
    let archive: ReturnType<typeof archiveFacility> | undefined;
    try {
      await writer.tx.select({ id: creditBatches.id }).from(creditBatches).where(and(
        eq(creditBatches.id, creditBatchId), eq(creditBatches.organizationId, ctx.organizationId),
      )).for("update");
      archive = archiveFacility(ctx, facilityId, 1);
      // Observe rejection immediately, but assert the original promise below.
      void archive.catch(() => undefined);
      // Archive owns the facility FOR UPDATE before queuing on our batch row.
      await waitForBlockedOperations(pool, writer.pid, 1);
      // A facility FK or a locking ownership read would complete the lock cycle.
      await recordActivity(ctx, writer.tx, event({ facilityId, creditBatchId }));
      await writer.commit();
      expect((await archive).archivedAt).toBeInstanceOf(Date);
      expect(await listEntityActivity(ctx, "delivery", entityId)).toMatchObject([{ facilityId, creditBatchId }]);
    } finally {
      await writer.rollback();
      if (archive) await Promise.allSettled([archive]);
    }
  } finally {
    await pool.end();
  }
});

it("rejects status changes without a local or remote target at the database boundary", async () => {
  await expect(db.insert(activityEvents).values({ ...event({ action: "status_changed" }),
    organizationId: ctx.organizationId, actorUserId: ctx.userId }))
    .rejects.toMatchObject({ cause: { code: "23514", constraint: "activity_events_status_target" } });
  await db.transaction((tx) => recordActivity(ctx, tx, event({ action: "status_changed", toRemote: "verified" })));
  expect((await listEntityActivity(ctx, "delivery", entityId))[0].toRemote).toBe("verified");
});
