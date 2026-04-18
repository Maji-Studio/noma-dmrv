import { tonnesToKg } from "./unit-conversions";

/**
 * Returns how many kg are still available on a delivery given the
 * total already applied. In edit mode, pass `existingApplicationTons`
 * so the current application's contribution is not double-counted.
 * Returns null when capacity is unknown (deliveredWetMassKg is null).
 */
export function calculateAvailableKg(
  capacityKg: number | null,
  alreadyAppliedTons: number,
  existingApplicationTons = 0,
): number | null {
  if (capacityKg == null) return null;
  return capacityKg - tonnesToKg(alreadyAppliedTons) + tonnesToKg(existingApplicationTons);
}

export interface CapacityCheckResult {
  ok: boolean;
  availableKg: number | null;
  errorMessage?: string;
}

/**
 * Validates that a requested application amount doesn't exceed what's
 * left on the delivery. Skips the check when capacity is unknown.
 */
export function checkDeliveryCapacity(opts: {
  capacityKg: number | null;
  alreadyAppliedTons: number;
  requestedTons: number;
  existingApplicationTons?: number;
}): CapacityCheckResult {
  const availableKg = calculateAvailableKg(
    opts.capacityKg,
    opts.alreadyAppliedTons,
    opts.existingApplicationTons ?? 0,
  );

  if (availableKg === null) return { ok: true, availableKg: null };

  const requestedKg = tonnesToKg(opts.requestedTons);
  if (requestedKg > availableKg) {
    const fmt = (n: number) =>
      n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return {
      ok: false,
      availableKg,
      errorMessage: `Cannot apply ${fmt(requestedKg)} kg: only ${fmt(availableKg)} kg available from this delivery`,
    };
  }

  return { ok: true, availableKg };
}
