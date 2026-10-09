import { stockEffectsSchema } from "./stock-effects";
import { z } from "zod";
import { feedstockRepresentationSchema } from "./feedstocks";

export function itemEnvelopeSchema(schema: z.ZodType) {
  return z.object({ data: schema.describe("Resource representation.") });
}
export function listEnvelopeSchema(schema: z.ZodType) {
  return z.object({
    data: z.array(schema).describe("Page of resources, newest first by (createdAt, id)."),
    nextCursor: z.string().nullable().describe("Opaque cursor for the next page, or null at the end; keep filters unchanged."),
  });
}
export function stockWriteEnvelopeSchema(schema: z.ZodType) {
  return itemEnvelopeSchema(schema).extend({ stockEffects: stockEffectsSchema.optional() });
}
export const feedstockCreateEnvelopeSchema = z.object({
  data: z.array(feedstockRepresentationSchema).describe("Created feedstocks, one per bin allocation; ids and codes are provisional in a dry run."),
  warnings: z.array(z.string()).optional().describe("Non-fatal operator guidance, plain text."),
  stockEffects: stockEffectsSchema.optional(),
});
