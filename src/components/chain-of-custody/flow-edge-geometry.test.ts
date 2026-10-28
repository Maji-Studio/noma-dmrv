import { describe, expect, it } from "vitest";
import { FLOW_COLUMN_PITCH, FLOW_NODE_BOX_WIDTH, FLOW_NODE_SIZE } from "./chain-constants";
import { curvePointAtX, flowEdgePath, labelHeight, placeEdgeLabels, type LabelledEdge } from "./flow-edge-geometry";

const HALF = FLOW_NODE_SIZE / 2;
const columnX = (index: number) => index * FLOW_COLUMN_PITCH;
const gapCentre = (afterColumn: number) => columnX(afterColumn) + FLOW_COLUMN_PITCH / 2;
const TWO_LINES = "Wet: 1,000 kg · Dry: 450 kg";

function lit(id: string, from: [number, number], to: [number, number], text = TWO_LINES): LabelledEdge {
  const [sourceColumn, sourceY] = from;
  const [targetColumn, targetY] = to;
  return {
    id,
    source: `n${sourceColumn}:${sourceY}`,
    target: `n${targetColumn}:${targetY}`,
    sourceX: columnX(sourceColumn) + HALF,
    sourceY,
    targetX: columnX(targetColumn) - HALF,
    targetY,
    text,
  };
}

function overlaps(placed: Map<string, { x: number; y: number }>, edges: LabelledEdge[]) {
  const chips = edges.map((graphEdge) => ({ ...placed.get(graphEdge.id)!, h: labelHeight(graphEdge.text) }));
  return chips.some((chip, index) =>
    chips.some((other, otherIndex) =>
      otherIndex > index &&
      Math.abs(chip.x - other.x) < 1 &&
      Math.abs(chip.y - other.y) < (chip.h + other.h) / 2,
    ),
  );
}

describe("flowEdgePath", () => {
  it("draws a level-in, level-out cubic", () => {
    expect(flowEdgePath(10, 20, 110, 80)).toBe("M10,20 C60,20 60,80 110,80");
  });

  it("finds the curve's height at a given x", () => {
    expect(curvePointAtX(0, 0, 100, 100, 50).y).toBeCloseTo(50);
    expect(curvePointAtX(0, 0, 100, 100, 0).y).toBeCloseTo(0);
  });
});

describe("placeEdgeLabels", () => {
  it("labels a one-to-one hand-off in the gap after its source", () => {
    const edges = [lit("a", [0, 0], [1, 0])];
    expect(placeEdgeLabels(edges).get("a")).toEqual({ x: gapCentre(0), y: 0 });
  });

  it("keeps a branching fan that skips a column off the skipped column and apart", () => {
    // One group in column 0 feeding three runs in column 2, past column 1.
    const edges = [lit("a", [0, 0], [2, -64], "1,600 kg"), lit("b", [0, 0], [2, 0], "1,600 kg"), lit("c", [0, 0], [2, 64], "1,600 kg")];
    const placed = placeEdgeLabels(edges);

    for (const graphEdge of edges) {
      const { x } = placed.get(graphEdge.id)!;
      // In the gap before the targets, clear of column 1's record boxes.
      expect(x).toBeCloseTo(gapCentre(1));
      expect(Math.abs(x - columnX(1))).toBeGreaterThan(FLOW_NODE_BOX_WIDTH / 2);
    }
    expect(overlaps(placed, edges)).toBe(false);
    const ys = edges.map((graphEdge) => placed.get(graphEdge.id)!.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });

  it("pushes converging two-line chips apart when their sources sit close", () => {
    const edges = [lit("a", [0, -10], [1, 0]), lit("b", [0, 10], [1, 0])];
    const placed = placeEdgeLabels(edges);

    expect(overlaps(placed, edges)).toBe(false);
    expect(placed.get("a")!.x).toBeCloseTo(gapCentre(0));
  });

  it("puts a fan into two close targets in the gap before them, apart", () => {
    // One delivery to two applications one row apart.
    const edges = [lit("a", [0, 0], [1, -32]), lit("b", [0, 0], [1, 32])];
    expect(overlaps(placeEdgeLabels(edges), edges)).toBe(false);
  });
});
