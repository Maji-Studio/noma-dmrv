/**
 * Biochar composition pure helpers
 *
 * Server-safe (no React, no DB, no Zod). All transforms between the form
 * shape (`IngredientBin[]`) and the persisted JSONB envelope live here, plus
 * the formulation-driven reconcile and source-biochar mass derivation.
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
 * Recipe-suggested mass for a single ingredient = productMassKg *
 * ingredientRatio. This value only prefills the editable mass field; the
 * recorded mass is authoritative for allocation. Returns null whenever either
 * input is missing or non-positive.
 */
export function deriveSuggestedIngredientMassKg(
  productMassKg: number | null | undefined,
  ingredientRatio: number | null | undefined,
): number | null {
  if (
    !Number.isFinite(productMassKg) ||
    !Number.isFinite(ingredientRatio)
  ) {
    return null;
  }
  const mass = productMassKg as number;
  const ingredient = ingredientRatio as number;
  if (mass <= 0 || ingredient <= 0) return null;
  return mass * ingredient;
}

interface IngredientMassLike {
  massKg?: unknown;
}

export const SOURCE_BIOCHAR_MASS_ERROR =
  "Recorded ingredient mass exceeds blend mass. Reduce ingredient mass or increase blend mass.";

const GRAMS_PER_KILOGRAM = 1_000;

function toPersistedMassGrams(massKg: number): number {
  return Math.round(massKg * GRAMS_PER_KILOGRAM);
}

/** Sum the actual ingredient masses recorded for one product blend. */
function sumRecordedIngredientMassKg(
  ingredients: readonly IngredientMassLike[] | null | undefined,
): number {
  const totalGrams = (ingredients ?? []).reduce((total, ingredient) => {
    const massKg = ingredient.massKg;
    return total +
      (typeof massKg === "number" && Number.isFinite(massKg) && massKg > 0
        ? toPersistedMassGrams(massKg)
        : 0);
  }, 0);
  return totalGrams / GRAMS_PER_KILOGRAM;
}

/**
 * Source biochar is the recorded pre-water blend mass less recorded ingredient
 * masses. Formulation shares are volume guidance and never enter this equation.
 */
export function deriveSourceBiocharMassKg(
  blendMassKg: number | null | undefined,
  ingredients: readonly IngredientMassLike[] | null | undefined,
): number | null {
  if (
    typeof blendMassKg !== "number" ||
    !Number.isFinite(blendMassKg)
  ) {
    return null;
  }
  const blendMassGrams = toPersistedMassGrams(blendMassKg);
  const ingredientMassGrams = toPersistedMassGrams(
    sumRecordedIngredientMassKg(ingredients),
  );
  return (blendMassGrams - ingredientMassGrams) / GRAMS_PER_KILOGRAM;
}

/**
 * Suggestions may become form values only while creating a composition. An
 * existing product keeps saved null masses empty unless the operator explicitly
 * assigns a different formulation, whose ingredient rows have no saved facts.
 */
export function shouldPrefillSuggestedMasses(input: {
  isEditMode: boolean;
  initialFormulationId: string | null | undefined;
  selectedFormulationId: string | null | undefined;
}): boolean {
  if (!input.selectedFormulationId) return false;
  return (
    !input.isEditMode ||
    input.selectedFormulationId !== input.initialFormulationId
  );
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
