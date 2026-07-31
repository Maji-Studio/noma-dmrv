import { describe, expect, it } from "vitest";
import {
  feedstockDryStockOverdrawMessage,
  productionRunMassBalanceFeedback,
  WET_MASS_BALANCE_WARNING,
} from "./production-run-mass-balance";
import { DRY_MASS_BALANCE_MESSAGE } from "@/schemas/production-runs";

describe("productionRunMassBalanceFeedback", () => {
  it("labels dry availability and gives the equivalent wet-mass limit", () => {
    expect(feedstockDryStockOverdrawMessage(100, 20)).toBe(
      "Only 100 kg of dry feedstock is available. At 20% moisture, enter at most 125 kg wet mass.",
    );
  });

  it("warns immediately when wet output exceeds wet input", () => {
    expect(
      productionRunMassBalanceFeedback({
        feedstockWetMassKg: 1_000,
        feedstockMoisturePercent: 20,
        biocharOutputKg: 20_000,
        biocharMoisturePercent: null,
      }),
    ).toEqual({ wetWarning: WET_MASS_BALANCE_WARNING });
  });

  it("returns the authoritative dry error once both moistures are known", () => {
    expect(
      productionRunMassBalanceFeedback({
        feedstockWetMassKg: 1_000,
        feedstockMoisturePercent: 20,
        biocharOutputKg: 20_000,
        biocharMoisturePercent: 1.5,
      }),
    ).toEqual({
      wetWarning: WET_MASS_BALANCE_WARNING,
      dryError: DRY_MASS_BALANCE_MESSAGE,
    });
  });

  it("catches a dry violation even when wet output is lower than wet input", () => {
    expect(
      productionRunMassBalanceFeedback({
        feedstockWetMassKg: 1_000,
        feedstockMoisturePercent: 50,
        biocharOutputKg: 600,
        biocharMoisturePercent: 0,
      }),
    ).toEqual({ dryError: DRY_MASS_BALANCE_MESSAGE });
  });

  it("clears both messages when the balance is valid", () => {
    expect(
      productionRunMassBalanceFeedback({
        feedstockWetMassKg: 1_000,
        feedstockMoisturePercent: 20,
        biocharOutputKg: 500,
        biocharMoisturePercent: 1.5,
      }),
    ).toEqual({});
  });

  it.each([
    { feedstockWetMassKg: -1, feedstockMoisturePercent: 20 },
    { feedstockWetMassKg: 100, feedstockMoisturePercent: 101 },
    { biocharOutputKg: -1, biocharMoisturePercent: 20 },
    { biocharOutputKg: 100, biocharMoisturePercent: 101 },
  ])("defers dry-balance feedback for invalid field input %#", (invalid) => {
    expect(() =>
      productionRunMassBalanceFeedback({
        feedstockWetMassKg: 1_000,
        feedstockMoisturePercent: 20,
        biocharOutputKg: 500,
        biocharMoisturePercent: 10,
        ...invalid,
      }),
    ).not.toThrow();
  });
});
