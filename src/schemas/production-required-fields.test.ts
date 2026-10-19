import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { incidentReports, productionRuns, productionSamples } from "@/db/schema";
import { resolveEventInstant } from "@/lib/operations/event-times";
import { productionIncidentFormSchema, updateProductionIncidentSchema } from "./production-incidents";
import { productionSampleFormSchema, updateProductionSampleSchema } from "./production-samples";
import { productionRunFormSchema, updateProductionRunSchema } from "./production-runs";
import { createProductionRunInput, updateProductionRunInput } from "./production-run-input";
import { moistureSchema } from "./output-stock";

const ID = "33333333-3333-4333-8333-333333333333";
const INSTANT = "2026-09-01T12:00:00Z";
const measurement = { productionRunId: ID, timestamp: INSTANT };
const incident = { productionRunId: ID, incidentTime: INSTANT, severity: "low", description: "Temperature rose." };
const measurements = ["weightGrams", "volumeMl", "temperatureC", "moistureContentPercent", "fixedCarbonPercent", "volatileMatterPercent", "ashContentPercent"] as const;

for (const schema of [productionSampleFormSchema, updateProductionSampleSchema]) {
  const base = { ...measurement, productionSampleId: ID, expectedVersion: 1 };
  describe("in-process measurement validation", () => {
    it.each([{}, { notes: "No reading", photoUrl: "https://example.com/photo.jpg" }, Object.fromEntries(measurements.map(field => [field, ""]))])("requires a measurement, not metadata: %j", values => {
      const result = schema.safeParse({ ...base, ...values });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["weightGrams"], message: "Enter at least one measured value." }));
    });
    it.each(measurements)("accepts zero as the sole %s reading", field => {
      expect(schema.safeParse({ ...base, [field]: "0" }).success).toBe(true);
    });
    it.each(["weightGrams", "volumeMl"])("refuses negative %s", field => {
      expect(schema.safeParse({ ...base, [field]: -1 }).success).toBe(false);
    });
    it("allows negative temperature", () => {
      expect(schema.safeParse({ ...base, temperatureC: -1 }).success).toBe(true);
    });
  });
}

for (const [schema, base, field] of [
  [productionSampleFormSchema, { ...measurement, weightGrams: 1 }, "timestamp"],
  [updateProductionSampleSchema, { ...measurement, weightGrams: 1, productionSampleId: ID, expectedVersion: 1 }, "timestamp"],
  [productionIncidentFormSchema, incident, "incidentTime"],
  [updateProductionIncidentSchema, { ...incident, productionIncidentId: ID, expectedVersion: 1 }, "incidentTime"],
] as const) {
  describe(`${field} instant contract`, () => {
    it.each(["", "2026-09-01", "2026-09-01T12:00", "not-a-time"])("refuses %s", value => {
      expect(schema.safeParse({ ...base, [field]: value }).success).toBe(false);
    });
    it("shows one plain message for a cleared or refused time", () => {
      const result = schema.safeParse({ ...base, [field]: "" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toEqual([
        expect.objectContaining({ path: [field], message: field === "timestamp" ? "Enter the measurement time." : "Enter the incident time." }),
      ]);
    });
    it("resolves local input on the facility clock", () => {
      const value = { date: "2026-09-01", time: "12:00" };
      expect(schema.safeParse({ ...base, [field]: value }).success).toBe(true);
      expect(resolveEventInstant(value, "Africa/Dar_es_Salaam", [field]).toISOString()).toBe("2026-09-01T09:00:00.000Z");
      expect(resolveEventInstant(value, "America/New_York", [field]).toISOString()).toBe("2026-09-01T16:00:00.000Z");
    });
    it("keeps explicit offsets and refuses skipped or repeated facility times", () => {
      expect(schema.safeParse({ ...base, [field]: "2026-09-01T12:00:00+03:00" }).success).toBe(true);
      expect(resolveEventInstant("2026-09-01T12:00:00+03:00", "UTC", [field]).toISOString()).toBe("2026-09-01T09:00:00.000Z");
      for (const date of ["2026-03-29", "2026-10-25"]) {
        expect(() => resolveEventInstant({ date, time: "02:30" }, "Europe/Zurich", [field])).toThrow();
      }
    });
  });
}

describe("run moisture matches output stock", () => {
  for (const field of ["feedstockMoisturePercent", "biocharMoisturePercent"] as const) {
    it.each([-1, 0, 99.999999, 100, 101])(`${field}: %s`, value => {
      const expected = moistureSchema().safeParse(value).success;
      expect(productionRunFormSchema.shape[field].safeParse(value).success).toBe(expected);
      expect(updateProductionRunSchema.shape[field].safeParse(value).success).toBe(expected);
      expect(createProductionRunInput.shape[field].safeParse(value).success).toBe(expected);
      expect(updateProductionRunInput.shape[field].safeParse(value).success).toBe(expected);
    });
  }
});

it("stores only current production fields and requires explicit starts and severity", () => {
  const runs = getTableColumns(productionRuns);
  expect(runs.startTime.hasDefault).toBe(false);
  expect(runs).not.toHaveProperty("feedstockStorageLocationId");
  expect(runs).not.toHaveProperty("electricitySourceCategory");
  expect(runs).not.toHaveProperty("lowCarbonPercentage");
  expect(getTableColumns(incidentReports)).not.toHaveProperty("incidentDate");
  expect(getTableColumns(incidentReports).severity.notNull).toBe(true);
  expect(getTableColumns(productionSamples)).not.toHaveProperty("sampleCode");
});
