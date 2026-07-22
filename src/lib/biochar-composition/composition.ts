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
  feedstockTypeId: string;
  feedstockType: {
    id: string;
    name: string;
    category: string;
  };
  ratio: number | null;
}

/**
 * Reconcile rows against a formulation's ingredient list.
 *
 * Identity is by `formulationIngredientId`. User-entered `massKg` is
 * preserved; `storageLocationId` is preserved only while the line still points
 * at the same feedstock type. Catalog name/category/ratio are taken from the
 * formulation as the authoritative source. Rows for lines no longer in the
 * formulation are dropped; new lines enter with null bin/mass.
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
    const sameFeedstockType = prior?.feedstockTypeId === ing.feedstockTypeId;
    return {
      formulationIngredientId: ing.id,
      feedstockTypeId: ing.feedstockTypeId,
      feedstockTypeName: ing.feedstockType.name,
      feedstockTypeCategory: ing.feedstockType.category,
      ratio: ing.ratio ?? null,
      storageLocationId: sameFeedstockType ? prior?.storageLocationId ?? null : null,
      massKg: prior?.massKg ?? null,
    };
  });
}

/**
 * Recipe-suggested mass for a single ingredient =
 * (productMassKg / biocharRatio) * ingredientRatio.
 * Orientation only — prefills the editable mass field; the entered mass is
 * authoritative. Returns null whenever any input is missing or non-positive.
 */
export function deriveSuggestedIngredientMassKg(
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
 * Threshold (in percent) past which the entered ingredient mass shows a soft
 * "vs recipe" hint. Never blocks submission — the recipe is orientation, not
 * a constraint.
 */
export const INGREDIENT_MASS_DEVIATION_WARN_PERCENT = 10;

/**
 * Signed percent deviation of the entered mass against the recipe suggestion.
 * Null when either side is missing or the suggestion is non-positive.
 */
export function deriveMassDeviationPercent(
  actualMassKg: number | null | undefined,
  suggestedMassKg: number | null | undefined,
): number | null {
  if (!Number.isFinite(actualMassKg) || !Number.isFinite(suggestedMassKg)) {
    return null;
  }
  const actual = actualMassKg as number;
  const suggested = suggestedMassKg as number;
  if (suggested <= 0 || actual < 0) return null;
  return ((actual - suggested) / suggested) * 100;
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
      typeof bin.feedstockTypeId === "string" &&
      typeof bin.feedstockTypeName === "string" &&
      typeof bin.feedstockTypeCategory === "string" &&
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
