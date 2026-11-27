import { feedstockFixtureValues } from "./feedstock-fixture";
import type { DbTransaction } from "@/db";
import { creditBatches, facilities, feedstocks, feedstockTypes, productionProcesses, productionRunFeedstocks, productionRuns, reactors, storageLocations } from "@/db/schema";
import { TEST_ORG_ID, TEST_SITE_POSITION } from "./test-org";

/** Transaction-owned fixture; callers roll back even after a failed assertion. */
export async function failedRunFixture(tx: DbTransaction, options: { timezone?: string; endTime?: string; batch?: boolean } = {}) {
  const tag = crypto.randomUUID();
  const org = { organizationId: TEST_ORG_ID };
  const [facility] = await tx.insert(facilities).values({ ...org, ...TEST_SITE_POSITION, timezone: options.timezone ?? "UTC", code: `FR-F-${tag}`, name: `Failed run fixture ${tag}` }).returning();
  const site = { ...org, facilityId: facility.id };
  const [type] = await tx.insert(feedstockTypes).values({ ...org, code: `FR-T-${tag}`, name: `Failed run fixture ${tag}`, usage: "pyrolysis", category: "forestry" }).returning();
  const [bin] = await tx.insert(storageLocations).values({ ...site, code: `FR-B-${tag}`, name: `Failed run fixture ${tag}`, type: "feedstock_bin", feedstockTypeId: type.id }).returning();
  const [reactor] = await tx.insert(reactors).values({ ...site, code: `FR-R-${tag}`, identifier: `Failed run fixture ${tag}`, reactorType: "fixed-bed" }).returning();
  const [process] = await tx.insert(productionProcesses).values({ ...site, feedstockTypeId: type.id }).returning();
  const [stock] = await tx.insert(feedstocks).values(await feedstockFixtureValues(tx, { ...site, code: `FR-S-${tag}`, feedstockTypeId: type.id, storageLocationId: bin.id,
    deliveryDate: new Date("2026-01-01"), massWetKg: 1000, massDryKg: 1000, moistureContentPercent: 0, status: "complete" })).returning();
  const [run] = await tx.insert(productionRuns).values({ ...site, reactorId: reactor.id, code: `FR-PR-${tag}`,
    startTime: new Date("2026-02-28T12:00:00Z"), endTime: new Date(options.endTime ?? "2026-03-01T12:00:00Z"), status: "failed",
    feedstockWetMassKg: 100, feedstockMoisturePercent: 0, feedstockMassDryKg: 100,
    dieselOperationLiters: 2, dieselGensetLiters: 3, preprocessingFuelLiters: 4, electricityKwh: 5,
  }).returning();
  await tx.insert(productionRunFeedstocks).values({ ...org, productionRunId: run.id, feedstockId: stock.id, wetMassUsedKg: 100 });
  const batchValues = { ...site, code: `FR-CB-${tag}`, feedstockTypeId: type.id, productionProcessId: process.id, startDate: "2026-03-01", endDate: "2026-03-31" };
  const batch = options.batch === false ? null : (await tx.insert(creditBatches).values(batchValues).returning())[0];
  return { org, site, facility, type, stock, run, batch, batchValues };
}
