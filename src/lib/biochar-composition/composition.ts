/**
 * Biochar composition pure helpers
 *
 * Server-safe (no React, no DB, no Zod). All transforms between the form
 * shape (`IngredientBin[]`) and the persisted JSONB envelope live here, plus
 * the formulation-driven reconcile and source-biochar mass derivation.
 */

import type { IngredientBin } from "./types";
import { computeClampedDryMass } from "@/lib/calculations/mass-dry";
import { PERCENT_SCALE } from "@/lib/mass-moisture";

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
      massDryKg: sameFeedstockType ? prior?.massDryKg ?? null : null,
      moistureContentPercent: sameFeedstockType
        ? prior?.moistureContentPercent ?? null
        : null,
    };
  });
}

interface IngredientMassLike {
  massKg?: unknown;
  massDryKg?: unknown;
}

/** Read mass-only ingredient facts without requiring formulation metadata. */
export function fromCompositionMassJsonb(raw: unknown): IngredientMassLike[] {
  if (!raw || typeof raw !== "object") return [];
  const ingredients = (raw as { ingredients?: unknown }).ingredients;
  if (!Array.isArray(ingredients)) return [];

  return ingredients.flatMap((ingredient) => {
    if (!ingredient || typeof ingredient !== "object") return [];
    const { massKg, massDryKg } = ingredient as IngredientMassLike;
    return typeof massKg === "number" && Number.isFinite(massKg) && massKg >= 0
      ? [{
          massKg,
          massDryKg:
            typeof massDryKg === "number" &&
            Number.isFinite(massDryKg) &&
            massDryKg >= 0
              ? massDryKg
              : undefined,
        }]
      : [];
  });
}

export const SOURCE_BIOCHAR_MASS_ERROR =
  "Recorded ingredient mass exceeds blend mass. Reduce ingredient mass or increase blend mass.";

export const ZERO_SOURCE_BIOCHAR_ERROR =
  "Source biochar mass must be greater than 0 kg. Increase the biochar wet mass before creating this product.";

export const ZERO_SOURCE_BIOCHAR_WARNING =
  "This product contains 0 kg of source biochar. It cannot be ordered or traced to a production run or credit batch. Create a new product with more than 0 kg of biochar.";

export const GRAMS_PER_KILOGRAM = 1_000;

/** Pins derived blend moisture to six-decimal precision. */
const MOISTURE_SNAP_FACTOR = 1e6;

export function toPersistedMassGrams(massKg: number): number {
  return Math.round(massKg * GRAMS_PER_KILOGRAM);
}

/** Sum the actual wet ingredient masses recorded for one product blend. */
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
 * Source biochar is the recorded pre-water wet blend mass less recorded wet
 * ingredient masses. Formulation shares are volume guidance and never enter
 * this equation.
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

/** Dry source biochar only, excluding blend ingredients and added water. */
export function deriveSourceBiocharDryMassKg(
  blendMassKg: number | null | undefined,
  moistureContentPercent: number | null | undefined,
  ingredients: readonly IngredientMassLike[] | null | undefined,
): number | null {
  return computeClampedDryMass(
    deriveSourceBiocharMassKg(blendMassKg, ingredients),
    moistureContentPercent,
  );
}

/**
 * Inverse of `deriveSourceBiocharMassKg`: the persisted pre-water blend mass
 * is the operator-entered biochar wet mass plus recorded wet ingredient
 * masses. The form captures biochar-only mass; the database keeps the blend
 * total, so the exact gram arithmetic must round-trip both directions.
 */
export function deriveBlendMassKg(
  sourceBiocharMassKg: number | null | undefined,
  ingredients: readonly IngredientMassLike[] | null | undefined,
): number | null {
  if (
    typeof sourceBiocharMassKg !== "number" ||
    !Number.isFinite(sourceBiocharMassKg) ||
    sourceBiocharMassKg < 0
  ) {
    return null;
  }
  const biocharMassGrams = toPersistedMassGrams(sourceBiocharMassKg);
  const ingredientMassGrams = toPersistedMassGrams(
    sumRecordedIngredientMassKg(ingredients),
  );
  return (biocharMassGrams + ingredientMassGrams) / GRAMS_PER_KILOGRAM;
}

