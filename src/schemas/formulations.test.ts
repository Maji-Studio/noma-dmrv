import { describe, expect, it } from "vitest";
import {
  createFormulationSchema,
  exceedsFormulationRatioSum,
  formulationRatioSum,
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
