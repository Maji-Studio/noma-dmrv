import { eq } from "drizzle-orm";
import { productionRuns, storageLocations, creditBatchProductionRuns } from "@/db/schema";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { beforeAll, expect, it } from "vitest";
import { db } from "@/db";
import { transportLegs } from "@/db/schema";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { getFeedstockTransportOwnerBatches } from "@/data-access/feedstock-transport-ownership";
import { getTransportFreezeFeedstockIds } from "@/data-access/feedstock-transport-ownership-freeze";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { failedRunFixture } from "./helpers/failed-run-fixture";

const ROLLBACK = new Error("rollback failed figures fixture");
beforeAll(() => ensureTestOrg());
it("counts full failed production and transport with no material membership or stored mass", async () => {
  await expect(db.transaction(async tx => {
    const fixture = await failedRunFixture(tx);
    const ctx = makeTestOrgContext();
    await tx.insert(transportLegs).values({ ...fixture.org, entityType: "feedstock", entityId: fixture.stock.id,
      distanceKm: 10, loadMassKg: 1000, transportMethodType: "road" });
    const facts = (await loadBatchesEmissionAutomaticFacts(ctx, [fixture.batch!.id], {}, tx))[fixture.batch!.id];
    expect(facts.automaticFigures).toMatchObject({
      "run-startup-diesel": { magnitude: "2", unit: "L" },
      "run-genset-diesel": { magnitude: "7", unit: "L" },
      "run-electricity": { magnitude: "5", unit: "kWh" },
      "feedstock-dry-mass": { magnitude: "100", unit: "kg" },
      "feedstock-transport": { magnitude: "20", unit: "km * tonne" },
      "biochar-dry-mass": null, "safety-margin": null,
    });
    expect(facts.automaticRecordCounts?.["run-electricity"]).toBe(1);
    expect((await getFeedstockTransportOwnerBatches(ctx, [fixture.stock.id], tx)).get(fixture.stock.id)).toEqual([
      { creditBatchId: fixture.batch!.id, code: fixture.batch!.code },
    ]);
    expect(await getTransportFreezeFeedstockIds(ctx, tx, { batchIds: [fixture.batch!.id] })).toContain(fixture.stock.id);
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});

it("leaves every material rollup and figure unchanged by stale positive failed output", async () => {
  await expect(db.transaction(async tx => {
    const fixture = await failedRunFixture(tx);
    const ctx = makeTestOrgContext();
    const ids = [fixture.batch!.id];
    const [outputBin] = await tx.insert(storageLocations).values({ ...fixture.site, type: "biochar_bin",
      code: `FR-OUT-${crypto.randomUUID()}`, name: "Material output" }).returning();
    const [material] = await tx.insert(productionRuns).values({ ...fixture.run, id: undefined,
      code: `FR-MATERIAL-${crypto.randomUUID()}`, status: "complete", startTime: new Date("2026-03-02"), endTime: new Date("2026-03-03"),
      outputPostedAt: new Date("2026-03-03"), biocharStorageLocationId: outputBin.id,
      biocharOutputKg: 20, biocharDryMassKg: 20, biocharMoisturePercent: 0 }).returning();
    await tx.insert(creditBatchProductionRuns).values({ ...fixture.org, creditBatchId: fixture.batch!.id, productionRunId: material.id });
    const before = await loadCreditBatchRollups(ctx, ids, { includeRunForwards: true }, tx);
    const figures = await loadBatchesEmissionAutomaticFacts(ctx, ids, {}, tx);
    await tx.update(productionRuns).set({ biocharOutputKg: 999, biocharDryMassKg: 999, biocharMoisturePercent: 0 }).where(eq(productionRuns.id, fixture.run.id));
    expect(await loadCreditBatchRollups(ctx, ids, { includeRunForwards: true }, tx)).toEqual(before);
    expect(await loadBatchesEmissionAutomaticFacts(ctx, ids, {}, tx)).toEqual(figures);
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});

it.each([null, 0])("preserves a failed electricity reading of %s", async electricityKwh => {
  await expect(db.transaction(async tx => {
    const fixture = await failedRunFixture(tx);
    await tx.update(productionRuns).set({ electricityKwh }).where(eq(productionRuns.id, fixture.run.id));
    const facts = (await loadBatchesEmissionAutomaticFacts(makeTestOrgContext(), [fixture.batch!.id], {}, tx))[fixture.batch!.id];
    expect(facts.automaticFigures["run-electricity"]).toEqual(electricityKwh === null ? null : { magnitude: "0", unit: "kWh" });
    expect(facts.automaticRecordCounts?.["run-electricity"]).toBe(1);
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});
