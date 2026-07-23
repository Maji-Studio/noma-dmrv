import { describe, expect, it } from "vitest";
import { canonicalizeFeedstockStockTake } from "./bin-stock-take";

describe("canonicalizeFeedstockStockTake", () => {
  it("rounds decimal half steps like PostgreSQL NUMERIC", () => {
    expect(canonicalizeFeedstockStockTake(0.5005, 0.0001245)).toEqual({
      countedWetMassKg: 0.501,
      moistureRatioUsed: 0.000125,
      countedMassKg: 0.501,
    });
    expect(
      canonicalizeFeedstockStockTake(0.001, 0.5).countedMassKg,
    ).toBe(0.001);
  });

  it("keeps the percent-based UI preview aligned with the server decision", () => {
    const countedWetMassKg = 1.0005;
    const moisturePercent = 0.01245;

    const preview = canonicalizeFeedstockStockTake(
      countedWetMassKg,
      moisturePercent / 100,
    );
    const server = canonicalizeFeedstockStockTake(
      preview.countedWetMassKg,
      preview.moistureRatioUsed,
    );

    expect(preview).toEqual({
      countedWetMassKg: 1.001,
      moistureRatioUsed: 0.000125,
      countedMassKg: 1.001,
    });
    expect(server).toEqual(preview);
  });
});
