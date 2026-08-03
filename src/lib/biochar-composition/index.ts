export {
  COMPOSITION_BIN_TYPE,
  type IngredientBin,
  type BiocharComposition,
  type CompositionRow,
} from "./types";

export {
  reconcileComposition,
  deriveSuggestedIngredientMassKg,
  deriveSourceBiocharMassKg,
  deriveMassDeviationPercent,
  GRAMS_PER_KILOGRAM,
  SOURCE_BIOCHAR_MASS_ERROR,
  INGREDIENT_MASS_DEVIATION_WARN_PERCENT,
  toPersistedMassGrams,
  fromCompositionJsonb,
  toCompositionJsonb,
} from "./composition";

export { useBiocharComposition } from "./use-biochar-composition";
export type {
  UseBiocharCompositionArgs,
  UseBiocharCompositionResult,
} from "./use-biochar-composition";
