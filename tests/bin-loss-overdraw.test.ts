import { feedstockFixtureValues, cleanupFeedstockFixtureParents } from "./helpers/feedstock-fixture";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements,
  facilities,
  feedstocks,
  feedstockTypes,
  storageLocations,
  users,
} from "@/db/schema";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

const TEST_USER_ID = "test-user-bin-loss-overdraw";
const AVAILABLE_STOCK_KG = 400;
const OVERDRAW_LOSS_KG = 401;

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return {
    ...actual,
    requireOrgContext: vi.fn().mockResolvedValue({
      userId: "test-user-bin-loss-overdraw",
      organizationId: "org_test_fixtures",
      orgRole: "owner",
      isPlatformAdmin: false,
    }),
  };
});

import { getFeedstockBinStock } from "@/data-access/feedstock-bin-ledger";
import { recordLossFn } from "@/fn/bin-movements";

beforeAll(async () => {
  await ensureTestOrg();
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      email: "bin-loss-overdraw-test@example.com",
      name: "Bin Loss Overdraw Test",
      emailVerified: true,
    })
    .onConflictDoNothing({ target: users.id });
});

describe("bin loss stock guard", () => {
  let fixture: { facilityId: string; feedstockTypeId: string; storageLocationId: string; feedstockId: string };
  const loss = (occurredAt: string, lossMassKg: number) => recordLossFn({
    storageLocationId: fixture.storageLocationId, lane: "feedstock",
    idempotencyKey: crypto.randomUUID(), reason: "Event-time stock regression",
    occurredAt, lossMassKg,
  });
  const movements = () => db.select().from(binMovements)
    .where(eq(binMovements.storageLocationId, fixture.storageLocationId));

  beforeEach(async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    fixture = await db.transaction(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({ ...TEST_SITE_POSITION, timezone: "UTC",
          organizationId: TEST_ORG_ID,
          code: `FAC-LOSS-${tag}`,
          name: `Loss Guard Facility ${tag}`,
        })
        .returning({ id: facilities.id });
      const [feedstockType] = await tx
        .insert(feedstockTypes)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FT-LOSS-${tag}`,
          name: `Loss Guard Feedstock ${tag}`,
          category: "forestry",
        })
        .returning({ id: feedstockTypes.id });
      const [storageLocation] = await tx
        .insert(storageLocations)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          feedstockTypeId: feedstockType.id,
          code: `BIN-LOSS-${tag}`,
          name: `Loss Guard Bin ${tag}`,
          type: "feedstock_bin",
        })
        .returning({ id: storageLocations.id });
      const [feedstock] = await tx
        .insert(feedstocks)
        .values(await feedstockFixtureValues(tx, {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          feedstockTypeId: feedstockType.id,
          storageLocationId: storageLocation.id,
          code: `FS-LOSS-${tag}`,
          status: "complete",
          deliveryDate: new Date("2025-01-02T00:00:00.000Z"),
          massDryKg: AVAILABLE_STOCK_KG,
          massWetKg: AVAILABLE_STOCK_KG,
        }))
        .returning({ id: feedstocks.id });

      return {
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        storageLocationId: storageLocation.id,
        feedstockId: feedstock.id,
      };
    });
  });

  it.each([
    { scenario: "before intake", time: "2025-01-01T00:00:00.000Z" },
    { scenario: "future time", time: "2999-01-01T00:00:00.000Z" },
  ])("rejects $scenario", async ({ time }) => {
    expect(await loss(time, AVAILABLE_STOCK_KG)).toMatchObject({
      success: false, issues: [{ path: ["occurredAt"] }],
    });
    expect(await movements()).toHaveLength(0);
  });

  it("accepts a valid earlier loss", async () => {
    const halfStock = AVAILABLE_STOCK_KG / 2;
    expect(await loss("2025-01-04T00:00:00.000Z", halfStock)).toMatchObject({ success: true });
    expect(await loss("2025-01-03T00:00:00.000Z", halfStock)).toMatchObject({ success: true });
    const stock = await getFeedstockBinStock(makeTestOrgContext(TEST_USER_ID), fixture.storageLocationId);
    expect(stock.entries.map(entry => entry.afterWetKg)).toEqual([AVAILABLE_STOCK_KG, halfStock, 0]);
  });

  it("rejects a loss that would make a later balance negative despite a refill", async () => {
    expect(await loss("2025-01-04T00:00:00.000Z", AVAILABLE_STOCK_KG)).toMatchObject({ success: true });
    await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      organizationId: TEST_ORG_ID, facilityId: fixture.facilityId,
      feedstockTypeId: fixture.feedstockTypeId, storageLocationId: fixture.storageLocationId,
      code: `E2E-REFILL-${crypto.randomUUID()}`, status: "complete",
      deliveryDate: new Date("2025-01-05T00:00:00.000Z"),
      massDryKg: AVAILABLE_STOCK_KG, massWetKg: AVAILABLE_STOCK_KG,
    }));
    expect(await loss("2025-01-03T00:00:00.000Z", AVAILABLE_STOCK_KG)).toMatchObject({
      success: false, issues: [{ path: ["occurredAt"] }],
    });
    expect(await movements()).toHaveLength(1);
  });

  it.each([
    { timezone: "Africa/Dar_es_Salaam", before: "2025-01-01T20:59:59.000Z", midnight: "2025-01-01T21:00:00.000Z", early: "2025-01-01T22:00:00.000Z", later: "2025-01-01T23:00:00.000Z" },
    { timezone: "America/New_York", before: "2025-01-02T04:59:59.000Z", midnight: "2025-01-02T05:00:00.000Z", early: "2025-01-02T06:00:00.000Z", later: "2025-01-02T07:00:00.000Z" },
  ])("uses the delivery day in $timezone", async ({ timezone, before, midnight, early, later }) => {
    await db.update(facilities).set({ timezone }).where(eq(facilities.id, fixture.facilityId));
    expect(await loss(before, AVAILABLE_STOCK_KG)).toMatchObject({ success: false, issues: [{ path: ["occurredAt"] }] });
    expect(await movements()).toHaveLength(0);
    const halfStock = AVAILABLE_STOCK_KG / 2;
    expect(await loss(later, halfStock)).toMatchObject({ success: true });
    expect(await loss(early, halfStock)).toMatchObject({ success: true });
    const stock = await getFeedstockBinStock(makeTestOrgContext(TEST_USER_ID), fixture.storageLocationId);
    expect(stock.entries.map(entry => entry.occurredAt)).toEqual([midnight, early, later]);
    expect(stock.entries.map(entry => entry.afterWetKg)).toEqual([AVAILABLE_STOCK_KG, halfStock, 0]);
  });

  it.each([
    { timezone: "America/Santiago", day: "2026-09-06", before: "2026-09-06T03:59:59.999Z", start: "2026-09-06T04:00:00.000Z", early: "2026-09-06T04:30:00.000Z" },
    { timezone: "America/Havana", day: "2026-11-01", before: "2026-11-01T03:59:59.999Z", start: "2026-11-01T04:00:00.000Z", early: "2026-11-01T04:30:00.000Z" },
  ])("starts intake at the first valid instant of $day in $timezone", async ({ timezone, day, before, start, early }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T12:00:00.000Z"));
    try {
      await db.update(facilities).set({ timezone }).where(eq(facilities.id, fixture.facilityId));
      await db.update(feedstocks).set({ deliveryDate: new Date(`${day}T00:00:00.000Z`) }).where(eq(feedstocks.id, fixture.feedstockId));
      const ctx = makeTestOrgContext(TEST_USER_ID);
      const stock = await getFeedstockBinStock(ctx, fixture.storageLocationId);
      expect(stock.entries).toMatchObject([{ kind: "intake", occurredAt: start, afterWetKg: AVAILABLE_STOCK_KG }]);
      expect(await loss(before, AVAILABLE_STOCK_KG)).toMatchObject({ success: false, issues: [{ path: ["occurredAt"] }] });
      expect(await movements()).toHaveLength(0);
      expect(await loss(early, AVAILABLE_STOCK_KG)).toMatchObject({ success: true });
      const afterLoss = await getFeedstockBinStock(ctx, fixture.storageLocationId);
      expect(afterLoss.entries.map(entry => entry.occurredAt)).toEqual([start, early]);
      expect(afterLoss.currentWetKg).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("guards current stock", async () => {
    const rejected = await recordLossFn({
      storageLocationId: fixture.storageLocationId,
      lane: "feedstock",
      idempotencyKey: crypto.randomUUID(),
      reason: "Overdraw regression check",
      occurredAt: "2025-01-03T10:00:00.000Z", lossMassKg: OVERDRAW_LOSS_KG,
    });

    expect(rejected).toMatchObject({
      success: false,
      field: "lossMassKg",
    });
    if (!rejected.success) {
      expect(rejected.error).toBe("Not enough wet feedstock in this bin");
    }

    const rowsAfterRejection = await db
      .select()
      .from(binMovements)
      .where(eq(binMovements.storageLocationId, fixture.storageLocationId));
    expect(rowsAfterRejection).toHaveLength(0);

    const accepted = await recordLossFn({
      storageLocationId: fixture.storageLocationId,
      lane: "feedstock",
      idempotencyKey: crypto.randomUUID(),
      reason: "Exact available stock",
      occurredAt: "2025-01-03T10:00:00.000Z", lossMassKg: AVAILABLE_STOCK_KG,
    });

    expect(accepted.success).toBe(true);
    const rowsAfterAcceptance = await db
      .select()
      .from(binMovements)
      .where(eq(binMovements.storageLocationId, fixture.storageLocationId));
    expect(rowsAfterAcceptance).toHaveLength(1);
    expect(rowsAfterAcceptance[0].massDeltaKg).toBe(-AVAILABLE_STOCK_KG);
  });

  afterEach(async () => {
    await db.delete(binMovements).where(
      eq(binMovements.storageLocationId, fixture.storageLocationId),
    );
    await db.delete(feedstocks).where(eq(feedstocks.storageLocationId, fixture.storageLocationId));
    await cleanupFeedstockFixtureParents(db);
    await db
      .delete(storageLocations)
      .where(eq(storageLocations.id, fixture.storageLocationId));
    await db
      .delete(feedstockTypes)
      .where(eq(feedstockTypes.id, fixture.feedstockTypeId));
    await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
  });
});
