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
import { ensureTestOrg, TEST_ORG_ID } from "./helpers/test-org";

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
  it("rejects an overdraw without a row and accepts an exact-stock loss", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await db.transaction(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({
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
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          feedstockTypeId: feedstockType.id,
          storageLocationId: storageLocation.id,
          code: `FS-LOSS-${tag}`,
          status: "complete",
          massDryKg: AVAILABLE_STOCK_KG,
        })
        .returning({ id: feedstocks.id });

      return {
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        storageLocationId: storageLocation.id,
        feedstockId: feedstock.id,
      };
    });

    try {
      const rejected = await recordLossFn({
        storageLocationId: fixture.storageLocationId,
        lane: "feedstock",
        reason: "Overdraw regression check",
        lossMassKg: OVERDRAW_LOSS_KG,
      });

      expect(rejected).toMatchObject({
        success: false,
        field: "lossMassKg",
      });
      if (!rejected.success) {
        expect(rejected.error).toContain("400 kg available");
      }

      const rowsAfterRejection = await db
        .select()
        .from(binMovements)
        .where(eq(binMovements.storageLocationId, fixture.storageLocationId));
      expect(rowsAfterRejection).toHaveLength(0);

      const accepted = await recordLossFn({
        storageLocationId: fixture.storageLocationId,
        lane: "feedstock",
        reason: "Exact available stock",
        lossMassKg: AVAILABLE_STOCK_KG,
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
      await db.delete(feedstocks).where(eq(feedstocks.id, fixture.feedstockId));
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
