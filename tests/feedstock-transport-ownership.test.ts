import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  creditBatchProductionRuns, creditBatches, facilities, feedstocks, feedstockTypes,
  productionProcesses, productionRunFeedstocks, productionRuns, reactors, storageLocations, suppliers, transportLegs,
} from "@/db/schema";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import { missingFeedstockTransportIds } from "@/lib/certification/submission-readiness";
import { collectTransportEntityIds } from "@/lib/isometric/utils/transport-lineage";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

const EARLY_LEGS = 77;
const MARCH_LEGS = 30;
const LEG_MASS_KG = 1_000;
const LEG_DISTANCE_KM = 10;
const ROUND_TRIP_TONNE_KM = 20;
const ROLLBACK = new Error("rollback transport ownership fixture");

describe("feedstock transport ownership data access", () => {
  it("claims 77 early legs, 30 March legs and no April legs from one shared bin", async () => {
    const tag = crypto.randomUUID();
    const ctx = makeTestOrgContext();
    await expect(db.transaction(async (tx) => {
      const org = { organizationId: TEST_ORG_ID };
      const [facility] = await tx.insert(facilities).values({ ...org, ...TEST_SITE_POSITION, timezone: "UTC", code: `TO-F-${tag}`, name: "Transport ownership" }).returning();
      const site = { ...org, facilityId: facility.id };
      const [type] = await tx.insert(feedstockTypes).values({ ...org, code: `TO-T-${tag}`, name: "Transport ownership", usage: "pyrolysis", category: "forestry" }).returning();
      const [supplier] = await tx.insert(suppliers).values({ ...org, code: `TO-S-${tag}`, name: "Transport ownership" }).returning();
      const [bin] = await tx.insert(storageLocations).values({ ...site, code: `TO-B-${tag}`, name: "Transport ownership", type: "feedstock_bin", feedstockTypeId: type.id }).returning();
      const [reactor] = await tx.insert(reactors).values({ ...site, code: `TO-R-${tag}`, identifier: "Transport ownership", reactorType: "fixed-bed" }).returning();
      const [process] = await tx.insert(productionProcesses).values({ ...site, feedstockTypeId: type.id }).returning();
      const stocks = await tx.insert(feedstocks).values(Array.from({ length: EARLY_LEGS + MARCH_LEGS }, (_, index) => ({
        ...site, code: `TO-FS-${index}-${tag}`, feedstockTypeId: type.id, supplierId: supplier.id, storageLocationId: bin.id,
        deliveryDate: new Date(index < EARLY_LEGS ? "2026-01-01" : "2026-03-01"),
        massWetKg: LEG_MASS_KG, massDryKg: LEG_MASS_KG, moistureContentPercent: 0, status: "complete" as const,
      }))).returning();
      await tx.insert(transportLegs).values(stocks.map((stock) => ({
        ...org, entityType: "feedstock" as const, entityId: stock.id, distanceKm: LEG_DISTANCE_KM,
        loadMassKg: LEG_MASS_KG, transportMethodType: "road" as const,
      })));
      const months = ["02", "03", "04"];
      const runs = await tx.insert(productionRuns).values(months.map((month) => ({
        ...site, reactorId: reactor.id, code: `TO-PR-${month}-${tag}`, startTime: new Date(`2026-${month}-10T00:00:00Z`),
        feedstockMassDryKg: LEG_MASS_KG,
      }))).returning();
      const batches = await tx.insert(creditBatches).values(months.map((month) => ({
        ...site, code: `TO-CB-${month}-${tag}`, feedstockTypeId: type.id, productionProcessId: process.id,
        startDate: `2026-${month}-01`, endDate: `2026-${month}-28`,
      }))).returning();
      await tx.insert(creditBatchProductionRuns).values(batches.map((batch, index) => ({
        ...org, creditBatchId: batch.id, productionRunId: runs[index].id,
      })));
      await tx.insert(productionRunFeedstocks).values(runs.flatMap((run, index) =>
        (index === 0 ? stocks.slice(0, EARLY_LEGS) : stocks).map((stock) => ({
          ...org, productionRunId: run.id, feedstockId: stock.id, wetMassUsedKg: 1,
        })),
      ));
      // Read each batch alone: owners must still come from all organization runs.
      for (const [index, batch] of batches.entries()) {
        const rollup = (await loadCreditBatchRollups(ctx, [batch.id], undefined, tx))[batch.id];
        const run = rollup.lineageFacts.runs[0];
        expect(run.feedstocks).toHaveLength(index === 0 ? EARLY_LEGS : EARLY_LEGS + MARCH_LEGS);
        const ids = collectTransportEntityIds([{ feedstocks: run.feedstocks, biocharProduct: null }]);
        const expected = [EARLY_LEGS, MARCH_LEGS, 0][index];
        expect(ids.feedstockIds).toHaveLength(expected);
        if (expected === 0) expect(missingFeedstockTransportIds(ids.feedstockIds, [])).toEqual([]);
        const automatic = (await loadBatchesEmissionAutomaticFacts(ctx, [batch.id], {}, tx))[batch.id];
        expect(automatic.automaticRecordCounts?.["feedstock-transport"]).toBe(expected);
        expect(automatic.automaticFigures["feedstock-transport"]).toEqual({
          magnitude: String(expected * ROUND_TRIP_TONNE_KM), unit: "km * tonne",
        });
        expect(Number(automatic.automaticFigures["feedstock-dry-mass"]?.magnitude)).toBe(LEG_MASS_KG);
      }
      expect(await loadCreditBatchRollups({ ...ctx, organizationId: `foreign-${tag}` }, batches.map((batch) => batch.id), undefined, tx)).toEqual({});
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  });
});
