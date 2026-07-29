import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  archiveStorageLocation,
  deleteStorageLocation,
  getStorageLocations,
  restoreStorageLocation,
  updateStorageLocation,
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
const CONCURRENCY_BARRIER_TIMEOUT_MS = 5_000;
const CONCURRENCY_TEST_TIMEOUT_MS = 10_000;

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
      ).rejects.toThrow(
        /Storage bin was not found or is archived. Refresh the page and try again./,
      );
    } finally {
      await cleanupStorageArchiveFixture(fixture);
    }
  });

  it("rejects direct edits after a bin is archived", async () => {
    const fixture = await createStorageArchiveFixture();
    const ctx = makeTestOrgContext(TEST_USER_ID);

    try {
      await archiveStorageLocation(ctx, fixture.storageLocationId);
      await expect(
        updateStorageLocation(ctx, fixture.storageLocationId, {
          name: "Archived bins must not be editable",
        }),
      ).rejects.toThrow(/restore this storage bin before editing it/i);

      const [unchanged] = await db
        .select({ name: storageLocations.name })
        .from(storageLocations)
        .where(
          and(
            eq(storageLocations.id, fixture.storageLocationId),
            eq(storageLocations.organizationId, TEST_ORG_ID),
          ),
        );
      expect(unchanged.name).not.toBe(
        "Archived bins must not be editable",
      );
    } finally {
      await cleanupStorageArchiveFixture(fixture);
    }
  });

  it("does not restore a bin while its facility is being archived", async () => {
    const fixture = await createStorageArchiveFixture();
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const facilityArchivedAt = new Date();
    let releaseFacilityArchive = () => {};
    let facilityArchiveTransaction: Promise<void> | undefined;

    try {
      await archiveStorageLocation(ctx, fixture.storageLocationId);

      let signalFacilityArchiveReady = () => {};
      const facilityArchiveReady = new Promise<void>((resolve) => {
        signalFacilityArchiveReady = resolve;
      });
      const releaseFacilityArchivePromise = new Promise<void>((resolve) => {
        releaseFacilityArchive = resolve;
      });
      let facilityArchiveBackendPid = 0;

      facilityArchiveTransaction = db.transaction(async (tx) => {
        await tx
          .update(facilities)
          .set({ archivedAt: facilityArchivedAt })
          .where(
            and(
              eq(facilities.id, fixture.facilityId),
              eq(facilities.organizationId, TEST_ORG_ID),
            ),
          );
        const backend = await tx.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`,
        );
        facilityArchiveBackendPid = backend.rows[0]?.pid ?? 0;
        signalFacilityArchiveReady();
        await releaseFacilityArchivePromise;
      });
      await facilityArchiveReady;

      const restoreOutcome = restoreStorageLocation(
        ctx,
        fixture.storageLocationId,
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await expect.poll(async () => {
        const result = await db.execute<{ waiting: boolean }>(sql`
          select exists (
            select 1
            from pg_stat_activity
            where ${facilityArchiveBackendPid} = any(pg_blocking_pids(pid))
          ) as waiting
        `);
        return result.rows[0]?.waiting ?? false;
      }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(true);

      releaseFacilityArchive();
      await facilityArchiveTransaction;

      const outcome = await restoreOutcome;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) {
        throw new Error("Expected storage-location restore to be rejected");
      }
      expect(outcome.error).toBeInstanceOf(SafeError);
      expect((outcome.error as Error).message).toMatch(
        /restore the facility before restoring this storage bin/i,
      );

      const [state] = await db
        .select({
          binArchivedAt: storageLocations.archivedAt,
          facilityArchivedAt: facilities.archivedAt,
        })
        .from(storageLocations)
        .innerJoin(
          facilities,
          and(
            eq(storageLocations.facilityId, facilities.id),
            eq(facilities.organizationId, TEST_ORG_ID),
          ),
        )
        .where(
          and(
            eq(storageLocations.id, fixture.storageLocationId),
            eq(storageLocations.organizationId, TEST_ORG_ID),
          ),
        );
      expect(state.binArchivedAt).toBeInstanceOf(Date);
      expect(state.facilityArchivedAt?.getTime()).toBe(
        facilityArchivedAt.getTime(),
      );
    } finally {
      releaseFacilityArchive();
      await facilityArchiveTransaction?.catch(() => undefined);
      await cleanupStorageArchiveFixture(fixture);
    }
  });

  it("serializes concurrent facility archives without stranding children", async () => {
    const fixture = await createStorageArchiveFixture();
    const ctx = makeTestOrgContext(TEST_USER_ID);
    let releaseFacilityLock = () => {};
    let facilityLockTransaction: Promise<void> | undefined;

    try {
      let signalFacilityLockReady = () => {};
      const facilityLockReady = new Promise<void>((resolve) => {
        signalFacilityLockReady = resolve;
      });
      const releaseFacilityLockPromise = new Promise<void>((resolve) => {
        releaseFacilityLock = resolve;
      });
      let facilityLockBackendPid = 0;

      facilityLockTransaction = db.transaction(async (tx) => {
        await tx
          .select({ id: facilities.id })
          .from(facilities)
          .where(
            and(
              eq(facilities.id, fixture.facilityId),
              eq(facilities.organizationId, TEST_ORG_ID),
            ),
          )
          .for("update");
        const backend = await tx.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`,
        );
        facilityLockBackendPid = backend.rows[0]?.pid ?? 0;
        signalFacilityLockReady();
        await releaseFacilityLockPromise;
      });
      await facilityLockReady;

      const archiveOutcomes = [
        archiveFacility(ctx, fixture.facilityId),
        archiveFacility(ctx, fixture.facilityId),
      ].map((archive) =>
        archive.then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      );

      await expect.poll(async () => {
        const result = await db.execute<{ waiting_count: number }>(sql`
          with recursive blocked(pid) as (
            select pid
            from pg_stat_activity
            where ${facilityLockBackendPid} = any(pg_blocking_pids(pid))
            union
            select activity.pid
            from pg_stat_activity activity
            inner join blocked blocker
              on blocker.pid = any(pg_blocking_pids(activity.pid))
          )
          select count(*)::int as waiting_count from blocked
        `);
        return result.rows[0]?.waiting_count ?? 0;
      }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(2);

      releaseFacilityLock();
      await facilityLockTransaction;

      const outcomes = await Promise.all(archiveOutcomes);
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      const rejected = outcomes.find((outcome) => !outcome.ok);
      expect(rejected?.error).toBeInstanceOf(SafeError);
      expect((rejected?.error as Error).message).toMatch(
        /facility is already archived/i,
      );

      await restoreFacility(ctx, fixture.facilityId);
      const [restored] = await db
        .select({
          binArchivedAt: storageLocations.archivedAt,
          facilityArchivedAt: facilities.archivedAt,
        })
        .from(storageLocations)
        .innerJoin(
          facilities,
          and(
            eq(storageLocations.facilityId, facilities.id),
            eq(facilities.organizationId, TEST_ORG_ID),
          ),
        )
        .where(
          and(
            eq(storageLocations.id, fixture.storageLocationId),
            eq(storageLocations.organizationId, TEST_ORG_ID),
          ),
        );
      expect(restored.facilityArchivedAt).toBeNull();
      expect(restored.binArchivedAt).toBeNull();
    } finally {
      releaseFacilityLock();
      await facilityLockTransaction?.catch(() => undefined);
      await cleanupStorageArchiveFixture(fixture);
    }
  }, CONCURRENCY_TEST_TIMEOUT_MS);

  it("keeps an individually archived bin archived across facility archive and restore", async () => {
    const fixture = await createStorageArchiveFixture();
    const ctx = makeTestOrgContext(TEST_USER_ID);

    try {
      const individuallyArchived = await archiveStorageLocation(
        ctx,
        fixture.storageLocationId,
      );
      await archiveFacility(ctx, fixture.facilityId);

      const [archivePrecision] = await db
        .select({
          binOffsetMicroseconds: sql<number>`
            mod(
              extract(microseconds from ${storageLocations.archivedAt})::int,
              1000
            )
          `,
          facilityOffsetMicroseconds: sql<number>`
            mod(
              extract(microseconds from ${facilities.archivedAt})::int,
              1000
            )
          `,
        })
        .from(storageLocations)
        .innerJoin(
          facilities,
          and(
            eq(storageLocations.facilityId, facilities.id),
            eq(facilities.organizationId, TEST_ORG_ID),
          ),
        )
        .where(
          and(
            eq(storageLocations.id, fixture.storageLocationId),
            eq(storageLocations.organizationId, TEST_ORG_ID),
          ),
        );
      expect(archivePrecision.binOffsetMicroseconds).toBe(0);
      expect(archivePrecision.facilityOffsetMicroseconds).toBe(500);

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
