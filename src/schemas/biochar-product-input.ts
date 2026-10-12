import { z } from "zod";
import {
  biocharProductFormSchema, biocharProductStatusValues, DUPLICATE_FORMULATION_INGREDIENT_MESSAGE,
  MOISTURE_MAX, MOISTURE_MIN, updateBiocharProductSchema,
} from "./biochar-products";
import { eventInstantSchema } from "./event-instant";
import {
  clearableNumber, expectedVersionSchema, massKgSchema, optionalNumber, pipeToCanonicalNumber,
  requiredMassKgSchema, stockEventInstantSchema, storedPercentSchema,
} from "./helpers";
import { MAX_STOCK_ENTRY_ITEMS, moistureSchema, orderedSourcesSchema, OUTPUT_STOCK_REQUEST_KEY_MAX_LENGTH } from "./output-stock";

const INGREDIENT_MOISTURE_REQUIRED = "Enter the measured moisture for every ingredient added.";
const BIOCHAR_MOISTURE_REQUIRED = "Enter the measured biochar moisture, or the sub-bins drawn from a split bin.";
const BIOCHAR_MOISTURE_OR_SOURCES = "Send the biochar moisture or the sub-bins drawn, not both.";

const densitySchema = z.number().finite().min(0, "Must be a non-negative number").nullable().optional();
const ingredientMoistureSchema = storedPercentSchema().min(MOISTURE_MIN, "Must be 0-100").max(MOISTURE_MAX, "Must be 0-100");

/** One formulation line as mixed: its wet mass and the moisture measured for the material used. */
const ingredientInput = z.strictObject({
  formulationIngredientId: z.uuid().describe("Formulation line UUID; one entry per line of the formulation."),
  storageLocationId: z.uuid().nullable().describe("Feedstock bin the ingredient was drawn from, UUID, or null for material not tracked in a bin."),
  wetMassKg: requiredMassKgSchema("Ingredient mass must be 0 or greater").describe("Wet ingredient mass in kilograms, as weighed. 0 records a line that was not used."),
  moisturePercent: ingredientMoistureSchema.nullable().optional().describe("Measured moisture of the material used, percent of wet mass. Required when wetMassKg is above 0."),
}).superRefine((value, ctx) => {
  if (value.wetMassKg > 0 && value.moisturePercent == null) ctx.addIssue({ code: "custom", path: ["moisturePercent"], message: INGREDIENT_MOISTURE_REQUIRED });
});

const ingredientsInput = z.array(ingredientInput).max(MAX_STOCK_ENTRY_ITEMS).superRefine((ingredients, ctx) => {
  const seen = new Set<string>();
  ingredients.forEach((ingredient, index) => {
    if (seen.has(ingredient.formulationIngredientId)) ctx.addIssue({ code: "custom", path: [index, "formulationIngredientId"], message: DUPLICATE_FORMULATION_INGREDIENT_MESSAGE });
    seen.add(ingredient.formulationIngredientId);
  });
});

/** What REST and MCP publish for a new product (decision 52): the parts as weighed, not the blend. */
const publishedCreateFields = {
  facilityId: z.uuid().describe("Facility the product is mixed and placed at, UUID."),
  formulationId: z.uuid().describe("Formulation UUID, including the Pure biochar formulation for an unblended product."),
  placedAt: eventInstantSchema,
  status: z.enum(biocharProductStatusValues).default("testing").describe("Product state: draft, testing, ready or sold. Defaults to testing."),
  sourceBiocharStorageLocationId: z.uuid().describe("Biochar bin the biochar was drawn from, UUID."),
  storageLocationId: z.uuid().describe("Product bin the blend was placed in, UUID. A bin with no formulation yet is claimed for this one."),
  biocharWetMassKg: biocharProductFormSchema.shape.massKg.describe("Wet biochar drawn from the source bin as weighed, in kilograms, without ingredients or added water."),
  biocharMoisturePercent: moistureSchema().nullable().optional().describe("Measured biochar moisture as percent of wet mass, below 100. Required unless sources are given."),
  sources: orderedSourcesSchema.optional().describe("Split biochar bins only: the sub-bins drawn, each layerId a production run UUID, in the order they were emptied, each with its moisture."),
  waterAddedKg: biocharProductFormSchema.shape.waterAddedKg.describe("Water added to the blend in kilograms; 0 when none."),
  densityKgM3: pipeToCanonicalNumber(optionalNumber, densitySchema).describe("Bulk density in kilograms per cubic metre."),
  ingredients: ingredientsInput.default([]).describe("One entry per formulation line with its wet mass and measured moisture. Empty for Pure biochar."),
  basisFingerprint: z.string().min(1).optional().describe("basisFingerprint from a dry run. If stock moved since, the write is refused with stock_basis_changed. Omit it to draw current stock."),
};

