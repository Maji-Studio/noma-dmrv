import { z } from "zod";
import {
  GEOJSON_MAX_FEATURES,
  GEOJSON_MAX_NORMALIZED_BYTES,
  GEOJSON_MAX_NOTE_LENGTH,
  GEOJSON_MAX_NOTES,
  GEOJSON_MAX_VERTICES,
} from "@/config/geo";
import { computeBoundaryStats } from "@/lib/geojson/stats";
import type { GisBoundary } from "@/lib/geojson/types";

const positionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const linearRingSchema = z
  .array(positionSchema)
  .min(4)
  .refine(
    (ring) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      return first[0] === last[0] && first[1] === last[1];
    },
    { message: "Boundary rings must be closed" },
  );
const polygonCoordinatesSchema = z.array(linearRingSchema).min(1);
const multiPolygonCoordinatesSchema = z.array(polygonCoordinatesSchema).min(1);
const bboxSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const propertiesSchema = z.record(z.string(), z.json());

const polygonFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: propertiesSchema,
  geometry: z.object({
    type: z.literal("Polygon"),
    coordinates: polygonCoordinatesSchema,
  }),
});

const multiPolygonFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: propertiesSchema,
  geometry: z.object({
    type: z.literal("MultiPolygon"),
    coordinates: multiPolygonCoordinatesSchema,
  }),
});

const gisBoundaryEnvelopeSchema = z
  .object({
    version: z.literal(1),
    source: z.enum(["upload", "paste"]),
    fileName: z.string().min(1).max(255).nullable(),
    capturedAt: z.iso.datetime(),
    collection: z.object({
      type: z.literal("FeatureCollection"),
      features: z
        .array(z.union([polygonFeatureSchema, multiPolygonFeatureSchema]))
        .min(1),
      bbox: bboxSchema,
    }),
    stats: z.object({
      features: z.number().int().positive(),
      vertices: z.number().int().positive(),
      areaHectares: z.number().nonnegative(),
      bbox: bboxSchema,
      center: z.tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ]),
    }),
    notes: z
      .array(z.string().max(GEOJSON_MAX_NOTE_LENGTH))
      .max(GEOJSON_MAX_NOTES),
  })
  .superRefine((value, ctx) => {
    if (value.source === "paste" && value.fileName !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["fileName"],
        message: "Pasted boundaries cannot include a file name",
      });
    }
    if (value.source === "upload" && value.fileName === null) {
      ctx.addIssue({
        code: "custom",
        path: ["fileName"],
        message: "Uploaded boundaries require a file name",
      });
    }
  });

export const gisBoundarySchema: z.ZodType<GisBoundary, GisBoundary> =
  gisBoundaryEnvelopeSchema;

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Revalidate a client-returned boundary before persistence.
 *
 * The Zod schema checks the envelope and geometry shape. Everything a reader
 * later treats as a measurement — extent, centre, area, feature and vertex
 * counts — is recomputed here from `collection.features` and written back over
 * whatever the caller sent, so a hand-crafted payload cannot claim a different
 * location or size than the coordinates it stores. The caps are then enforced
 * against those recomputed numbers.
 */
export function parseGisBoundary(value: unknown): GisBoundary {
  const parsed = gisBoundarySchema.parse(value);
  const stats = computeBoundaryStats(parsed.collection.features);

  if (stats.features > GEOJSON_MAX_FEATURES) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["collection", "features"],
        message: `This boundary has ${stats.features} areas. The maximum is ${GEOJSON_MAX_FEATURES}.`,
      },
    ]);
  }
  if (stats.vertices > GEOJSON_MAX_VERTICES) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["collection", "features"],
        message: `This boundary has ${stats.vertices} vertices. The maximum is ${GEOJSON_MAX_VERTICES}.`,
      },
    ]);
  }

  const boundary: GisBoundary = {
    ...parsed,
    collection: { ...parsed.collection, bbox: stats.bbox },
    stats,
  };

  if (serializedBytes(boundary) > GEOJSON_MAX_NORMALIZED_BYTES) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["collection"],
        message:
          "This boundary is too detailed to store. Simplify it and upload again.",
      },
    ]);
  }

  return boundary;
}

export type { GisBoundary } from "@/lib/geojson/types";
