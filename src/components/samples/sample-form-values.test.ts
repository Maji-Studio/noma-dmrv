import { describe, expect, it } from "vitest";
import {
  resolveSamplingClock,
  SAMPLE_CLEARABLE_NUMBER_FIELDS,
  SAMPLING_CLOCK_FAILED_HINT,
  SAMPLING_CLOCK_LOADING_HINT,
  SAMPLING_CLOCK_NO_BATCH_HINT,
  withClearedMeasurements,
} from "./sample-form-values";

describe("withClearedMeasurements", () => {
  it("sends an emptied hydrogen input as null so the update clears it", () => {
    // numericValue("") leaves undefined in form state; undefined means "keep" on update.
    const submitted = withClearedMeasurements({ totalCarbonPercent: 80, organicCarbonPercent: 75, totalHydrogenPercent: undefined });
    expect(submitted.totalHydrogenPercent).toBeNull();
  });

  it("clears every optional measurement and keeps entered values and other fields", () => {
    const submitted = withClearedMeasurements({ totalCarbonPercent: 80, organicCarbonPercent: 75, totalOxygenPercent: 4.2, labName: "" });
    expect(submitted).toMatchObject({ totalCarbonPercent: 80, organicCarbonPercent: 75, totalOxygenPercent: 4.2, labName: "" });
    for (const field of SAMPLE_CLEARABLE_NUMBER_FIELDS.filter((name) => name !== "totalOxygenPercent")) {
      expect(submitted).toHaveProperty(field, null);
    }
  });

  it("never clears the required carbon figures", () => {
    expect(SAMPLE_CLEARABLE_NUMBER_FIELDS).not.toContain("totalCarbonPercent");
    expect(SAMPLE_CLEARABLE_NUMBER_FIELDS).not.toContain("organicCarbonPercent");
  });
});

describe("resolveSamplingClock", () => {
  // A deep-linked sample: the context facility runs on UTC, the batch facility on Dar es Salaam time.
  const CONTEXT_ZONE = "UTC";
  const BATCH_ZONE = "Africa/Dar_es_Salaam";
  const BATCH_ID = "22222222-2222-4222-8222-222222222222";
  const cue = (zone: string) => `Facility time: ${zone}`;
  const clock = (lookup: "pending" | "error" | "success", batchTimeZone?: string | null, creditBatchId: string | null = BATCH_ID) =>
    resolveSamplingClock({ creditBatchId, lookup, batchTimeZone, placeholderTimeZone: CONTEXT_ZONE, cue });

  it("uses the batch facility zone once the lookup succeeds", () => {
    expect(clock("success", BATCH_ZONE)).toEqual({ ready: true, timeZone: BATCH_ZONE, hint: cue(BATCH_ZONE) });
  });

  it("blocks time entry while the batch zone loads, never trusting the context zone", () => {
    expect(clock("pending")).toEqual({ ready: false, timeZone: CONTEXT_ZONE, hint: SAMPLING_CLOCK_LOADING_HINT });
  });

  it("blocks time entry after a failed lookup or a lookup without a zone", () => {
    expect(clock("error")).toMatchObject({ ready: false, hint: SAMPLING_CLOCK_FAILED_HINT });
    expect(clock("success", null)).toMatchObject({ ready: false, hint: SAMPLING_CLOCK_FAILED_HINT });
  });

  it("asks for a credit batch before a time", () => {
    expect(clock("success", BATCH_ZONE, null)).toMatchObject({ ready: false, hint: SAMPLING_CLOCK_NO_BATCH_HINT });
  });
});
