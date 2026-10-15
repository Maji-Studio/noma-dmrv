import { DOCUMENT_CONFIRM_DEADLINE_MS } from "@/config/documents";
import { MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import { z } from "zod";
import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { API_DOCUMENT_OWNERS, API_DOCUMENT_OWNER_TYPES } from "@/lib/documents/api-owners";
import { documentUploadEnvelopeSchema } from "@/lib/representations/document-writes";
import { documentRepresentationSchema } from "@/lib/representations/documents";
import { itemEnvelopeSchema } from "@/lib/representations/envelopes";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { requestDocumentUploadBodyInput } from "@/schemas/document-input";
import { mutationQuerySchema } from "../query";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { etagHeader, idempotencyParameter, jsonResponse, locationHeader, problemResponses, queryParameters, targetParameter, writeHeaders } from "./transport";

const WRITE_ERRORS = [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503];
const FLOW = "Files never travel in this call. Request an upload, PUT the bytes to upload.url with upload.headers, then confirm. Use the upload URL without the API key; it expires at expiresAt. A replay with the same key returns the stored data and a fresh link while the upload is pending. Otherwise upload is null with a warning explaining why (uploaded, failed, deleted, expired, archived or submitted).";
const REFUSALS = "Missing or foreign owners answer 404 not_found. Submitted records refuse uploads with 409 certification_locked. Conflicts answer 409 conflict. Unknown properties and invalid declarations answer 422 validation_failed at the field pointer. No dry run: dryRun=true answers 422 validation_failed. No API delete.";
const documentParameter = { name: "documentId", in: "path", required: true, description: "Document UUID belonging to this record.", schema: { type: "string", format: "uuid" } };
const NO_DRY_RUN = "Dry runs are unavailable. true answers 422 validation_failed; false commits.";
const noDryRunParameters = queryParameters(mutationQuerySchema).map(parameter => ({ ...parameter, description: NO_DRY_RUN, schema: { ...parameter.schema, description: NO_DRY_RUN } }));

export function addDocumentWritePaths(paths: Paths, publishOutput: (schema: z.ZodType) => JsonSchema) {
  for (const ownerType of API_DOCUMENT_OWNER_TYPES) {
    const owner = API_DOCUMENT_OWNERS[ownerType];
    const base = `/${owner.path}/{idOrCode}/documents`;
    const declaration = requestDocumentUploadBodyInput.extend({ documentType: z.enum(owner.documentTypes).describe("Document classification allowed for this owner.") });
    paths[base].post = {
      ...privateOperation(`request_${ownerType}_document_upload`, owner.writeScope,
        `Request a private evidence upload. ${FLOW} ${REFUSALS} Reusing a request key with changed input answers 422 idempotency_key_reused. Use the owner UUID path for safe retries after owner deletion or code changes; Location uses that UUID. Archived owners refuse new requests with 404; committed UUID replays remain 201. Idempotency-Key is required (400 idempotency_key_required when missing; 400 idempotency_key_invalid when malformed). The response includes the document GET Location and ETag.`, {
          ...problemResponses(WRITE_ERRORS),
          "201": jsonResponse("Upload requested, or stored outcome replayed with a newly minted capability or warning.", publishOutput(documentUploadEnvelopeSchema), { ...etagHeader, ...locationHeader, "Idempotent-Replayed": writeHeaders["Idempotent-Replayed"] }),
        }, [targetParameter(), ...noDryRunParameters, { ...idempotencyParameter(true), description: "Required unique key for this upload request. Reuse on retry to recover the stored document with a fresh pending upload capability. No dry run." }]),
      requestBody: requestBody(operationInput(declaration), { documentType: owner.documentTypes[0], fileName: "receipt.pdf", contentType: "application/pdf", sizeBytes: 8, sha256: "cf9f6d7f6a764f117a86e8e0baaa26e7e0a36f4498aa78f7ff49275d9636fec0" }),
    };
    paths[`${base}/{documentId}/confirm`] = { post: {
      ...privateOperation(`confirm_${ownerType}_document_upload`, owner.writeScope,
        `Confirm uploaded bytes within a ${DOCUMENT_CONFIRM_DEADLINE_MS / MILLISECONDS_PER_SECOND} second budget. Empty JSON object or no body. E1: Idempotency-Key is accepted and ignored; no idempotency record is written. E2: If-Match is ignored, including malformed tags; no version precondition, 412 or 428. Uploaded repeats return 200 with ETag without storage I/O. Wrong bytes commit a failed transition, then answer 422 validation_failed at /sizeBytes, /contentType or /sha256. Failed repeats answer 409 conflict with the stored reason. A pending upload on a newly submitted owner becomes failed and answers 409 certification_locked at /ownerId. Gone documents, wrong owners and archived pending owners answer 404. Missing bytes answer retryable 409 conflict with Retry-After and stay pending. Budget exhaustion answers retryable 500 deadline_exceeded. ${REFUSALS}`, {
          ...problemResponses(WRITE_ERRORS),
          "200": jsonResponse("Confirmed document, or repeat confirmation of an uploaded document.", publishOutput(itemEnvelopeSchema(documentRepresentationSchema)), etagHeader),
        }, [targetParameter(), documentParameter, ...noDryRunParameters, { name: "Idempotency-Key", in: "header", required: false, description: "Accepted and ignored (E1). Confirm keeps no idempotency record.", schema: { type: "string" } }]),
      requestBody: { required: false, description: `Optional empty JSON object, maximum ${API_BODY_MAX_BYTES} bytes.`, content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } } },
    } };
  }
}
