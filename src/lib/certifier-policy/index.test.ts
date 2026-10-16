import { describe, expect, it } from "vitest";
import { isBatchEligible, validateBatchPeriod } from "./index";

describe("validateBatchPeriod", () => {
  it("applies the existing calendar-month cap to Isometric batches", () => {
    expect(validateBatchPeriod({
      certifier: "isometric",
      startDate: "2026-01-01",
      endDate: "2026-02-02",
    })).toBe("A credit batch may span at most one month (one calendar month; noma rule).");
  });

  it.each(["puro_earth", null])("exempts batches with certifier %s from the Isometric cap", (certifier) => {
    expect(validateBatchPeriod({
      certifier,
      startDate: "2026-01-01",
      endDate: "2026-04-30",
    })).toBeNull();
  });

  it.each(["isometric", "puro_earth", null])("preserves calendar-date validation for %s", (certifier) => {
    expect(validateBatchPeriod({ certifier, startDate: "2026-02-30", endDate: "2026-04-30" }))
      .toBe("Enter a valid date.");
    expect(validateBatchPeriod({ certifier, startDate: "2026-04-30", endDate: "2026-01-01" }))
      .toBe("End date must be after start date");
    expect(validateBatchPeriod({
      certifier,
      startDate: new Date("2026-01-01T18:00:00.000Z"),
      endDate: new Date("2026-01-01T06:00:00.000Z"),
    })).toBeNull();
  });
});

describe("isBatchEligible", () => {
  const methodBEligibility = {
    eligibleSampleCount: 30,
    agreedBaselineSize: 30,
    unsampledAllowed: true,
  };
  const unsampledBatch = {
    sampling: "unsampled" as const,
    certifier: "isometric",
    hasIsometricCredentials: true,
    methodBEligibility,
  };
  const connectionMessage = "Unsampled credit batches require an Isometric connection for the organization and facility.";

  it("refuses unsampled creation without organization Isometric credentials", () => {
    expect(isBatchEligible({ ...unsampledBatch, hasIsometricCredentials: false }))
      .toEqual({ eligible: false, message: connectionMessage });
  });

  it.each(["puro_earth", null])("refuses unsampled creation for certifier %s", (certifier) => {
    expect(isBatchEligible({ ...unsampledBatch, certifier }))
      .toEqual({ eligible: false, message: connectionMessage });
  });

  it.each([
    { eligibleSampleCount: 29, agreedBaselineSize: 30, unsampledAllowed: false },
    { eligibleSampleCount: 30, agreedBaselineSize: 30, unsampledAllowed: false },
    { eligibleSampleCount: 30, agreedBaselineSize: 40, unsampledAllowed: false },
  ])("preserves the Method-B refusal for $eligibleSampleCount Samples and baseline $agreedBaselineSize", (facts) => {
    expect(isBatchEligible({ ...unsampledBatch, methodBEligibility: facts })).toEqual({
      eligible: false,
      message: `This process has ${facts.eligibleSampleCount} qualifying Method-A Samples. Record at least ${facts.agreedBaselineSize} and complete the Method-B prerequisites before creating an unsampled credit batch.`,
    });
  });

  it("checks the connection before Method-B prerequisites", () => {
    expect(isBatchEligible({
      ...unsampledBatch,
      hasIsometricCredentials: false,
      methodBEligibility: { ...methodBEligibility, unsampledAllowed: false },
    })).toEqual({ eligible: false, message: connectionMessage });
  });

  it("accepts unsampled creation when Method B is met", () => {
    expect(isBatchEligible(unsampledBatch)).toEqual({ eligible: true });
  });

  it("accepts sampled creation without Isometric facts", () => {
    expect(isBatchEligible({ sampling: "sampled" })).toEqual({ eligible: true });
  });
});
