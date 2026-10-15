import { feedstockFixtureValues, cleanupFeedstockFixtureParents } from "./helpers/feedstock-fixture";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
  it.each([
    "current stock",
    "before intake",
    "future time",
    "valid earlier loss",
    "later negative balance",
  ])("guards %s", async (scenario) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await db.transaction(async (tx) => {
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

    try {
      const loss = (occurredAt: string, lossMassKg: number) => recordLossFn({
        storageLocationId: fixture.storageLocationId, lane: "feedstock",
        idempotencyKey: crypto.randomUUID(), reason: "Event-time stock regression",
        occurredAt, lossMassKg,
      });
      if (scenario === "before intake" || scenario === "future time") {
        const time = scenario === "before intake" ? "2025-01-01T00:00:00.000Z" : "2999-01-01T00:00:00.000Z";
        expect(await loss(time, AVAILABLE_STOCK_KG)).toMatchObject({
          success: false, issues: [{ path: ["occurredAt"] }],
        });
      } else if (scenario === "valid earlier loss") {
        const halfStock = AVAILABLE_STOCK_KG / 2;
        expect(await loss("2025-01-04T00:00:00.000Z", halfStock)).toMatchObject({ success: true });
        expect(await loss("2025-01-03T00:00:00.000Z", halfStock)).toMatchObject({ success: true });
        const stock = await getFeedstockBinStock(makeTestOrgContext(TEST_USER_ID), fixture.storageLocationId);
        expect(stock.entries.map(entry => entry.afterWetKg)).toEqual([AVAILABLE_STOCK_KG, halfStock, 0]);
        return;
      } else if (scenario === "later negative balance") {
        // A later refill restores current stock but cannot fund the earlier loss.
        expect(await loss("2025-01-04T00:00:00.000Z", AVAILABLE_STOCK_KG)).toMatchObject({ success: true });
        await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
          organizationId: TEST_ORG_ID, facilityId: fixture.facilityId,
          feedstockTypeId: fixture.feedstockTypeId, storageLocationId: fixture.storageLocationId,
          code: `E2E-REFILL-${tag}`, status: "complete",
          deliveryDate: new Date("2025-01-05T00:00:00.000Z"),
          massDryKg: AVAILABLE_STOCK_KG, massWetKg: AVAILABLE_STOCK_KG,
        }));
        expect(await loss("2025-01-03T00:00:00.000Z", AVAILABLE_STOCK_KG)).toMatchObject({
          success: false, issues: [{ path: ["occurredAt"] }],
        });
        const movements = await db.select().from(binMovements)
          .where(eq(binMovements.storageLocationId, fixture.storageLocationId));
        expect(movements).toHaveLength(1);
        return;
      }
      if (scenario === "before intake" || scenario === "future time") {
        const movements = await db.select().from(binMovements)
          .where(eq(binMovements.storageLocationId, fixture.storageLocationId));
        expect(movements).toHaveLength(0);
        return;
      }
      const rejected = await recordLossFn({
        storageLocationId: fixture.storageLocationId,
        lane: "feedstock",
        idempotencyKey: crypto.randomUUID(),
        reason: "Overdraw regression check",
        occurredAt: "2026-10-15T10:00:00.000Z", lossMassKg: OVERDRAW_LOSS_KG,
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
        occurredAt: "2026-10-15T10:00:00.000Z", lossMassKg: AVAILABLE_STOCK_KG,
      });

      expect(accepted.success).toBe(true);
      const rowsAfterAcceptance = await db
        .select()
        .from(binMovements)
        .where(eq(binMovements.storageLocationId, fixture.storageLocationId));
      expect(rowsAfterAcceptance).toHaveLength(1);
      expect(rowsAfterAcceptance[0].massDeltaKg).toBe(-AVAILABLE_STOCK_KG);
    } finally {
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
    }
  });
});
