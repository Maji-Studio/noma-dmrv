import { z } from "zod";
import { eventInstantSchema } from "./event-instant";
import { expectedVersionSchema, requiredPositiveMassKgSchema, storedPercentSchema, uuidSchema } from "./helpers";
import { DELIVERED_WET_MASS_MIN_KG, DELIVERED_WET_MASS_RANGE_MESSAGE } from "@/lib/delivery-wet-mass";
import { orderedSourceSchema, MAX_STOCK_ENTRY_ITEMS } from "./output-stock";
import { optionalDistanceSource } from "./distance-source";

export const DELIVERY_DISTANCE_MESSAGE = "Distance must be greater than 0";
const metadata = {
  driverId: uuidSchema().nullable().optional().describe("Driver UUID; null clears the driver on update."),
  vehicleId: uuidSchema().nullable().optional().describe("Vehicle UUID; null clears the vehicle on update."),
  distanceKmOverride: z.number().finite().positive(DELIVERY_DISTANCE_MESSAGE).nullable().optional()
    .describe("One-way km; the server counts the round trip. Omit to use the location distance."),
  distanceSource: optionalDistanceSource.describe("Distance provenance: map estimate, manual entry or documentary evidence. Documentary provenance may be supplied without an override."),
  distanceNote: z.string().max(500).nullable().optional().describe("Distance evidence note. Omission preserves it on update; null clears it."),
};

export const recordDeliveryInput = z.strictObject({
  orderId: uuidSchema().describe("Order UUID. The order determines the shipping facility and formulation."),
  storageLocationId: uuidSchema().describe("Source product bin UUID, in the order facility and holding its formulation."),
  deliveredAt: eventInstantSchema.describe("Delivery instant, resolved in the order facility time zone. Cannot be in the future; local DST gaps and folds are refused."),
  deliveredWetMassKg: requiredPositiveMassKgSchema(
    "Delivered wet mass is required", "Delivered wet mass must be a number", "Delivered wet mass must be greater than 0",
    { value: DELIVERED_WET_MASS_MIN_KG, message: DELIVERED_WET_MASS_RANGE_MESSAGE },
  ).describe("Delivered wet product mass in kilograms."),
  moisturePercent: storedPercentSchema().min(0).lt(100).optional().describe("Measured water as percent of wet mass. Required without sources. Ignored when sources are sent; each source carries its own reading and the server stores the overall moisture."),
  sources: z.array(orderedSourceSchema.strict().extend({
    layerId: uuidSchema().describe("Product layerId from get_bin_stock."),
  })).min(1).max(MAX_STOCK_ENTRY_ITEMS)
    .refine(sources => new Set(sources.map(source => source.layerId)).size === sources.length, "Choose each sub-bin once.").optional().describe("Split-bin products in operator draw order. Get each product layerId from get_bin_stock and supply its measured moisturePercent."),
  basisFingerprint: z.string().min(1).optional().describe("Stock basis from the dry run. Send on the real write to refuse it if stock changed."),
  ...metadata,
}).superRefine((value, ctx) => {
  if (!value.sources && value.moisturePercent === undefined) ctx.addIssue({ code: "custom", path: ["moisturePercent"], message: "Biochar product moisture is required" });
});
export type RecordDeliveryInput = z.output<typeof recordDeliveryInput>;

export const updateDeliveryApiInput = z.strictObject({
  code: z.string().min(1).max(50).regex(/^[A-Z0-9-]+$/).optional().describe("Unique delivery code within the organization."),
  ...metadata,
  expectedVersion: expectedVersionSchema,
});
export type UpdateDeliveryApiInput = z.output<typeof updateDeliveryApiInput>;
