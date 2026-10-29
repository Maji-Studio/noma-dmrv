import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { facilities, feedstocks, feedstockTypes, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, reactors, storageLocations } from "@/db/schema";
import { createProductionRunInTransaction, updateProductionRunInTransaction } from "@/data-access/production-runs/mutations";
import { updateFacility } from "@/data-access/facility-mutations";
import { createFeedstockInTransaction, updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { allocateFeedstockWetMass, deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { reallocateRunsForBins, reallocateRunsForFacility } from "@/data-access/feedstock-run-allocations";
import { cleanupFeedstockFixtureParents, feedstockFixtureValues } from "./helpers/feedstock-fixture";
import { cleanupLineageFixture, createLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

const ctx = makeTestOrgContext("test-allocation-cutoff");
const INTAKE_KG = 10_000;
const DRAW_KG = 5_000;
const ROLLBACK = new Error("fixture rollback");
const date = (day: string) => new Date(`${day}T00:00:00Z`);

async function fixture(tx: DbTransaction) {
  const tag = crypto.randomUUID();
  const [facility] = await tx.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID,
    code: `CUT-${tag}`, name: "Cutoff test", timezone: "Africa/Dar_es_Salaam" }).returning();
  const [type] = await tx.insert(feedstockTypes).values({ organizationId: TEST_ORG_ID,
    code: `CUT-${tag}`, name: "Cutoff test", category: "forestry", usage: "pyrolysis" }).returning();
  const bins = await tx.insert(storageLocations).values(["a", "b"].map(suffix => ({ organizationId: TEST_ORG_ID,
    code: `CUT-${suffix}-${tag}`, name: `Cutoff test ${suffix}`, facilityId: facility.id, type: "feedstock_bin" as const, feedstockTypeId: type.id }))).returning();
  const intakes = await tx.insert(feedstocks).values(await feedstockFixtureValues(tx,
    ["2026-03-01", "2026-03-15", "2026-04-01"].map((day, index) => ({ organizationId: TEST_ORG_ID,
      code: `CUT-${index}-${tag}`, facilityId: facility.id, feedstockTypeId: type.id, storageLocationId: bins[0].id,
      deliveryDate: date(day), status: "complete" as const, massWetKg: INTAKE_KG, massDryKg: INTAKE_KG })))).returning();
  async function run(startTime = new Date("2026-03-20T08:00:00Z"), binId = bins[0].id, executor = tx) {
    const id = crypto.randomUUID();
    const [reactor] = await executor.insert(reactors).values({ organizationId: TEST_ORG_ID, facilityId: facility.id,
      code: `CUT-${id}`, identifier: `Cutoff test ${id}`, reactorType: "batch" }).returning();
    return createProductionRunInTransaction(ctx, executor, { code: `CUT-${id}`, facilityId: facility.id,
      reactorId: reactor.id, status: "running", startTime, endTime: null, feedstockDraws: [{ storageLocationId: binId, wetMassKg: DRAW_KG }] });
  }
  return { facility, type, bins, intakes, run };
}
async function shares(tx: Pick<DbTransaction, "select">, runId: string) {
  return tx.select({ feedstockId: productionRunFeedstocks.feedstockId, wetMassUsedKg: productionRunFeedstocks.wetMassUsedKg })
    .from(productionRunFeedstocks).where(and(eq(productionRunFeedstocks.organizationId, TEST_ORG_ID), eq(productionRunFeedstocks.productionRunId, runId)));
}
async function scenario(work: (tx: DbTransaction, f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  try {
    await db.transaction(async tx => { await work(tx, await fixture(tx)); throw ROLLBACK; });
  } catch (error) { if (error !== ROLLBACK) throw error; }
}

beforeAll(() => ensureTestOrg());
describe("facility-day feedstock allocations", () => {
  it("refuses a draw above the cutoff total even when current stock covers it", () => scenario(async (tx, f) => {
    const run = await f.run();
    const before = await shares(tx, run.id);
    await expect(tx.transaction(savepoint => updateProductionRunInTransaction(ctx, savepoint, run.id, {
      expectedVersion: run.version, feedstockDraws: [{ storageLocationId: f.bins[0].id, wetMassKg: 25_000 }],
    }))).rejects.toMatchObject({ code: "insufficient_stock",
      message: expect.stringMatching(/^By the run's start day/),
      issues: [expect.objectContaining({ path: ["feedstockDraws", 0, "storageLocationId"],
        meta: { storageLocationId: f.bins[0].id, availableWetKg: 20_000, requestedWetKg: 25_000, unit: "kg" } })],
    });
    expect(await shares(tx, run.id)).toEqual(before);
  }));
  it("allows a start-only edit against an archived historical source bin", () => scenario(async (tx, f) => {
    const run = await f.run();
    await tx.update(storageLocations).set({ archivedAt: new Date() }).where(and(
      eq(storageLocations.organizationId, TEST_ORG_ID), eq(storageLocations.id, f.bins[0].id)));
    await updateProductionRunInTransaction(ctx, tx, run.id, {
      expectedVersion: run.version, startTime: new Date("2026-03-10T08:00:00Z"),
    });
    expect(await shares(tx, run.id)).toEqual([{ feedstockId: f.intakes[0].id, wetMassUsedKg: DRAW_KG }]);
    await expect(tx.transaction(savepoint => updateProductionRunInTransaction(ctx, savepoint, run.id, {
      expectedVersion: run.version + 1, startTime: new Date("2026-03-11T08:00:00Z"),
      feedstockDraws: [{ storageLocationId: f.bins[0].id, wetMassKg: DRAW_KG }],
    }))).rejects.toThrow(/archived/);
  }));
  it("rebuilds a date-only intake correction on an archived bin but refuses stock and reference changes", () => scenario(async (tx, f) => {
    const run = await f.run();
    expect(await shares(tx, run.id)).toHaveLength(2);
    await tx.update(storageLocations).set({ archivedAt: new Date() }).where(and(
      eq(storageLocations.organizationId, TEST_ORG_ID), eq(storageLocations.id, f.bins[0].id)));
    const saved = await updateFeedstockInTransaction(ctx, tx, f.intakes[1].id, {
      expectedVersion: f.intakes[1].version, deliveryDate: date("2026-04-02"),
    });
    expect(saved.deliveryDate).toEqual(date("2026-04-02"));
    const expectedShares = [{ feedstockId: f.intakes[0].id, wetMassUsedKg: DRAW_KG }];
    expect(await shares(tx, run.id)).toEqual(expectedShares);
    for (const patch of [
      { massWetKg: INTAKE_KG + 1 },
      { massWetKg: INTAKE_KG + 1, deliveryDate: date("2026-03-15") },
      { massWetKg: 0, deliveryDate: date("2026-03-15") },
      { moistureContentPercent: 10, deliveryDate: date("2026-03-15") },
      { storageLocationId: f.bins[1].id, deliveryDate: date("2026-03-15") },
      { feedstockTypeId: f.type.id, deliveryDate: date("2026-03-15") },
      { facilityId: f.facility.id, deliveryDate: date("2026-03-15") },
    ]) {
      await expect(tx.transaction(savepoint => updateFeedstockInTransaction(ctx, savepoint, saved.id, {
        expectedVersion: saved.version, ...patch,
      }))).rejects.toThrow(/archived/);
      expect(await shares(tx, run.id)).toEqual(expectedShares);
    }
  }));
  it("keeps cancelled draws as history without consuming stock or blocking intake and timezone edits", () => scenario(async (tx, f) => {
    const run = await f.run(new Date("2026-03-10T08:00:00Z"));
    const before = await shares(tx, run.id);
    await updateProductionRunInTransaction(ctx, tx, run.id, {
      expectedVersion: run.version, status: "cancelled", cancellationReason: "Test cancellation",
    });
    expect(await deriveFeedstockWetStockKg(ctx, tx, f.bins[0].id)).toBe(3 * INTAKE_KG);
    const draws = await tx.select().from(productionRunFeedstockDraws).where(and(
      eq(productionRunFeedstockDraws.organizationId, TEST_ORG_ID), eq(productionRunFeedstockDraws.productionRunId, run.id)));
    expect(draws).toHaveLength(1);
    await updateFeedstockInTransaction(ctx, tx, f.intakes[0].id, {
      expectedVersion: f.intakes[0].version, deliveryDate: date("2026-04-02"),
    });
    await tx.select().from(facilities).where(and(
      eq(facilities.organizationId, TEST_ORG_ID), eq(facilities.id, f.facility.id))).for("update");
    await tx.update(facilities).set({ timezone: "UTC" }).where(and(
      eq(facilities.organizationId, TEST_ORG_ID), eq(facilities.id, f.facility.id)));
    await reallocateRunsForFacility(ctx, tx, f.facility.id);
    expect(await shares(tx, run.id)).toEqual(before);
  }));
  it("keeps a run's intake history when the form cancels it and resubmits its draws", () => scenario(async (tx, f) => {
    const run = await f.run();
    const before = await shares(tx, run.id);
    await updateProductionRunInTransaction(ctx, tx, run.id, {
      expectedVersion: run.version, status: "cancelled", cancellationReason: "Test cancellation",
      feedstockDraws: [{ storageLocationId: f.bins[0].id, wetMassKg: DRAW_KG }],
    });
    expect(await shares(tx, run.id)).toEqual(expect.arrayContaining(before));
    expect(await shares(tx, run.id)).toHaveLength(before.length);
  }));
  it("names the affected run when an intake edit leaves too little qualifying mass", () => scenario(async (tx, f) => {
    const run = await f.run();
    await updateProductionRunInTransaction(ctx, tx, run.id, {
      expectedVersion: run.version, feedstockDraws: [{ storageLocationId: f.bins[0].id, wetMassKg: 15_000 }],
    });
    await expect(tx.transaction(savepoint => updateFeedstockInTransaction(ctx, savepoint, f.intakes[1].id, {
      expectedVersion: f.intakes[1].version, deliveryDate: date("2026-04-02"),
    }))).rejects.toMatchObject({ code: "insufficient_stock",
      message: expect.stringContaining(`Run ${run.code}:`),
      issues: [expect.objectContaining({ path: ["deliveryDate"], message: expect.stringContaining(`Run ${run.code}:`),
        meta: { storageLocationId: f.bins[0].id, availableWetKg: INTAKE_KG, requestedWetKg: 15_000, unit: "kg" } })],
    });
  }));
  it("splits 5 t across March intakes and excludes April", () => scenario(async (tx, f) => {
    const run = await f.run();
    expect(await shares(tx, run.id)).toEqual(expect.arrayContaining(f.intakes.slice(0, 2).map(intake => ({ feedstockId: intake.id, wetMassUsedKg: 2_500 }))));
    expect(await shares(tx, run.id)).toHaveLength(2);
  }));
  it("includes the same facility day when 01:00 is the previous UTC day", () => scenario(async (tx, f) => {
    const run = await f.run(new Date("2026-03-14T22:00:00Z"));
    expect(await shares(tx, run.id)).toHaveLength(2);
    expect((await shares(tx, run.id)).map(row => row.feedstockId)).toContain(f.intakes[1].id);
  }));
  it("keeps previous-UTC-day runs in intake discovery for same-facility-day arrivals", () => scenario(async (tx, f) => {
    const run = await f.run(new Date("2026-03-14T22:00:00Z"));
    const created = await createFeedstockInTransaction(ctx, tx, {
      facilityId: f.facility.id, feedstockTypeId: f.type.id, supplierId: f.intakes[0].supplierId!,
      deliveryDate: date("2026-03-15"), totalWetMassKg: INTAKE_KG, moisturePercent: 0,
      allocations: [{ storageLocationId: f.bins[0].id, allocatedWetMassKg: INTAKE_KG }],
    });
    const allocated = await shares(tx, run.id);
    expect(allocated).toHaveLength(3);
    expect(allocated.map(row => row.feedstockId)).toContain(created.feedstocks[0].id);
    expect(allocated.reduce((total, row) => total + row.wetMassUsedKg, 0)).toBeCloseTo(DRAW_KG);
  }));
  it("rebuilds after a saved facility timezone change", async () => {
    const f = await db.transaction(tx => fixture(tx));
    try {
      const run = await db.transaction(tx => f.run(new Date("2026-03-14T22:00:00Z"), undefined, tx));
      expect(await shares(db, run.id)).toHaveLength(2);
      await updateFacility(ctx, f.facility.id, { expectedVersion: f.facility.version, timezone: "UTC" });
      expect(await shares(db, run.id)).toEqual([{ feedstockId: f.intakes[0].id, wetMassUsedKg: DRAW_KG }]);
    } finally {
      const runIds = db.select({ id: productionRuns.id }).from(productionRuns).where(and(
        eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.facilityId, f.facility.id)));
      await db.delete(productionRunFeedstocks).where(and(eq(productionRunFeedstocks.organizationId, TEST_ORG_ID), inArray(productionRunFeedstocks.productionRunId, runIds)));
      await db.delete(productionRunFeedstockDraws).where(and(eq(productionRunFeedstockDraws.organizationId, TEST_ORG_ID), inArray(productionRunFeedstockDraws.productionRunId, runIds)));
      await db.delete(productionRuns).where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.facilityId, f.facility.id)));
      await db.delete(reactors).where(and(eq(reactors.organizationId, TEST_ORG_ID), eq(reactors.facilityId, f.facility.id)));
      await db.delete(feedstocks).where(and(eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.facilityId, f.facility.id)));
      await db.delete(storageLocations).where(and(eq(storageLocations.organizationId, TEST_ORG_ID), eq(storageLocations.facilityId, f.facility.id)));
      await cleanupFeedstockFixtureParents(db);
      await db.delete(feedstockTypes).where(and(eq(feedstockTypes.organizationId, TEST_ORG_ID), eq(feedstockTypes.id, f.type.id)));
      await db.delete(facilities).where(and(eq(facilities.organizationId, TEST_ORG_ID), eq(facilities.id, f.facility.id)));
    }
  });
  it("allows an unrelated edit when another historical draw bin is archived", () => scenario(async (tx, f) => {
    await updateFeedstockInTransaction(ctx, tx, f.intakes[2].id, {
      expectedVersion: f.intakes[2].version, storageLocationId: f.bins[1].id, deliveryDate: date("2026-03-01"),
    });
    const run = await f.run();
    await updateProductionRunInTransaction(ctx, tx, run.id, { expectedVersion: run.version,
      feedstockDraws: f.bins.map(bin => ({ storageLocationId: bin.id, wetMassKg: DRAW_KG })),
    });
    const before = await shares(tx, run.id);
    await tx.update(storageLocations).set({ archivedAt: new Date() }).where(and(
      eq(storageLocations.organizationId, TEST_ORG_ID), eq(storageLocations.id, f.bins[1].id)));
    // Both dates qualify, so the historical allocation itself stays unchanged.
    await updateFeedstockInTransaction(ctx, tx, f.intakes[1].id, {
      expectedVersion: f.intakes[1].version, deliveryDate: date("2026-03-16"),
    });
    expect(await shares(tx, run.id)).toEqual(before);
    await expect(tx.transaction(savepoint => updateFeedstockInTransaction(ctx, savepoint, f.intakes[2].id, {
      expectedVersion: f.intakes[2].version + 1, massWetKg: INTAKE_KG + 1,
    }))).rejects.toThrow(/not found or is archived/);
  }));
  it("rebuilds when only startTime changes", () => scenario(async (tx, f) => {
    const run = await f.run();
    await updateProductionRunInTransaction(ctx, tx, run.id, { expectedVersion: run.version, startTime: new Date("2026-03-10T08:00:00Z") });
    expect(await shares(tx, run.id)).toEqual([{ feedstockId: f.intakes[0].id, wetMassUsedKg: DRAW_KG }]);
  }));
  it("removes a date-edited intake and recalculates wet-mass weights", () => scenario(async (tx, f) => {
    const run = await f.run();
    await updateFeedstockInTransaction(ctx, tx, f.intakes[1].id, { expectedVersion: f.intakes[1].version, deliveryDate: date("2026-04-02") });
    expect(await shares(tx, run.id)).toEqual([{ feedstockId: f.intakes[0].id, wetMassUsedKg: DRAW_KG }]);
    await updateFeedstockInTransaction(ctx, tx, f.intakes[2].id, { expectedVersion: f.intakes[2].version, deliveryDate: date("2026-03-02"), massWetKg: 30_000 });
    expect(await shares(tx, run.id)).toEqual(expect.arrayContaining([
      { feedstockId: f.intakes[0].id, wetMassUsedKg: 1_250 }, { feedstockId: f.intakes[2].id, wetMassUsedKg: 3_750 },
    ]));
  }));
  it("rebuilds runs in both bins when an intake moves", () => scenario(async (tx, f) => {
    await updateFeedstockInTransaction(ctx, tx, f.intakes[2].id, { expectedVersion: f.intakes[2].version, storageLocationId: f.bins[1].id, deliveryDate: date("2026-03-01") });
    const first = await f.run();
    const second = await f.run(undefined, f.bins[1].id);
    await updateFeedstockInTransaction(ctx, tx, f.intakes[1].id, { expectedVersion: f.intakes[1].version, storageLocationId: f.bins[1].id });
    expect(await shares(tx, first.id)).toEqual([{ feedstockId: f.intakes[0].id, wetMassUsedKg: DRAW_KG }]);
    expect(await shares(tx, second.id)).toEqual(expect.arrayContaining([f.intakes[1], f.intakes[2]].map(intake => ({ feedstockId: intake.id, wetMassUsedKg: 2_500 }))));
    expect(await shares(tx, second.id)).toHaveLength(2);
  }));
  it("refuses a draw before any intake and rolls back an invalid start edit", () => scenario(async (tx, f) => {
    await expect(tx.transaction(savepoint => f.run(new Date("2026-02-20T08:00:00Z"), undefined, savepoint)))
      .rejects.toMatchObject({ code: "insufficient_stock",
        message: `Bin ${f.bins[0].name} has no complete intake with wet mass delivered by the run’s start day. Move the run’s start or correct the intake’s delivery date.`,
      });
    const run = await f.run();
    const before = await shares(tx, run.id);
    await expect(tx.transaction(savepoint => updateProductionRunInTransaction(ctx, savepoint, run.id,
      { expectedVersion: run.version, startTime: new Date("2026-02-20T08:00:00Z") }))).rejects.toMatchObject({ code: "insufficient_stock" });
    expect(await shares(tx, run.id)).toEqual(before);
  }));
  it("does not expose a bin name outside the caller's organization", () => scenario(async (tx, f) => {
    const otherCtx = { ...ctx, organizationId: crypto.randomUUID() };
    await expect(allocateFeedstockWetMass(otherCtx, tx, f.bins[0].id, DRAW_KG, "2026-02-20"))
      .rejects.toMatchObject({
        message: "This bin has no complete intake with wet mass delivered by the run’s start day. Move the run’s start or correct the intake’s delivery date.",
      });
  }));
  it("rolls back an intake edit that empties the qualifying basis", () => scenario(async (tx, f) => {
    const run = await f.run(new Date("2026-03-10T08:00:00Z"));
    const before = await shares(tx, run.id);
    await expect(tx.transaction(savepoint => updateFeedstockInTransaction(ctx, savepoint, f.intakes[0].id,
      { expectedVersion: f.intakes[0].version, deliveryDate: date("2026-04-02") }))).rejects.toMatchObject({ code: "insufficient_stock", issues: [expect.objectContaining({ path: ["deliveryDate"], code: "insufficient_stock", message: expect.stringContaining(`Run ${run.code}:`) })] });
    expect(await shares(tx, run.id)).toEqual(before);
    const [intake] = await tx.select().from(feedstocks).where(eq(feedstocks.id, f.intakes[0].id));
    expect(intake.deliveryDate).toEqual(f.intakes[0].deliveryDate);
  }));
  it("later intake create and edit leave Sent runs unchanged and unlocked", async () => {
    const f = await createLineageFixture();
    try {
      const rows = () => db.select().from(productionRunFeedstocks).where(and(
        eq(productionRunFeedstocks.organizationId, TEST_ORG_ID), eq(productionRunFeedstocks.productionRunId, f.productionRunId)));
      const before = await rows();
      const [original] = await db.select().from(feedstocks).where(and(
        eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.id, f.feedstockId)));
      await expect(db.transaction(async tx => {
        const created = await createFeedstockInTransaction(ctx, tx, {
          facilityId: f.facilityId, feedstockTypeId: f.feedstockTypeId, supplierId: original.supplierId!,
          deliveryDate: date("2026-07-01"), totalWetMassKg: INTAKE_KG, moisturePercent: 0,
          allocations: [{ storageLocationId: f.feedstockBinId, allocatedWetMassKg: INTAKE_KG }],
        });
        await updateFeedstockInTransaction(ctx, tx, created.feedstocks[0].id, {
          expectedVersion: created.feedstocks[0].version, deliveryDate: date("2026-07-02"),
        });
        // A second writer can acquire this row immediately while the intake
        // transaction is still open: discovery excluded it before row locking.
        await db.transaction(async other => {
          const locked = await other.select({ id: productionRuns.id }).from(productionRuns).where(and(
            eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, f.productionRunId),
          )).for("update", { noWait: true });
          expect(locked).toHaveLength(1);
        });
        expect(await rows()).toEqual(before);
        throw ROLLBACK;
      })).rejects.toBe(ROLLBACK);
      expect(await rows()).toEqual(before);
      await expect(db.transaction(tx => createFeedstockInTransaction(ctx, tx, {
        facilityId: f.facilityId, feedstockTypeId: f.feedstockTypeId, supplierId: original.supplierId!,
        deliveryDate: date("2026-03-01"), totalWetMassKg: INTAKE_KG, moisturePercent: 0,
        allocations: [{ storageLocationId: f.feedstockBinId, allocatedWetMassKg: INTAKE_KG }],
      }))).rejects.toMatchObject({ code: "certification_locked", issues: expect.arrayContaining([
        expect.objectContaining({ path: ["deliveryDate"], code: "certification_locked" }),
      ]) });
    } finally { await cleanupLineageFixture(f); }
  });
  it("refuses changing a Sent run through a newly qualifying intake", async () => {
    const f = await createLineageFixture();
    try {
      const savedRows = () => db.select().from(productionRunFeedstocks).where(and(
        eq(productionRunFeedstocks.organizationId, TEST_ORG_ID), eq(productionRunFeedstocks.productionRunId, f.productionRunId)));
      const before = await savedRows();
      await expect(db.transaction(async tx => {
        const [extra] = await tx.insert(feedstocks).values(await feedstockFixtureValues(tx, {
          organizationId: TEST_ORG_ID, code: `CUT-${crypto.randomUUID()}`, facilityId: f.facilityId,
          feedstockTypeId: f.feedstockTypeId, storageLocationId: f.feedstockBinId, status: "complete",
          deliveryDate: date("2026-07-01"), massWetKg: INTAKE_KG, massDryKg: INTAKE_KG,
        })).returning();
        await updateFeedstockInTransaction(ctx, tx, extra.id, { expectedVersion: extra.version, deliveryDate: date("2026-03-01") });
      })).rejects.toMatchObject({ code: "certification_locked", issues: [expect.objectContaining({ path: ["deliveryDate"], code: "certification_locked" })] });
      expect(await savedRows()).toEqual(before);
      await db.transaction(tx => reallocateRunsForBins(ctx, tx, [f.feedstockBinId]));
      expect(await savedRows()).toEqual(before);
      const [run] = await db.select().from(productionRuns).where(eq(productionRuns.id, f.productionRunId));
      await expect(db.transaction(tx => updateProductionRunInTransaction(ctx, tx, run.id,
        { expectedVersion: run.version, startTime: new Date("2026-06-12T08:00:00Z") }))).rejects.toMatchObject({ code: "certification_locked" });
    } finally { await cleanupLineageFixture(f); }
  });
});
