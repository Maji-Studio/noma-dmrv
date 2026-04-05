export const KG_PER_TONNE = 1000;

export function tonnesToKg(value: number): number {
  return value * KG_PER_TONNE;
}

export function kgToTonnes(value: number): number {
  return value / KG_PER_TONNE;
}

/** Convert tonnes-per-hour (tph) to kg/h. Same scale factor as tonnesToKg. */
export function tphToKgPerHour(value: number): number {
  return value * KG_PER_TONNE;
}

/** Convert kg/h to tonnes-per-hour (tph). Same scale factor as kgToTonnes. */
export function kgPerHourToTph(value: number): number {
  return value / KG_PER_TONNE;
}
