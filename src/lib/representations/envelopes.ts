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
export const feedstockPreviewSchema = z.object({
  feedstockId: z.uuid().describe("Provisional feedstock identifier, UUID."),
  storageLocationId: z.uuid().nullable().describe("Receiving bin identifier, UUID, or null when unspecified."),
  allocatedWetMassKg: z.number().nullable().describe("Allocated wet mass in kilograms, or null when unavailable."),
  allocatedDryMassKg: z.number().describe("Allocated dry mass in kilograms."),
  stockDeltaWetKg: z.number().nullable().describe("Wet stock addition in kilograms; zero for incomplete rows, not the resulting bin balance."),
});
export const feedstockCreateEnvelopeSchema = z.object({
  data: z.array(feedstockRepresentationSchema).describe("Created feedstocks, one per bin allocation; ids and codes are provisional in a dry run."),
  warnings: z.array(z.string()).optional().describe("Non-fatal operator guidance, plain text."),
  preview: z.array(feedstockPreviewSchema).optional().describe("Stock additions for a dry run only, in kilograms."),
});
