import { roundKg } from "@/lib/calculations/mass-dry";
import { z } from "zod";
import type { Application } from "@/db/schema";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import type { GisBoundary } from "@/lib/geojson/types";
import { lookupFields, lookupInstants, lookupVersion } from "./lookup-fields";

const position = z.tuple([z.number(), z.number()]);
const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const applicationBoundarySummarySchema = z.object({
  areaHectares: z.number().describe("Stored boundary area in hectares."),
  featureCount: z.number().int().describe("Number of polygon features."),
  vertexCount: z.number().int().describe("Number of boundary vertices."),
  bbox: bbox.describe("WGS 84 extent as west, south, east, north in decimal degrees."),
  center: position.describe("Boundary centre as longitude, latitude in decimal degrees."),
});
const polygon = z.array(z.array(position));
export const applicationBoundaryRepresentationSchema = applicationBoundarySummarySchema.extend({
  collection: z.object({
    type: z.literal("FeatureCollection").describe("GeoJSON collection type."),
    features: z.array(z.object({
      type: z.literal("Feature").describe("GeoJSON feature type."),
      properties: z.record(z.string(), z.unknown()).nullable().describe("Stored JSON feature properties."),
      geometry: z.union([
        z.object({ type: z.literal("Polygon").describe("Polygon geometry."), coordinates: polygon.describe("WGS 84 rings of longitude and latitude positions.") }),
        z.object({ type: z.literal("MultiPolygon").describe("MultiPolygon geometry."), coordinates: z.array(polygon).describe("WGS 84 polygons of longitude and latitude positions.") }),
      ]).describe("Stored polygon geometry."),
    })).describe("Full stored boundary features."),
    bbox: bbox.describe("WGS 84 collection extent as west, south, east, north."),
  }).describe("Full stored GeoJSON FeatureCollection in WGS 84."),
});

export const applicationRepresentationSchema = z.object({
  id: lookupFields.id, code: lookupFields.code, version: lookupVersion,
  deliveryId: z.uuid().describe("Source delivery identifier, UUID."),
  applicationDate: z.iso.date().describe("Application calendar date, YYYY-MM-DD, on the delivery facility's clock."),
  appliedWetMassKg: z.number().describe("Applied wet kilograms of delivered product, to 3 decimal places."),
  dryBiocharKg: z.number().describe("Server-derived dry biochar kilograms allocated from the delivery, to 3 decimal places."),
  fieldSizeHa: z.number().describe("Applied field area in hectares."),
  fieldIdentifier: z.string().nullable().describe("Field or parcel identifier, or null when unspecified."),
  cropType: z.string().nullable().describe("Crop type, or null when unspecified."),
  applicationMethod: z.literal(["manual", "mechanical", null]).describe("Spreading method, or null when unspecified."),
  evidenceMethod: z.enum(["location", "boundary", "visual"]).describe("Stored spreading evidence method. Legacy visual records remain readable."),
  gpsLatitude: z.number().nullable().describe("Latitude in decimal degrees, or null when unspecified."),
  gpsLongitude: z.number().nullable().describe("Longitude in decimal degrees, or null when unspecified."),
  gisBoundary: applicationBoundarySummarySchema.nullable().describe("Stored boundary summary, or null. Read full geometry from the boundary route."),
  soilTemperatureSource: z.literal(["baseline", "global_database", null]).describe("Soil temperature provenance, or null when unspecified."),
  soilTemperatureC: z.number().nullable().describe("Annual average soil temperature in degrees Celsius, or null when unspecified."),
  allocations: z.array(z.object({
    biocharProductId: z.uuid().describe("Allocated product identifier, UUID."),
    productionRunId: z.uuid().describe("Allocated source run identifier, UUID."),
    wetMassKg: z.number().describe("Frozen allocated wet product kilograms, to 3 decimal places."),
    dryBiocharKg: z.number().describe("Frozen server-derived dry biochar kilograms, to 3 decimal places."),
  })).describe("Frozen product and source run shares, ordered by product and run identifier."),
  createdAt: lookupFields.createdAt, updatedAt: lookupFields.updatedAt,
});
export type ApplicationRepresentation = z.infer<typeof applicationRepresentationSchema>;
export type ApplicationRepresentationInput = Omit<Application, "applicationDate" | "createdAt" | "updatedAt"> & {
  applicationDate: Date | string; createdAt: Date | string; updatedAt: Date | string;
  allocations: { biocharProductId: string; productionRunId: string; wetMassKg: number; dryMassKg: number }[];
};

export function applicationBoundarySummary(boundary: GisBoundary) {
  return { areaHectares: boundary.stats.areaHectares, featureCount: boundary.stats.features,
    vertexCount: boundary.stats.vertices, bbox: boundary.stats.bbox, center: boundary.stats.center };
}

export function representApplicationBoundary(boundary: GisBoundary) {
  return { ...applicationBoundarySummary(boundary), collection: boundary.collection };
}

export function representApplication(row: ApplicationRepresentationInput): ApplicationRepresentation {
  return applicationRepresentationSchema.parse({ ...row, ...lookupInstants(row),
    applicationDate: new Date(row.applicationDate).toISOString().slice(0, "YYYY-MM-DD".length),
    appliedWetMassKg: roundKg(tonnesToKg(row.biocharAppliedTons)),
    dryBiocharKg: roundKg(tonnesToKg(row.biocharAppliedDryTons)),
    applicationMethod: row.applicationMethodType,
    gisBoundary: row.gisBoundary ? applicationBoundarySummary(row.gisBoundary) : null,
    allocations: row.allocations.map(({ biocharProductId, productionRunId, wetMassKg, dryMassKg }) => ({
      biocharProductId, productionRunId, wetMassKg, dryBiocharKg: dryMassKg,
    })).sort((a, b) => a.biocharProductId.localeCompare(b.biocharProductId) || a.productionRunId.localeCompare(b.productionRunId)),
  });
}