/** UI-only: the form's request key, so a resubmitted form replays its saved product. */
const unpublishedCreateFields = {
  idempotencyKey: z.string().trim().min(1).max(OUTPUT_STOCK_REQUEST_KEY_MAX_LENGTH).optional(),
};

interface ProductEntry {
  biocharMoisturePercent?: number | null;
  sources?: unknown[];
}

/** The biochar draw needs its moisture: one reading, or one per sub-bin, never both. */
function refineProductEntry(value: ProductEntry, ctx: z.RefinementCtx<ProductEntry>) {
  if (!value.sources && value.biocharMoisturePercent == null) ctx.addIssue({ code: "custom", path: ["biocharMoisturePercent"], message: BIOCHAR_MOISTURE_REQUIRED });
  if (value.sources && value.biocharMoisturePercent != null) ctx.addIssue({ code: "custom", path: ["biocharMoisturePercent"], message: BIOCHAR_MOISTURE_OR_SOURCES });
}

/** The published body of `make_biochar_product`; adapters reject anything else. */
export const makeBiocharProductApiInput = z.strictObject(publishedCreateFields).superRefine(refineProductEntry);

/** The full operation input: the published body plus the form's request key. */
export const makeBiocharProductInput = z.strictObject({ ...publishedCreateFields, ...unpublishedCreateFields }).superRefine(refineProductEntry);

export type MakeBiocharProductInput = z.output<typeof makeBiocharProductInput>;

/** The fields a posted product still takes. */
const publishedUpdateFields = {
  code: updateBiocharProductSchema.shape.code.describe("Human-readable product code."),
  status: z.enum(biocharProductStatusValues).optional().describe("Product state: draft, testing, ready or sold."),
  densityKgM3: pipeToCanonicalNumber(clearableNumber, densitySchema).describe("Bulk density in kilograms per cubic metre, or null to clear."),
};

/**
 * UI-only: the edit form resends the facts the product's stock was drawn on,
 * so a changed one is refused rather than ignored. None is in the published contract.
 */
const unpublishedUpdateFields = {
  facilityId: z.uuid().optional(),
  formulationId: z.uuid().optional(),
  placedAt: stockEventInstantSchema().optional(),
  storageLocationId: z.uuid().nullable().optional(),
  massKg: massKgSchema().optional(),
  moistureContentPercent: storedPercentSchema().min(MOISTURE_MIN).max(MOISTURE_MAX).optional(),
  waterAddedKg: massKgSchema().optional(),
  composition: z.record(z.string(), z.unknown()).optional(),
};

/** The published PATCH body; the transport supplies the product id and the If-Match version. */
export const updateBiocharProductApiInput = z.strictObject(publishedUpdateFields);

/** The published `update_biochar_product` tool input: the id and version join the body because MCP has no path or If-Match. */
export const updateBiocharProductToolInput = z.strictObject({
  biocharProductId: z.uuid().describe("Target biochar product UUID."),
  expectedVersion: expectedVersionSchema.describe("Version from get_biochar_product."),
  ...publishedUpdateFields,
});

/** The full `update_biochar_product` input. */
export const updateBiocharProductInput = z.strictObject({
  ...publishedUpdateFields,
  biocharProductId: z.uuid().describe("Target biochar product UUID."),
  expectedVersion: expectedVersionSchema.describe("Version from get_biochar_product."),
  ...unpublishedUpdateFields,
});

export type UpdateBiocharProductOperationInput = z.output<typeof updateBiocharProductInput>;
