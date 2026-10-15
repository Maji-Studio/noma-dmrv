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
  deliveryId: uuidSchema(),
  applicationDate: calendarDateSchema(),
  appliedWetMassKg: positiveMassKgSchema().min(MASS_KG_INPUT_STEP, MASS_MIN_KG_MESSAGE),
  fieldSizeHa: z.number().positive(FIELD_SIZE_POSITIVE_MESSAGE),
  fieldIdentifier: z.string().max(MAX_FIELD_IDENTIFIER_LENGTH).nullable().optional(),
  cropType: z.string().max(MAX_CROP_TYPE_LENGTH).nullable().optional(),
  applicationMethod: z.enum(applicationMethods).nullable().optional(),
  evidenceMethod: z.enum(["location", "boundary", "visual"]).refine(value => value !== "visual", "This evidence method is not available yet."),
  gpsLatitude: z.number().min(-90).max(90).nullable().optional(),
  gpsLongitude: z.number().min(-180).max(180).nullable().optional(),
  gisBoundary: gisBoundarySchema.nullable().optional(),
  soilTemperatureSource: z.enum(soilTemperatureSources).nullable().optional(),
  soilTemperatureC: z.number().min(MIN_SOIL_TEMPERATURE_C).max(MAX_SOIL_TEMPERATURE_C).nullable().optional(),
};
export const recordApplicationInput = z.strictObject({ ...fields, evidenceMethod: fields.evidenceMethod.default("location") }).superRefine((data, ctx) => {
  const result = applicationEvidenceStateSchema.safeParse(data);
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: issue.path[0] === "gpsLongitude" ? ["gpsLatitude"] : issue.path, message: issue.message });
});
export const updateApplicationInput = z.strictObject({
  ...z.object(fields).partial().shape,
  applicationId: uuidSchema(),
  expectedVersion: expectedVersionSchema,
  code: z.string().min(1).max(MAX_CODE_LENGTH).regex(/^[A-Z0-9-]+$/).optional(),
});
export const deleteApplicationInput = z.strictObject({ applicationId: uuidSchema(), expectedVersion: expectedVersionSchema });
export type RecordApplicationInput = z.output<typeof recordApplicationInput>;
export type UpdateApplicationInput = z.output<typeof updateApplicationInput>;
export type DeleteApplicationInput = z.output<typeof deleteApplicationInput>;
