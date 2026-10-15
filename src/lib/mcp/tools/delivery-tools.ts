import { DELIVERY_REPRESENTATION_REVISION } from "@/config/api-rest";
import { deliveryBody, recordedDeliveryBody, representationCheckedRecord, representationCheckedUpdate, withCurrentOnStale } from "@/lib/api/delivery-write-checks";
import { REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";
import { updateDeliveryOperation } from "@/lib/operations/deliveries";
import { validationFailed } from "@/lib/operations/errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { runWithStockBasisPreview } from "@/lib/operations/stock-basis-preview";
import type { DeliveryRepresentation } from "@/lib/representations/deliveries";
import { deliveryCreateEnvelopeSchema, deliveryUpdateEnvelopeSchema } from "@/lib/representations/delivery-writes";
import { recordDeliveryInput } from "@/schemas/delivery-input";
import { controls, parseControls, stockWriteOptions, writeOptions } from "./write-controls";
import type { WriteTool } from "./write-tools";

const createInput = recordDeliveryInput.safeExtend(controls.shape);
const updateInput = updateDeliveryOperation.input.safeExtend(controls.shape);
const createContract = toOperationJsonSchema(createInput);
const updateContract = toOperationJsonSchema(updateInput);
const annotations = { readOnlyHint: false, openWorldHint: false, idempotentHint: true } as const;
const guidance = `${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;

export const deliveryWriteTools: WriteTool[] = [
  {
    kind: "write", name: "record_delivery", scope: "deliveries:write", input: createInput, output: deliveryCreateEnvelopeSchema,
    annotations: { ...annotations, destructiveHint: false },
    description: `Record one finished-product delivery against an order; this is not feedstock intake (use log_feedstock_delivery). Call find_orders and get_order_balance for remaining wet kg, then find_storage_locations with type=product_bin and the order's formulationId, then get_bin_stock for drawOrder and sub-bins. This deducts from the product bin. Mass is wet kg; moisture is percent of wet mass. Distances are one-way km; the server counts the round trip. Omit distanceKmOverride to use the customer location's distance; an override must be above 0. Without sources, a split bin draws in its drawOrder. A dry run's stockEffects and allocations show which products would be drawn; pass its basisFingerprint on the real write. deliveredAt is resolved in the order facility's zone, accepts { date, time }, and cannot be in the future. Never invent moisture readings: ask the operator. A top-level moisturePercent is ignored when sources is sent; each source carries its own reading and the stored overall moisture is 100 times (1 minus solids divided by wet mass), including ingredient solids. Without sources, moisturePercent is the recorded reading. Upload the bill of lading with request_document_upload (ownerType delivery, documentType bill_of_lading); the result includes a non-blocking warning until then. ${guidance}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, createContract);
      const result = await runWithStockBasisPreview(representationCheckedRecord, context.ctx, input,
        stockWriteOptions(context, dryRun, requestKey), data => data.basisFingerprint, data => data.allocations);
      return { ...result, body: recordedDeliveryBody(result, dryRun) };
    },
    summarize(body, dryRun) {
      const row = body.data as DeliveryRepresentation;
      const headline = dryRun ? `Dry run: would record delivery ${row.code} (provisional code).` : `Recorded delivery ${row.code} (version ${row.version}).`;
      return [headline, ...((body.warnings as string[] | undefined) ?? [])].join(" ");
    },
  },
  {
    kind: "write", name: "update_delivery", scope: "deliveries:write", input: updateInput, output: deliveryUpdateEnvelopeSchema,
    annotations: { ...annotations, destructiveHint: true },
    description: `Update delivery metadata only: code, driver, vehicle and distance. Send only changed fields; omission preserves fields and null clears clearable fields. Mass, moisture and time fixes are corrections made in the app. Call get_delivery first and pass version as expectedVersion; a stale version returns the current record. Distance is one-way km; the server counts the round trip, and distanceKmOverride must be above 0 or null to clear it. ${guidance}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, updateContract);
      const parsed = updateDeliveryOperation.input.safeParse(input);
      if (!parsed.success) throw validationFailed(parsed.error);
      const { deliveryId, expectedVersion } = parsed.data;
      return withCurrentOnStale(context.ctx, deliveryId, async () => {
        const result = await runOperation(representationCheckedUpdate(deliveryId, DELIVERY_REPRESENTATION_REVISION), context.ctx, input,
          writeOptions(context, dryRun, requestKey, deliveryId, expectedVersion, DELIVERY_REPRESENTATION_REVISION));
        return { ...result, body: deliveryBody(result.data) };
      });
    },
    summarize(body, dryRun) {
      const row = body.data as DeliveryRepresentation;
      return dryRun ? `Dry run: would update delivery ${row.code} to version ${row.version}.` : `Updated delivery ${row.code} to version ${row.version}.`;
    },
  },
];
