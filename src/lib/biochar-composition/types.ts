/**
 * Biochar composition types
 *
 * Single source of truth for the ingredient-bin row shape, the persisted JSONB
 * envelope, and the renderable row used by the form. The Zod schema in
 * `src/schemas/biochar-products.ts` validates input shaped like `IngredientBin`.
 */

export const COMPOSITION_BIN_TYPE = "feedstock_bin" as const;

/**
 * Shape mirrors `z.infer<typeof ingredientBinFormSchema>` in
 * `src/schemas/biochar-products.ts`. Optional fields stay optional so callers
 * can pass either Zod output (with possibly-undefined) or normalized rows.
 */
export interface IngredientBin {
  formulationIngredientId: string;
  feedstockTypeId: string;
  feedstockTypeName: string;
  feedstockTypeCategory: string;
  ratio?: number | null;
  /** Wet/as-received mass entered by the operator. */
  massKg?: number | null;
  /** Server-derived dry mass frozen from the source bin's intake basis. */
  massDryKg?: number | null;
  /** Server-derived wet-basis moisture snapshot used for massDryKg. */
  moistureContentPercent?: number | null;
  storageLocationId?: string | null;
}

/**
 * Persisted JSONB envelope. Typed permissively so it matches the
 * `Record<string, unknown>` shape that the Drizzle column expects.
 */
export type BiocharComposition = Record<string, unknown> & {
  ingredients?: IngredientBin[];
};

export interface CompositionRow {
  key: string;
  index: number;
  formulationIngredientId: string;
  feedstockTypeId: string;
  feedstockTypeName: string;
  feedstockTypeCategory: string;
  ratio: number | null;
  massKgFieldName: `ingredientBins.${number}.massKg`;
  storageLocationFieldName: `ingredientBins.${number}.storageLocationId`;
}