/**
 * The finished product's effective moisture: 1 − totalDry/totalWet across the
 * whole blend (biochar dry + ingredient dry snapshots over blend mass plus
 * added water). This is the ONE product-level moisture figure — the
 * single-material `deriveEffectiveMoisturePercent` in `mass-moisture` must
 * not be fed a blend mass (its module header says so), which is exactly the
 * mistake behind DR-002 / BP-26-001 (list said 26.1%, form said 34.3%).
 * Returns null when the composition cannot account for its dry mass (an
 * ingredient without a dry snapshot, or no biochar dry mass derivable).
 */
export function deriveBlendEffectiveMoisturePercent({
  blendMassKg,
  waterAddedKg,
  biocharMoisturePercent,
  ingredients,
  sourceAllocatedDryMassKg,
}: {
  blendMassKg: number | null | undefined;
  waterAddedKg: number | null | undefined;
  biocharMoisturePercent: number | null | undefined;
  ingredients: readonly IngredientMassLike[] | null | undefined;
  /** Allocation-tracked biochar dry mass; wins over the moisture derivation. */
  sourceAllocatedDryMassKg?: number | null;
}): number | null {
  if (
    typeof blendMassKg !== "number" ||
    !Number.isFinite(blendMassKg) ||
    blendMassKg <= 0
  ) {
    return null;
  }
  const totalWetKg = blendMassKg + (waterAddedKg ?? 0);
  const biocharDryKg =
    sourceAllocatedDryMassKg ??
    deriveSourceBiocharDryMassKg(blendMassKg, biocharMoisturePercent, ingredients);
  const ingredientDryKg = deriveIngredientDryMassTotalKg(ingredients);
  if (biocharDryKg == null || ingredientDryKg == null || totalWetKg <= 0) {
    return null;
  }
  const totalDryKg = biocharDryKg + ingredientDryKg;
  const percent = Math.min(
    PERCENT_SCALE,
    Math.max(0, (1 - totalDryKg / totalWetKg) * PERCENT_SCALE),
  );
  // Snap float noise (1 − 0.85 → 15.000000000000002) so a pure product's
  // effective moisture round-trips exactly to its entered percentage.
  return (
    Math.round(percent * MOISTURE_SNAP_FACTOR) / MOISTURE_SNAP_FACTOR
  );
}

/** Sum of recorded positive ingredient wet masses, gram-exact. */
export function deriveIngredientMassTotalKg(
  ingredients: readonly IngredientMassLike[] | null | undefined,
): number {
  return sumRecordedIngredientMassKg(ingredients);
}

/** Sum ingredient dry snapshots, or return null when a recorded mass lacks one. */
export function deriveIngredientDryMassTotalKg(
  ingredients: readonly IngredientMassLike[] | null | undefined,
): number | null {
  return (ingredients ?? []).reduce<number | null>((total, ingredient) => {
    if (total == null) return null;
    const massKg = ingredient.massKg;
    if (typeof massKg !== "number" || !Number.isFinite(massKg) || massKg <= 0) {
      return total;
    }
    const massDryKg = ingredient.massDryKg;
    return typeof massDryKg === "number" &&
      Number.isFinite(massDryKg) &&
      massDryKg >= 0
      ? total + massDryKg
      : null;
  }, 0);
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
      (bin.massDryKg == null ||
        (Number.isFinite(bin.massDryKg) && bin.massDryKg >= 0)) &&
      (bin.moistureContentPercent == null ||
        (Number.isFinite(bin.moistureContentPercent) &&
          bin.moistureContentPercent >= 0 &&
          bin.moistureContentPercent <= 100)) &&
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
