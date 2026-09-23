/**
 * The product composition the form draws from its live fields: the wet
 * product total and every part split into solids and water.
 *
 * Kept out of the component so the dry biochar rule is testable on its own:
 * a new product draws dry biochar at the entered moisture, which is the draw
 * the server posts; a saved product keeps the dry allocation recorded at
 * creation, whatever the moisture field says now.
 */
import type { IngredientBin } from "@/lib/biochar-composition";
import { splitWetMass } from "@/lib/mass-moisture";
import type { AffectedStockPreview } from "@/types/output-stock";
import {
  ingredientComponents,
  productCompositionComponents,
  sourceComponents,
  type CompositionComponent,
} from "./product-composition-components";

type IngredientLike = Omit<IngredientBin, "massKg"> & { massKg?: unknown };

export interface FormProductComposition {
  /** Dry biochar in the product: the biochar draw. */
  sourceDryKg: number | null;
  /**
   * Biochar, ingredients and added water together. It stays null until water
   * and every ingredient mass are entered, so blank required fields never read
   * as a smaller product.
   */
  wetProductKg: number | null;
  components: CompositionComponent[];
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function formProductComposition({
  isEditMode,
  massKg,
  moisturePercent,
  waterAddedKg,
  recordedSourceDryMassKg,
  ingredients,
  allocationFrozen,
  previews,
}: {
  isEditMode: boolean;
  /** Wet biochar drawn from the source bin. */
  massKg: number | null;
  moisturePercent: number | null;
  waterAddedKg: unknown;
  /** The saved product's dry allocation, when it has one. */
  recordedSourceDryMassKg: number | null;
  ingredients: readonly IngredientLike[];
  allocationFrozen: boolean;
  /** The product's stock projection, only while it is fresh and unblocked. */
  previews?: readonly AffectedStockPreview[];
}): FormProductComposition {
  const measuredDryKg = splitWetMass(massKg, moisturePercent)?.dryKg ?? null;
  const sourceDryKg = isEditMode
    ? recordedSourceDryMassKg ?? measuredDryKg
    : measuredDryKg;
  const addedWaterKg = finiteNonNegative(waterAddedKg);

  // A plain sum of the entered masses, so the total is exactly the sum of the
  // parts drawn under it.
  const ingredientMasses = ingredients.map((ingredient) => finiteNonNegative(ingredient.massKg));
  const wet = finiteNonNegative(massKg);
  const wetProductKg =
    wet !== null && addedWaterKg !== null && ingredientMasses.every((mass) => mass !== null)
      ? ingredientMasses.reduce<number>((total, mass) => total + (mass ?? 0), wet + addedWaterKg)
      : null;

  const source = sourceComponents({ wetKg: massKg, dryKg: sourceDryKg, addedWaterKg });
  const parts = ingredients.flatMap((ingredient) =>
    ingredientComponents(ingredient, {
      frozen: allocationFrozen,
      stock: previews?.find(
        (preview) =>
          preview.lane === "ingredient" &&
          preview.storageLocationId === ingredient.storageLocationId,
      ),
    }),
  );

  return {
    sourceDryKg,
    wetProductKg,
    components: productCompositionComponents(source, parts),
  };
}
