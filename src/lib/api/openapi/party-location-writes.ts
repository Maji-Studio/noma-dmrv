import { z } from "zod";
import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { LOCATION_DISTANCE_MIN_KM, LOCATION_DISTANCE_MAX_KM } from "@/config/party-input";
import { supplierLocationApiInput, customerLocationApiInput } from "@/schemas/party-location-input";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { mutationQuerySchema } from "../query";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { etagHeader, idempotencyParameter, ifMatchParameter, jsonResponse, locationHeader, privateHeaders, problemResponses, queryParameters, targetParameter, writeHeaders } from "./transport";

const DRY_RUN = "Dry runs roll back all writes and Activity, return 200 with Dry-Run, and omit ETag and Location. Deadline exhaustion answers retryable 500 deadline_exceeded.";
const RETRY = `If-Match requires the child's strong ETag (428 precondition_required when absent). Stale row versions or representation revisions answer 412 stale_version with the current location. Optional Idempotency-Key replays precede domain preconditions, including after deletion or archive. Changed keyed input answers 422 idempotency_key_reused; a committed key on a dry run answers 409 key_already_used. ${DRY_RUN}`;
const TARGET = "Writes take UUIDs only. Missing, foreign or wrong-parent locations answer 404 not_found at /locationId before stale row versions or representation revisions. Archived parents answer 404 not_found at the parent id before either stale precondition. Location writes do not change the parent version.";
const PAIRS = `Facility distances are one-way km from ${LOCATION_DISTANCE_MIN_KM} to ${LOCATION_DISTANCE_MAX_KM}; null removes a pair, omitted pairs stay. Every stored pair is returned, including archived facilities. Pairs for archived facilities can be retained or cleared but not set; missing, foreign or archived facilities being set answer 404 not_found at /facilityDistances/{index}/facilityId. Unknown fields answer 422 validation_failed with JSON Pointers.`;

export function addPartyLocationWritePaths(paths: Paths, { publishOutput, writeErrors }: {
  publishOutput: (schema: z.ZodType) => JsonSchema; writeErrors: number[];
}) {
  const emptyBody = { required: false,
    description: `An empty object or no body; non-empty bodies require application/json, maximum ${API_BODY_MAX_BYTES} bytes.`,
    content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } } };
  for (const kind of ["supplier", "customer"] as const) {
    const cap = kind === "supplier" ? "Supplier" : "Customer";
    const input = kind === "supplier" ? supplierLocationApiInput : customerLocationApiInput;
    const representation = kind === "supplier" ? supplierLocationRepresentationSchema : customerLocationRepresentationSchema;
    const envelope = publishOutput(z.object({ data: representation.describe("Location representation."), warnings: z.array(z.string()).optional().describe("Default-location changes or distance-fill results, when present.") }));
    const collection = `/${kind}s/{idOrCode}/locations`;
    const detail = `${collection}/{locationId}`;
    const parameters = [targetParameter(true), { name: "locationId", in: "path", required: true,
      description: "Location identifier under this parent, UUID.", schema: { type: "string", format: "uuid" } },
    ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)];
    const errors = { ...problemResponses([...writeErrors, 412, 413, 415, 428]), "412": { $ref: `#/components/responses/${cap}LocationProblem412` } };
    paths[collection].post = {
      ...privateOperation(`add_${kind}_location`, `${kind}s:write`,
        `Add one location under a parent UUID. Idempotency-Key is required even for dry runs (400 idempotency_key_required). Changed keyed input answers 422 idempotency_key_reused; a committed key on a dry run answers 409 key_already_used. Missing, foreign or archived parents answer 404 not_found at /${kind}Id. Country and GPS are required. isDefault: true promotes this location; otherwise it becomes default only if there is no active default. ${PAIRS} ${DRY_RUN}`,
        { ...problemResponses([...writeErrors, 413, 415]),
          "201": jsonResponse("Location committed or replayed. Location identifies the child and ETag validates its representation.", envelope, { ...etagHeader, ...locationHeader, ...writeHeaders }),
          "200": jsonResponse("Dry-run location preview with provisional identifiers.", envelope, writeHeaders) },
        [targetParameter(true), ...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
      requestBody: requestBody(operationInput(input), { name: "North field", country: "Tanzania", gpsLatitude: -8, gpsLongitude: 34 }),
    };
    paths[detail].patch = {
      ...privateOperation(`update_${kind}_location`, `${kind}s:write`,
        `Update a location. Omission keeps values; null clears optional text${kind === "customer" ? " and defaultSoilTemperatureC" : " including name"}. Country${kind === "customer" ? " and name are" : " is"} not nullable. GPS changes as a pair. Empty PATCH answers 422 validation_failed. isDefault: true promotes; false on the current default is coerced back to true. ${kind === "customer" ? "An archived location answers 404 not_found at /locationId before either stale precondition. Registered storage-site name or GPS changes answer 409 certification_locked at the first changed field. A busy registration fence answers retryable 409 conflict at /locationId." : ""} ${TARGET} ${PAIRS} ${RETRY}`,
        { ...errors, "200": jsonResponse("Updated or dry-run location; ETag only on commit or replay.", envelope, { ...etagHeader, ...writeHeaders }) }, parameters),
      requestBody: requestBody(operationInput(z.object(input.shape).partial()), { city: "Mbeya" }),
    };
    paths[detail].delete = {
      ...privateOperation(`delete_${kind}_location`, `${kind}s:delete`,
        `Delete a location and its facility pairs. Deleting the default promotes the next active sibling and returns a warning in dry runs. ${kind === "customer" ? "Orders, including archived orders, or a registered storage site answer 409 conflict at /locationId; order blockers include orderCodes metadata. A busy registration fence answers retryable 409 conflict. An archived location may be deleted." : "Default promotion does not fill intake distances."} ${TARGET} ${RETRY}`,
        { ...errors, "204": { description: "Deleted or replayed; no body or ETag.", headers: { ...privateHeaders, ...writeHeaders } },
          "200": jsonResponse("Dry-run pre-delete location and any warnings.", envelope, writeHeaders) }, parameters),
      requestBody: emptyBody,
    };
    if (kind === "customer") for (const command of ["archive", "restore"] as const) {
      paths[`${detail}/${command}`] = { post: {
        ...privateOperation(`${command}_customer_location`, "customers:write",
          `${command === "archive" ? "Archive" : "Restore"} a customer location. Each transition increments the child version. Repeating with an old ETag answers 412 stale_version; with the current ETag it answers 409 conflict at /locationId. Archive of the last active location answers 409 conflict. Archiving the default promotes an active sibling and returns a warning. Restore sets the default only if there is no active default. Existing orders retain archived locations. ${TARGET} ${RETRY}`,
          { ...errors, "200": jsonResponse("Transitioned or dry-run location; ETag only on commit or replay.", envelope, { ...etagHeader, ...writeHeaders }) }, parameters),
        requestBody: emptyBody,
      } };
    }
  }
}
