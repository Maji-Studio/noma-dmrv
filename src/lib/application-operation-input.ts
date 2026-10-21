import type { ApplicationFormData } from "@/schemas/applications";

/**
 * Operation input fields the form names differently (the renames in
 * `applicationOperationInput`, reversed), so a refused save lands on the
 * field the operator edited.
 */
export const APPLICATION_REFUSAL_ALIASES = {
  appliedWetMassKg: "biocharAppliedKg",
  applicationMethod: "applicationMethodType",
} as const;

/** The operation input for an application, built from the form data. */
export function applicationOperationInput(data: ApplicationFormData) {
  const { biocharAppliedKg, applicationMethodType, ...fields } = data;
  return { ...fields, gpsLatitude: fields.gpsLatitude ?? null, gpsLongitude: fields.gpsLongitude ?? null,
    soilTemperatureC: fields.soilTemperatureC ?? null, soilTemperatureSource: fields.soilTemperatureSource ?? null,
    appliedWetMassKg: biocharAppliedKg, applicationMethod: applicationMethodType };
}
