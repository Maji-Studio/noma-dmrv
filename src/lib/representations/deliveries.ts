import { z } from "zod";
import { distanceSources } from "@/schemas/distance-source";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const deliveryRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  facilityId: z.uuid().describe("Owning facility identifier, UUID."),
  orderId: z.uuid().describe("Delivered order identifier, UUID."),
  storageLocationId: z.uuid().describe("Source product bin identifier, UUID."),
  deliveredAt: z.iso.datetime().describe("Delivery event instant in UTC, RFC 3339."),
  deliveredWetMassKg: z.number().describe("Delivered wet product kilograms, stored to 3 decimal places."),
  moisturePercent: z.number().nullable().describe("Water as percent of wet mass, stored to 6 decimal places; null when not recorded. The recorded reading, except a split-bin delivery sent with sources, where the server stores the overall (1 minus total solids divided by wet mass) times 100, including ingredient solids."),
  dryBiocharKg: z.number().nullable().describe("Server-derived dry biochar kilograms from the stored dry mass, to 3 decimal places; null when not recorded."),
  driverId: z.uuid().nullable().describe("Driver identifier, UUID, or null when unspecified."),
  vehicleId: z.uuid().nullable().describe("Vehicle identifier, UUID, or null when unspecified."),
  distanceKmOverride: z.number().nullable().describe("One-way distance override in kilometres; the server counts the round trip. Null uses the destination distance. Stored as 32-bit floating-point real, about 6 significant decimal digits."),
  distanceSource: z.literal([...distanceSources, null]).describe("Distance provenance, or null when unspecified. Documentary evidence may be stored without an override."),
  distanceNote: z.string().nullable().describe("Distance evidence note, or null when unspecified."),
  destinationCustomerLocationId: z.uuid().nullable().describe("Order destination customer location identifier, UUID, or null when the order has none."),
}).omit({ name: true });
export type DeliveryRepresentation = z.infer<typeof deliveryRepresentationSchema>;
export type DeliveryRepresentationInput = LookupRepresentationInput<Omit<DeliveryRepresentation,
  "deliveredAt" | "moisturePercent" | "dryBiocharKg" | "destinationCustomerLocationId">> & {
  deliveryDate: Date | string; moistureContentPercent: number | null; massDryKg: number | null; orderCustomerLocationId: string | null;
};

/** Stored delivery fields and the order destination; stock movements describe drawn products. */
export function representDelivery(row: DeliveryRepresentationInput): DeliveryRepresentation {
  return deliveryRepresentationSchema.parse({ ...row, ...lookupInstants(row),
    deliveredAt: new Date(row.deliveryDate).toISOString(), moisturePercent: row.moistureContentPercent,
    dryBiocharKg: row.massDryKg, destinationCustomerLocationId: row.orderCustomerLocationId });
}
