import type { DbTransaction } from ".";
import * as schema from "./schema";

type CreditBatchSeedIds = {
  facilityMoshi: string;
  feedstockWoodchips: string;
  feedstockCoffeeHusk: string;
  processMoshiWoodchips: string;
  processMoshiCoffee: string;
  creditBatch1: string;
  creditBatch2: string;
  productionRun1: string;
  productionRun2: string;
  productionRun3: string;
};

type CreditBatchSeedTimestamps = {
  facilitySetup: Date;
};

export async function seedProductionProcessesAndCreditBatches(
  tx: DbTransaction,
  ids: CreditBatchSeedIds,
  demoTimestamps: CreditBatchSeedTimestamps,
) {
  // ADR 0016: a production process is the (facility, feedstock)
  // sampling-regime campaign; each credit batch is a <=1-month protocol
  // production batch slicing exactly one process.
  console.log("Creating production processes...");
  await tx.insert(schema.productionProcesses).values([
    {
      id: ids.processMoshiWoodchips,
      facilityId: ids.facilityMoshi,
      feedstockTypeId: ids.feedstockWoodchips,
      establishedAt: demoTimestamps.facilitySetup,
    },
    {
      id: ids.processMoshiCoffee,
      facilityId: ids.facilityMoshi,
      feedstockTypeId: ids.feedstockCoffeeHusk,
      establishedAt: demoTimestamps.facilitySetup,
    },
  ]);

  console.log("Creating credit batches...");
  await tx.insert(schema.creditBatches).values([
    {
      id: ids.creditBatch1,
      code: "CB-26-001",
      facilityId: ids.facilityMoshi,
      feedstockTypeId: ids.feedstockWoodchips,
      productionProcessId: ids.processMoshiWoodchips,
      status: "pending",
      startDate: "2026-05-13",
      endDate: "2026-05-31",
      certifier: "isometric",
      registry: "Isometric Registry",
      bufferPoolPercent: 10,
      durabilityOption: "200_year",
      hToCorgRatio: 0.269,
      fDurableCalculated: 0.851,
      siteManagementNotes:
        "Biochar incorporated into planting rows within 48 hours; no synthetic nitrogen applied during the application window.",
      affidavitReference: "AFF-MOSHI-2026-001",
      intendedUseConfirmation:
        "Customer purchase orders specify soil application on named coffee and tea plots.",
      companyVerificationRef: "BRELA-agri-customer-records-2026",
      mixingTimelineDays: 2,
    },
    {
      id: ids.creditBatch2,
      code: "CB-26-002",
      facilityId: ids.facilityMoshi,
      feedstockTypeId: ids.feedstockCoffeeHusk,
      productionProcessId: ids.processMoshiCoffee,
      status: "draft",
      startDate: "2026-05-15",
      endDate: "2026-05-31",
      certifier: "isometric",
      registry: "Isometric Registry",
      durabilityOption: "1000_year",
      // Eq.6 petrography/TGA inputs — means and n−1 std devs consistent with
      // the batch's three seeded replicates (R₀ 2.9/2.8/2.7; residual carbon
      // 68.2/67.6/68.1 in seed-data.ts).
      meanRandomReflectancePercent: 2.8,
      stdRandomReflectance: 0.1,
      meanNonReactiveCarbonPercent: 68,
      stdNonReactiveCarbonPercent: 0.32,
    },
  ]);

  console.log("Creating credit batch production-run membership...");
  await tx.insert(schema.creditBatchProductionRuns).values([
    {
      creditBatchId: ids.creditBatch1,
      productionRunId: ids.productionRun1,
    },
    {
      creditBatchId: ids.creditBatch1,
      productionRunId: ids.productionRun3,
    },
    {
      creditBatchId: ids.creditBatch2,
      productionRunId: ids.productionRun2,
    },
  ]);
}
