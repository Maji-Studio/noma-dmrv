import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

const formulationLineSchema = z.object({
  id: z.uuid().describe("Formulation line UUID; pass it as formulationIngredientId when making a biochar product."),
  feedstockTypeId: z.uuid().describe("Feedstock type of the ingredient, UUID."),
  ratio: z.number().nullable().describe("Volume share of the blend as a fraction from 0 to 1, or null. Guidance only: it never sets a mass."),
});

export const formulationRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  biocharRatio: z.number().nullable().describe("Biochar share of the blend as a fraction from 0 to 1, or null when not set."),
  lines: z.array(formulationLineSchema).describe("Ingredient lines in recipe order; empty for Pure biochar."),
});
export type FormulationRepresentation = z.infer<typeof formulationRepresentationSchema>;
export type FormulationRepresentationInput = LookupRepresentationInput<FormulationRepresentation>;

/** Formulations are never archived, so archivedAt is always null. */
export function representFormulation(row: FormulationRepresentationInput): FormulationRepresentation {
  return formulationRepresentationSchema.parse({
    id: row.id, code: row.code, name: row.name, version: row.version, biocharRatio: row.biocharRatio,
    lines: row.lines.map(({ id, feedstockTypeId, ratio }) => ({ id, feedstockTypeId, ratio })),
    ...lookupInstants(row),
  });
}
