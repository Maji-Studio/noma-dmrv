import { expect, it } from "vitest";
import { labSampleRepresentationSchema, representLabSample, type LabSampleRepresentationInput } from "./lab-samples";
import { z } from "zod";

const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const now = new Date("2026-10-06T12:00:00Z");
const row: LabSampleRepresentationInput = {
  id, code: "SAM-26-0001", version: 3, creditBatchId: id, samplingTime: now, labName: "Lab", labAccreditation: "ISO 17025",
  analysisDate: "2026-10-07", weightGrams: 50, volumeMl: null, totalCarbonPercent: 80, organicCarbonPercent: 78,
  inorganicCarbonPercent: 2, totalHydrogenPercent: 2.5, totalNitrogenPercent: null, totalOxygenPercent: 8, totalSulfurPercent: null,
  ashContentPercent: 0, moistureContentPercent: 4, bulkDensityKgPerM3: null, ph: 9.1, saltContentGPerKg: null,
  hToCOrgRatio: 0.3815, oToCOrgRatio: 0.077, randomReflectanceR0Percent: 2.4, sReflectanceFraction: 0.5, r0MeasurementCount: 500,
  r0AnalysisDate: "2026-10-08", reactiveCarbonPercent: null, residualCarbonPercent: 70, tgaAnalysisDate: null,
  phosphorusPercent: null, potassiumPercent: null, magnesiumPercent: null, calciumPercent: null, ironPercent: null,
  createdAt: now, updatedAt: now,
};

it("projects exactly the published fields and drops joined, private and unpublished columns", () => {
  const joined = {
    ...row, organizationId: "foreign", facilityId: id, durabilityOption: "1000_year", creditBatchCode: "CB-1", productionRunId: id,
    timeZone: "Africa/Dar_es_Salaam", arsenicMgKg: 1, r0HistogramFileUrl: "https://example.test/x", cursorCreatedAt: "2026-10-06T12:00:00.000000Z",
  };
  const data = representLabSample(joined);
  expect(Object.keys(data).sort()).toEqual(Object.keys(labSampleRepresentationSchema.shape).sort());
  for (const field of ["organizationId", "facilityId", "durabilityOption", "creditBatchCode", "productionRunId", "timeZone", "arsenicMgKg", "r0HistogramFileUrl", "cursorCreatedAt", "sampleCode"]) {
    expect(data).not.toHaveProperty(field);
  }
  expect(data).toMatchObject({ code: "SAM-26-0001", version: 3, creditBatchId: id, samplingTime: now.toISOString(), hToCOrgRatio: 0.3815, ashContentPercent: 0, volumeMl: null });
  expect(representLabSample(JSON.parse(JSON.stringify(data)))).toEqual(data);
});

it("normalizes the sampling instant to UTC and keeps a legacy null batch", () => {
  expect(representLabSample({ ...row, samplingTime: "2026-10-06T15:00:00+03:00", creditBatchId: null, createdAt: "2026-10-06T15:00:00+03:00" }))
    .toMatchObject({ samplingTime: "2026-10-06T12:00:00.000Z", creditBatchId: null, createdAt: "2026-10-06T12:00:00.000Z" });
});

it("describes every published field", () => {
  const published = z.toJSONSchema(labSampleRepresentationSchema);
  for (const field of Object.values(published.properties ?? {})) expect(typeof field === "object" && field.description).toBeTruthy();
});

it("is stable: the same stored facts always give the same bytes", () => {
  expect(JSON.stringify(representLabSample(row))).toBe(JSON.stringify(representLabSample({ ...row })));
});
