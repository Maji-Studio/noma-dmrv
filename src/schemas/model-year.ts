import { z } from "zod";

export const MODEL_YEAR_MIN = 1900;
const MODEL_YEAR_LOOKAHEAD_YEARS = 1;
export const MODEL_YEAR_MAX = new Date().getFullYear() + MODEL_YEAR_LOOKAHEAD_YEARS;

export const modelYearSchema = z.number()
  .int("Model year must be a whole number")
  .min(MODEL_YEAR_MIN, `Model year must be ${MODEL_YEAR_MIN} or later`)
  .max(MODEL_YEAR_MAX, "Model year cannot be in the future")
  .optional()
  .nullable();
