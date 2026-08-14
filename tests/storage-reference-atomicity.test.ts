import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { lockBinStock } from "@/data-access/bin-stock-guards";
import { archiveFacility } from "@/data-access/facilities";
import { createStorageLocation } from "@/data-access/quick-add";
import {
  createFeedstock,
  updateFeedstock,
} from "@/data-access/feedstocks";
import {
  createProductionRun,
  updateProductionRun,
} from "@/data-access/production-runs";
import {
  facilities,
  feedstocks,
  feedstockTypes,
  productionRunFeedstockDraws,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  storageLocations,
  suppliers,
  transportLegs,
} from "@/db/schema";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-storage-reference-atomicity";
const CONCURRENCY_BARRIER_TIMEOUT_MS = 5_000;
const CONCURRENCY_TEST_TIMEOUT_MS = 30_000;
const ctx = makeTestOrgContext(TEST_USER_ID);

interface Fixture {
  facilityId: string;
  targetFacilityId: string;
  archivedFacilityId: string;
  supplierId: string;
  reactorId: string;
  targetReactorId: string;
  primaryFeedstockTypeId: string;
  secondaryFeedstockTypeId: string;
  untypedFeedstockBinId: string;
  typedFeedstockBinId: string;
  biocharBinId: string;
  existingFeedstockId: string;
  unlocatedFeedstockId: string;
  existingProductionRunId: string;
  tag: string;
}

const fixtures: Fixture[] = [];

beforeAll(() => ensureTestOrg());

