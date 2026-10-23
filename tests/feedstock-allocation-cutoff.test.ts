import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { facilities, feedstocks, feedstockTypes, productionRunFeedstocks, productionRuns, reactors, storageLocations } from "@/db/schema";
import { createProductionRunInTransaction, updateProductionRunInTransaction } from "@/data-access/production-runs/mutations";
import { updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { reallocateRunsForBins } from "@/data-access/feedstock-run-allocations";
import { feedstockFixtureValues } from "./helpers/feedstock-fixture";
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
  return { facility, bins, intakes, run };
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
      .rejects.toMatchObject({ code: "insufficient_stock" });
    const run = await f.run();
    const before = await shares(tx, run.id);
    await expect(tx.transaction(savepoint => updateProductionRunInTransaction(ctx, savepoint, run.id,
      { expectedVersion: run.version, startTime: new Date("2026-02-20T08:00:00Z") }))).rejects.toMatchObject({ code: "insufficient_stock" });
    expect(await shares(tx, run.id)).toEqual(before);
  }));
  it("rolls back an intake edit that empties the qualifying basis", () => scenario(async (tx, f) => {
    const run = await f.run(new Date("2026-03-10T08:00:00Z"));
    const before = await shares(tx, run.id);
    await expect(tx.transaction(savepoint => updateFeedstockInTransaction(ctx, savepoint, f.intakes[0].id,
      { expectedVersion: f.intakes[0].version, deliveryDate: date("2026-04-02") }))).rejects.toMatchObject({ code: "insufficient_stock" });
    expect(await shares(tx, run.id)).toEqual(before);
    const [intake] = await tx.select().from(feedstocks).where(eq(feedstocks.id, f.intakes[0].id));
    expect(intake.deliveryDate).toEqual(f.intakes[0].deliveryDate);
  }));
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
      })).rejects.toMatchObject({ code: "certification_locked" });
      expect(await savedRows()).toEqual(before);
      await db.transaction(tx => reallocateRunsForBins(ctx, tx, [f.feedstockBinId]));
      expect(await savedRows()).toEqual(before);
      const [run] = await db.select().from(productionRuns).where(eq(productionRuns.id, f.productionRunId));
      await expect(db.transaction(tx => updateProductionRunInTransaction(ctx, tx, run.id,
        { expectedVersion: run.version, startTime: new Date("2026-06-12T08:00:00Z") }))).rejects.toMatchObject({ code: "certification_locked" });
    } finally { await cleanupLineageFixture(f); }
  });
});
