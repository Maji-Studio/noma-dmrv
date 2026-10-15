import { z } from "zod";
import { calendarDateSchema, expectedVersionSchema, MASS_KG_INPUT_STEP, MASS_MIN_KG_MESSAGE, positiveMassKgSchema, uuidSchema } from "./helpers";
import { applicationEvidenceStateSchema, applicationMethods, soilTemperatureSources } from "./applications";
import { gisBoundarySchema } from "./gis-boundary";
import { FIELD_SIZE_POSITIVE_MESSAGE } from "@/lib/application-field-size";

const MIN_SOIL_TEMPERATURE_C = -50;
const MAX_SOIL_TEMPERATURE_C = 60;
const MAX_FIELD_IDENTIFIER_LENGTH = 255;
const MAX_CROP_TYPE_LENGTH = 100;
const MAX_CODE_LENGTH = 50;
const fields = {
  deliveryId: uuidSchema().describe("Delivered source delivery UUID."),
  applicationDate: calendarDateSchema().describe("Application calendar date, YYYY-MM-DD, on the delivery facility clock; not before delivery or in the future."),
  appliedWetMassKg: positiveMassKgSchema().min(MASS_KG_INPUT_STEP, MASS_MIN_KG_MESSAGE).describe("Applied wet kilograms of delivered product in 0.001 kg steps. Dry biochar is derived, never supplied."),
  fieldSizeHa: z.number().positive(FIELD_SIZE_POSITIVE_MESSAGE).describe("Measured field area in hectares. Never invent field size."),
  fieldIdentifier: z.string().max(MAX_FIELD_IDENTIFIER_LENGTH).nullable().optional().describe("Field or parcel identifier; null for none."),
  cropType: z.string().max(MAX_CROP_TYPE_LENGTH).nullable().optional().describe("Crop type; null for none."),
  applicationMethod: z.enum(applicationMethods).describe("Spreading method: manual or mechanical.").nullable().optional().describe("Spreading method; null for none."),
  evidenceMethod: z.enum(["location", "boundary", "visual"]).refine(value => value !== "visual", "This evidence method is not available yet.").describe("Evidence method: location requires GPS; boundary requires GeoJSON. Visual is not available yet."),
  gpsLatitude: z.number().min(-90).max(90).nullable().optional().describe("Latitude in decimal degrees; provide both GPS coordinates. Never invent GPS."),
  gpsLongitude: z.number().min(-180).max(180).nullable().optional().describe("Longitude in decimal degrees; provide both GPS coordinates."),
  gisBoundary: gisBoundarySchema.nullable().optional(),
  soilTemperatureSource: z.enum(soilTemperatureSources).describe("Temperature provenance: baseline or global_database.").nullable().optional().describe("Soil temperature provenance; null for none."),
  soilTemperatureC: z.number().min(MIN_SOIL_TEMPERATURE_C).max(MAX_SOIL_TEMPERATURE_C).nullable().optional().describe("Annual average soil temperature in degrees Celsius; null for none."),
};
export const recordApplicationInput = z.strictObject({ ...fields, evidenceMethod: fields.evidenceMethod.default("location") }).superRefine((data, ctx) => {
  // An omitted location pair is resolved inside the operation; the writer validates the final state.
  if (data.evidenceMethod === "location" && data.gpsLatitude === undefined && data.gpsLongitude === undefined) return;
  const result = applicationEvidenceStateSchema.safeParse(data);
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: issue.path[0] === "gpsLongitude" ? ["gpsLatitude"] : issue.path, message: issue.message });
});
export const updateApplicationInput = z.strictObject({
  ...z.object(fields).partial().shape,
  applicationId: uuidSchema(),
  expectedVersion: expectedVersionSchema,
  code: z.string().min(1).max(MAX_CODE_LENGTH).regex(/^[A-Z0-9-]+$/).optional().describe("Human-readable application code: capital letters, digits and hyphens."),
});
export const deleteApplicationInput = z.strictObject({ applicationId: uuidSchema(), expectedVersion: expectedVersionSchema });
export type RecordApplicationInput = z.output<typeof recordApplicationInput>;
export type UpdateApplicationInput = z.output<typeof updateApplicationInput>;
export type DeleteApplicationInput = z.output<typeof deleteApplicationInput>;
