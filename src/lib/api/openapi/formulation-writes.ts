import { z } from "zod";
import { API_BODY_MAX_BYTES, FORMULATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { API_FORMULATION_MAX_LINES } from "@/config/api-formulations";
import { itemEnvelopeSchema } from "@/lib/representations/envelopes";
import { formulationRepresentationSchema } from "@/lib/representations/formulations";
import { createFormulationInput, updateFormulationApiInput } from "@/schemas/formulation-input";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { mutationQuerySchema } from "../query";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { etagHeader, idempotencyParameter, ifMatchParameter, jsonResponse, locationHeader, privateHeaders, problemResponses, queryParameters, targetParameter, writeHeaders } from "./transport";

interface FormulationWriteKit {
  publishOutput: (schema: z.ZodType) => JsonSchema;
  writeErrors: number[];
}
const INPUT_GUIDANCE = `Ratios are fractions from 0 to 1 in millionth steps; known shares must sum to at most 1. Ratios guide mixing and never set masses. At most ${API_FORMULATION_MAX_LINES} lines, each with a distinct blend-usage feedstock type. Unknown properties, including nested ones, answer 422 validation_failed with JSON Pointers. Missing, foreign or newly referenced archived feedstock types answer 404 not_found at /lines/{index}/feedstockTypeId. Non-blend types answer 422 validation_failed at the same pointer.`;
const DRY_RUN_GUIDANCE = "Dry runs roll back every write and Activity event, return 200 and Dry-Run, and omit ETag and Location. Deadline exhaustion answers retryable 500 deadline_exceeded.";
const RETRY_GUIDANCE = `If-Match is required (428 precondition_required); a stale row version or representation revision answers 412 stale_version with current. Optional keyed replays precede domain preconditions. ${DRY_RUN_GUIDANCE}`;

export function addFormulationWritePaths(paths: Paths, { publishOutput, writeErrors }: FormulationWriteKit) {
  const envelope = publishOutput(itemEnvelopeSchema(formulationRepresentationSchema));
  const existingErrors = {
    ...problemResponses([...writeErrors, 412, 413, 415, 428]),
    "412": { $ref: "#/components/responses/FormulationProblem412" },
  };
  const existingParameters = [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)];
  const emptyBody = {
    required: false,
    description: `An empty object or no body; non-empty bodies require application/json, maximum ${API_BODY_MAX_BYTES} bytes.`,
    content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } },
  };
  paths["/formulations"].post = {
    ...privateOperation("create_formulation", "formulations:write",
      `Create one formulation with a generated code. Idempotency-Key is required even for dry runs (400 idempotency_key_required). A key reused with a different input answers 422 idempotency_key_reused. ${INPUT_GUIDANCE} ${DRY_RUN_GUIDANCE}`,
      {
        ...problemResponses([...writeErrors, 413, 415]),
        "201": jsonResponse(`Formulation committed, or replayed, at representation revision ${FORMULATION_REPRESENTATION_REVISION}.`, envelope, { ...etagHeader, ...locationHeader, ...writeHeaders }),
        "200": jsonResponse("Dry-run formulation preview; provisional ids and instants.", envelope, writeHeaders),
      }, [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(operationInput(createFormulationInput), { name: "Pure biochar", biocharRatio: 1, lines: [] }),
  };
  paths["/formulations/{idOrCode}"].patch = {
    ...privateOperation("update_formulation", "formulations:write",
      `Update by UUID only. Omission keeps, null clears nullable fields, and zero stays zero. Lines replace the whole list; retained types may be archived. Archived formulations answer 404 not_found at /formulationId before either stale precondition. Duplicate codes answer 409 conflict at /code. Removing a line used by products answers 409 conflict at /lines with formulationIngredientId, feedstockTypeId and productCodes metadata. Existing products keep their snapshots. ${INPUT_GUIDANCE} ${RETRY_GUIDANCE}`,
      { ...existingErrors, "200": jsonResponse("Updated or dry-run representation; ETag only on commit or replay.", envelope, { ...etagHeader, ...writeHeaders }) }, existingParameters),
    requestBody: requestBody(operationInput(updateFormulationApiInput), { description: "Mix to the recorded shares." }),
  };
  paths["/formulations/{idOrCode}"].delete = {
    ...privateOperation("delete_formulation", "formulations:delete",
      `Delete an unused formulation by UUID, including an archived one. Products, product bins or orders, including archived references, answer 409 conflict at /formulationId with productCodes, binCodes or orderCodes metadata. ${RETRY_GUIDANCE}`,
      {
        ...existingErrors,
        "204": { description: "Deleted, or replayed; no body or ETag.", headers: { ...privateHeaders, ...writeHeaders } },
        "200": jsonResponse("Dry-run representation that would be deleted.", envelope, writeHeaders),
      }, existingParameters),
    requestBody: emptyBody,
  };
  for (const command of ["archive", "restore"] as const) {
    paths[`/formulations/{idOrCode}/${command}`] = { post: {
      ...privateOperation(`${command}_formulation`, "formulations:write",
        `${command === "archive" ? "Archive" : "Restore"} a formulation by UUID. Missing or foreign targets answer 404 not_found at /formulationId. ${command === "archive" ? "Already archived" : "Not archived"} answers 409 conflict at /formulationId after version checks. Each transition increments the version. Archive keeps existing references; restore keeps retained lines even on archived feedstock types. ${RETRY_GUIDANCE}`,
        { ...existingErrors, "200": jsonResponse(`Transitioned or dry-run formulation at revision ${FORMULATION_REPRESENTATION_REVISION}; ETag only on commit or replay.`, envelope, { ...etagHeader, ...writeHeaders }) }, existingParameters),
      requestBody: emptyBody,
    } };
  }
}
