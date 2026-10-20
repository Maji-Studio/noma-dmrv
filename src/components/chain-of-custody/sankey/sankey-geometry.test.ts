import { describe, expect, it } from "vitest";
import {
  EXIT_AREA_TOP,
  EXIT_BOTTOM_PADDING,
  EXIT_ROW_H,
  exitRowTop,
  sankeyViewHeight,
} from "./sankey-geometry";

const exit = (fromColumn: "productionRuns" | "biocharLots") => ({ fromColumn });

describe("sankeyViewHeight", () => {
  it("keeps the canvas for batches with up to two exits in a column", () => {
    expect(sankeyViewHeight([])).toBe(500);
    expect(sankeyViewHeight([exit("productionRuns"), exit("biocharLots")])).toBe(500);
    expect(sankeyViewHeight([exit("productionRuns"), exit("productionRuns")])).toBe(500);
  });

  it("grows by one row height per extra exit row so the last row is not clipped", () => {
    const exits = [exit("productionRuns"), exit("productionRuns"), exit("productionRuns")];
    const height = sankeyViewHeight(exits);
    expect(height).toBe(500 + EXIT_ROW_H);
    expect(exitRowTop(exits.length - 1) + EXIT_ROW_H + EXIT_BOTTOM_PADDING).toBe(height);
  });

  it("starts the first exit row at the shared area top", () => {
    expect(exitRowTop(0)).toBe(EXIT_AREA_TOP);
  });
});
