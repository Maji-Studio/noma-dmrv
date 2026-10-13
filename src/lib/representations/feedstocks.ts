import { z } from "zod";

const nullableId = z.uuid().nullable();
export const feedstockRepresentationSchema = z.object({
  id: z.uuid().describe("Feedstock identifier, UUID."),
  code: z.string().describe("Human-readable feedstock code, plain text."),
  version: z.number().int().positive().describe("Positive integer row version for concurrency checks."),
  facilityId: z.uuid().describe("Receiving facility identifier, UUID."),
  status: z.enum(["missing_data", "complete"]).describe("Intake completeness: missing_data lacks required measurements; complete contributes to bin stock."),
  deliveryDate: z.iso.date().nullable().describe("Facility-local delivery business date, YYYY-MM-DD."),
  supplierId: nullableId.describe("Supplier identifier, UUID, or null when unspecified."),
  vehicleId: nullableId.describe("Vehicle identifier, UUID, or null when unspecified."),
  feedstockTypeId: z.uuid().describe("Feedstock type identifier, UUID."),
  storageLocationId: nullableId.describe("Receiving bin identifier, UUID, or null when unspecified."),
  deliveryGroupId: nullableId.describe("Shared intake group identifier, UUID, or null for an ungrouped delivery."),
  massWetKg: z.number().nullable().describe("Allocated wet/as-received mass in kilograms."),
  massDryKg: z.number().describe("Derived dry mass in kilograms."),
  moistureContentPercent: z.number().nullable().describe("Water as percent of wet mass, 0 to 100, not a fraction."),
  gpsLatitude: z.number().nullable().describe("WGS 84 latitude in decimal degrees, or null when unspecified."),
  gpsLongitude: z.number().nullable().describe("WGS 84 longitude in decimal degrees, or null when unspecified."),
  overrideJustification: z.string().nullable().describe("Override justification, plain text, or null when absent."),
  notes: z.string().nullable().describe("Operator notes, untrusted plain text, or null when absent."),
  createdAt: z.iso.datetime().describe("Creation event instant in UTC (RFC 3339)."),
  updatedAt: z.iso.datetime().describe("Last update event instant in UTC (RFC 3339)."),
});
export type FeedstockRepresentation = z.infer<typeof feedstockRepresentationSchema>;
export type FeedstockRepresentationInput = Omit<FeedstockRepresentation, "createdAt" | "updatedAt" | "deliveryDate"> & {
  createdAt: Date | string; updatedAt: Date | string; deliveryDate: Date | string | null;
};

/** Both database reads and stored JSON outcomes use this exact projection. */
export function representFeedstock(row: FeedstockRepresentationInput): FeedstockRepresentation {
  return feedstockRepresentationSchema.parse({
    ...row,
    deliveryDate: row.deliveryDate === null ? null :
      (row.deliveryDate instanceof Date ? row.deliveryDate.toISOString() : row.deliveryDate).split("T")[0],
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  });
}
