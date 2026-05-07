/**
 * Biochar composition pure helpers
 *
 * Server-safe (no React, no DB, no Zod). All transforms between the form
 * shape (`IngredientBin[]`) and the persisted JSONB envelope live here, plus
 * the formulation-driven reconcile and the removal-kg derivation.
 */

import type { IngredientBin } from "./types";

interface FormulationIngredientLike {
  id: string;
  name: string;
  ingredientType: string;
  ratio: number | null;
}

/**
 * Reconcile rows against a formulation's ingredient list.
 *
 * Identity is by `formulationIngredientId`. User-entered `storageLocationId`
 * and `massKg` are preserved; `name`/`type`/`ratio` are taken from the
 * formulation as the authoritative source. Rows for ingredients no longer in
 * the formulation are dropped; new ingredients enter with null bin/mass.
 */
export function reconcileComposition(
  formulation: { ingredients: FormulationIngredientLike[] },
  existing?: IngredientBin[] | null,
): IngredientBin[] {
  const liveBins = existing ?? [];
  return formulation.ingredients.map((ing) => {
    const prior = liveBins.find(
      (eb) => eb.formulationIngredientId === ing.id,
    );
    return {
      formulationIngredientId: ing.id,
      ingredientName: ing.name,
      ingredientType: ing.ingredientType,
      ratio: ing.ratio ?? null,
      storageLocationId: prior?.storageLocationId ?? null,
      massKg: prior?.massKg ?? null,
    };
  });
}

/**
 * Removal kg for a single ingredient = (productMassKg / biocharRatio) * ingredientRatio.
 * Returns null whenever any input is missing or non-positive.
 */
export function deriveBinRemovalKg(
  productMassKg: number | null | undefined,
  biocharRatio: number | null | undefined,
  ingredientRatio: number | null | undefined,
): number | null {
  if (
    !Number.isFinite(productMassKg) ||
    !Number.isFinite(biocharRatio) ||
    !Number.isFinite(ingredientRatio)
  ) {
    return null;
  }
  const mass = productMassKg as number;
  const biochar = biocharRatio as number;
  const ingredient = ingredientRatio as number;
  if (mass <= 0 || biochar <= 0 || ingredient <= 0) return null;
  return (mass / biochar) * ingredient;
}

/**
 * Read form rows out of a persisted composition JSONB. Tolerates the legacy
 * empty-object shape, missing fields, and non-array `ingredients`.
 */
export function fromCompositionJsonb(raw: unknown): IngredientBin[] {
  if (!raw || typeof raw !== "object") return [];
  const ingredients = (raw as { ingredients?: unknown }).ingredients;
  if (!Array.isArray(ingredients)) return [];
  return ingredients.filter((b): b is IngredientBin => {
    if (!b || typeof b !== "object") return false;
    const bin = b as Partial<IngredientBin>;
    return (
      typeof bin.formulationIngredientId === "string" &&
      typeof bin.ingredientName === "string" &&
      typeof bin.ingredientType === "string" &&
      (bin.ratio == null || Number.isFinite(bin.ratio)) &&
      (bin.massKg == null ||
        (Number.isFinite(bin.massKg) && bin.massKg >= 0)) &&
      (bin.storageLocationId == null ||
        typeof bin.storageLocationId === "string")
    );
  });
}

type CreateOpts = { mode: "create" };
type UpdateOpts = { mode: "update" };

/**
 * Serialize form rows to the persisted JSONB shape with create/update partial
 * semantics:
 *
 *   create                          → {} (no rows) | { ingredients: [...] }
 *   update with bins=undefined      → undefined          (omit = preserve)
 *   update with bins=[]             → {}                 (clear)
 *   update with bins=[...]          → { ingredients: [...] }
 *
 * The `undefined` return on update is a *signal to the caller* to omit the
 * `composition` key from the DB write entirely.
 */
export function toCompositionJsonb(
  bins: IngredientBin[] | undefined,
  opts: CreateOpts | UpdateOpts,
): Record<string, unknown> | undefined {
  if (opts.mode === "create") {
    return bins && bins.length > 0 ? { ingredients: bins } : {};
  }
  if (bins === undefined) return undefined;
  return bins.length > 0 ? { ingredients: bins } : {};
}
