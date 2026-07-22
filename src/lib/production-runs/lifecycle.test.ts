import { describe, expect, it } from "vitest";
import {
  assertProductionRunOutcome,
  assertProductionRunTransition,
  getProductionRunOutcomeViolations,
  shouldClearProductionRunEndTime,
  shouldIncludeProductionRunEndTime,
  type ProductionRunOutcomeInput,
} from "./lifecycle";

const START_TIME = new Date("2026-01-01T10:00:00Z");
const END_TIME = new Date("2026-01-01T11:00:00Z");

function makeOutcomeInput(
  overrides: Partial<ProductionRunOutcomeInput> = {},
): ProductionRunOutcomeInput {
  return {
    status: "complete",
    startTime: START_TIME,
    endTime: END_TIME,
    endTimePresent: true,
    cancellationReason: null,
    biocharOutputKg: 20,
    biocharMoisturePercent: 0,
    feedstockWetMassKg: 100,
    feedstockMoisturePercent: 20,
    feedstock: { basis: "consumed-mass", consumedFeedstockKg: 80 },
    ...overrides,
  };
}

describe("production-run lifecycle", () => {
  it.each([
    ["draft", "running"],
    ["draft", "cancelled"],
    ["running", "complete"],
    ["running", "failed"],
    ["complete", "running"],
    ["failed", "running"],
    ["cancelled", "cancelled"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(() => assertProductionRunTransition(from, to)).not.toThrow();
  });

  it.each([
    ["draft", "complete"],
    ["draft", "failed"],
    ["complete", "cancelled"],
    ["failed", "complete"],
    ["cancelled", "running"],
  ] as const)("rejects %s → %s", (from, to) => {
    expect(() => assertProductionRunTransition(from, to)).toThrow();
  });

  it.each(["complete", "failed"] as const)(
    "includes the displayed end time for running → %s when end fields are not dirty",
    (to) => {
      expect(
        shouldIncludeProductionRunEndTime({
          endFieldsTouched: false,
          from: "running",
          to,
        }),
      ).toBe(true);
    },
  );

  it.each(["complete", "failed"] as const)(
    "clears the saved end time when reopening a %s run",
    (from) => {
      expect(
        shouldClearProductionRunEndTime({
          from,
          to: "running",
          existingEndTime: new Date("2026-01-01T11:00:00Z"),
        }),
      ).toBe(true);
    },
  );

  it("does not clear an end time for a non-reopening update", () => {
    expect(
      shouldClearProductionRunEndTime({
        from: "complete",
        to: "complete",
        existingEndTime: new Date("2026-01-01T11:00:00Z"),
      }),
    ).toBe(false);
  });

  it.each(["complete", "failed"] as const)(
    "does not rewrite the end time when an existing %s run remains terminal",
    (status) => {
      expect(
        shouldIncludeProductionRunEndTime({
          endFieldsTouched: false,
          from: status,
          to: status,
        }),
      ).toBe(false);
    },
  );

  it("does not treat cancelled as an end-required outcome", () => {
    expect(
      shouldIncludeProductionRunEndTime({
        endFieldsTouched: false,
        from: "running",
        to: "cancelled",
      }),
    ).toBe(false);
  });

  it("continues to include touched end fields regardless of status", () => {
    expect(
      shouldIncludeProductionRunEndTime({
        endFieldsTouched: true,
        from: "running",
        to: "cancelled",
      }),
    ).toBe(true);
  });

  describe("getProductionRunOutcomeViolations", () => {
    it.each([
      [
        "an end at the start",
        { endTime: START_TIME },
        { code: "end-not-after-start" },
      ],
      [
        "a terminal run without an end",
        { status: "failed", endTime: null, endTimePresent: false },
        { code: "terminal-end-required", status: "failed" },
      ],
      [
        "a complete run without positive output",
        { biocharOutputKg: 0 },
        { code: "complete-output-required" },
      ],
      [
        "a terminal run without consumed feedstock",
        { feedstock: { basis: "consumed-mass", consumedFeedstockKg: 0 } },
        {
          code: "feedstock-required",
          status: "complete",
          basis: "consumed-mass",
        },
      ],
      [
        "a cancelled run without a reason",
        {
          status: "cancelled",
          endTime: null,
          endTimePresent: false,
          cancellationReason: "  ",
        },
        { code: "cancellation-reason-required" },
      ],
      [
        "a running run with an end",
        { status: "running" },
        { code: "running-end-forbidden" },
      ],
      [
        "dry output above dry input",
        { biocharOutputKg: 81 },
        { code: "dry-mass-balance-exceeded" },
      ],
    ] as const)("reports %s", (_label, overrides, expectedViolation) => {
      expect(getProductionRunOutcomeViolations(makeOutcomeInput(overrides))).toContainEqual(
        expectedViolation,
      );
    });

    it.each([
      {
        label: "source bin",
        formFeedstock: { storageLocationId: null },
        overrides: {},
      },
      {
        label: "wet mass",
        formFeedstock: { storageLocationId: "bin-id" },
        overrides: { feedstockWetMassKg: null },
      },
      {
        label: "moisture",
        formFeedstock: { storageLocationId: "bin-id" },
        overrides: { feedstockMoisturePercent: null },
      },
    ] as const)("reports missing form-input feedstock when $label is absent", ({
      formFeedstock,
      overrides,
    }) => {
      const violations = getProductionRunOutcomeViolations(
        makeOutcomeInput({
          feedstock: { basis: "form-inputs", ...formFeedstock },
          ...overrides,
        }),
      );

      expect(violations).toContainEqual({
        code: "feedstock-required",
        status: "complete",
        basis: "form-inputs",
      });
    });

    it("distinguishes form inputs from allocated consumption", () => {
      const formInput = makeOutcomeInput({
        feedstock: { basis: "form-inputs", storageLocationId: null },
      });
      const consumedMassInput = makeOutcomeInput({
        feedstock: { basis: "consumed-mass", consumedFeedstockKg: 80 },
      });

      expect(getProductionRunOutcomeViolations(formInput)).toContainEqual(
        expect.objectContaining({ code: "feedstock-required", basis: "form-inputs" }),
      );
      expect(getProductionRunOutcomeViolations(consumedMassInput)).not.toContainEqual(
        expect.objectContaining({ code: "feedstock-required" }),
      );
    });

    it("returns every violation in stable form-issue order", () => {
      const violations = getProductionRunOutcomeViolations(
        makeOutcomeInput({
          status: "complete",
          endTime: null,
          endTimePresent: false,
          biocharOutputKg: 0,
          feedstock: { basis: "consumed-mass", consumedFeedstockKg: 0 },
        }),
      );

      expect(violations).toEqual([
        { code: "terminal-end-required", status: "complete" },
        { code: "complete-output-required" },
        {
          code: "feedstock-required",
          status: "complete",
          basis: "consumed-mass",
        },
      ]);
    });

    it.each([
      makeOutcomeInput(),
      makeOutcomeInput({ status: "draft", endTime: null, endTimePresent: false }),
      makeOutcomeInput({ status: "running", endTime: null, endTimePresent: false }),
      makeOutcomeInput({
        status: "cancelled",
        endTime: null,
        endTimePresent: false,
        cancellationReason: "operator error",
      }),
      makeOutcomeInput({ status: "failed", biocharOutputKg: null }),
    ])("accepts a valid $status outcome", (input) => {
      expect(getProductionRunOutcomeViolations(input)).toEqual([]);
    });
  });

  describe("assertProductionRunOutcome", () => {
    it.each([
      [{ feedstock: { basis: "consumed-mass", consumedFeedstockKg: 0 } }, "must consume feedstock"],
      [{ biocharOutputKg: 0 }, "positive biochar output"],
      [{ endTime: null, endTimePresent: false }, "needs an end time"],
      [{ status: "running" }, "cannot have an end time"],
      [
        {
          status: "cancelled",
          endTime: null,
          endTimePresent: false,
          cancellationReason: "  ",
        },
        "cancellation reason",
      ],
      [{ biocharOutputKg: 81 }, "Dry biochar output cannot exceed dry feedstock input"],
    ] as const)("maps a violation to SafeError: %s", (overrides, message) => {
      expect(() => assertProductionRunOutcome(makeOutcomeInput(overrides))).toThrow(message);
    });

    it("preserves mutation priority when several rules fail", () => {
      expect(() =>
        assertProductionRunOutcome(
          makeOutcomeInput({
            status: "cancelled",
            cancellationReason: null,
            biocharOutputKg: 81,
          }),
        ),
      ).toThrow("Dry biochar output cannot exceed dry feedstock input");
    });

    it("permits failed output to be absent", () => {
      expect(() =>
        assertProductionRunOutcome(
          makeOutcomeInput({ status: "failed", biocharOutputKg: null }),
        ),
      ).not.toThrow();
    });
  });
});
