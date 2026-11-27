import { countQueries } from "./helpers/query-counter";
import { loadRunEmissionContributors } from "@/data-access/credit-batch-emission-contributors";
import { loadCountedFailedTransportOwners } from "@/data-access/production-source-manifest";
import { getTransportFeedstockCountedRemovals } from "@/data-access/certification-lineage-guards";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { eq } from "drizzle-orm";
import { buildCreateDatapointRequest } from "@/lib/isometric/transformers/datapoint";
import { beforeAll, expect, it } from "vitest";
import { db } from "@/db";
import { certificationSubmissions, creditBatches, creditBatchProductionRuns, feedstocks, productionRunFeedstocks, productionRuns, storageLocations, transportLegs } from "@/db/schema";
import { getRecordedEnergyInputs } from "@/data-access/energy";
import { getEmissionAllocation } from "@/data-access/emission-allocation";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { buildEnergyBreakdown } from "@/lib/energy/attribution";
import { aggregateProductionRuns, enrichWithTransportLegs } from "@/lib/isometric/utils/aggregation";
import { failedRunFixture } from "./helpers/failed-run-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const ROLLBACK = new Error("rollback energy parity fixture");
beforeAll(() => ensureTestOrg());

it("agrees on complete and failed batch activity and once-only transport while keeping start-day flows", async () => {
  await expect(db.transaction(async tx => {
    const f = await failedRunFixture(tx);
    const ctx = makeTestOrgContext();
    const batchId = f.batch!.id;
    const [bin] = await tx.insert(storageLocations).values({ ...f.site, type: "biochar_bin",
      code: `FR-OUT-${crypto.randomUUID()}`, name: "Material output" }).returning();
    const [complete] = await tx.insert(productionRuns).values({ ...f.run, id: undefined,
      code: `FR-COMPLETE-${crypto.randomUUID()}`, status: "complete", startTime: new Date("2026-03-02"), endTime: new Date("2026-03-03"),
      outputPostedAt: new Date("2026-03-03"), biocharStorageLocationId: bin.id,
      biocharOutputKg: 20, biocharDryMassKg: 20, biocharMoisturePercent: 0 }).returning();
    await tx.insert(creditBatchProductionRuns).values({ ...f.org, productionRunId: complete.id, creditBatchId: batchId });
    // The failed run is earlier and owns both this shared intake and its exclusive intake.
    await tx.insert(productionRunFeedstocks).values({ ...f.org, productionRunId: complete.id, feedstockId: f.stock.id, wetMassUsedKg: 100 });
    const [exclusive] = await tx.insert(feedstocks).values({ ...f.stock, id: undefined, code: `FR-EXCLUSIVE-${crypto.randomUUID()}` }).returning();
    await tx.insert(productionRunFeedstocks).values({ ...f.org, productionRunId: f.run.id, feedstockId: exclusive.id, wetMassUsedKg: 100 });
    const legs = await tx.insert(transportLegs).values([f.stock.id, exclusive.id].map(entityId => ({
      ...f.org, entityType: "feedstock" as const, entityId, distanceKm: 10, loadMassKg: 1000, transportMethodType: "road" as const,
    }))).returning();
    await tx.update(productionRuns).set({ biocharDryMassKg: 999, biocharOutputKg: 999 }).where(eq(productionRuns.id, f.run.id));
    const { inputs } = await getRecordedEnergyInputs(ctx, f.facility.id, tx);
    const energy = buildEnergyBreakdown(inputs, { from: null, to: "2026-03-31" });
    const activity = energy.records.find(record => record.scope === "batch" && record.id === batchId)!.footprint.activity;
    const automatic = (await loadBatchesEmissionAutomaticFacts(ctx, [batchId], {}, tx))[batchId].automaticFigures;
    const removalInputs = enrichWithTransportLegs(aggregateProductionRuns([complete], undefined, { failedContributors: [f.run] }),
      { feedstock: legs, biochar: [], sample: [] });
    expect(energy.records.find(record => record.scope === "batch" && record.id === batchId)?.dryMassKg).toBe(20);
    expect(inputs.runs.find(run => run.id === f.run.id)?.biocharDryMassKg).toBeNull();
    expect(activity.startup).toBe(4);
    expect(activity.genset + activity.preprocessing).toBe(14);
    expect(activity.grid).toBe(10);
    expect(activity.feedstockTransport).toBe(40);
    expect(activity.startup).toBe(Number(automatic["run-startup-diesel"]!.magnitude));
    expect(activity.genset + activity.preprocessing).toBe(Number(automatic["run-genset-diesel"]!.magnitude));
    expect(activity.grid).toBe(Number(automatic["run-electricity"]!.magnitude));
    expect(activity.feedstockTransport).toBe(Number(automatic["feedstock-transport"]!.magnitude));
    expect(removalInputs).toMatchObject({ totalStartupDieselLitres: activity.startup,
      totalGensetDieselLitres: activity.genset + activity.preprocessing, totalElectricityKwh: activity.grid,
      feedstockTransportMassDistanceTonneKm: activity.feedstockTransport, totalBiocharDryMassKg: 20 });
    const payloadCases = [
      { source: "run-startup-diesel", group: "pyrolysis", blueprint: "fuel_usage_by_volume", key: "volume_of_fuel", kind: "volume", unit: "l", value: activity.startup },
      { source: "run-genset-diesel", group: "pyrolysis", blueprint: "fuel_usage_by_volume", key: "volume_of_fuel", kind: "volume", unit: "l", value: activity.genset + activity.preprocessing },
      { source: "run-electricity", group: "pyrolysis", blueprint: "grid_electricity_use", key: "electricity_use", kind: "energy", unit: "kWh", value: activity.grid },
      { source: "feedstock-transport", group: "biomass-feedstock-transport", blueprint: "mass_distance_based_ci_emissions", key: "mass_distance", kind: "mass_distance", unit: "tonne * km", value: activity.feedstockTransport },
    ] as const;
    for (const item of payloadCases) {
      const payload = buildCreateDatapointRequest({
        groupKey: item.group, componentBlueprintKey: item.blueprint,
        lineContract: { scope: "operating", automaticSource: item.source, entryPolicy: "additive", origin: "reviewed" },
        rtcInput: { input_key: item.key, quantity_kind: item.kind, type: "monitored", datapoint_id: null, display_name: item.key },
        blueprintInput: { input_key: item.key, quantity_kind: item.kind, compatible_unit: item.unit, data_shape: "SCALAR", description: "" },
        agg: { ...removalInputs, weightedOrganicCarbonPercent: null, weightedHToCorgRatio: null, weightedOToCorgRatio: null },
        projectId: "test-project", supplierRefId: f.run.id,
      });
      expect(payload.quantity.magnitude).toBe(item.value);
    }
    expect(energy.records.find(record => record.id === f.run.id)?.day).toBe("2026-02-28");
    expect(energy.flows.filter(flow => flow.source === "startup")).toContainEqual({
      source: "startup", creditBatchId: batchId, day: "2026-02-28", activity: 2,
    });
    const allocation = await getEmissionAllocation(ctx, { creditBatchId: batchId }, tx);
    expect(allocation.records.find(record => record.id === f.run.id)?.parts).toMatchObject([{ key: batchId, fraction: 1 }]);
    expect(allocation.records.find(record => record.id === exclusive.id)?.feedstock?.firstRun?.id).toBe(f.run.id);
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});


it.each([
  { status: "draft", own: true, claimed: false, reserved: true },
  { status: "draft", own: false, claimed: false, reserved: true },
  { status: "draft", own: true, claimed: true },
  { status: "submitted", own: true, claimed: true },
  { status: "draft", own: false, claimed: true },
  { status: "submitted", own: false, claimed: true },
  { status: "draft", own: false, claimed: false },
] as const)("keeps Energy and batch transport relative to the claim: %j", async (scenario) => {
  const { status, own, claimed } = scenario;
  const reserved = "reserved" in scenario && scenario.reserved;
  await expect(db.transaction(async tx => {
    const f = await failedRunFixture(tx);
    const ctx = makeTestOrgContext();
    const batchId = f.batch!.id;
    const [claim, other] = await insertRemovalFixture(tx, [f.site, f.site]);
    if (claimed) await tx.update(creditBatches).set({ productionEmissionsClaimedByRemovalId: claim.id })
      .where(eq(creditBatches.id, batchId));
    await tx.insert(transportLegs).values({ ...f.org, entityType: "feedstock", entityId: f.stock.id,
      distanceKm: 10, loadMassKg: 1000, transportMethodType: "road" });
    const before = (await loadBatchesEmissionAutomaticFacts(ctx, [batchId], {}, tx))[batchId];
    const [reservation] = await tx.insert(certificationSubmissions).values({ ...f.org, provider: "isometric", submissionType: "removal",
      localEntityType: "removal", localEntityId: claim.id, version: 1, status,
      payloadSnapshot: { transportFeedstockIds: own ? [f.stock.id] : [] } }).returning();
    if (!own) await tx.insert(certificationSubmissions).values({ ...f.org, provider: "isometric", submissionType: "removal",
      localEntityType: "removal", localEntityId: other.id, version: 1, status,
      payloadSnapshot: { transportFeedstockIds: [f.stock.id] } });
    if (reserved) await tx.update(creditBatches).set({ productionEmissionsClaimReservedBySubmissionId: reservation.id })
      .where(eq(creditBatches.id, batchId));
    const facts = (await loadBatchesEmissionAutomaticFacts(ctx, [batchId], {}, tx))[batchId];
    const { inputs } = await getRecordedEnergyInputs(ctx, f.facility.id, tx);
    const energy = buildEnergyBreakdown(inputs, { from: null, to: "2026-03-31" });
    const activity = energy.records.find(record => record.scope === "batch" && record.id === batchId)!.footprint.activity;
    expect(activity.feedstockTransport).toBe(own ? 20 : 0);
    expect(facts.automaticFigures["feedstock-transport"]).toEqual({ magnitude: own ? "20" : "0", unit: "km * tonne" });
    expect(facts.automaticRecordCounts?.["feedstock-transport"]).toBe(own ? 1 : 0);
    if (own) expect(facts).toEqual(before);
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});


// Ownership resolution costs four reads; counted snapshots must always cost one.
const FAILED_OWNER_QUERY_BUDGET = 5;
const CLAIMED_BATCH_COUNT = 3;

it("loads counted snapshots once for batches with distinct claiming Removals", async () => {
  await expect(db.transaction(async tx => {
    const ctx = makeTestOrgContext();
    const fixtures: Awaited<ReturnType<typeof failedRunFixture>>[] = [];
    const claims = new Map<string, string>();
    for (let i = 0; i < CLAIMED_BATCH_COUNT; i++) {
      const f = await failedRunFixture(tx);
      fixtures.push(f);
      const [removal] = await insertRemovalFixture(tx, [f.site]);
      claims.set(f.batch!.id, removal.id);
      await tx.update(creditBatches).set({ productionEmissionsClaimedByRemovalId: removal.id })
        .where(eq(creditBatches.id, f.batch!.id));
      await tx.insert(certificationSubmissions).values({ ...f.org, provider: "isometric",
        submissionType: "removal", localEntityType: "removal", localEntityId: removal.id,
        version: 1, status: "draft", payloadSnapshot: { transportFeedstockIds: [f.stock.id] } });
    }
    const contributors = await loadRunEmissionContributors(ctx, fixtures.map(f => f.run.id), tx);
    const single = await countQueries(() => loadCountedFailedTransportOwners(ctx, contributors.slice(0, 1), tx, claims));
    const many = await countQueries(() => loadCountedFailedTransportOwners(ctx, contributors, tx, claims));
    expect(single.result.size).toBe(1);
    expect(many.result).toEqual(new Map(fixtures.map(f => [f.stock.id, f.run.id])));
    expect(many.queries).toBe(single.queries);
    expect(many.queries).toBe(FAILED_OWNER_QUERY_BUDGET);
    const relationships = await countQueries(() =>
      getTransportFeedstockCountedRemovals(ctx, fixtures.map(f => f.stock.id), tx));
    expect(relationships.queries).toBe(1);
    for (const f of fixtures) {
      expect(relationships.result.get(f.stock.id)).toEqual(new Set([claims.get(f.batch!.id)]));
    }
    // A second listing Removal must exclude the intake even when its own snapshot also lists it.
    await tx.insert(certificationSubmissions).values({ ...fixtures[0].org, provider: "isometric",
      submissionType: "removal", localEntityType: "removal", localEntityId: claims.get(fixtures[1].batch!.id)!,
      version: 2, status: "submitted", payloadSnapshot: { transportFeedstockIds: [fixtures[0].stock.id] } });
    const excluded = await loadCountedFailedTransportOwners(ctx, contributors, tx, claims);
    expect(excluded.has(fixtures[0].stock.id)).toBe(false);
    expect(excluded.size).toBe(CLAIMED_BATCH_COUNT - 1);
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});
