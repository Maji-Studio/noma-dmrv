import { z } from "zod";
import { FEEDSTOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "../etag";

const nullableId = z.uuid().nullable();
export const feedstockRepresentationSchema = z.object({
  id: z.uuid(), code: z.string(), version: z.number().int().positive(), facilityId: z.uuid(),
  status: z.enum(["missing_data", "complete"]),
  deliveryDate: z.iso.date().nullable().describe("Facility-local delivery business date, YYYY-MM-DD."),
  supplierId: nullableId, vehicleId: nullableId, feedstockTypeId: z.uuid(), storageLocationId: nullableId,
  deliveryGroupId: nullableId,
  massWetKg: z.number().nullable().describe("Allocated wet/as-received mass in kilograms."),
  massDryKg: z.number().describe("Derived dry mass in kilograms."),
  moistureContentPercent: z.number().nullable().describe("Water as percent of wet mass, 0 to 100, not a fraction."),
  gpsLatitude: z.number().nullable(), gpsLongitude: z.number().nullable(),
  overrideJustification: z.string().nullable(), notes: z.string().nullable(),
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

export function feedstockEtag(row: Pick<FeedstockRepresentation, "version">): string {
  return representationEtag(row.version, FEEDSTOCK_REPRESENTATION_REVISION);
}

/** Intake rows carry the stock additions, not the bin's resulting balance. */
export function feedstockStockPreview(rows: FeedstockRepresentation[]) {
  return rows.map((row) => ({
    feedstockId: row.id, storageLocationId: row.storageLocationId,
    allocatedWetMassKg: row.massWetKg, allocatedDryMassKg: row.massDryKg,
    stockDeltaWetKg: row.status === "complete" ? row.massWetKg : 0,
  }));
}
