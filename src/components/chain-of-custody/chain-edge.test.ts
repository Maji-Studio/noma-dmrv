import { describe, expect, it } from "vitest";
import { FLOW_COLUMN_PITCH, FLOW_NODE_SIZE } from "./chain-constants";
import { flowEdgePath } from "./chain-edge";

const GAP = FLOW_COLUMN_PITCH - FLOW_NODE_SIZE;

describe("flowEdgePath", () => {
  it("labels an edge between neighbouring columns at its midpoint", () => {
    const { labelX, labelY } = flowEdgePath(0, 0, GAP, 100);

    expect(labelX).toBeCloseTo(GAP / 2);
    expect(labelY).toBeCloseTo(50);
  });

  it("labels an edge that skips a column in the gap after its source", () => {
    const { labelX, labelY } = flowEdgePath(0, 0, GAP + FLOW_COLUMN_PITCH, 0);

    expect(labelX).toBeCloseTo(GAP / 2);
    expect(labelY).toBeCloseTo(0);
  });

  it("draws a level-in, level-out cubic", () => {
    expect(flowEdgePath(10, 20, 110, 80).path).toBe("M10,20 C60,20 60,80 110,80");
  });
});
