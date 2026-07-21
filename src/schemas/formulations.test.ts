import { describe, expect, it } from "vitest";
import {
  createFormulationSchema,
  exceedsFormulationRatioSum,
  formulationPercentSum,
  formulationPercentFormSchema,
  formulationRatioSum,
  percentFormToRatioPayload,
  percentToRatio,
  ratioToPercent,
  updateFormulationSchema,
} from "./formulations";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("formulationRatioSum", () => {
  it("treats missing ratios as zero", () => {
    expect(formulationRatioSum(null, null)).toBe(0);
    expect(formulationRatioSum(undefined, undefined)).toBe(0);
    expect(formulationRatioSum(0.5, [{ ratio: null }])).toBe(0.5);
  });

  it("sums biochar and ingredient ratios", () => {
    expect(
      formulationRatioSum(0.7, [{ ratio: 0.2 }, { ratio: 0.1 }]),
    ).toBeCloseTo(1, 10);
  });
});

describe("exceedsFormulationRatioSum", () => {
  it("is false at or below 100%", () => {
    expect(exceedsFormulationRatioSum(0.7, [{ ratio: 0.3 }])).toBe(false);
    expect(exceedsFormulationRatioSum(0.5, [{ ratio: 0.4 }])).toBe(false);
  });

  it("absorbs floating-point artifacts within tolerance", () => {
    // 0.7 + 0.1 + 0.2 drifts to 1.0000000000000002 in float math — not a real
    // over-allocation, so the tolerance must swallow it.
    expect(
      exceedsFormulationRatioSum(0.7, [{ ratio: 0.1 }, { ratio: 0.2 }]),
    ).toBe(false);
  });

  it("is true when the blend is over-allocated", () => {
    expect(exceedsFormulationRatioSum(0.7, [{ ratio: 0.6 }])).toBe(true);
    expect(exceedsFormulationRatioSum(1, [{ ratio: 0.01 }])).toBe(true);
  });
});

describe("formulation schema ratio-sum refinement", () => {
  const base = { name: "Test blend" };

  it("rejects a blend summing to more than 100%", () => {
    const result = createFormulationSchema.safeParse({
      ...base,
      biocharRatio: 0.7,
      ingredients: [{ feedstockTypeId: UUID, ratio: 0.6 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.path.includes("biocharRatio"),
        ),
      ).toBe(true);
    }
  });

  it("accepts a blend summing to exactly 100%", () => {
    const result = createFormulationSchema.safeParse({
      ...base,
      biocharRatio: 0.7,
      ingredients: [{ feedstockTypeId: UUID, ratio: 0.3 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an incomplete blend under 100% (warn, not block)", () => {
    const result = createFormulationSchema.safeParse({
      ...base,
      biocharRatio: 0.4,
      ingredients: [{ feedstockTypeId: UUID, ratio: 0.2 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an over-allocated update payload", () => {
    const result = updateFormulationSchema.safeParse({
      formulationId: UUID,
      biocharRatio: 0.9,
      ingredients: [{ feedstockTypeId: UUID, ratio: 0.5 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.path.includes("biocharRatio"),
        ),
      ).toBe(true);
    }
  });
});

describe("percent ⇄ ratio conversion", () => {
  it("converts and round-trips cleanly at numeric(7,6) precision", () => {
    expect(percentToRatio(70)).toBe(0.7);
    expect(ratioToPercent(0.7)).toBe(70);
    expect(percentToRatio(33.33)).toBe(0.3333);
    expect(ratioToPercent(0.3333)).toBe(33.33);
    // The classic float trap: 0.07 * 100 = 7.000000000000001 without rounding.
    expect(ratioToPercent(0.07)).toBe(7);
    expect(ratioToPercent(percentToRatio(12.34))).toBe(12.34);
  });

  it("is null-safe", () => {
    expect(percentToRatio(null)).toBeNull();
    expect(percentToRatio(undefined)).toBeNull();
    expect(ratioToPercent(null)).toBeNull();
    expect(ratioToPercent(Number.NaN)).toBeNull();
  });
});

describe("formulationPercentSum", () => {
  it("sums biochar and ingredient shares, missing as zero", () => {
    expect(formulationPercentSum(null, null)).toBe(0);
    expect(
      formulationPercentSum(70, [{ sharePercent: 20 }, { sharePercent: null }]),
    ).toBe(90);
  });
});

describe("formulationPercentFormSchema", () => {
  const base = { name: "Percent blend" };

  it("accepts a fully allocated blend and coerces form strings", () => {
    const result = formulationPercentFormSchema.safeParse({
      ...base,
      biocharPercent: "70",
      ingredients: [{ feedstockTypeId: UUID, sharePercent: "30" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.biocharPercent).toBe(70);
      expect(result.data.ingredients?.[0]?.sharePercent).toBe(30);
    }
  });

  it("rejects an over-allocated blend on the biocharPercent path", () => {
    const result = formulationPercentFormSchema.safeParse({
      ...base,
      biocharPercent: 70,
      ingredients: [{ feedstockTypeId: UUID, sharePercent: 60 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.path.includes("biocharPercent"),
        ),
      ).toBe(true);
    }
  });

  it("rejects shares outside 0–100", () => {
    expect(
      formulationPercentFormSchema.safeParse({
        ...base,
        biocharPercent: 101,
      }).success,
    ).toBe(false);
    expect(
      formulationPercentFormSchema.safeParse({
        ...base,
        biocharPercent: 50,
        ingredients: [{ feedstockTypeId: UUID, sharePercent: -1 }],
      }).success,
    ).toBe(false);
  });

  it("accepts an under-allocated blend (rest is unallocated, not an error)", () => {
    const result = formulationPercentFormSchema.safeParse({
      ...base,
      biocharPercent: 40,
      ingredients: [{ feedstockTypeId: UUID, sharePercent: 20 }],
    });
    expect(result.success).toBe(true);
  });
});

describe("percentFormToRatioPayload", () => {
  it("maps percent entry to the ratio-based server contract", () => {
    const payload = percentFormToRatioPayload({
      name: "Blend",
      biocharPercent: 70,
      description: "",
      ingredients: [{ feedstockTypeId: UUID, sharePercent: 30 }],
    });
    expect(payload.biocharRatio).toBe(0.7);
    expect(payload.ingredients).toEqual([
      { feedstockTypeId: UUID, ratio: 0.3 },
    ]);
    expect(createFormulationSchema.safeParse(payload).success).toBe(true);
  });

  it("keeps empty shares null", () => {
    const payload = percentFormToRatioPayload({
      name: "Blend",
      biocharPercent: null,
      description: undefined,
      ingredients: [{ feedstockTypeId: UUID, sharePercent: null }],
    });
    expect(payload.biocharRatio).toBeNull();
    expect(payload.ingredients?.[0]?.ratio).toBeNull();
  });
});
