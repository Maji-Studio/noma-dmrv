import { z } from "zod";
import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { recordApplicationInput, updateApplicationInput } from "./application-input";
import { publishedJsonSchemas } from "./published-json-schema";

// Geometry validation belongs to the normalizer during execute, after replay.
const rawBoundary = z.custom<unknown>().register(publishedJsonSchemas, { jsonSchema: { type: "object" } })
  .describe(`Raw GeoJSON FeatureCollection, Feature, Polygon or MultiPolygon in WGS 84. Do not send the app boundary envelope. The full JSON body must fit within ${API_BODY_MAX_BYTES} bytes; add larger boundaries in the app.`);
export const recordApplicationApiInput = z.strictObject({ ...recordApplicationInput.shape, gisBoundary: rawBoundary.nullable().optional().describe(rawBoundary.description!) });
export const updateApplicationApiInput = z.strictObject({ ...updateApplicationInput.omit({ applicationId: true, expectedVersion: true }).shape, gisBoundary: rawBoundary.nullable().optional().describe(rawBoundary.description!) });
export const updateApplicationApiOperationInput = updateApplicationApiInput.extend({
  applicationId: updateApplicationInput.shape.applicationId,
  expectedVersion: updateApplicationInput.shape.expectedVersion,
});
