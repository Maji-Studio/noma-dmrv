/**
 * The product form's submission shape, kept free of React so the server can
 * share it: `make_biochar_product` derives the stored blend the same way.
 */
import type { BiocharProductFormData } from "@/schemas/biochar-products";
import { deriveBlendMassKg } from "./composition";

/**
 * The form captures the biochar-only wet mass, while the persisted `massKg`
 * stays the pre-water blend total (biochar plus every recorded ingredient) so
 * server accounting is unchanged. Edits pass the stored total through
 * verbatim: the mass field is disabled, and rebuilding the total from rows
 * reconciled against a since-edited formulation would silently change the
 * record. Immutable source allocations additionally keep their persisted
 * composition server-side.
 */
export function prepareBiocharProductSubmission(
  data: BiocharProductFormData,
  allocationFrozen: boolean,
  persistedBlendMassKg?: number,
): BiocharProductFormData {
  const massKg =
    persistedBlendMassKg !== undefined
      ? persistedBlendMassKg
      : deriveBlendMassKg(
          typeof data.massKg === "number" ? data.massKg : null,
          data.ingredientBins,
        ) ?? data.massKg;
  const next = { ...data, massKg };
  return allocationFrozen
    ? { ...next, ingredientBins: undefined }
    : next;
}

/**
 * Server issue path to form field, for a refused save. The create action
 * renames the form's fields to the operation's (`massKg` is sent as
 * `biocharWetMassKg`, `ingredientBins` as `ingredients`), and a lineage lock
 * on update names the stored `composition`. `*` matches one path segment.
 */
export const BIOCHAR_PRODUCT_REFUSAL_ALIASES = {
  biocharWetMassKg: "massKg",
  biocharMoisturePercent: "moistureContentPercent",
  "ingredients.*.wetMassKg": "ingredientBins.*.massKg",
  "ingredients.*.moisturePercent": "ingredientBins.*.moistureContentPercent",
  "ingredients.*.storageLocationId": "ingredientBins.*.storageLocationId",
  composition: "ingredientBins",
  // A short sub-bin of a split biochar bin is a short draw of the biochar mass.
  sources: "massKg",
} as const;
