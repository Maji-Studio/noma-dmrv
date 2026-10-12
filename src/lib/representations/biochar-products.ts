import { z } from "zod";
import { deriveSourceBiocharMassKg } from "@/lib/biochar-composition/composition";
import { biocharProductStatusValues } from "@/schemas/biochar-products";

const ingredientSchema = z.object({
  formulationIngredientId: z.uuid().describe("Formulation line UUID this ingredient was mixed for."),
  feedstockTypeId: z.uuid().describe("Feedstock type of the ingredient as mixed, UUID."),
  storageLocationId: z.uuid().nullable().describe("Feedstock bin the ingredient was drawn from, UUID, or null for material not tracked in a bin."),
  wetMassKg: z.number().nullable().describe("Wet ingredient mass in kilograms; 0 for a line that was not used."),
  moisturePercent: z.number().nullable().describe("Measured moisture of the material used, percent of wet mass, or null when none was recorded."),
});
const sourceAllocationSchema = z.object({
  productionRunId: z.uuid().describe("Production run the biochar came from, UUID."),
  wetMassKg: z.number().describe("Wet biochar drawn from that run in kilograms."),
  dryMassKg: z.number().describe("Dry biochar drawn from that run in kilograms."),
});

export const biocharProductRepresentationSchema = z.object({
  id: z.uuid().describe("Biochar product identifier, UUID."),
  code: z.string().describe("Human-readable product code."),
  version: z.number().int().positive().describe("Positive row version for concurrency checks."),
  facilityId: z.uuid().describe("Owning facility identifier, UUID."),
  formulationId: z.uuid().describe("Formulation identifier, UUID; the Pure biochar formulation for an unblended product."),
  status: z.enum(biocharProductStatusValues).describe("Product state: draft, testing, ready or sold."),
  placedAt: z.iso.datetime().describe("Instant the product was mixed and placed, UTC, RFC 3339."),
  productionDate: z.iso.datetime().describe("Instant of the oldest biochar lot drawn, UTC, RFC 3339."),
  expiresAt: z.iso.datetime().nullable().describe("Instant the 12-month stockpiling validity ends, UTC, RFC 3339, or null."),
  sourceBiocharStorageLocationId: z.uuid().nullable().describe("Biochar bin the biochar was drawn from, UUID, or null."),
  storageLocationId: z.uuid().nullable().describe("Product bin the blend was placed in, UUID, or null."),
  biocharWetMassKg: z.number().nullable().describe("Wet biochar drawn from the source bin as weighed, in kilograms, without ingredients or added water."),
  biocharMoisturePercent: z.number().nullable().describe("Measured biochar moisture as percent of wet mass; the overall figure for a split-bin draw."),
  waterAddedKg: z.number().nullable().describe("Water added to the blend in kilograms."),
  densityKgM3: z.number().nullable().describe("Bulk density in kilograms per cubic metre, or null."),
  ingredients: z.array(ingredientSchema).describe("Ingredients as mixed, in recipe order, from the snapshot saved with the product."),
  sourceAllocations: z.array(sourceAllocationSchema).describe("Biochar drawn per production run, ordered by run id."),
  archivedAt: z.iso.datetime().nullable().describe("Archive instant in UTC (RFC 3339), or null when active."),
  createdAt: z.iso.datetime().describe("Creation instant in UTC, RFC 3339."),
  updatedAt: z.iso.datetime().describe("Last update instant in UTC, RFC 3339."),
});
export type BiocharProductRepresentation = z.infer<typeof biocharProductRepresentationSchema>;

type Instant = Date | string;
type IngredientRow = z.infer<typeof ingredientSchema>;
export type BiocharProductRepresentationInput = Omit<BiocharProductRepresentation,
  "biocharWetMassKg" | "placedAt" | "productionDate" | "expiresAt" | "archivedAt" | "createdAt" | "updatedAt"> & {
  /** The stored blend: biochar as weighed plus every ingredient, before water. Never published. */
  blendMassKg: number | null;
  placedAt: Instant; productionDate: Instant; expiresAt: Instant | null; archivedAt: Instant | null; createdAt: Instant; updatedAt: Instant;
};

const instant = (value: Instant) => new Date(value).toISOString();

/**
 * Explicit public projection. Ingredients and source allocations are saved
 * with the product, so renaming a formulation or feedstock type cannot change
 * these bytes under the same ETag. The biochar mass is the stored blend less
 * the saved ingredient masses, the inverse of how a write derives the blend.
 */
export function representBiocharProduct(row: BiocharProductRepresentationInput): BiocharProductRepresentation {
  const ingredients: IngredientRow[] = row.ingredients.map((ingredient) => ({
    formulationIngredientId: ingredient.formulationIngredientId, feedstockTypeId: ingredient.feedstockTypeId,
    storageLocationId: ingredient.storageLocationId ?? null, wetMassKg: ingredient.wetMassKg ?? null,
    moisturePercent: ingredient.moisturePercent ?? null,
  }));
  return biocharProductRepresentationSchema.parse({
    id: row.id, code: row.code, version: row.version, facilityId: row.facilityId, formulationId: row.formulationId,
    status: row.status, placedAt: instant(row.placedAt), productionDate: instant(row.productionDate),
    expiresAt: row.expiresAt === null ? null : instant(row.expiresAt),
    sourceBiocharStorageLocationId: row.sourceBiocharStorageLocationId, storageLocationId: row.storageLocationId,
    biocharWetMassKg: deriveSourceBiocharMassKg(row.blendMassKg, ingredients.map(({ wetMassKg }) => ({ massKg: wetMassKg }))),
    biocharMoisturePercent: row.biocharMoisturePercent, waterAddedKg: row.waterAddedKg, densityKgM3: row.densityKgM3,
    ingredients,
    sourceAllocations: row.sourceAllocations.map(({ productionRunId, wetMassKg, dryMassKg }) => ({ productionRunId, wetMassKg, dryMassKg })),
    archivedAt: row.archivedAt === null ? null : instant(row.archivedAt),
    createdAt: instant(row.createdAt), updatedAt: instant(row.updatedAt),
  });
}