async function createFixture(): Promise<Fixture> {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const fixture = await db.transaction(async (tx) => {
    const [facility, targetFacility, archivedFacility] = await tx
      .insert(facilities)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `FAC-SRA-${tag}`,
          name: `Storage Reference Atomicity Facility ${tag}`,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FAC-SRA-TARGET-${tag}`,
          name: `Storage Reference Atomicity Target ${tag}`,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FAC-SRA-ARCH-${tag}`,
          name: `Archived Storage Reference Facility ${tag}`,
          archivedAt: new Date(),
        },
      ])
      .returning({ id: facilities.id });
    const [supplier] = await tx
      .insert(suppliers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `SUP-SRA-${tag}`,
        name: `Storage Reference Atomicity Supplier ${tag}`,
      })
      .returning({ id: suppliers.id });
    const [reactor, targetReactor] = await tx
      .insert(reactors)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `R-SRA-${tag}`,
          identifier: `Storage Reference Atomicity Reactor ${tag}`,
          reactorType: "auger" as const,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: targetFacility.id,
          code: `R-SRA-TARGET-${tag}`,
          identifier: `Storage Reference Atomicity Target Reactor ${tag}`,
          reactorType: "auger" as const,
        },
      ])
      .returning({ id: reactors.id });
    const [primaryFeedstockType, secondaryFeedstockType] = await tx
      .insert(feedstockTypes)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `FT-SRA-A-${tag}`,
          name: `Storage Reference Atomicity A ${tag}`,
          category: "forestry",
          usage: "pyrolysis" as const,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FT-SRA-B-${tag}`,
          name: `Storage Reference Atomicity B ${tag}`,
          category: "agricultural_residue",
          usage: "pyrolysis" as const,
        },
      ])
      .returning({ id: feedstockTypes.id });
    const [untypedFeedstockBin, typedFeedstockBin, biocharBin] = await tx
      .insert(storageLocations)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BIN-SRA-U-${tag}`,
          name: `Storage Reference Atomicity Untyped ${tag}`,
          type: "feedstock_bin" as const,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BIN-SRA-F-${tag}`,
          name: `Storage Reference Atomicity Feedstock ${tag}`,
          type: "feedstock_bin" as const,
          feedstockTypeId: primaryFeedstockType.id,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BIN-SRA-B-${tag}`,
          name: `Storage Reference Atomicity Biochar ${tag}`,
          type: "biochar_bin" as const,
        },
      ])
      .returning({ id: storageLocations.id });
    const [existingFeedstock, unlocatedFeedstock] = await tx
      .insert(feedstocks)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `FS-SRA-EXISTING-${tag}`,
          status: "missing_data",
          feedstockTypeId: primaryFeedstockType.id,
          massDryKg: 0,
          massWetKg: 0,
          moistureContentPercent: 0,
          storageLocationId: untypedFeedstockBin.id,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `FS-SRA-UNLOCATED-${tag}`,
          status: "missing_data",
          feedstockTypeId: primaryFeedstockType.id,
          massDryKg: 0,
          massWetKg: 0,
          moistureContentPercent: 0,
          storageLocationId: null,
        },
      ])
      .returning({ id: feedstocks.id });
    const [existingProductionRun] = await tx
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `PR-SRA-EXISTING-${tag}`,
        status: "draft",
        startTime: new Date("2026-07-24T06:00:00Z"),
        endTime: null,
        reactorId: reactor.id,
      })
      .returning({ id: productionRuns.id });

    return {
      facilityId: facility.id,
      targetFacilityId: targetFacility.id,
      archivedFacilityId: archivedFacility.id,
      supplierId: supplier.id,
      reactorId: reactor.id,
      targetReactorId: targetReactor.id,
      primaryFeedstockTypeId: primaryFeedstockType.id,
      secondaryFeedstockTypeId: secondaryFeedstockType.id,
      untypedFeedstockBinId: untypedFeedstockBin.id,
      typedFeedstockBinId: typedFeedstockBin.id,
      biocharBinId: biocharBin.id,
      existingFeedstockId: existingFeedstock.id,
      unlocatedFeedstockId: unlocatedFeedstock.id,
      existingProductionRunId: existingProductionRun.id,
      tag,
    };
  });
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()!;
    const testFeedstocks = await db
      .select({ id: feedstocks.id })
      .from(feedstocks)
      .where(
        inArray(feedstocks.facilityId, [
          fixture.facilityId,
          fixture.targetFacilityId,
        ]),
      );
    const testRuns = await db
      .select({ id: productionRuns.id })
      .from(productionRuns)
      .where(
        inArray(productionRuns.facilityId, [
          fixture.facilityId,
          fixture.targetFacilityId,
        ]),
      );

    if (testRuns.length > 0) {
      await db
        .delete(productionRunFeedstocks)
        .where(
          inArray(
            productionRunFeedstocks.productionRunId,
            testRuns.map((run) => run.id),
          ),
        );
      await db
        .delete(productionRunFeedstockDraws)
        .where(
          inArray(
            productionRunFeedstockDraws.productionRunId,
            testRuns.map((run) => run.id),
          ),
        );
      await db
        .delete(productionRuns)
        .where(inArray(productionRuns.id, testRuns.map((run) => run.id)));
    }
    if (testFeedstocks.length > 0) {
      await db
        .delete(transportLegs)
        .where(
          inArray(
            transportLegs.entityId,
            testFeedstocks.map((feedstock) => feedstock.id),
          ),
        );
      await db
        .delete(feedstocks)
        .where(inArray(feedstocks.id, testFeedstocks.map((feedstock) => feedstock.id)));
    }
    await db
      .delete(storageLocations)
      .where(eq(storageLocations.facilityId, fixture.facilityId));
    await db
      .delete(reactors)
      .where(inArray(reactors.id, [fixture.reactorId, fixture.targetReactorId]));
    await db.delete(suppliers).where(eq(suppliers.id, fixture.supplierId));
    await db
      .delete(feedstockTypes)
      .where(
        inArray(feedstockTypes.id, [
          fixture.primaryFeedstockTypeId,
          fixture.secondaryFeedstockTypeId,
        ]),
      );
    await db.delete(facilities).where(eq(facilities.id, fixture.facilityId));
    await db
      .delete(facilities)
      .where(eq(facilities.id, fixture.targetFacilityId));
    await db
      .delete(facilities)
      .where(eq(facilities.id, fixture.archivedFacilityId));
  }
});

