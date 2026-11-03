/** Default precision shared by mass labels and displayed mass balances. */
export const MASS_KG_MAX_FRACTION_DIGITS = 1;

export const MASS_KG_FORMAT_OPTIONS = {
  maximumFractionDigits: MASS_KG_MAX_FRACTION_DIGITS,
} satisfies Intl.NumberFormatOptions;

const displayedMass = new Intl.NumberFormat("en-US", {
  ...MASS_KG_FORMAT_OPTIONS,
  useGrouping: false,
});

/** Match Intl label rounding, including decimal ties, without parsing a locale. */
export function roundDisplayedMassKg(kg: number): number {
  return Number(displayedMass.format(kg));
}
