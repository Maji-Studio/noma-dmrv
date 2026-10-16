import { z } from "zod";
import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { recordApplicationApiInput, updateApplicationApiInput } from "@/schemas/application-api-input";
import { applicationWriteEnvelopeSchema } from "@/lib/representations/application-writes";
import { applicationRepresentationSchema } from "@/lib/representations/applications";
import { itemEnvelopeSchema } from "@/lib/representations/envelopes";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { problemSchema } from "../problem-schema";
import { mutationQuerySchema } from "../query";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { etagHeader, idempotencyParameter, ifMatchParameter, jsonResponse, locationHeader, privateHeaders, problemResponses, queryParameters, targetParameter, writeHeaders } from "./transport";
const GUIDANCE = "Mass is applied wet kg of delivered product, in steps of 0.001 kg. Dry biochar is derived and cannot be supplied. Field size is hectares. applicationDate is a YYYY-MM-DD calendar date on the delivery facility's clock, not before delivery or in the future. Never invent field size or GPS. Raw GeoJSON must be WGS 84. Boundary evidence requires a boundary on create and after merging a PATCH. Capacity is checked under the delivery lock; committed allocations are authoritative.";
const REFUSALS = "Unknown fields answer 422 validation_failed. Missing, foreign or archived deliveries or facilities answer 404 not_found at /deliveryId. A delivery that is not delivered answers 422 at /deliveryId. Invalid dates answer 422 at /applicationDate, geometry at /gisBoundary, GPS at /gpsLatitude and field size at /fieldSizeHa. Capacity answers 409 conflict at /appliedWetMassKg with issue meta { measure: delivery_remaining_wet, availableWetKg, requestedWetKg, unit: kg }. Missing provenance and duplicate codes answer 409 conflict. Sent lineage and Removal-owned slices refuse protected changes with 409 certification_locked. The visual evidence method is not available yet.";
export function addApplicationWritePaths(paths: Paths, { publishOutput, writeErrors }: { publishOutput: (schema: z.ZodType) => JsonSchema; writeErrors: number[] }) {
  const envelope = publishOutput(applicationWriteEnvelopeSchema);
  const errors = problemResponses([...writeErrors, 413, 415]);
  const stale = { description: "Stale If-Match, with the current application representation.", content: { "application/problem+json": { schema: publishOutput(problemSchema.extend({ current: applicationRepresentationSchema.describe("Current application after a failed precondition.") })) } }, headers: privateHeaders };
  paths["/applications"].post = {
    ...privateOperation("record_application", "applications:write", `Record one field application with a generated code. ${GUIDANCE} ${REFUSALS} First find a delivery with hasRemainingMass=true and read its application-balance. Omitted location GPS and soil temperature copy site defaults with warnings; explicit null on soil temperature or its source means no site default is copied. Idempotency-Key is required, including dry runs. A replay returns the stored outcome. Dry runs return 200 with Dry-Run: true and save no application, activity or audit event. Committed creates return 201, Location and ETag.`, {
      ...errors, "201": jsonResponse("Application committed or replayed.", envelope, { ...etagHeader, ...locationHeader, ...writeHeaders }),
      "200": jsonResponse("Dry-run application, allocations, balance and warnings. No Location or ETag.", envelope, writeHeaders),
    }, [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(operationInput(recordApplicationApiInput), { deliveryId: "ea31ace1-5b30-4443-adb4-26b43bfa5599", applicationDate: "2026-10-08", appliedWetMassKg: 1200, fieldSizeHa: 3 }),
  };
  paths["/applications/{idOrCode}"].patch = {
    ...privateOperation("update_application", "applications:write", `Update by UUID with a strong If-Match; code paths answer 404. Missing If-Match answers 428; stale tags answer 412 with the current representation. Omitted fields stay unchanged; null clears optional fields. PATCH never copies site defaults. Repointing to another delivery is allowed. ${GUIDANCE} ${REFUSALS} Dry runs roll back and return 200 without ETag. Optional idempotency keys bind to the target and If-Match and replay before precondition checks.`, {
      ...errors, ...problemResponses([428]), "412": stale, "200": jsonResponse("Updated application or dry-run preview. ETag is absent on dry runs.", envelope, { ...etagHeader, ...writeHeaders }),
    }, [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: requestBody(operationInput(updateApplicationApiInput), { cropType: "Maize" }),
  };
  paths["/applications/{idOrCode}"].delete = {
    ...privateOperation("delete_application", "applications:delete", "Delete by UUID with a strong If-Match. The separate applications:delete scope is off by default. Missing If-Match answers 428; stale tags answer 412 with the current representation. Sent lineage and Removal-owned slices answer 409 certification_locked. Archived applications can be deleted. Documents retire in the transaction; storage cleanup runs after commit. Dry runs roll back and return the representation that would be deleted. Optional idempotency keys bind to the target and If-Match and replay before precondition checks. A supplied body must be an empty JSON object.", {
      ...errors, ...problemResponses([428]), "412": stale,
      "204": { description: "Deleted or replayed deletion, without a body.", headers: { ...privateHeaders, ...writeHeaders } },
      "200": jsonResponse("Dry-run deleted representation.", publishOutput(itemEnvelopeSchema(applicationRepresentationSchema)), writeHeaders),
    }, [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: { required: false, description: `Optional empty JSON object, maximum ${API_BODY_MAX_BYTES} bytes.`, content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } } },
  };
}