async function archiveBeforeReferenceWrite<T>(
  storageLocationId: string,
  write: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let releaseArchive = () => {};
  let signalArchiveReady = () => {};
  const archiveReady = new Promise<void>((resolve) => {
    signalArchiveReady = resolve;
  });
  const releaseArchivePromise = new Promise<void>((resolve) => {
    releaseArchive = resolve;
  });
  let archiveBackendPid = 0;

  const archiveTransaction = db.transaction(async (tx) => {
    await lockBinStock(ctx, tx, storageLocationId);
    await tx
      .update(storageLocations)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(storageLocations.id, storageLocationId),
          eq(storageLocations.organizationId, TEST_ORG_ID),
        ),
      );
    const backend = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    );
    archiveBackendPid = backend.rows[0]?.pid ?? 0;
    signalArchiveReady();
    await releaseArchivePromise;
  });

  await archiveReady;
  const writeOutcome = write().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  try {
    await expect.poll(async () => {
      const result = await db.execute<{ waiting: boolean }>(sql`
        select exists (
          select 1
          from pg_locks waiting
          join pg_locks held
            on held.locktype = waiting.locktype
           and held.database is not distinct from waiting.database
           and held.classid is not distinct from waiting.classid
           and held.objid is not distinct from waiting.objid
           and held.objsubid is not distinct from waiting.objsubid
          where waiting.locktype = 'advisory'
            and not waiting.granted
            and held.granted
            and held.pid = ${archiveBackendPid}
        ) as waiting
      `);
      return result.rows[0]?.waiting ?? false;
    }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(true);
  } finally {
    releaseArchive();
    await archiveTransaction;
  }

  return writeOutcome;
}

async function archiveFacilityBeforeReferenceWrite<T>(
  fixture: Fixture,
  write: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let releaseArchive = () => {};
  let signalArchiveReady = () => {};
  const archiveReady = new Promise<void>((resolve) => {
    signalArchiveReady = resolve;
  });
  const releaseArchivePromise = new Promise<void>((resolve) => {
    releaseArchive = resolve;
  });
  let archiveBackendPid = 0;

  const archiveTransaction = db.transaction(async (tx) => {
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
    const archivedAt = new Date();
    await tx
      .update(facilities)
      .set({ archivedAt })
      .where(eq(facilities.id, fixture.facilityId));
    await tx
      .update(storageLocations)
      .set({ archivedAt })
      .where(eq(storageLocations.facilityId, fixture.facilityId));
    await tx
      .update(feedstocks)
      .set({ archivedAt })
      .where(eq(feedstocks.facilityId, fixture.facilityId));
    await tx
      .update(productionRuns)
      .set({ archivedAt })
      .where(eq(productionRuns.facilityId, fixture.facilityId));
    const backend = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    );
    archiveBackendPid = backend.rows[0]?.pid ?? 0;
    signalArchiveReady();
    await releaseArchivePromise;
  });

  await archiveReady;
  const writeOutcome = write().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  try {
    await expect.poll(async () => {
      const result = await db.execute<{ waiting: boolean }>(sql`
        select exists (
          select 1
          from pg_locks waiting
          join pg_locks held
            on held.locktype = waiting.locktype
           and held.transactionid is not distinct from waiting.transactionid
          where waiting.locktype = 'transactionid'
            and not waiting.granted
            and held.granted
            and held.pid = ${archiveBackendPid}
        ) as waiting
      `);
      return result.rows[0]?.waiting ?? false;
    }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(true);
  } finally {
    releaseArchive();
    await archiveTransaction;
  }

  return writeOutcome;
}

function expectArchivedReferenceRejected(
  outcome: { ok: true; value: unknown } | { ok: false; error: unknown },
): void {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) {
    throw new Error("Expected the storage reference write to be rejected");
  }
  expect(outcome.error).toBeInstanceOf(Error);
  expect((outcome.error as Error).message).toMatch(/not found|archived/i);
}

