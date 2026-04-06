export const KG_PER_TONNE = 1000;

export function tonnesToKg(value: number): number {
  return value * KG_PER_TONNE;
}

export function kgToTonnes(value: number): number {
  return value / KG_PER_TONNE;
}
