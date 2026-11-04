import { z } from "zod";
import { massKgSchema, stockEventInstantSchema, uuidSchema } from "./helpers";
import { moistureSchema, orderedSourcesSchema, wetMassSchema } from "./output-stock";

/** Only persisted records have provenance to resolve. */
export const recordCreditBatchesSchema = z.object({
  kind: z.enum(["feedstock", "biochar-product", "delivery", "application"]),
  id: uuidSchema(),
});

export type RecordCreditBatchesInput = z.infer<typeof recordCreditBatchesSchema>;

/** The output bin a delivery or product draws from, at the entry's time. */
const previewBinSchema = z.object({
  storageLocationId: uuidSchema(),
  facilityId: uuidSchema(),
  occurredAt: stockEventInstantSchema(),
});

/** The draw as the stock preview plans it; null until mass and readings are entered. */
const previewDrawSchema = z.object({
  wetMassKg: wetMassSchema(),
  moisturePercent: moistureSchema().nullable().optional(),
  sources: orderedSourcesSchema.optional(),
}).nullable();

/** An unsaved record's source, as its form holds it (#1350). */
export const recordCreditBatchPreviewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delivery"), bin: previewBinSchema, draw: previewDrawSchema }),
  z.object({ kind: z.literal("biochar-product"), bin: previewBinSchema, draw: previewDrawSchema }),
  z.object({
    kind: z.literal("application"),
    deliveryId: uuidSchema(),
    /** Null until an amount is entered. */
    appliedWetMassKg: massKgSchema().positive().nullable(),
    /** The application being edited, left out of the delivery's other applications. */
    applicationId: uuidSchema().nullable(),
  }),
]);

export type RecordCreditBatchPreviewInput = z.infer<typeof recordCreditBatchPreviewSchema>;
