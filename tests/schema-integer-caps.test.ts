/**
 * Integer Cap Schema Tests (issue #251 companion)
 *
 * Uncapped integer fields let form input overflow a Postgres `integer`
 * column, producing a raw DB error. The Zod schemas now cap them at
 * PG_INTEGER_MAX so the overflow is rejected with a friendly validation
 * message before it ever reaches the database.
 */
import { describe, it, expect } from "vitest";

import { PG_INTEGER_MAX } from "@/schemas/helpers";
import {
  createProductionRunSchema,
  updateProductionRunSchema,
} from "@/schemas/production-runs";
import { createSampleSchema, updateSampleSchema } from "@/schemas/samples";

const OVERFLOW = 3_000_000_000; // > 2_147_483_647 (PG integer max)

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const REACTOR_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const CREDIT_BATCH_ID = "33333333-3333-4333-8333-333333333333";
const SAMPLE_ID = "55555555-5555-4555-8555-555555555555";

const validRunBase = {
  facilityId: FACILITY_ID,
  startDate: "2026-01-15",
  reactorId: REACTOR_ID,
  startTime: "08:00",
};

const validSampleBase = {
  creditBatchId: CREDIT_BATCH_ID,
  samplingTime: new Date("2026-01-15T12:00:00.000Z"),
  totalCarbonPercent: 80,
  organicCarbonPercent: 75,
};

describe("residenceTimeMinutes PG integer cap", () => {
  it("rejects an overflowing value on create", () => {
    const result = createProductionRunSchema.safeParse({
      ...validRunBase,
      residenceTimeMinutes: OVERFLOW,
    });
    expect(result.success).toBe(false);
  });

  it("accepts PG_INTEGER_MAX itself on create", () => {
    const result = createProductionRunSchema.safeParse({
      ...validRunBase,
      residenceTimeMinutes: PG_INTEGER_MAX,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an overflowing value on update", () => {
    const result = updateProductionRunSchema.safeParse({
      productionRunId: RUN_ID,
      residenceTimeMinutes: OVERFLOW,
    });
    expect(result.success).toBe(false);
  });

  it("accepts PG_INTEGER_MAX itself on update", () => {
    const result = updateProductionRunSchema.safeParse({
      productionRunId: RUN_ID,
      residenceTimeMinutes: PG_INTEGER_MAX,
    });
    expect(result.success).toBe(true);
  });
});

describe("r0MeasurementCount PG integer cap", () => {
  it("rejects an overflowing number on create", () => {
    const result = createSampleSchema.safeParse({
      ...validSampleBase,
      r0MeasurementCount: OVERFLOW,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an overflowing string on create (form input path)", () => {
    const result = createSampleSchema.safeParse({
      ...validSampleBase,
      r0MeasurementCount: String(OVERFLOW),
    });
    expect(result.success).toBe(false);
  });

  it("accepts PG_INTEGER_MAX itself on create", () => {
    const result = createSampleSchema.safeParse({
      ...validSampleBase,
      r0MeasurementCount: PG_INTEGER_MAX,
    });
    expect(result.success).toBe(true);
  });

  it("still normalizes an empty string to null on create", () => {
    const result = createSampleSchema.safeParse({
      ...validSampleBase,
      r0MeasurementCount: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.r0MeasurementCount).toBeNull();
    }
  });

  it("rejects an overflowing value on update", () => {
    const result = updateSampleSchema.safeParse({
      sampleId: SAMPLE_ID,
      r0MeasurementCount: OVERFLOW,
    });
    expect(result.success).toBe(false);
  });

  it("accepts PG_INTEGER_MAX itself on update", () => {
    const result = updateSampleSchema.safeParse({
      sampleId: SAMPLE_ID,
      r0MeasurementCount: PG_INTEGER_MAX,
    });
    expect(result.success).toBe(true);
  });
});
