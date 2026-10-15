import { z } from "zod";

export const MODEL_YEAR_MIN = 1900;
export const MODEL_YEAR_MAX = new Date().getFullYear() + 1;

export const modelYearSchema = z.number()
  .int("Model year must be a whole number")
  .min(MODEL_YEAR_MIN, "Model year must be 1900 or later")
  .max(MODEL_YEAR_MAX, "Model year cannot be in the future")
  .optional()
  .nullable();
