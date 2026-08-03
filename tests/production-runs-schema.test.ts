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

const completeProductionRunInput = {
  ...validProductionRunInput,
  status: "complete" as const,
  endDate: "2026-07-15",
  endTime: "12:00",
  biocharOutputKg: 10,
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

describe("productionRunFormSchema terminal feedstock requirements", () => {
  it.each([
    {
      label: "source bin",
      overrides: { feedstockStorageLocationId: null },
      path: ["feedstockStorageLocationId"],
      message: "Select a source bin.",
    },
    {
      label: "wet mass",
      overrides: { feedstockWetMassKg: null },
      path: ["feedstockWetMassKg"],
      message: "Enter feedstock wet mass.",
    },
    {
      label: "moisture",
      overrides: { feedstockMoisturePercent: null },
      path: ["feedstockMoisturePercent"],
      message: "Enter feedstock moisture.",
    },
  ])("points a missing $label requirement at its own field", ({
    overrides,
    path,
    message,
  }) => {
    const result = productionRunFormSchema.safeParse({
      ...completeProductionRunInput,
      ...overrides,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path, message }),
      );
      expect(result.error.issues).not.toContainEqual(
        expect.objectContaining({
          message:
            "A complete run needs a source bin, moisture %, and wet mass to compute consumed feedstock.",
        }),
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
            message: expect.stringMatching(/End time must be after start time/),
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
  const afterDstFixtures = () => new Date("2026-12-01T00:00:00.000Z");
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
    const result = makeProductionRunFormSchema(
      NEW_YORK,
      afterDstFixtures,
    ).safeParse({
      ...completeRun,
      startDate: "2026-03-08",
      startTime: "02:30",
      endDate: "2026-03-08",
      endTime: "04:00",
    });

    expect(result.success).toBe(false);
    expect(messagesFor(result, "startTime")).toEqual([
      "02:30 does not exist on 2026-03-08 in America/New York. Clocks move" +
        " forward that day. Enter a time outside the skipped hour.",
    ]);
    // Exactly one message, on the field the operator typed into: an unresolved
    // start must not also fire "End must be after start" or the terminal-run
    // "needs an end date and time" check.
    expect(messagesFor(result, "endTime")).toEqual([]);
  });

  it("rejects an end inside the spring-forward gap, on the end field", () => {
    process.env.TZ = "Africa/Dar_es_Salaam";
    const result = makeProductionRunFormSchema(
      NEW_YORK,
      afterDstFixtures,
    ).safeParse({
      ...completeRun,
      startDate: "2026-03-08",
      startTime: "01:30",
      endDate: "2026-03-08",
      endTime: "02:30",
    });

    expect(result.success).toBe(false);
    expect(messagesFor(result, "endTime")).toEqual([
      "02:30 does not exist on 2026-03-08 in America/New York. Clocks move" +
        " forward that day. Enter a time outside the skipped hour.",
    ]);
    expect(messagesFor(result, "startTime")).toEqual([]);
  });

  it("rejects an ambiguous fall-back wall clock on its own field", () => {
    process.env.TZ = "Europe/Zurich";
    const result = makeProductionRunFormSchema(
      NEW_YORK,
      afterDstFixtures,
    ).safeParse({
      ...completeRun,
      startDate: "2026-11-01",
      startTime: "01:30",
      endDate: "2026-11-01",
      endTime: "03:00",
    });

    expect(result.success).toBe(false);
    expect(messagesFor(result, "startTime")).toEqual([
      "01:30 occurs twice on 2026-11-01 in America/New York. Clocks move" +
        " back that day. Enter a time outside the repeated hour.",
    ]);
    expect(messagesFor(result, "endTime")).toEqual([]);
  });

  it("leaves a run at a facility without DST unaffected", () => {
    process.env.TZ = "America/New_York";
    const result = makeProductionRunFormSchema(
      "Africa/Dar_es_Salaam",
      afterDstFixtures,
    ).safeParse({
      ...completeRun,
      startDate: "2026-03-08",
      startTime: "02:30",
      endDate: "2026-03-08",
      endTime: "04:00",
    });

    expect(result.success).toBe(true);
  });
});

describe("makeProductionRunFormSchema future instant boundary", () => {
  const NOW = new Date("2026-07-15T12:00:00.000Z");
  const fixedClock = () => NOW;
  const completeRun = {
    ...validProductionRunInput,
    status: "complete" as const,
    biocharOutputKg: 10,
    biocharMoisturePercent: 5,
  };

  it("accepts an exact-now start at a facility ahead of UTC", () => {
    const result = makeProductionRunFormSchema(
      "Pacific/Kiritimati",
      fixedClock,
    ).safeParse({
      ...validProductionRunInput,
      biocharOutputKg: 10,
      startDate: "2026-07-16",
      startTime: "02:00",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a future start at a facility ahead of UTC", () => {
    const result = makeProductionRunFormSchema(
      "Pacific/Kiritimati",
      fixedClock,
    ).safeParse({
      ...validProductionRunInput,
      biocharOutputKg: 10,
      startDate: "2026-07-16",
      startTime: "02:01",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["startTime"],
            message:
              "Start time cannot be in the future. Enter a time at or before now.",
          }),
        ]),
      );
    }
  });

  it("accepts an exact-now end at a facility behind UTC", () => {
    const result = makeProductionRunFormSchema(
      "America/Los_Angeles",
      fixedClock,
    ).safeParse({
      ...completeRun,
      startDate: "2026-07-15",
      startTime: "04:00",
      endDate: "2026-07-15",
      endTime: "05:00",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a future end at a facility behind UTC", () => {
    const result = makeProductionRunFormSchema(
      "America/Los_Angeles",
      fixedClock,
    ).safeParse({
      ...completeRun,
      startDate: "2026-07-15",
      startTime: "04:00",
      endDate: "2026-07-15",
      endTime: "05:01",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["endTime"],
            message:
              "End time cannot be in the future. Enter a time at or before now.",
          }),
        ]),
      );
    }
  });
});

describe("productionRunFilterSchema", () => {
  it("accepts a credit-batch deep-link filter", () => {
    const creditBatchId = "55555555-5555-4555-8555-555555555555";
    const result = productionRunFilterSchema.parse({ creditBatchId });

    expect(result.creditBatchId).toBe(creditBatchId);
  });
});
