import { z } from "zod";
import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { guidedWriteEnvelopeSchema, itemEnvelopeSchema } from "@/lib/representations/envelopes";
import { orderRepresentationSchema } from "@/lib/representations/orders";
import { recordOrderInput, updateOrderApiInput } from "@/schemas/order-input";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { mutationQuerySchema } from "../query";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { etagHeader, idempotencyParameter, ifMatchParameter, jsonResponse, locationHeader, privateHeaders, problemResponses, queryParameters, targetParameter, writeHeaders } from "./transport";

const EXAMPLE_CUSTOMER_LOCATION_ID = "a12c2b2d-3296-4ea7-9ff8-24e899bed679";
const CREATE_GUIDANCE = "A customer location is required for the delivery destination. Quantity is requested wet product kg. Omitted packaging defaults to the organization setting. orderDate is a calendar date (YYYY-MM-DD), not an event instant. An order does not reserve stock. Unknown or foreign references answer 404 not_found with a pointer. Invalid input answers 422 validation_failed.";
const WRITE_GUIDANCE = "Quantity is requested wet product kg. On create, omitted packaging defaults to the organization setting. On update, omission keeps the stored packaging. orderDate is a calendar date (YYYY-MM-DD), not an event instant. An order does not reserve stock.";
const ERROR_GUIDANCE = "Missing, foreign or archived references answer 404 not_found with a pointer. Duplicate codes answer 409 conflict. Relationships frozen by deliveries and Sent lineage answer 409 certification_locked. Invalid input answers 422 validation_failed; a quantity below allocations includes allocatedWetKg and unit kg in issue metadata.";

interface OrderWriteKit {
  publishOutput: (schema: z.ZodType) => JsonSchema;
  writeErrors: number[];
}

/** Order writes share the transactional operation contract. */
export function addOrderWritePaths(paths: Paths, { publishOutput, writeErrors }: OrderWriteKit) {
  const envelope = publishOutput(guidedWriteEnvelopeSchema(orderRepresentationSchema));
  paths["/orders"].post = {
    ...privateOperation("record_order", "orders:write",
      `Record one order. The code is generated. ${CREATE_GUIDANCE} Dry runs roll back and still need an Idempotency-Key. Location and ETag appear only on committed creates.`,
      {
        ...problemResponses([...writeErrors, 413, 415]),
        "201": jsonResponse("Order committed, or replayed.", envelope, { ...etagHeader, ...locationHeader, ...writeHeaders }),
        "200": jsonResponse("Dry-run order preview.", envelope, writeHeaders),
      },
      [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(operationInput(recordOrderInput), {
      facilityId: "df2795a4-886b-4a89-bbdd-532c6b1b8e45", customerId: "ea31ace1-5b30-4443-adb4-26b43bfa5599",
      customerLocationId: EXAMPLE_CUSTOMER_LOCATION_ID,
      formulationId: "b54b7b81-9b54-4757-ae1b-99fb28ea1c7f", orderDate: "2026-10-08", quantityKg: 2400,
    }),
  };
  paths["/orders/{idOrCode}"].patch = {
    ...privateOperation("update_order", "orders:write",
      `Update by UUID with a strong If-Match; codes are not accepted in the path. Omitted fields stay unchanged; customerLocationId cannot be null or empty. Changing customerId requires a customerLocationId belonging to the new customer; otherwise the response is 422 validation_failed (Delivery location belongs to a different customer). Facility, customer, customer location and formulation freeze once any delivery exists, including archived deliveries. Archived orders cannot be updated. ${WRITE_GUIDANCE} ${ERROR_GUIDANCE} Dry runs roll back; keyed replays precede precondition checks.`,
      {
        ...problemResponses([...writeErrors, 412, 413, 415, 428]),
        "412": { $ref: "#/components/responses/OrderProblem412" },
        "200": jsonResponse("Updated order or dry-run representation. ETag is absent on dry runs.", envelope, { ...etagHeader, ...writeHeaders }),
      },
      [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: requestBody(operationInput(updateOrderApiInput), { quantityKg: 2500, customerLocationId: EXAMPLE_CUSTOMER_LOCATION_ID }),
  };
  paths["/orders/{idOrCode}"].delete = {
    ...privateOperation("delete_order", "orders:delete",
      "Delete by UUID with a strong If-Match. Requires orders:delete, a separate scope that is off by default. Only orders with no deliveries, including archived deliveries, can be deleted; otherwise the response is 409 certification_locked. An archived order without deliveries can be deleted. Certified lineage answers 409 certification_locked. The deletion retires order documents; storage cleanup runs after commit. Dry runs roll back and return the representation that would be deleted. A supplied body must be an empty JSON object.",
      {
        ...problemResponses([...writeErrors, 412, 413, 415, 428]),
        "412": { $ref: "#/components/responses/OrderProblem412" },
        "204": { description: "Deleted, or replay of a committed deletion; no body.", headers: { ...privateHeaders, ...writeHeaders } },
        "200": jsonResponse("Dry-run deleted representation.", publishOutput(itemEnvelopeSchema(orderRepresentationSchema)), writeHeaders),
      },
      [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: {
      required: false,
      description: `Optional empty JSON object, maximum ${API_BODY_MAX_BYTES} bytes.`,
      content: { "application/json": { schema: operationInput(z.strictObject({})), example: {} } },
    },
  };
}
