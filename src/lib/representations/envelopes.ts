import { stockEffectsSchema } from "./stock-effects";
import { z } from "zod";
import { feedstockRepresentationSchema } from "./feedstocks";

export function itemEnvelopeSchema(schema: z.ZodType) {
  return z.object({ data: schema.describe("Resource representation.") });
}
export function listEnvelopeSchema(schema: z.ZodType, order = "newest first by (createdAt, id)") {
  return z.object({
    data: z.array(schema).describe(`Page of resources, ${order}.`),
    nextCursor: z.string().nullable().describe("Opaque cursor for the next page, or null at the end; keep filters unchanged."),
  });
}
export function stockWriteEnvelopeSchema(schema: z.ZodType) {
  return itemEnvelopeSchema(schema).extend({ stockEffects: stockEffectsSchema.optional() });
}
/** A stock write that can name the basis it drew on: a dry run adds the fingerprint to send back with the real write. */
export function stockBasisWriteEnvelopeSchema(schema: z.ZodType) {
  return stockWriteEnvelopeSchema(schema).extend({
    basisFingerprint: z.string().optional().describe("Dry runs only: the stock basis these effects were computed on, opaque string. Send it as basisFingerprint on the real write to refuse it if stock moved."),
  });
}
export const feedstockCreateEnvelopeSchema = z.object({
  data: z.array(feedstockRepresentationSchema).describe("Created feedstocks, one per bin allocation; ids and codes are provisional in a dry run."),
  warnings: z.array(z.string()).optional().describe("Non-fatal operator guidance, plain text."),
  stockEffects: stockEffectsSchema.optional(),
});
/** A write that can add plain-text guidance to the saved row: calculated ratios first, then what a registry submission still needs. Never blocks. */
export function guidedWriteEnvelopeSchema(schema: z.ZodType) {
  return itemEnvelopeSchema(schema).extend({
    warnings: z.array(z.string()).optional().describe("Non-fatal guidance, plain text: ratios the server calculated, then certification gaps. Absent when there is none."),
  });
}
