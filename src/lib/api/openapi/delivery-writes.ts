import { z } from "zod";
import { deliveryAllocationSchema, deliveryCreateEnvelopeSchema, deliveryUpdateEnvelopeSchema } from "@/lib/representations/delivery-writes";
import { recordDeliveryInput, updateDeliveryApiInput } from "@/schemas/delivery-input";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { mutationQuerySchema } from "../query";
import { problemSchema, stockPreviewSchema } from "../problem-schema";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { etagHeader, idempotencyParameter, ifMatchParameter, jsonResponse, locationHeader, problemResponseComponents, problemResponses, queryParameters, targetParameter, writeHeaders } from "./transport";

const deliveryConflictSchema = problemSchema.extend({
  preview: stockPreviewSchema.extend({
    allocations: z.array(deliveryAllocationSchema).optional().describe("Delivery allocations from the fresh dry run, in draw order. Allocation sums can differ from the delivery's 3 decimal place dryBiocharKg in trailing digits."),
  }).optional().describe(problemSchema.shape.preview.description!),
});

const CREATE_GUIDANCE = "A delivery sends finished product from a product bin to a customer against an order and deducts from the bin. Feedstock intake uses POST /feedstocks. Masses are wet kg; moisture is percent of wet mass. On create, moisturePercent is the measured reading. moisturePercent is ignored when sources are sent; each source carries its own reading and the stored value is the server-derived overall (1 minus total solids divided by wet mass) times 100, including ingredient solids. Distances are one-way km and the server counts the round trip. distanceKmOverride must be above 0; omit it to use the customer location's distance. deliveredAt is resolved in the order facility's time zone and cannot be in the future; DST gaps and folds are refused. Without sources, a split bin draws in its drawOrder, shown in the bin stock read. The dry run shows which products would be drawn in allocations, also returned on committed creates. Pass the dry run's basisFingerprint on the real write; a stale fingerprint answers 409 stock_basis_changed with a fresh stock preview including allocations when available. Without it the write acts on current stock.";
const CREATE_ERRORS = "Missing, foreign or archived orders and archived order facilities answer 404 not_found at /orderId. Missing, foreign or archived bins answer 404 not_found at /storageLocationId. Missing or foreign drivers and vehicles answer 404 not_found at /driverId and /vehicleId; missing or foreign source products at /sources/i/layerId. Invalid bin type, facility or formulation answers 422 validation_failed at /storageLocationId. Own-org source products in another bin or placed after the delivery answer 422 validation_failed at /sources/i/layerId. Sources on a mix bin answer 422 validation_failed at /sources; missing moisture at /moisturePercent. Future deliveredAt and local DST gaps or folds answer 422 validation_failed at /deliveredAt. Unknown fields answer 422 validation_failed at their field pointer with issue code unknown_field. An order balance overage answers 409 conflict at /deliveredWetMassKg with measure order_remaining_wet, availableWetKg, requestedWetKg and unit kg in issue metadata. Stock overdraw answers 409 insufficient_stock at /deliveredWetMassKg with the bin, measure, availableSolidsKg, requestedSolidsKg and unit kg. Certified order lineage answers 409 certification_locked at /orderId. A stale basisFingerprint answers 409 stock_basis_changed with a fresh preview when available.";

interface DeliveryWriteKit { publishOutput: (schema: z.ZodType) => JsonSchema; writeErrors: number[] }

export function addDeliveryWritePaths(paths: Paths, { publishOutput, writeErrors }: DeliveryWriteKit) {
  const createEnvelope = publishOutput(deliveryCreateEnvelopeSchema);
  paths["/deliveries"].post = {
    ...privateOperation("record_delivery", "deliveries:write",
      `Record one delivery with a generated code. ${CREATE_GUIDANCE} ${CREATE_ERRORS} A non-blocking warning asks you to upload the bill of lading as a delivery document of type bill_of_lading. Idempotency-Key is required, including dry runs. Dry runs roll back and return stockEffects and basisFingerprint; committed creates return Location and ETag.`,
      {
        ...problemResponses([...writeErrors, 413, 415]),
        "409": {
          ...problemResponseComponents().Problem409,
          content: { "application/problem+json": { schema: publishOutput(deliveryConflictSchema) } },
        },
        "201": jsonResponse("Delivery committed, or replayed, with allocations and an upload warning.", createEnvelope, { ...etagHeader, ...locationHeader, ...writeHeaders }),
        "200": jsonResponse("Dry-run delivery preview with stockEffects, basisFingerprint, allocations and an upload warning. No Location or ETag.", createEnvelope, writeHeaders),
      }, [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(operationInput(recordDeliveryInput), {
      orderId: "ea31ace1-5b30-4443-adb4-26b43bfa5599", storageLocationId: "df0f2a35-884c-4293-8783-31aa9fc5e315",
      deliveredAt: "2026-10-08T09:30:00Z", deliveredWetMassKg: 2400, moisturePercent: 31,
    }),
  };
  paths["/deliveries/{idOrCode}"].patch = {
    ...privateOperation("update_delivery", "deliveries:write",
      "Update delivery metadata by UUID with a strong If-Match; codes are refused in the path. Only code, driverId, vehicleId, distanceKmOverride, distanceSource and distanceNote can change. Mass, moisture, sources, time, order and bin are unknown keys and answer 422. Omitted fields stay unchanged. Null clears clearable fields; distanceKmOverride null clears its source unless documentary provenance is explicitly supplied. Distances are one-way km; the server counts the round trip. distanceKmOverride must be above 0. Archived deliveries or facilities cannot be updated. Missing or foreign driver and vehicle UUIDs answer 404 with a pointer. Certified lineage and duplicate codes answer 409. Missing If-Match answers 428; stale tags answer 412 with the current representation. Dry runs roll back and return 200 without ETag. An optional Idempotency-Key replays before precondition checks. PATCH does not add the create's bill-of-lading warning.",
      {
        ...problemResponses([...writeErrors, 412, 413, 415, 428]),
        "412": { $ref: "#/components/responses/DeliveryProblem412" },
        "200": jsonResponse("Updated delivery or dry-run representation. ETag is absent on dry runs.", publishOutput(deliveryUpdateEnvelopeSchema), { ...etagHeader, ...writeHeaders }),
      }, [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: requestBody(operationInput(updateDeliveryApiInput.omit({ expectedVersion: true })), { distanceKmOverride: 25, distanceSource: "manual", distanceNote: "Route confirmed by the driver." }),
  };
}
