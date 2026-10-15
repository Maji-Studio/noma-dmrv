import { SafeError } from "@/lib/errors";
import { positiveOrNull } from "./transport-leg";
import { countedRoundTripKm } from "./round-trip";
import { kgToTonnes } from "./unit-conversions";

/** Already-attributed immutable wet loads, with current one-way delivery distances. */
export function calculateBiocharTransport(
  slices: readonly { loadMassKg: number; distanceKm: number }[],
): { massDistanceTonneKm: number; loadMassKg: number } {
  for (const slice of slices) {
    if (positiveOrNull(slice.distanceKm) == null) throw new SafeError("Biochar delivery has no positive transport distance. Record a distance before submitting.");
    if (positiveOrNull(slice.loadMassKg) == null) throw new SafeError("Biochar delivery has no positive application wet mass. Check its application allocation before submitting.");
  }
  return slices.reduce((total, slice) => ({
    loadMassKg: total.loadMassKg + slice.loadMassKg,
    massDistanceTonneKm: total.massDistanceTonneKm +
      kgToTonnes(slice.loadMassKg) * countedRoundTripKm(slice.distanceKm),
  }), { massDistanceTonneKm: 0, loadMassKg: 0 });
}
