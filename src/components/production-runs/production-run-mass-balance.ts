import {
  dryOutputExceedsDryInput,
  exceedsMassWithTolerance,
} from "@/lib/calculations/mass-dry";
import { DRY_MASS_BALANCE_MESSAGE } from "@/lib/production-runs/lifecycle";
import { formatStockKg } from "@/lib/stock-overdraw";

export const WET_MASS_BALANCE_WARNING =
  "Wet output exceeds wet input. Review the masses before continuing.";

interface ProductionRunMassBalanceInput {
  feedstockWetMassKg: unknown;
  feedstockMoisturePercent: unknown;
  biocharOutputKg: unknown;
  biocharMoisturePercent: unknown;
}

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function feedstockDryStockOverdrawMessage(
  availableDryKg: number,
  moisturePercent: number,
): string {
  const maximumWetKg = availableDryKg / (1 - moisturePercent / 100);
  return `Only ${formatStockKg(availableDryKg)} of dry feedstock is available. At ${moisturePercent.toLocaleString()}% moisture, enter at most ${formatStockKg(maximumWetKg)} wet mass.`;
}

export function productionRunMassBalanceFeedback(
  input: ProductionRunMassBalanceInput,
): { wetWarning?: string; dryError?: string } {
  const feedstockWetMassKg = numberOrNull(input.feedstockWetMassKg);
  const feedstockMoisturePercent = numberOrNull(
    input.feedstockMoisturePercent,
  );
  const biocharOutputKg = numberOrNull(input.biocharOutputKg);
  const biocharMoisturePercent = numberOrNull(input.biocharMoisturePercent);

  const inputsCanDeriveDryMass =
    feedstockWetMassKg !== null &&
    feedstockWetMassKg >= 0 &&
    feedstockMoisturePercent !== null &&
    feedstockMoisturePercent >= 0 &&
    feedstockMoisturePercent <= 100 &&
    biocharOutputKg !== null &&
    biocharOutputKg >= 0 &&
    biocharMoisturePercent !== null &&
    biocharMoisturePercent >= 0 &&
    biocharMoisturePercent <= 100;

  const wetWarning =
    feedstockWetMassKg !== null &&
    biocharOutputKg !== null &&
    feedstockWetMassKg >= 0 &&
    biocharOutputKg >= 0 &&
    exceedsMassWithTolerance(biocharOutputKg, feedstockWetMassKg)
      ? WET_MASS_BALANCE_WARNING
      : undefined;
  const dryError = inputsCanDeriveDryMass && dryOutputExceedsDryInput({
    feedstockWetMassKg,
    feedstockMoisturePercent,
    biocharOutputKg,
    biocharMoisturePercent,
  })
    ? DRY_MASS_BALANCE_MESSAGE
    : undefined;

  return { wetWarning, dryError };
}
