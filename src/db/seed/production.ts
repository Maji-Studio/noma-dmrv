import { createFeedstockFn } from "@/fn/feedstocks";
import { createProductionRunFn } from "@/fn/production-runs";
import { createCreditBatchFn } from "@/fn/credit-batches";
import { createSampleFn } from "@/fn/samples";
import { createFeedstockSchema } from "@/schemas/feedstocks";
import { createProductionRunSchema, makeProductionRunFormSchema } from "@/schemas/production-runs";
import { createCreditBatchSchema } from "@/schemas/credit-batches";
import { createSampleSchema, calculateHToCOrgRatio, calculateOToCOrgRatio } from "@/schemas/samples";
import { combineDateAndTime } from "@/lib/date-utils";
import { DELIVERIES, PERIOD, RUN, RUN_DATES, SAMPLE, SAMPLE_DATES, TIME_ZONE } from "./constants";
import { unwrap, type SeedCounts } from "./actions";
import type { Infrastructure } from "./infrastructure";
import { seedReadings } from "./readings";

export async function seedProduction(infra: Infrastructure, counts: SeedCounts) {
  const facilityId = infra.facility.id;
  for (const delivery of DELIVERIES) {
    const forestry = delivery.material === "forestry";
    await unwrap(`create feedstock ${delivery.date}`, createFeedstockFn(createFeedstockSchema.parse({
      facilityId, deliveryDate: delivery.date, supplierId: infra.suppliers[forestry ? 0 : 1].id,
      feedstockTypeId: forestry ? infra.forestry.id : infra.manure.id,
      vehicleId: infra.vehicle.id, transportDistanceKm: delivery.distanceKm,
      transportDistanceSource: "manual", transportTripType: "one_way",
      totalWetMassKg: delivery.massKg, moisturePercent: delivery.moisture,
      allocations: [{ storageLocationId: forestry ? infra.forestryBin.id : infra.manureBin.id, allocatedWetMassKg: delivery.massKg }],
    })));
    counts.add("feedstock deliveries");
    counts.add("feedstocks");
  }
  const runIds: string[] = [];
  for (const date of RUN_DATES) {
    // Same facility-zone form validation and wall-clock conversion as the UI.
    const form = makeProductionRunFormSchema(TIME_ZONE).parse({
      facilityId, reactorId: infra.reactor.id, operatorId: infra.operator.id, status: "complete",
      startDate: date, startTime: RUN.startTime, endDate: date, endTime: RUN.endTime,
      feedstockDraws: [{ storageLocationId: infra.forestryBin.id, wetMassKg: RUN.wetMassKg }],
      feedstockMoisturePercent: RUN.moisturePercent,
      feedingRateKgHr: RUN.feedingRateKgHr, residenceTimeMinutes: RUN.residenceTimeMinutes,
      dieselOperationLiters: RUN.dieselOperationLiters, dieselGensetLiters: RUN.dieselGensetLiters,
      preprocessingFuelLiters: RUN.preprocessingFuelLiters, electricityKwh: RUN.electricityKwh,
      biocharOutputKg: RUN.biocharOutputKg, biocharMoisturePercent: RUN.biocharMoisturePercent,
      biocharStorageLocationId: infra.biocharBin.id,
    });
    const startTime = combineDateAndTime(date, RUN.startTime, TIME_ZONE);
    const run = await unwrap(`create production run ${date}`, createProductionRunFn(createProductionRunSchema.parse({
      ...form, startTime, endTime: combineDateAndTime(date, RUN.endTime, TIME_ZONE),
    })));
    counts.add("completed production runs");
    runIds.push(run.id);
    await seedReadings(run.id, startTime, counts);
  }
  const batch = await unwrap("create sampled credit batch", createCreditBatchFn(createCreditBatchSchema.parse({
    facilityId, feedstockTypeId: infra.forestry.id, startDate: PERIOD.start, endDate: PERIOD.end,
    sampling: "sampled", productionRunIds: runIds,
  })));
  counts.add("credit batches");
  for (const date of SAMPLE_DATES) {
    await unwrap(`create sample ${date}`, createSampleFn(createSampleSchema.parse({
      ...SAMPLE, creditBatchId: batch.id, samplingTime: combineDateAndTime(date, RUN.endTime, TIME_ZONE),
      analysisDate: date, durabilityOption: infra.facility.durabilityOption,
      hToCOrgRatio: calculateHToCOrgRatio(SAMPLE.totalHydrogenPercent, SAMPLE.organicCarbonPercent),
      oToCOrgRatio: calculateOToCOrgRatio(SAMPLE.totalOxygenPercent, SAMPLE.organicCarbonPercent),
      r0AnalysisDate: date, tgaAnalysisDate: date,
    })));
    counts.add("lab samples");
  }
}
