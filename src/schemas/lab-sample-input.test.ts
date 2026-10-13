import { describe, expect, it } from "vitest";
import { rejectUnknownFields } from "@/lib/api/unknown-fields";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { RATIO_INPUT_MAX } from "./helpers";
import { recordLabSampleInput, updateLabSampleApiInput, updateLabSampleInput } from "./lab-sample-input";

const BATCH_ID = "00000000-0000-4000-8000-000000000001";
const SAMPLE_ID = "00000000-0000-4000-8000-000000000002";
const create = { creditBatchId: BATCH_ID, samplingTime: "2026-10-12T09:30:00Z", totalCarbonPercent: 80, organicCarbonPercent: 78 };
const update = { labSampleId: SAMPLE_ID, expectedVersion: 1 };
const optionalNumbers = [
  "weightGrams", "volumeMl", "inorganicCarbonPercent", "totalHydrogenPercent", "totalNitrogenPercent", "totalOxygenPercent",
  "totalSulfurPercent", "ashContentPercent", "moistureContentPercent", "bulkDensityKgPerM3", "ph", "saltContentGPerKg",
  "oToCOrgRatio", "randomReflectanceR0Percent", "sReflectanceFraction", "reactiveCarbonPercent", "residualCarbonPercent",
  "phosphorusPercent", "potassiumPercent", "magnesiumPercent", "calciumPercent", "ironPercent",
] as const;
const unpublished = [
  "hToCOrgRatio", "durabilityOption", "nutrientClaimEnabled", "r0HistogramFileUrl", "tgaThermogramFileUrl",
  "arsenicMgKg", "pahTotalMgKg", "productionRunId", "sampleCode", "organizationId", "version",
];

describe("recordLabSampleInput", () => {
  it("requires the batch, the sampling time and both carbon figures", () => {
    expect(recordLabSampleInput.parse(create)).toMatchObject({ ...create, samplingTime: "2026-10-12T09:30:00Z" });
    const missing = recordLabSampleInput.safeParse({});
    expect(missing.error?.issues.map(issue => issue.path[0]).sort()).toEqual(["creditBatchId", "organicCarbonPercent", "samplingTime", "totalCarbonPercent"]);
  });

  it("takes a facility-local sampling time and refuses one without an offset", () => {
    expect(recordLabSampleInput.parse({ ...create, samplingTime: { date: "2026-10-12", time: "09:30" } }).samplingTime).toEqual({ date: "2026-10-12", time: "09:30" });
    for (const samplingTime of ["2026-10-12T09:30:00", "2026-10-12T09:30", "2026-10-12"]) {
      expect(recordLabSampleInput.safeParse({ ...create, samplingTime }).success, samplingTime).toBe(false);
    }
  });

  it("lowercases the credit batch UUID", () => {
    expect(recordLabSampleInput.parse({ ...create, creditBatchId: BATCH_ID.toUpperCase() }).creditBatchId).toBe(BATCH_ID);
  });

  it("refuses unknown and unpublished fields", () => {
    for (const field of ["mystery", ...unpublished]) {
      expect(recordLabSampleInput.safeParse({ ...create, [field]: 1 }).success, field).toBe(false);
    }
  });

  it("accepts numeric strings and stores a missing or empty optional figure empty", () => {
    for (const field of optionalNumbers) {
      expect(recordLabSampleInput.parse({ ...create, [field]: "0.5" })).toHaveProperty(field, 0.5);
      for (const empty of ["", null, undefined]) expect(recordLabSampleInput.parse({ ...create, [field]: empty })).toHaveProperty(field, null);
      expect(recordLabSampleInput.safeParse({ ...create, [field]: "0.5abc" }).success, field).toBe(false);
      expect(recordLabSampleInput.safeParse({ ...create, [field]: -1 }).success, field).toBe(false);
    }
    expect(recordLabSampleInput.parse({ ...create, r0MeasurementCount: "500" }).r0MeasurementCount).toBe(500);
    expect(recordLabSampleInput.safeParse({ ...create, r0MeasurementCount: "12.5" }).success).toBe(false);
    expect(recordLabSampleInput.safeParse({ ...create, totalCarbonPercent: "" }).error?.issues[0]).toMatchObject({ path: ["totalCarbonPercent"], message: "This field is required" });
  });

  it("keeps each figure in its range", () => {
    expect(recordLabSampleInput.safeParse({ ...create, totalCarbonPercent: 100.1 }).success).toBe(false);
    expect(recordLabSampleInput.safeParse({ ...create, ph: 14.1 }).success).toBe(false);
    expect(recordLabSampleInput.safeParse({ ...create, sReflectanceFraction: 1.01 }).success).toBe(false);
    expect(recordLabSampleInput.safeParse({ ...create, oToCOrgRatio: RATIO_INPUT_MAX + 0.000001 }).success).toBe(false);
    expect(recordLabSampleInput.safeParse({ ...create, oToCOrgRatio: RATIO_INPUT_MAX }).success).toBe(true);
    expect(recordLabSampleInput.safeParse({ ...create, labName: "x".repeat(201) }).success).toBe(false);
    expect(recordLabSampleInput.parse({ ...create, analysisDate: "2026-10-01" }).analysisDate).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(recordLabSampleInput.safeParse({ ...create, analysisDate: "2026-02-31" }).success).toBe(false);
  });

  it("refuses only carbon in excess of the total, with the form's copy", () => {
    expect(recordLabSampleInput.safeParse({ ...create, totalCarbonPercent: 80, organicCarbonPercent: 80.5 }).success).toBe(true);
    expect(recordLabSampleInput.safeParse({ ...create, totalCarbonPercent: 80, organicCarbonPercent: 40, inorganicCarbonPercent: 1 }).success).toBe(true);
    expect(recordLabSampleInput.safeParse({ ...create, organicCarbonPercent: 81 }).error?.issues).toEqual([
      expect.objectContaining({ path: ["organicCarbonPercent"], message: "Organic carbon cannot exceed total carbon by more than 0.5 percentage points. Correct the carbon values." }),
    ]);
    expect(recordLabSampleInput.safeParse({ ...create, inorganicCarbonPercent: 3 }).error?.issues).toEqual([
      expect.objectContaining({ path: ["inorganicCarbonPercent"], message: "Organic plus inorganic carbon cannot exceed total carbon by more than 0.5 percentage points. Correct the carbon values." }),
    ]);
  });
});

