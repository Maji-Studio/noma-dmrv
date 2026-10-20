import type { SavedIngredientSolids, SubBinIngredient } from './sub-bin-ingredients';

/** One batch an entry moved: the layer (product or run) and the dry biochar it gave or took. */
export interface EntryDraw {
  layerId: string;
  dryMassKg: number;
}

/**
 * The ingredient solids one stock entry moved, by material, signed like the
 * stock change (positive into the bin). Each batch moves its ingredients in
 * the shares its product saved when it was made: dry biochar moved over the
 * product's dry biochar, times each saved line. When the entry's solids change
 * is on record, the ingredient total is that change less the dry biochar change
 * and the saved shares only split it, so the parts add up to the posted solids.
 * A biochar bin's runs have no saved lines, so the result is empty.
 * Presentation only: nothing posts from it.
 */
export function entryIngredientSolids({ dryChangeKg, solidsChangeKg, draws, productDryKg, saved }: {
  dryChangeKg: number;
  solidsChangeKg: number | null;
  draws: readonly EntryDraw[];
  productDryKg: ReadonlyMap<string, number>;
  saved: ReadonlyMap<string, readonly SavedIngredientSolids[]>;
}): SubBinIngredient[] {
  const weights = new Map<string, number>();
  for (const draw of draws) {
    const productDry = productDryKg.get(draw.layerId) ?? 0;
    if (productDry <= 0) continue;
    const share = Math.abs(draw.dryMassKg) / productDry;
    for (const line of saved.get(draw.layerId) ?? []) {
      if (line.drySolidsKg <= 0) continue;
      weights.set(line.name, (weights.get(line.name) ?? 0) + share * line.drySolidsKg);
    }
  }
  const weightKg = [...weights.values()].reduce((sum, kg) => sum + kg, 0);
  if (weightKg <= 0) return [];
  const totalKg = solidsChangeKg === null ? Math.sign(dryChangeKg) * weightKg : solidsChangeKg - dryChangeKg;
  return [...weights].map(([name, kg]) => ({ name, solidsKg: (totalKg * kg) / weightKg }));
}
