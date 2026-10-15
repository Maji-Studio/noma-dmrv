import { z } from "zod";
import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { guidedWriteEnvelopeSchema, itemEnvelopeSchema } from "@/lib/representations/envelopes";
import { labSampleRepresentationSchema } from "@/lib/representations/lab-samples";
import { recordLabSampleInput, updateLabSampleApiInput } from "@/schemas/lab-sample-input";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { mutationQuerySchema } from "../query";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { etagHeader, idempotencyParameter, ifMatchParameter, jsonResponse, locationHeader, privateHeaders, problemResponses, queryParameters, targetParameter, writeHeaders } from "./transport";

const EXAMPLE_CREDIT_BATCH_ID = "0b6b1c0e-5b8e-4a55-9c3c-2f6c8d1b7a10";

const WRITE_GUIDANCE = "H/C_org is always calculated by the server from totalHydrogenPercent and organicCarbonPercent, and O/C_org from totalOxygenPercent when oxygen is present. The response says so in warnings, followed by what a registry submission will still need; neither blocks the write. Every Sample on a sampled credit batch needs moistureContentPercent, and on a 1,000-year batch also sReflectanceFraction, before a Removal can be submitted; mean R0 and TGA are optional. Send samplingTime as RFC 3339 with an explicit offset or as { date, time } in the credit batch facility's zone (facility timeZone, also shown by whoami); a time in the future is refused.";
const ERROR_GUIDANCE = "Refusals: 404 on /creditBatchId for a missing, foreign or archived credit batch, 409 conflict for a duplicate code or certification_locked once the sample's lineage is in a certification, 422 with a pointer for invalid input.";

interface LabSampleWriteKit {
  publishOutput: (schema: z.ZodType) => JsonSchema;
  writeErrors: number[];
}

/** Lab sample create, update and delete. Updates move a sample between credit batches; deletes are behind their own scope. */
export function addLabSampleWritePaths(paths: Paths, { publishOutput, writeErrors }: LabSampleWriteKit) {
  const envelope = publishOutput(guidedWriteEnvelopeSchema(labSampleRepresentationSchema));
  paths["/lab-samples"].post = {
    ...privateOperation("record_lab_sample", "lab-samples:write",
      `Record one lab replicate on a credit batch. Total and organic carbon are required, dry basis. The code is generated. ${WRITE_GUIDANCE} ${ERROR_GUIDANCE} Dry runs roll back and still need an Idempotency-Key. Location and ETag appear only on committed creates.`,
      {
        ...problemResponses([...writeErrors, 413, 415]),
        "201": jsonResponse("Sample committed, or replayed.", envelope, { ...etagHeader, ...locationHeader, ...writeHeaders }),
        "200": jsonResponse("Dry-run sample preview.", envelope, writeHeaders),
      },
      [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(operationInput(recordLabSampleInput), {
      creditBatchId: EXAMPLE_CREDIT_BATCH_ID, samplingTime: { date: "2026-10-08", time: "10:00" },
      totalCarbonPercent: 80, organicCarbonPercent: 78, inorganicCarbonPercent: 2, totalHydrogenPercent: 2.5,
      labName: "Example Lab", labAccreditation: "ISO 17025",
    }),
  };
  paths["/lab-samples/{idOrCode}"].patch = {
    ...privateOperation("update_lab_sample", "lab-samples:write",
      `Update by UUID with a strong If-Match; codes are not accepted in the path. Omission preserves fields, null clears optional ones, and the totals cannot be cleared. Send code to rename and creditBatchId to move the sample to another credit batch. Ratios are recalculated from the merged row. ${WRITE_GUIDANCE} ${ERROR_GUIDANCE} Dry runs roll back; replays precede precondition checks.`,
      {
        ...problemResponses([...writeErrors, 412, 413, 415, 428]),
        "412": { $ref: "#/components/responses/LabSampleProblem412" },
        "200": jsonResponse("Updated sample or dry-run representation. ETag is absent on dry runs.", envelope, { ...etagHeader, ...writeHeaders }),
      },
      [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: requestBody(operationInput(updateLabSampleApiInput), { residualCarbonPercent: 70, labName: null }),
  };
  paths["/lab-samples/{idOrCode}"].delete = {
    ...privateOperation("delete_lab_sample", "lab-samples:delete",
      "Delete by UUID with a strong If-Match. This also deletes the sample's transport legs and retires its lab report documents. A sample in a certification answers 409 certification_locked. Dry runs roll back and return the representation that would be deleted. A supplied body must be an empty JSON object.",
      {
        ...problemResponses([...writeErrors, 412, 413, 415, 428]),
        "412": { $ref: "#/components/responses/LabSampleProblem412" },
        "204": { description: "Deleted, or replay of a committed deletion; no body.", headers: { ...privateHeaders, ...writeHeaders } },
        "200": jsonResponse("Dry-run deleted representation.", publishOutput(itemEnvelopeSchema(labSampleRepresentationSchema)), writeHeaders),
      },
      [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: {
      required: false,
      description: `Optional empty JSON object, maximum ${API_BODY_MAX_BYTES} bytes.`,
      content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } },
    },
  };
}
