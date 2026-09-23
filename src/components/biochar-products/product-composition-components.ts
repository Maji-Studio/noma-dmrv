/**
 * The parts a biochar product is made of, split into solids and water, for
 * `ProductCompositionPreview` on the product form and the product read view.
 *
 * Presentation only: nothing here feeds accounting. Dry biochar and every
 * ingredient's dry solids come from the most authoritative figure the surface
 * has, and a part that cannot be derived stays null so it reads "Not
 * available" rather than being filed as solids or water.
 */
import type { ProductCompositionPart } from "@/components/ui/product-composition-preview";
import { GRAMS_PER_KILOGRAM, type IngredientBin } from "@/lib/biochar-composition";
import { MASS_MOISTURE_LABELS, splitWetMass } from "@/lib/mass-moisture";
import type { AffectedStockPreview } from "@/types/output-stock";

export type CompositionComponent = ProductCompositionPart;

export const DRY_BIOCHAR_LABEL = "Dry biochar";
export const BIOCHAR_WATER_LABEL = "Water in biochar";
/** All water in the product before any was added: the biochar's and every ingredient's. */
export const POOLED_WATER_LABEL = "Water";

/** "Compost solids": the ingredient's share once its own water is taken out. */
export function ingredientSolidsLabel(feedstockTypeName: string): string {
  return `${feedstockTypeName} solids`;
}

type IngredientLike = Omit<IngredientBin, "massKg"> & { massKg?: unknown };

function finiteMass(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Dry solids for one ingredient, most authoritative first:
 * - a saved product (`frozen`) keeps the dry snapshot recorded at creation, so
 *   later bin moisture never rewrites it;
 * - moisture the operator measured splits the entered wet mass;
 * - otherwise the ingredient bin's own stock ratio from the server projection,
 *   unrounded, which is the basis the server posts (rounded to the gram only
 *   at the end, as stored).
 * A zero addition has zero solids whatever the moisture says.
 */
export function ingredientDrySolidsKg(
  ingredient: IngredientLike,
  { frozen = false, stock }: { frozen?: boolean; stock?: AffectedStockPreview } = {},
): number | null {
  const wetKg = finiteMass(ingredient.massKg);
  if (wetKg === 0) return 0;
  if (frozen) return finiteMass(ingredient.massDryKg);
  if (ingredient.moistureSource === "operator_override") {
    return splitWetMass(wetKg, ingredient.moistureContentPercent)?.dryKg ?? null;
  }
  if (
    wetKg === null ||
    stock?.lane !== "ingredient" ||
    stock.beforeDryKg === null ||
    stock.beforeEstimatedWetKg === null ||
    stock.beforeEstimatedWetKg <= 0
  ) {
    return null;
  }
  return Math.round((wetKg * stock.beforeDryKg / stock.beforeEstimatedWetKg) * GRAMS_PER_KILOGRAM) / GRAMS_PER_KILOGRAM;
}

/**
 * One ingredient as its solids and its own water. Both stay null unless the
 * wet mass is known and the dry solids fit inside it.
 */
export function ingredientComponents(
  ingredient: IngredientLike,
  options: { frozen?: boolean; stock?: AffectedStockPreview } = {},
): CompositionComponent[] {
  const wetKg = finiteMass(ingredient.massKg);
  const dryKg = ingredientDrySolidsKg(ingredient, options);
  const valid = wetKg !== null && dryKg !== null && dryKg <= wetKg;
  return [
    { label: ingredientSolidsLabel(ingredient.feedstockTypeName), massKg: valid ? dryKg : null, kind: "ingredient" },
    { label: `Water in ${ingredient.feedstockTypeName.toLowerCase()}`, massKg: valid ? wetKg - dryKg : null, kind: "water" },
  ];
}

/**
 * The biochar drawn from the source bin as dry biochar and its water, plus
 * the water added afterwards. `dryKg` is the recorded allocation on a saved
 * product and the dry draw at the entered moisture on a new one.
 */
export function sourceComponents({
  wetKg,
  dryKg,
  addedWaterKg,
}: {
  wetKg: number | null;
  dryKg: number | null;
  addedWaterKg: number | null;
}): CompositionComponent[] {
  const wet = finiteMass(wetKg);
  const dry = finiteMass(dryKg);
  return [
    { label: DRY_BIOCHAR_LABEL, massKg: dry, kind: "biochar" },
    { label: BIOCHAR_WATER_LABEL, massKg: wet !== null && dry !== null && dry <= wet ? wet - dry : null, kind: "water" },
    { label: MASS_MOISTURE_LABELS.waterAdded, massKg: finiteMass(addedWaterKg), kind: "addedWater" },
  ];
}

/**
 * Display grouping for the whole product: dry biochar, each ingredient's
 * solids, one pooled water part, then added water. The water part is only
 * known when every water it pools is known.
 */
export function productCompositionComponents(
  source: readonly CompositionComponent[],
  ingredients: readonly CompositionComponent[],
): CompositionComponent[] {
  const water = [...source, ...ingredients].filter((component) => component.kind === "water");
  const pooledWater = water.every((component) => finiteMass(component.massKg) !== null)
    ? water.reduce((total, component) => total + (component.massKg ?? 0), 0)
    : null;
  return [
    ...source.filter((component) => component.kind === "biochar"),
    ...ingredients.filter((component) => component.kind === "ingredient"),
    { label: POOLED_WATER_LABEL, massKg: pooledWater, kind: "water" },
    ...source.filter((component) => component.kind === "addedWater"),
  ];
}
