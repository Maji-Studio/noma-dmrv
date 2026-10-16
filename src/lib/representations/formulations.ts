import { z } from "zod";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

const formulationLineSchema = z.object({
  id: z.uuid().describe("Formulation line UUID; pass it as formulationIngredientId when making a biochar product."),
  feedstockTypeId: z.uuid().describe("Feedstock type of the ingredient, UUID."),
  ratio: z.number().nullable().describe("Share of the solid blend as a fraction from 0 to 1, or null. Guidance only: it never sets a mass."),
});

export const formulationRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  description: z.string().nullable().describe("Formulation description, or null when not set."),
  archivedAt: z.iso.datetime().nullable().describe("Archive event instant in UTC (RFC 3339), or null when active."),
  biocharRatio: z.number().nullable().describe("Biochar share of the blend as a fraction from 0 to 1, or null when not set."),
  lines: z.array(formulationLineSchema).describe("Ingredient lines in recipe order; empty for Pure biochar."),
});
export type FormulationRepresentation = z.infer<typeof formulationRepresentationSchema>;
export type FormulationRepresentationInput = LookupRepresentationInput<FormulationRepresentation> & { archivedAt: Date | string | null };

export function representFormulation(row: FormulationRepresentationInput): FormulationRepresentation {
  return formulationRepresentationSchema.parse({
    id: row.id, code: row.code, name: row.name, version: row.version, biocharRatio: row.biocharRatio, description: row.description,
    lines: row.lines.map(({ id, feedstockTypeId, ratio }) => ({ id, feedstockTypeId, ratio })),
    ...lookupInstants(row),
  });
}
