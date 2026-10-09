import { expect, it } from "vitest";
import { productionRunRepresentationSchema, representProductionRun, type ProductionRunRepresentationInput } from "./production-runs";

const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const now = new Date("2026-10-06T12:00:00Z");
const row: ProductionRunRepresentationInput = {
  id, code: "PR-26-0001", version: 1, facilityId: id, facilityCode: "FAC-1", timeZone: "Africa/Nairobi",
  reactorId: id, reactorCode: "R-1", status: "running", cancellationReason: null, startTime: now, endTime: null,
  operatorId: null, feedstockDraws: [{ storageLocationId: id, storageLocationCode: "B2", wetMassKg: 1200 }],
  feedstockMoisturePercent: 30, feedingRateKgHr: 600, residenceTimeMinutes: 20, dieselOperationLiters: 0,
  dieselGensetLiters: null, preprocessingFuelLiters: null, electricityKwh: 12, biocharOutputKg: null,
  biocharMoisturePercent: null, biocharStorageLocationId: null, biocharStorageLocationCode: null, createdAt: now, updatedAt: now,
};
it("projects explicit fields and strips internal allocations, row fields and operator names", () => {
  const data = representProductionRun({ ...row, organizationId: "foreign", feedstocks: [{ id }], operatorName: "private" } as ProductionRunRepresentationInput);
  expect(data).toMatchObject({ startTime: now.toISOString(), endTime: null, timeZone: "Africa/Nairobi", feedstockDraws: row.feedstockDraws, dieselOperationLiters: 0 });
  expect(Object.keys(data).sort()).toEqual(Object.keys(productionRunRepresentationSchema.shape).sort());
  for (const field of ["organizationId", "feedstocks", "operatorName", "feedstockWetMassKg", "stockPostingSequence"]) expect(data).not.toHaveProperty(field);
  expect(representProductionRun(JSON.parse(JSON.stringify(data)))).toEqual(data);
});
it("normalizes closed run times to UTC and preserves nulls and zero", () => {
  expect(representProductionRun({ ...row, startTime: "2026-10-06T15:00:00+03:00", endTime: "2026-10-06T16:00:00+03:00", biocharOutputKg: 0 }))
    .toMatchObject({ startTime: "2026-10-06T12:00:00.000Z", endTime: "2026-10-06T13:00:00.000Z", biocharOutputKg: 0 });
});
