import { describe, expect, it } from "vitest";
import { flowBarWidthPercent, flowScaleKg } from "./production-run-flow-scale";

describe("flow scale", () => {
  it("scales the lighter mass against the heavier one", () => {
    const scale = flowScaleKg(1000, 300);
    expect(flowBarWidthPercent(1000, scale)).toBe(100);
    expect(flowBarWidthPercent(300, scale)).toBeCloseTo(30, 5);
  });

  it("keeps a tiny mass visible and leaves unknown masses at full row", () => {
    expect(flowBarWidthPercent(1, 1000)).toBe(6);
    expect(flowBarWidthPercent(null, 1000)).toBeUndefined();
    expect(flowBarWidthPercent(300, flowScaleKg(null, null))).toBeUndefined();
  });
});