describe("updateLabSampleInput", () => {
  it("leaves a missing field alone, clears an optional one with null and keeps zero", () => {
    expect(updateLabSampleApiInput.parse({})).toEqual({});
    for (const field of optionalNumbers) {
      const parsed = updateLabSampleInput.parse({ ...update, [field]: null });
      expect(parsed, field).toHaveProperty(field, null);
      expect(updateLabSampleInput.parse(update)[field], field).toBeUndefined();
      expect(updateLabSampleInput.parse({ ...update, [field]: "0" })[field], field).toBe(0);
    }
    expect(updateLabSampleInput.parse({ ...update, r0MeasurementCount: null }).r0MeasurementCount).toBeNull();
    expect(updateLabSampleInput.parse({ ...update, r0MeasurementCount: undefined }).r0MeasurementCount).toBeUndefined();
    expect(updateLabSampleInput.parse({ ...update, analysisDate: null, labName: null })).toMatchObject({ analysisDate: null, labName: null });
  });

  it("never clears the required carbon figures, the batch or the sampling time", () => {
    for (const field of ["totalCarbonPercent", "organicCarbonPercent", "creditBatchId", "samplingTime", "code"]) {
      expect(updateLabSampleApiInput.safeParse({ [field]: null }).success, field).toBe(false);
    }
  });

  it("accepts a code edit and a move to another batch", () => {
    expect(updateLabSampleApiInput.parse({ code: "SAM-26-010", creditBatchId: BATCH_ID.toUpperCase() })).toEqual({ code: "SAM-26-010", creditBatchId: BATCH_ID });
    expect(updateLabSampleApiInput.safeParse({ code: "sam 10" }).success).toBe(false);
  });

  it("publishes no id or version in the PATCH body, and requires both in the tool input", () => {
    for (const field of ["labSampleId", "expectedVersion", ...unpublished]) {
      expect(updateLabSampleApiInput.safeParse({ [field]: 1 }).success, field).toBe(false);
    }
    expect(updateLabSampleInput.safeParse({}).error?.issues.map(issue => issue.path[0]).sort()).toEqual(["expectedVersion", "labSampleId"]);
    expect(updateLabSampleInput.parse({ ...update, labSampleId: SAMPLE_ID.toUpperCase() }).labSampleId).toBe(SAMPLE_ID);
  });

  it("checks carbon excess among the figures it carries", () => {
    expect(updateLabSampleApiInput.safeParse({ totalCarbonPercent: 70, organicCarbonPercent: 71 }).error?.issues[0].path).toEqual(["organicCarbonPercent"]);
    // One figure alone is checked by the writer against the stored row.
    expect(updateLabSampleApiInput.safeParse({ organicCarbonPercent: 99 }).success).toBe(true);
  });
});

it("rejects unknown nested fields against the published contract and keeps numbers numeric", () => {
  const contract = toOperationJsonSchema(recordLabSampleInput);
  expect(() => rejectUnknownFields({ ...create, samplingTime: { date: "2026-10-12", time: "09:30", zone: "UTC" } }, contract))
    .toThrow(expect.objectContaining({ issues: [expect.objectContaining({ path: ["samplingTime", "zone"] })] }));
  expect(() => rejectUnknownFields({ ...create, weightGrams: "12.5" }, contract)).not.toThrow();
  const published = contract.properties as Record<string, unknown>;
  for (const field of [...optionalNumbers, "totalCarbonPercent", "organicCarbonPercent", "r0MeasurementCount"]) {
    expect(JSON.stringify(published[field]), field).toMatch(/"type":"(number|integer)"/);
    expect(JSON.stringify(published[field]), field).not.toContain('"type":"string"');
  }
});
