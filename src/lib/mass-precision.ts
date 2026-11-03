/** Default precision shared by mass labels and displayed mass balances. */
export const MASS_KG_MAX_FRACTION_DIGITS = 1;

const displayedMass = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: MASS_KG_MAX_FRACTION_DIGITS,
  useGrouping: false,
});

/** Match Intl label rounding, including decimal ties, without parsing a locale. */
export function roundDisplayedMassKg(kg: number): number {
  return Number(displayedMass.format(kg));
}
