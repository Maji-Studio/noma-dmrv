import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  archiveStorageLocation,
  deleteStorageLocation,
  getStorageLocations,
  restoreStorageLocation,
} from "@/data-access/storage-locations";
import { recordStockTakeMovement } from "@/data-access/bin-movements";
import {
  archiveFacility,
  restoreFacility,
} from "@/data-access/facilities";
import { db } from "@/db";
import { binMovements } from "@/db/schema/bin-movements";
import { feedstockTypes } from "@/db/schema/feedstock";
import {
  facilities,
  storageLocations,
} from "@/db/schema/facilities";
import { SafeError } from "@/lib/errors";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

beforeAll(() => ensureTestOrg());

async function createStorageArchiveFixture({
  type = "feedstock_bin",
  lane = "feedstock",
  endingBalanceKg = 0,
}: {
  type?: "feedstock_bin" | "biochar_bin" | "product_bin";
  lane?: "feedstock" | "biochar" | "product";
  endingBalanceKg?: number;
} = {}) {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-SLA-${tag}`,
        name: `Storage Archive Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-SLA-${tag}`,
        name: `Storage Archive Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    const [storageLocation] = await tx
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BIN-SLA-${tag}`,
        name: `Storage Archive Bin ${tag}`,
        type,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
      })
      .returning({ id: storageLocations.id });
    const movements = await tx
      .insert(binMovements)
      .values([
        {
          organizationId: TEST_ORG_ID,
          storageLocationId: storageLocation.id,
          lane,
          movementType: "adjustment" as const,
          massDeltaKg: 25,
          reason: "Regression fixture intake",
        },
        {
          organizationId: TEST_ORG_ID,
          storageLocationId: storageLocation.id,
          lane,
          movementType: "adjustment" as const,
          massDeltaKg: endingBalanceKg - 25,
          reason: "Regression fixture drawdown",
        },
      ])
      .returning({ id: binMovements.id });

    return {
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      movementIds: movements.map((movement) => movement.id),
      storageLocationId: storageLocation.id,
    };
  });
}

async function cleanupStorageArchiveFixture(
  fixture: Awaited<ReturnType<typeof createStorageArchiveFixture>>,
) {
  await db.transaction(async (tx) => {
    await tx
      .delete(binMovements)
      .where(
        and(
          eq(binMovements.storageLocationId, fixture.storageLocationId),
          eq(binMovements.organizationId, TEST_ORG_ID),
        ),
      );
    await tx
      .delete(storageLocations)
      .where(
        and(
          eq(storageLocations.id, fixture.storageLocationId),
          eq(storageLocations.organizationId, TEST_ORG_ID),
        ),
      );
    await tx
      .delete(feedstockTypes)
      .where(
        and(
          eq(feedstockTypes.id, fixture.feedstockTypeId),
          eq(feedstockTypes.organizationId, TEST_ORG_ID),
        ),
      );
    await tx
      .delete(facilities)
      .where(
        and(
          eq(facilities.id, fixture.facilityId),
          eq(facilities.organizationId, TEST_ORG_ID),
        ),
      );
  });
}

describe("storage location archive", () => {
  it("archives an in-use bin, exposes it in the archived view, and restores it", async () => {
    const fixture = await createStorageArchiveFixture();
    const ctx = makeTestOrgContext(TEST_USER_ID);

    try {
      await expect(
        deleteStorageLocation(ctx, fixture.storageLocationId),
      ).rejects.toThrowError(SafeError);
      await expect(
        deleteStorageLocation(ctx, fixture.storageLocationId),
      ).rejects.toThrow(/movement history/);

      const archived = await archiveStorageLocation(
        ctx,
        fixture.storageLocationId,
      );
      expect(archived.archivedAt).toBeInstanceOf(Date);

      const active = await getStorageLocations(ctx, {
        facilityId: fixture.facilityId,
      });
      expect(
        active.items.some((item) => item.id === fixture.storageLocationId),
      ).toBe(false);

      const archivedList = await getStorageLocations(ctx, {
        facilityId: fixture.facilityId,
        archived: true,
      });
      expect(
        archivedList.items.some(
          (item) => item.id === fixture.storageLocationId,
        ),
      ).toBe(true);

      const restored = await restoreStorageLocation(
        ctx,
        fixture.storageLocationId,
      );
      expect(restored.archivedAt).toBeNull();
    } finally {
      await cleanupStorageArchiveFixture(fixture);
    }
  });

  it.each([
    { type: "feedstock_bin" as const, lane: "feedstock" as const },
    { type: "biochar_bin" as const, lane: "biochar" as const },
    { type: "product_bin" as const, lane: "product" as const },
  ])("blocks archiving a $lane bin with non-zero stock", async ({ type, lane }) => {
    const fixture = await createStorageArchiveFixture({
      type,
      lane,
      endingBalanceKg: 10,
    });
    const ctx = makeTestOrgContext(TEST_USER_ID);

    try {
      await expect(
        archiveStorageLocation(ctx, fixture.storageLocationId),
      ).rejects.toThrow(/10 kg on hand/);
    } finally {
      await cleanupStorageArchiveFixture(fixture);
    }
  });

  it("rejects reconciliation writes after a bin is archived", async () => {
    const fixture = await createStorageArchiveFixture();
    const ctx = makeTestOrgContext(TEST_USER_ID);

    try {
      await archiveStorageLocation(ctx, fixture.storageLocationId);
      await expect(
        recordStockTakeMovement(ctx, {
          storageLocationId: fixture.storageLocationId,
          lane: "feedstock",
          countedMassKg: 0,
          countedWetMassKg: 0,
          moistureRatioUsed: 0,
          reason: "Archived-bin regression check",
        }),
      ).rejects.toThrow(/not found or archived/);
    } finally {
      await cleanupStorageArchiveFixture(fixture);
    }
  });

  it("keeps an individually archived bin archived across facility archive and restore", async () => {
    const fixture = await createStorageArchiveFixture();
    const ctx = makeTestOrgContext(TEST_USER_ID);

    try {
      const individuallyArchived = await archiveStorageLocation(
        ctx,
        fixture.storageLocationId,
      );
      await archiveFacility(ctx, fixture.facilityId);
      await restoreFacility(ctx, fixture.facilityId);

      const [bin] = await db
        .select({ archivedAt: storageLocations.archivedAt })
        .from(storageLocations)
        .where(
          and(
            eq(storageLocations.id, fixture.storageLocationId),
            eq(storageLocations.organizationId, TEST_ORG_ID),
          ),
        );

      expect(bin.archivedAt?.getTime()).toBe(
        individuallyArchived.archivedAt?.getTime(),
      );
    } finally {
      await cleanupStorageArchiveFixture(fixture);
    }
  });
});
