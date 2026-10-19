/** One ingredient's dry solids in a sub-bin or batch, named by the material it is. */
export interface SubBinIngredient {
  name: string;
  solidsKg: number;
}

/** An ingredient line a product saved when it was created: its material and dry solids then. */
export interface SavedIngredientSolids {
  name: string;
  drySolidsKg: number;
}

/**
 * A layer's remaining ingredient solids, split by ingredient in the shares the
 * product saved when it was created. A draw takes a blended product as it is
 * mixed, so every ingredient leaves in the same proportion and the saved
 * shares still hold. Lines of the same material read as one part, in the
 * order the formulation lists them. Presentation only: nothing posts from it.
 */
export function splitIngredientSolids(remainingKg: number, saved: readonly SavedIngredientSolids[]): SubBinIngredient[] {
  const byName = new Map<string, number>();
  for (const line of saved) byName.set(line.name, (byName.get(line.name) ?? 0) + Math.max(line.drySolidsKg, 0));
  const savedKg = [...byName.values()].reduce((sum, kg) => sum + kg, 0);
  if (savedKg <= 0) return [];
  const remaining = Math.max(remainingKg, 0);
  return [...byName].filter(([, kg]) => kg > 0).map(([name, kg]) => ({ name, solidsKg: (remaining * kg) / savedKg }));
}
