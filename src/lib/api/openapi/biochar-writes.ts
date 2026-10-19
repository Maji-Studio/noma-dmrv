import type { z } from "zod";
import { biocharProductRepresentationSchema } from "@/lib/representations/biochar-products";
import { itemEnvelopeSchema, stockBasisWriteEnvelopeSchema } from "@/lib/representations/envelopes";
import { outputStockMovementRepresentationSchema } from "@/lib/representations/output-stock-movements";
import { makeBiocharProductApiInput, updateBiocharProductApiInput } from "@/schemas/biochar-product-input";
import { recordOutputStockMovementApiBody } from "@/schemas/output-stock-movement-input";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { mutationQuerySchema } from "../query";
import { operationInput, privateOperation, requestBody, type Paths } from "./operation-kit";
import { etagHeader, idempotencyParameter, ifMatchParameter, jsonResponse, locationHeader, problemResponses, queryParameters, targetParameter, writeHeaders } from "./transport";

const EXAMPLE_FACILITY_ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const EXAMPLE_FORMULATION_ID = "0c6a1e3a-4a3f-4d0e-9a38-7a1f5c3f1b20";
const EXAMPLE_SOURCE_BIN_ID = "ea31ace1-5b30-4443-adb4-26b43bfa5599";
const EXAMPLE_PRODUCT_BIN_ID = "df0f2a35-884c-4293-8783-31aa9fc5e315";

const BASIS_GUIDANCE = "Dry runs return basisFingerprint with the stock effects. Send it back as basisFingerprint to refuse the write if stock moved since; the refusal is 409 stock_basis_changed with a fresh preview. Without it the write acts on current stock.";
const UNITS_GUIDANCE = "Masses are kilograms and moisture is percent of wet mass. Send event times as RFC 3339 with an explicit offset or as facility-local { date, time }; a time in the future is refused.";

interface BiocharWriteKit {
  publishOutput: (schema: z.ZodType) => JsonSchema;
  writeErrors: number[];
}

/** Product create and update, and loss and count postings on output bins. Products are never deleted through the API. */
export function addBiocharWritePaths(paths: Paths, { publishOutput, writeErrors }: BiocharWriteKit) {
  const productEnvelope = publishOutput(stockBasisWriteEnvelopeSchema(biocharProductRepresentationSchema));
  const createResponses = {
    ...problemResponses([...writeErrors, 413, 415]),
    "201": jsonResponse("Product committed, or replayed.", productEnvelope, { ...etagHeader, ...locationHeader, ...writeHeaders }),
    "200": jsonResponse("Dry-run product preview with stockEffects and basisFingerprint.", productEnvelope, writeHeaders),
  };
  paths["/biochar-products"].post = {
    ...privateOperation("make_biochar_product", "biochar-products:write",
      `Make a biochar product: draw biochar (and ingredients, for a blend) from bins and place it in a product bin. The biochar mass is as weighed, without ingredients or water; the server derives the stored blend. Refusals: 404 for an unknown or foreign reference, 409 insufficient_stock, stock_basis_changed, certification_locked or conflict, 422 for invalid input. ${BASIS_GUIDANCE} ${UNITS_GUIDANCE} Location and ETag appear only on committed creates.`,
      createResponses, [...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(operationInput(makeBiocharProductApiInput), {
      facilityId: EXAMPLE_FACILITY_ID, formulationId: EXAMPLE_FORMULATION_ID, placedAt: "2026-10-08T09:30:00Z",
      sourceBiocharStorageLocationId: EXAMPLE_SOURCE_BIN_ID, storageLocationId: EXAMPLE_PRODUCT_BIN_ID,
      biocharWetMassKg: 500, biocharMoisturePercent: 10, waterAddedKg: 0, ingredients: [],
    }),
  };
  paths["/biochar-products/{idOrCode}"].patch = {
    ...privateOperation("update_biochar_product", "biochar-products:write",
      "Update a product by UUID with a strong If-Match. Only code, status and densityKgM3 can change; null clears the density. Where, from what and how much the product was drawn is fixed once posted. Omission preserves fields. Dry runs roll back; replays precede precondition checks.",
      {
        ...problemResponses([...writeErrors, 412, 413, 415, 428]),
        "412": { $ref: "#/components/responses/BiocharProductProblem412" },
        "200": jsonResponse("Updated product or dry-run representation. ETag is absent on dry runs.", publishOutput(itemEnvelopeSchema(biocharProductRepresentationSchema)), { ...etagHeader, ...writeHeaders }),
      },
      [targetParameter(true), ...queryParameters(mutationQuerySchema), ifMatchParameter, idempotencyParameter(false)]),
    requestBody: requestBody(operationInput(updateBiocharProductApiInput), { status: "ready", densityKgM3: 250 }),
  };
  const movementEnvelope = publishOutput(stockBasisWriteEnvelopeSchema(outputStockMovementRepresentationSchema));
  paths["/storage-locations/{idOrCode}/stock-movements"].post = {
    ...privateOperation("record_output_stock_movement", "biochar-products:write",
      `Record a loss or a count on a biochar or product bin, by bin UUID. A loss is wet mass that left the bin. A count is the whole bin weighed: it resets stock and moisture and never raises stock, and a count of 0 records the bin as empty. Corrections are not available. A feedstock bin answers 422 and a missing, archived or foreign bin 404, both on /storageLocationId. ${BASIS_GUIDANCE} ${UNITS_GUIDANCE} Movements are not versioned and have no read by id, so the 201 carries neither ETag nor Location.`,
      {
        ...problemResponses([...writeErrors, 413, 415]),
        "201": jsonResponse("Movement committed, or replayed.", movementEnvelope, writeHeaders),
        "200": jsonResponse("Dry-run movement preview with stockEffects and basisFingerprint.", movementEnvelope, writeHeaders),
      },
      [targetParameter(true), ...queryParameters(mutationQuerySchema), idempotencyParameter(true)]),
    requestBody: requestBody(operationInput(recordOutputStockMovementApiBody), {
      kind: "loss", occurredAt: "2026-10-08T09:30:00Z", wetMassKg: 25, moisturePercent: 10, reason: "Spilled while loading.",
    }),
  };
}
