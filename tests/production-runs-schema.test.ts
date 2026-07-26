import { afterEach, describe, expect, it } from "vitest";
import {
  makeProductionRunFormSchema,
  productionRunFilterSchema,
  productionRunFormSchema,
} from "@/schemas/production-runs";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

const validProductionRunInput = {
  facilityId: "11111111-1111-4111-8111-111111111111",
  reactorId: "22222222-2222-4222-8222-222222222222",
  status: "running" as const,
  cancellationReason: "",
  startDate: "2026-07-15",
  startTime: "08:00",
  feedstockStorageLocationId: "33333333-3333-4333-8333-333333333333",
  biocharStorageLocationId: "44444444-4444-4444-8444-444444444444",
  feedstockWetMassKg: 100,
  feedstockMoisturePercent: 20,
  biocharOutputKg: 100,
  biocharMoisturePercent: 5,
};

describe("productionRunFormSchema mass balance", () => {
  it("rejects dry biochar output above dry feedstock input", () => {
    const result = productionRunFormSchema.safeParse(validProductionRunInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharOutputKg"],
            message: expect.stringMatching(/dry.*output.*dry.*input/i),
          }),
        ]),
      );
    }
  });

  it("allows dry output equal to dry input within the mass epsilon", () => {
    const result = productionRunFormSchema.safeParse({
      ...validProductionRunInput,
      biocharOutputKg: 80.001,
      biocharMoisturePercent: 0,
    });

    expect(result.success).toBe(true);
  });

  it("rejects mass and moisture precision that storage would round", () => {
    const result = productionRunFormSchema.safeParse({
      ...validProductionRunInput,
      feedstockWetMassKg: 100.0001,
      feedstockMoisturePercent: 20.1234567,
      biocharOutputKg: 80,
      biocharMoisturePercent: 0,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["feedstockWetMassKg"] }),
          expect.objectContaining({ path: ["feedstockMoisturePercent"] }),
        ]),
      );
    }
  });
});

// QA F-2 — the form's start/end cross-field checks must resolve the entered
// wall clock in the FACILITY's zone, matching what the submit path writes with
// `combineDateAndTime`. Resolving in the browser's zone instead lets the two
// disagree across a DST boundary only the browser's zone observes: on Zurich's
// spring-forward night the nonexistent local 02:30 rolls to 03:30, so a
// 02:30 → 03:30 run at a UTC+3 plant (no DST) is rejected as "end not after
// start" even though the instants it would save are an hour apart.
describe("makeProductionRunFormSchema timezone binding", () => {
  const springForwardRun = {
    ...validProductionRunInput,
    status: "complete" as const,
    startDate: "2026-03-29",
    startTime: "02:30",
    endDate: "2026-03-29",
    endTime: "03:30",
    biocharOutputKg: 10,
    biocharMoisturePercent: 5,
  };

  it("accepts a run that only exists in the facility's zone", () => {
    process.env.TZ = "Europe/Zurich";
    const result = makeProductionRunFormSchema("Africa/Dar_es_Salaam").safeParse(
      springForwardRun,
    );

    expect(result.success).toBe(true);
  });

  it("still rejects an end that is not after the start in the facility's zone", () => {
    process.env.TZ = "UTC";
    const result = makeProductionRunFormSchema("Africa/Dar_es_Salaam").safeParse({
      ...springForwardRun,
      endTime: "02:30",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["endTime"],
            message: expect.stringMatching(/End must be after start/),
          }),
        ]),
      );
    }
  });
});

// A wall clock inside the facility's spring-forward gap never happened, so the
// schema must refuse it by name instead of letting the submit path silently
// store the hour next door — that window clips the telemetry CSV and, via the
// end time, sets the registry `measured_at` datapoint.
describe("makeProductionRunFormSchema DST gap and fold", () => {
  const NEW_YORK = "America/New_York"; // forward 2026-03-08, back 2026-11-01
  const completeRun = {
    ...validProductionRunInput,
    status: "complete" as const,
    biocharOutputKg: 10,
    biocharMoisturePercent: 5,
  };
  const messagesFor = (
    result: ReturnType<ReturnType<typeof makeProductionRunFormSchema>["safeParse"]>,
    field: string,
  ) =>
    result.success
      ? []
      : result.error.issues
          .filter((issue) => issue.path.join(".") === field)
          .map((issue) => issue.message);

  it("rejects a start inside the spring-forward gap, naming the gap", () => {
    process.env.TZ = "UTC";
    const result = makeProductionRunFormSchema(NEW_YORK).safeParse({
      ...completeRun,
      startDate: "2026-03-08",
      startTime: "02:30",
      endDate: "2026-03-08",
      endTime: "04:00",
    });

    expect(result.success).toBe(false);
    expect(messagesFor(result, "startTime")).toEqual([
      "02:30 does not exist on 2026-03-08 in America/New York — clocks move" +
        " forward that day. Enter a time outside the skipped hour.",
    ]);
    // Exactly one message, on the field the operator typed into: an unresolved
    // start must not also fire "End must be after start" or the terminal-run
    // "needs an end date and time" check.
    expect(messagesFor(result, "endTime")).toEqual([]);
  });

  it("rejects an end inside the spring-forward gap, on the end field", () => {
    process.env.TZ = "Africa/Dar_es_Salaam";
    const result = makeProductionRunFormSchema(NEW_YORK).safeParse({
      ...completeRun,
      startDate: "2026-03-08",
      startTime: "01:30",
      endDate: "2026-03-08",
      endTime: "02:30",
    });

    expect(result.success).toBe(false);
    expect(messagesFor(result, "endTime")).toEqual([
      "02:30 does not exist on 2026-03-08 in America/New York — clocks move" +
        " forward that day. Enter a time outside the skipped hour.",
    ]);
    expect(messagesFor(result, "startTime")).toEqual([]);
  });

  // The fold is the opposite call: 01:30 happens twice on 2026-11-01, and both
  // occurrences are legitimate operating time, so the run is accepted and the
  // earlier instant is used (see `combineDateAndTime`).
  it("accepts an ambiguous fall-back wall clock", () => {
    process.env.TZ = "Europe/Zurich";
    const result = makeProductionRunFormSchema(NEW_YORK).safeParse({
      ...completeRun,
      startDate: "2026-11-01",
      startTime: "01:30",
      endDate: "2026-11-01",
      endTime: "03:00",
    });

    expect(result.success).toBe(true);
  });

  it("leaves a run at a facility without DST unaffected", () => {
    process.env.TZ = "America/New_York";
    const result = makeProductionRunFormSchema("Africa/Dar_es_Salaam").safeParse({
      ...completeRun,
      startDate: "2026-03-08",
      startTime: "02:30",
      endDate: "2026-03-08",
      endTime: "04:00",
    });

    expect(result.success).toBe(true);
  });
});

describe("productionRunFilterSchema", () => {
  it("accepts a credit-batch deep-link filter", () => {
    const creditBatchId = "55555555-5555-4555-8555-555555555555";
    const result = productionRunFilterSchema.parse({ creditBatchId });

    expect(result.creditBatchId).toBe(creditBatchId);
  });
});
