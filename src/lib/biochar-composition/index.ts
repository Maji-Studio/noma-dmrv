export {
  COMPOSITION_BIN_TYPE,
  type IngredientBin,
  type BiocharComposition,
  type CompositionRow,
} from "./types";

export {
  reconcileComposition,
  deriveSuggestedIngredientMassKg,
  deriveMassDeviationPercent,
  shouldPrefillSuggestedMasses,
  INGREDIENT_MASS_DEVIATION_WARN_PERCENT,
  fromCompositionJsonb,
  toCompositionJsonb,
} from "./composition";

export { useBiocharComposition } from "./use-biochar-composition";
export type {
  UseBiocharCompositionArgs,
  UseBiocharCompositionResult,
} from "./use-biochar-composition";
