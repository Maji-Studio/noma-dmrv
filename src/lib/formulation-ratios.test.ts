import { describe, expect, it } from "vitest";
import { exceedsFormulationRatioSum } from "./formulation-ratios";

describe("formulation integer millionths", () => {
  it.each([
    [0.7, [0.2, 0.1], false],
    [0.333333, [0.333333, 0.333334], false],
    [0.333334, [0.333333, 0.333334], true],
    [1, [0.000001], true],
  ])("checks %s plus %s", (biochar, ratios, exceeds) => {
    expect(exceedsFormulationRatioSum(biochar, ratios.map(ratio => ({ ratio })))).toBe(exceeds);
  });
  it("treats missing shares as zero", () => {
    expect(exceedsFormulationRatioSum(null, [{ ratio: null }, {}])).toBe(false);
  });
});
