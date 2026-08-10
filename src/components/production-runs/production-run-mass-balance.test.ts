import { describe, expect, it } from "vitest";
import {
  feedstockWetStockOverdrawMessage,
  productionRunMassBalanceFeedback,
  WET_MASS_BALANCE_WARNING,
} from "./production-run-mass-balance";
import { DRY_MASS_BALANCE_MESSAGE } from "@/schemas/production-runs";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { isStockOverdraw } from "@/lib/stock-overdraw";

describe("productionRunMassBalanceFeedback", () => {
  it("accepts the exact wet balance, derives run dry mass, and rejects 0.001 kg more", () => {
    const availableWetKg = 3_000;

    expect(isStockOverdraw(3_000, availableWetKg)).toBe(false);
    expect(deriveMassDryKg(3_000, 20)).toBe(2_400);
    expect(isStockOverdraw(3_000.001, availableWetKg)).toBe(true);
    expect(isStockOverdraw(3_000.1, availableWetKg)).toBe(true);
    expect(feedstockWetStockOverdrawMessage(availableWetKg)).toBe(
      "Only 3,000 kg of wet feedstock is available. Reduce the wet mass.",
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
