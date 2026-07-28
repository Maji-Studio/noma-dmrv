import { z } from "zod";
import {
  GEOJSON_MAX_FEATURES,
  GEOJSON_MAX_NORMALIZED_BYTES,
  GEOJSON_MAX_VERTICES,
} from "@/config/geo";
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
    notes: z.array(z.string()),
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
    if (value.stats.features !== value.collection.features.length) {
      ctx.addIssue({
        code: "custom",
        path: ["stats", "features"],
        message: "Boundary feature statistics do not match the collection",
      });
    }
    if (
      value.collection.bbox.some(
        (coordinate, index) => coordinate !== value.stats.bbox[index],
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["stats", "bbox"],
        message: "Boundary extent statistics do not match the collection",
      });
    }
  });

export const gisBoundarySchema: z.ZodType<GisBoundary, GisBoundary> =
  gisBoundaryEnvelopeSchema;

function countPositionArray(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  if (
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return 1;
  }
  return value.reduce(
    (total, entry) => total + countPositionArray(entry),
    0,
  );
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Revalidate a client-returned boundary before persistence. The Zod schema
 * checks the envelope and geometry shape; these checks enforce render and
 * server-action budgets from the actual collection rather than trusting stats.
 */
export function parseGisBoundary(value: unknown): GisBoundary {
  const parsed = gisBoundarySchema.parse(value);
  const featureCount = parsed.collection.features.length;
  const vertexCount = parsed.collection.features.reduce(
    (total, feature) =>
      total + countPositionArray(feature.geometry.coordinates),
    0,
  );

  if (featureCount > GEOJSON_MAX_FEATURES) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["collection", "features"],
        message: `This boundary has ${featureCount} areas. The maximum is ${GEOJSON_MAX_FEATURES}.`,
      },
    ]);
  }
  if (vertexCount > GEOJSON_MAX_VERTICES) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["collection", "features"],
        message: `This boundary has ${vertexCount} vertices. The maximum is ${GEOJSON_MAX_VERTICES}.`,
      },
    ]);
  }
  if (parsed.stats.vertices !== vertexCount) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["stats", "vertices"],
        message: "Boundary vertex statistics do not match the collection",
      },
    ]);
  }
  if (serializedBytes(parsed) > GEOJSON_MAX_NORMALIZED_BYTES) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["collection"],
        message:
          "This boundary is too detailed to store. Simplify it and upload again.",
      },
    ]);
  }

  return parsed as GisBoundary;
}

export type { GisBoundary } from "@/lib/geojson/types";
