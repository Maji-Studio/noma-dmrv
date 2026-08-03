import { describe, expect, it } from "vitest";
import {
  biocharProductBinStockChanged,
  deriveBiocharProductTotalMassChange,
} from "./biochar-product-stock-locks";

describe("biochar product stock updates", () => {
  it("treats a water-only edit as a product-bin stock change", () => {
    expect(
      biocharProductBinStockChanged(
        {
          massKg: 100,
          waterAddedKg: 50,
          storageLocationId: "product-bin-1",
        },
        { waterAddedKg: 40 },
      ),
    ).toBe(true);
  });

  it("compares reductions on the blended mass and water basis", () => {
    expect(
      deriveBiocharProductTotalMassChange(
        { massKg: 100, waterAddedKg: 50 },
        { massKg: 90, waterAddedKg: 40 },
      ),
    ).toEqual({
      previousTotalMassKg: 150,
      transactionTotalMassKg: 130,
      massFieldsChanged: true,
      isReduction: true,
    });

    expect(
      deriveBiocharProductTotalMassChange(
        { massKg: 100, waterAddedKg: 50 },
        { massKg: 110 },
      ),
    ).toMatchObject({
      previousTotalMassKg: 150,
      transactionTotalMassKg: 160,
      isReduction: false,
    });
  });

  it("reads an explicitly cleared water field as a reduction to zero", () => {
    expect(
      deriveBiocharProductTotalMassChange(
        { massKg: 100, waterAddedKg: 50 },
        { waterAddedKg: null },
      ),
    ).toMatchObject({
      previousTotalMassKg: 150,
      transactionTotalMassKg: 100,
      massFieldsChanged: true,
      isReduction: true,
    });
  });
});