describe(
  "storage reference atomicity",
  { timeout: CONCURRENCY_TEST_TIMEOUT_MS },
  () => {
    it("locks and revalidates zero-mass feedstock allocations", async () => {
      const fixture = await createFixture();
      const feedstockCode = `FS-SRA-ZERO-${fixture.tag}`;

      const outcome = await archiveBeforeReferenceWrite(
        fixture.untypedFeedstockBinId,
        () =>
          createFeedstock(
            ctx,
            {
              facilityId: fixture.facilityId,
              deliveryDate: new Date("2026-07-24T00:00:00Z"),
              supplierId: fixture.supplierId,
              feedstockTypeId: fixture.primaryFeedstockTypeId,
              totalWetMassKg: 0,
              moisturePercent: 0,
              allocations: [{
                storageLocationId: fixture.untypedFeedstockBinId,
                allocatedWetMassKg: 0,
              }],
            },
            async () => [feedstockCode],
          ),
      );

      expectArchivedReferenceRejected(outcome);
    });

    it("locks and revalidates the bin when a feedstock type changes", async () => {
      const fixture = await createFixture();

      const outcome = await archiveBeforeReferenceWrite(
        fixture.untypedFeedstockBinId,
        () =>
          updateFeedstock(ctx, fixture.existingFeedstockId, {
            feedstockTypeId: fixture.secondaryFeedstockTypeId,
          }),
      );

      expectArchivedReferenceRejected(outcome);
    });

    it("serializes a wet-only feedstock mass change with its bin", async () => {
      const fixture = await createFixture();

      const outcome = await archiveBeforeReferenceWrite(
        fixture.untypedFeedstockBinId,
        () =>
          updateFeedstock(ctx, fixture.existingFeedstockId, {
            massWetKg: 1,
          }),
      );

      expectArchivedReferenceRejected(outcome);
    });

    it("rejects an archived facility when moving an unlocated feedstock", async () => {
      const fixture = await createFixture();

      await expect(
        updateFeedstock(ctx, fixture.unlocatedFeedstockId, {
          facilityId: fixture.archivedFacilityId,
        }),
      ).rejects.toThrow(/not found|archived/i);
    });

    it("locks a supplied biochar bin for zero output", async () => {
      const fixture = await createFixture();

      const outcome = await archiveBeforeReferenceWrite(
        fixture.biocharBinId,
        () =>
          createProductionRun(ctx, {
            code: `PR-SRA-BIOCHAR-${fixture.tag}`,
            facilityId: fixture.facilityId,
            reactorId: fixture.reactorId,
            startTime: new Date("2026-07-24T08:00:00Z"),
            endTime: null,
            biocharOutputKg: 0,
            biocharMoisturePercent: 0,
            biocharStorageLocationId: fixture.biocharBinId,
          }),
      );

      expectArchivedReferenceRejected(outcome);
    });

    it("locks a supplied feedstock bin for null input mass", async () => {
      const fixture = await createFixture();

      const outcome = await archiveBeforeReferenceWrite(
        fixture.typedFeedstockBinId,
        () =>
          createProductionRun(ctx, {
            code: `PR-SRA-FEEDSTOCK-${fixture.tag}`,
            facilityId: fixture.facilityId,
            reactorId: fixture.reactorId,
            startTime: new Date("2026-07-24T12:00:00Z"),
            endTime: null,
            feedstockWetMassKg: null,
            feedstockMoisturePercent: null,
            feedstockStorageLocationId: fixture.typedFeedstockBinId,
          }),
      );

      expectArchivedReferenceRejected(outcome);
    });

    it("rejects a feedstock created while its facility is being archived", async () => {
      const fixture = await createFixture();

      const outcome = await archiveFacilityBeforeReferenceWrite(
        fixture,
        () =>
          createFeedstock(
            ctx,
            {
              facilityId: fixture.facilityId,
              deliveryDate: new Date("2026-07-24T00:00:00Z"),
              supplierId: fixture.supplierId,
              feedstockTypeId: fixture.primaryFeedstockTypeId,
              totalWetMassKg: 0,
              moisturePercent: 0,
              allocations: [{
                storageLocationId: fixture.untypedFeedstockBinId,
                allocatedWetMassKg: 0,
              }],
            },
            async () => [`FS-SRA-FACILITY-${fixture.tag}`],
          ),
      );

      expectArchivedReferenceRejected(outcome);
    });

    it("rejects a quick-added storage location for an archived facility", async () => {
      const fixture = await createFixture();

      await expect(createStorageLocation(ctx, {
        code: `BIN-SRA-QUICK-ARCH-${fixture.tag}`,
        name: `Storage Reference Atomicity Quick Archived ${fixture.tag}`,
        type: "feedstock_bin",
        facilityId: fixture.archivedFacilityId,
      })).rejects.toThrow(/not found|archived/i);
    });

    it("serializes quick-add creation behind a concurrent facility archive", async () => {
      const fixture = await createFixture();

      const outcome = await archiveFacilityBeforeReferenceWrite(
        fixture,
        () => createStorageLocation(ctx, {
          code: `BIN-SRA-QUICK-RACE-${fixture.tag}`,
          name: `Storage Reference Atomicity Quick Race ${fixture.tag}`,
          type: "feedstock_bin",
          facilityId: fixture.facilityId,
        }),
      );

      expectArchivedReferenceRejected(outcome);
      const [stranded] = await db
        .select({ id: storageLocations.id })
        .from(storageLocations)
        .where(eq(
          storageLocations.name,
          `Storage Reference Atomicity Quick Race ${fixture.tag}`,
        ));
      expect(stranded).toBeUndefined();
    });

    it("rejects a production run created while its facility is being archived", async () => {
      const fixture = await createFixture();

      const outcome = await archiveFacilityBeforeReferenceWrite(
        fixture,
        () =>
          createProductionRun(ctx, {
            code: `PR-SRA-FACILITY-${fixture.tag}`,
            facilityId: fixture.facilityId,
            reactorId: fixture.reactorId,
            startTime: new Date("2026-07-24T16:00:00Z"),
            endTime: null,
            biocharOutputKg: 0,
            biocharMoisturePercent: 0,
            biocharStorageLocationId: fixture.biocharBinId,
          }),
      );

      expectArchivedReferenceRejected(outcome);
    });

    it("rejects a feedstock move after its source facility archive wins", async () => {
      const fixture = await createFixture();

      const outcome = await archiveFacilityBeforeReferenceWrite(
        fixture,
        () =>
          updateFeedstock(ctx, fixture.unlocatedFeedstockId, {
            facilityId: fixture.targetFacilityId,
          }),
      );

      expectArchivedReferenceRejected(outcome);
      const [stored] = await db
        .select({
          facilityId: feedstocks.facilityId,
          archivedAt: feedstocks.archivedAt,
        })
        .from(feedstocks)
        .where(eq(feedstocks.id, fixture.unlocatedFeedstockId));
      expect(stored).toMatchObject({ facilityId: fixture.facilityId });
      expect(stored.archivedAt).not.toBeNull();
    });

    it("rejects a production run move after its source facility archive wins", async () => {
      const fixture = await createFixture();

      const outcome = await archiveFacilityBeforeReferenceWrite(
        fixture,
        () =>
          updateProductionRun(ctx, fixture.existingProductionRunId, {
            facilityId: fixture.targetFacilityId,
            reactorId: fixture.targetReactorId,
          }),
      );

      expectArchivedReferenceRejected(outcome);
      const [stored] = await db
        .select({
          facilityId: productionRuns.facilityId,
          archivedAt: productionRuns.archivedAt,
        })
        .from(productionRuns)
        .where(eq(productionRuns.id, fixture.existingProductionRunId));
      expect(stored).toMatchObject({ facilityId: fixture.facilityId });
      expect(stored.archivedAt).not.toBeNull();
    });

    it("keeps moved rows active when their move wins before source archive", async () => {
      const fixture = await createFixture();

      await updateFeedstock(ctx, fixture.unlocatedFeedstockId, {
        facilityId: fixture.targetFacilityId,
      });
      await updateProductionRun(ctx, fixture.existingProductionRunId, {
        facilityId: fixture.targetFacilityId,
        reactorId: fixture.targetReactorId,
      });
      await archiveFacility(ctx, fixture.facilityId);

      const [storedFeedstock] = await db
        .select({
          facilityId: feedstocks.facilityId,
          archivedAt: feedstocks.archivedAt,
        })
        .from(feedstocks)
        .where(eq(feedstocks.id, fixture.unlocatedFeedstockId));
      const [storedRun] = await db
        .select({
          facilityId: productionRuns.facilityId,
          archivedAt: productionRuns.archivedAt,
        })
        .from(productionRuns)
        .where(eq(productionRuns.id, fixture.existingProductionRunId));

      expect(storedFeedstock).toMatchObject({
        facilityId: fixture.targetFacilityId,
        archivedAt: null,
      });
      expect(storedRun).toMatchObject({
        facilityId: fixture.targetFacilityId,
        archivedAt: null,
      });
    });
  },
);
