import { z } from "zod";
import { eventInstantSchema } from "./event-instant";
import { expectedVersionSchema, requiredPositiveMassKgSchema, storedPercentSchema, uuidSchema } from "./helpers";
import { DELIVERED_WET_MASS_MIN_KG, DELIVERED_WET_MASS_RANGE_MESSAGE } from "@/lib/delivery-wet-mass";
import { orderedSourceSchema, MAX_STOCK_ENTRY_ITEMS } from "./output-stock";
import { optionalDistanceSource } from "./distance-source";

export const DELIVERY_DISTANCE_MESSAGE = "Distance must be greater than 0";
const metadata = {
  driverId: uuidSchema().nullable().optional(),
  vehicleId: uuidSchema().nullable().optional(),
  distanceKmOverride: z.number().finite().positive(DELIVERY_DISTANCE_MESSAGE).nullable().optional()
    .describe("One-way km; the server counts the round trip. Omit to use the location distance."),
  distanceSource: optionalDistanceSource,
  distanceNote: z.string().max(500).nullable().optional(),
};

export const recordDeliveryInput = z.strictObject({
  orderId: uuidSchema(),
  storageLocationId: uuidSchema(),
  deliveredAt: eventInstantSchema.describe("Delivery instant, resolved in the order facility time zone."),
  deliveredWetMassKg: requiredPositiveMassKgSchema(
    "Delivered wet mass is required", "Delivered wet mass must be a number", "Delivered wet mass must be greater than 0",
    { value: DELIVERED_WET_MASS_MIN_KG, message: DELIVERED_WET_MASS_RANGE_MESSAGE },
  ),
  moisturePercent: storedPercentSchema().min(0).lt(100).optional(),
  sources: z.array(orderedSourceSchema.strict().extend({
    layerId: uuidSchema().describe("Product layerId from get_bin_stock."),
  })).min(1).max(MAX_STOCK_ENTRY_ITEMS)
    .refine(sources => new Set(sources.map(source => source.layerId)).size === sources.length, "Choose each sub-bin once.").optional().describe("Split-bin products in operator draw order. Get each product layerId from get_bin_stock and supply its measured moisturePercent."),
  basisFingerprint: z.string().min(1).optional(),
  ...metadata,
}).superRefine((value, ctx) => {
  if (!value.sources && value.moisturePercent === undefined) ctx.addIssue({ code: "custom", path: ["moisturePercent"], message: "Biochar product moisture is required" });
});
export type RecordDeliveryInput = z.output<typeof recordDeliveryInput>;

export const updateDeliveryApiInput = z.strictObject({
  code: z.string().min(1).max(50).regex(/^[A-Z0-9-]+$/).optional(),
  ...metadata,
  expectedVersion: expectedVersionSchema,
});
export type UpdateDeliveryApiInput = z.output<typeof updateDeliveryApiInput>;
