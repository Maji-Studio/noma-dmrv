import { z } from "zod";

const optionalId = z.uuid().optional();

export const stockAvailabilityRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("productionRunFeedstock"),
    storageLocationId: z.uuid(),
    productionRunId: optionalId,
  }),
  z.object({
    kind: z.literal("biocharProduct"),
    sourceBiocharStorageLocationId: z.uuid(),
    biocharProductId: optionalId,
  }),
  z.object({
    kind: z.literal("delivery"),
    orderId: z.uuid(),
    deliveryId: optionalId,
    biocharProductId: optionalId,
  }),
]);

export type StockAvailabilityRequest = z.infer<
  typeof stockAvailabilityRequestSchema
>;
