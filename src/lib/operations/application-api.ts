import { validationFailed } from "./errors";
import { z } from "zod";
import { DomainError } from "@/lib/domain-errors";
import { normalizeGeoJson } from "@/lib/geojson/normalize";
import { recordApplicationApiInput, updateApplicationApiOperationInput } from "@/schemas/application-api-input";
import { recordApplicationInput, updateApplicationInput } from "@/schemas/application-input";
import type { ApplicationOperationOutput } from "@/data-access/application-operation-output";
import { recordApplication, updateApplication, describeRecordedApplication, describeUpdatedApplication } from "./applications";
import type { Operation } from "./runner";

function validated<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed(result.error);
  return result.data;
}
function normalizeBoundary(value: unknown) {
  if (value === null || value === undefined) return value;
  const fail = (message: string): never => { throw new DomainError("validation_failed", message, {
    issues: [{ path: ["gisBoundary"], code: "validation_failed", message }],
  }); };
  if (typeof value !== "object" || Array.isArray(value)) return fail("The GeoJSON root must be an object.");
  if ("source" in value || "collection" in value || "capturedAt" in value || "fileName" in value || "stats" in value || "version" in value || "notes" in value) {
    return fail("Send raw GeoJSON, without boundary envelope fields.");
  }
  if (!("type" in value) || !["FeatureCollection", "Feature", "Polygon", "MultiPolygon"].includes(String(value.type))) {
    return fail("Send a GeoJSON FeatureCollection, Feature, Polygon or MultiPolygon in WGS 84.");
  }
  const result = normalizeGeoJson({ text: JSON.stringify(value), source: "api" });
  if (!result.ok) return fail(result.error);
  return result.boundary;
}

/** Raw client geometry is fingerprinted by the runner before capture facts are generated. */
export const recordApplicationApi: Operation<typeof recordApplicationApiInput, ApplicationOperationOutput> = {
  ...recordApplication, input: recordApplicationApiInput,
  describe: (input, output) => describeRecordedApplication(input, output.application),
  execute: (scope, input) => recordApplication.execute(scope, validated(recordApplicationInput, { ...input, gisBoundary: normalizeBoundary(input.gisBoundary) })),
};
export const updateApplicationApi: Operation<typeof updateApplicationApiOperationInput, ApplicationOperationOutput> = {
  ...updateApplication, input: updateApplicationApiOperationInput,
  describe: (input, output) => describeUpdatedApplication(input, output.application),
  execute: (scope, input) => updateApplication.execute(scope, validated(updateApplicationInput, { ...input, gisBoundary: normalizeBoundary(input.gisBoundary) })),
};
