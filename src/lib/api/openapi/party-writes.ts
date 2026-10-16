import { CUSTOMER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { customerRepresentationSchema } from "@/lib/representations/customers";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import { createCustomerApiInput, updateCustomerApiInput } from "@/schemas/customer-input";
import { z } from "zod";
import { API_BODY_MAX_BYTES, SUPPLIER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { PARTY_MAX_LOCATIONS, LOCATION_DISTANCE_MIN_KM, LOCATION_DISTANCE_MAX_KM } from "@/config/party-input";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { itemEnvelopeSchema } from "@/lib/representations/envelopes";
import { supplierRepresentationSchema } from "@/lib/representations/suppliers";
import { createSupplierApiInput, updateSupplierApiInput } from "@/schemas/supplier-input";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { mutationQuerySchema } from "../query";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { etagHeader, idempotencyParameter, ifMatchParameter, jsonResponse, locationHeader, privateHeaders, problemResponses, queryParameters, targetParameter, writeHeaders } from "./transport";

interface PartyWriteKit {
  publishOutput: (schema: z.ZodType) => JsonSchema;
  writeErrors: number[];
}
const NAME_CONFLICT_GUIDANCE = "Duplicate names answer 409 conflict at /name; an archived-name conflict includes the scoped party id and archived: true in error metadata.";
const INPUT_GUIDANCE = `Create requires 1 to ${PARTY_MAX_LOCATIONS} locations with country and GPS; the last isDefault wins, otherwise the first location is default. Facility distances are one-way km from ${LOCATION_DISTANCE_MIN_KM} to ${LOCATION_DISTANCE_MAX_KM}; null removes a pair. Missing, foreign or archived facilities answer 404 not_found at /locations/{index}/facilityDistances/{index}/facilityId. Unknown keys, including contacts and nested fields, answer 422 validation_failed with JSON Pointers. ${NAME_CONFLICT_GUIDANCE}`;
const DRY_RUN_GUIDANCE = "Dry runs roll back every write and Activity event, return 200 and Dry-Run, and omit ETag and Location. Deadline exhaustion answers retryable 500 deadline_exceeded.";
const RETRY_GUIDANCE = `If-Match is required (428 precondition_required); a stale row version or representation revision answers 412 stale_version with current. Optional keyed replays precede domain preconditions. ${DRY_RUN_GUIDANCE}`;

export function addSupplierWritePaths(paths: Paths, { publishOutput, writeErrors }: PartyWriteKit) {
  const envelope = publishOutput(itemEnvelopeSchema(supplierRepresentationSchema));
  const createEnvelope = publishOutput(z.object({ data: supplierRepresentationSchema.describe("Created supplier representation."), locations: z.array(supplierLocationRepresentationSchema).describe("Created locations in input order, including ids, final versions and facility distance pairs.") }));
  const existingErrors = {
    ...problemResponses([...writeErrors, 412, 413, 415, 428]),
    "412": { $ref: "#/components/responses/SupplierProblem412" },
  };
  const existingParameters = [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)];
  const emptyBody = {
    required: false,
    description: `An empty object or no body; non-empty bodies require application/json, maximum ${API_BODY_MAX_BYTES} bytes.`,
    content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } },
  };
  paths["/suppliers"].post = {
    ...privateOperation("create_supplier", "suppliers:write",
      `Create one supplier with a generated code. Idempotency-Key is required even for dry runs (400 idempotency_key_required). A key reused with a different input answers 422 idempotency_key_reused. ${INPUT_GUIDANCE} ${DRY_RUN_GUIDANCE}`,
      {
        ...problemResponses([...writeErrors, 413, 415]),
        "201": jsonResponse(`Supplier committed, or replayed, at representation revision ${SUPPLIER_REPRESENTATION_REVISION}.`, createEnvelope, { ...etagHeader, ...locationHeader, ...writeHeaders }),
        "200": jsonResponse("Dry-run supplier preview; provisional ids and instants.", createEnvelope, writeHeaders),
      }, [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(operationInput(createSupplierApiInput), { name: "New supplier", locations: [{ name: "Main site", country: "Tanzania", gpsLatitude: -8, gpsLongitude: 34 }] }),
  };
  paths["/suppliers/{idOrCode}"].patch = {
    ...privateOperation("update_supplier", "suppliers:write",
      `Update by UUID only. Omission keeps and null clears nullable fields. Archived suppliers answer 404 not_found at /supplierId before either stale precondition. Duplicate codes answer 409 conflict at /code. Locations cannot be changed here. ${NAME_CONFLICT_GUIDANCE} ${RETRY_GUIDANCE}`,
      { ...existingErrors, "200": jsonResponse("Updated or dry-run representation; ETag only on commit or replay.", envelope, { ...etagHeader, ...writeHeaders }) }, existingParameters),
    requestBody: requestBody(operationInput(updateSupplierApiInput), { name: "Renamed supplier" }),
  };
  paths["/suppliers/{idOrCode}"].delete = {
    ...privateOperation("delete_supplier", "suppliers:delete",
      `Delete by UUID, including archived rows; deletes its locations and facility pairs. Intakes, including archived intakes, answer 409 conflict with feedstockCodes metadata. Blockers point at /supplierId. ${RETRY_GUIDANCE}`,
      {
        ...existingErrors,
        "204": { description: "Deleted, or replayed; no body or ETag.", headers: { ...privateHeaders, ...writeHeaders } },
        "200": jsonResponse("Dry-run representation that would be deleted.", envelope, writeHeaders),
      }, existingParameters),
    requestBody: emptyBody,
  };
  for (const command of ["archive", "restore"] as const) {
    paths[`/suppliers/{idOrCode}/${command}`] = { post: {
      ...privateOperation(`${command}_supplier`, "suppliers:write",
        `${command === "archive" ? "Archive" : "Restore"} a supplier by UUID. Missing or foreign targets answer 404 not_found at /supplierId. ${command === "archive" ? "Already archived" : "Not archived"} answers 409 conflict at /supplierId after version checks. Each transition increments the version. Archive keeps existing references; restore makes the party available for new references. ${RETRY_GUIDANCE}`,
        { ...existingErrors, "200": jsonResponse(`Transitioned or dry-run supplier at revision ${SUPPLIER_REPRESENTATION_REVISION}; ETag only on commit or replay.`, envelope, { ...etagHeader, ...writeHeaders }) }, existingParameters),
      requestBody: emptyBody,
    } };
  }
}

export function addCustomerWritePaths(paths: Paths, { publishOutput, writeErrors }: PartyWriteKit) {
  const envelope = publishOutput(itemEnvelopeSchema(customerRepresentationSchema));
  const createEnvelope = publishOutput(z.object({ data: customerRepresentationSchema.describe("Created customer representation."), locations: z.array(customerLocationRepresentationSchema).describe("Created locations in input order, including ids, final versions and facility distance pairs.") }));
  const existingErrors = {
    ...problemResponses([...writeErrors, 412, 413, 415, 428]),
    "412": { $ref: "#/components/responses/CustomerProblem412" },
  };
  const existingParameters = [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)];
  const emptyBody = {
    required: false,
    description: `An empty object or no body; non-empty bodies require application/json, maximum ${API_BODY_MAX_BYTES} bytes.`,
    content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } },
  };
  paths["/customers"].post = {
    ...privateOperation("create_customer", "customers:write",
      `Create one customer with a generated code. Idempotency-Key is required even for dry runs (400 idempotency_key_required). A key reused with a different input answers 422 idempotency_key_reused. ${INPUT_GUIDANCE} ${DRY_RUN_GUIDANCE}`,
      {
        ...problemResponses([...writeErrors, 413, 415]),
        "201": jsonResponse(`Customer committed, or replayed, at representation revision ${CUSTOMER_REPRESENTATION_REVISION}.`, createEnvelope, { ...etagHeader, ...locationHeader, ...writeHeaders }),
        "200": jsonResponse("Dry-run customer preview; provisional ids and instants.", createEnvelope, writeHeaders),
      }, [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(operationInput(createCustomerApiInput), { name: "New customer", locations: [{ name: "Main site", country: "Tanzania", gpsLatitude: -8, gpsLongitude: 34 }] }),
  };
  paths["/customers/{idOrCode}"].patch = {
    ...privateOperation("update_customer", "customers:write",
      `Update by UUID only. Omission keeps and null clears nullable fields. Archived customers answer 404 not_found at /customerId before either stale precondition. Duplicate codes answer 409 conflict at /code. Locations cannot be changed here. ${NAME_CONFLICT_GUIDANCE} ${RETRY_GUIDANCE}`,
      { ...existingErrors, "200": jsonResponse("Updated or dry-run representation; ETag only on commit or replay.", envelope, { ...etagHeader, ...writeHeaders }) }, existingParameters),
    requestBody: requestBody(operationInput(updateCustomerApiInput), { name: "Renamed customer" }),
  };
  paths["/customers/{idOrCode}"].delete = {
    ...privateOperation("delete_customer", "customers:delete",
      `Delete by UUID, including archived rows; deletes its locations and facility pairs. Orders, including archived orders, answer 409 conflict with orderCodes metadata; registered storage-site locations answer 409 with locationIds metadata. Blockers point at /customerId. ${RETRY_GUIDANCE}`,
      {
        ...existingErrors,
        "204": { description: "Deleted, or replayed; no body or ETag.", headers: { ...privateHeaders, ...writeHeaders } },
        "200": jsonResponse("Dry-run representation that would be deleted.", envelope, writeHeaders),
      }, existingParameters),
    requestBody: emptyBody,
  };
  for (const command of ["archive", "restore"] as const) {
    paths[`/customers/{idOrCode}/${command}`] = { post: {
      ...privateOperation(`${command}_customer`, "customers:write",
        `${command === "archive" ? "Archive" : "Restore"} a customer by UUID. Missing or foreign targets answer 404 not_found at /customerId. ${command === "archive" ? "Already archived" : "Not archived"} answers 409 conflict at /customerId after version checks. Each transition increments the version. Archive keeps existing references; restore makes the party available for new references. ${RETRY_GUIDANCE}`,
        { ...existingErrors, "200": jsonResponse(`Transitioned or dry-run customer at revision ${CUSTOMER_REPRESENTATION_REVISION}; ETag only on commit or replay.`, envelope, { ...etagHeader, ...writeHeaders }) }, existingParameters),
      requestBody: emptyBody,
    } };
  }
}

export function addPartyWritePaths(paths: Paths, kit: PartyWriteKit) {
  addSupplierWritePaths(paths, kit);
  addCustomerWritePaths(paths, kit);
}
